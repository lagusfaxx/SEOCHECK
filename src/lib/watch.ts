/**
 * Vigilancia: detecta lo que puede hacer perder tráfico de un día para otro y avisa por correo al instante.
 *
 * - Cambios entre los dos últimos crawls: title, canonical, noindex, H1 y estado HTTP por URL (un deploy que
 *   cambia sin querer muchas páginas es la causa más común de caídas).
 * - Reglas críticas: home caída, noindex nuevo o error nuevo en páginas con tráfico, robots.txt que bloquea todo,
 *   canonical cambiado en masa, caída fuerte de clics, caída de ranking y pérdida de un backlink de autoridad.
 *
 * Cada aviso se guarda como Alert (tipo "watch") y se envía una sola vez por semana por clave. Solo a miembros
 * del workspace.
 */
import { db } from "./db";
import { sendMail, mailTemplate } from "./mail";
import { appBaseUrl, urlKey } from "./util";
import { gscPeriod } from "./gsc-period";

const DAY = 864e5;

// ---------- cambios entre crawls (puro) ----------

export type PageSnap = { url: string; status: number; title: string | null; canonical: string | null; noindex: boolean; h1: string[]; error?: string | null };
export type Change = { url: string; field: "status" | "title" | "canonical" | "noindex" | "h1" | "gone"; before: string; after: string };

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Diferencias por URL entre dos crawls. "gone" solo si el crawl nuevo está completo (si no, no se sabe). */
export function diffCrawls(prev: PageSnap[], cur: PageSnap[], curComplete: boolean): Change[] {
  const now = new Map(cur.map((p) => [urlKey(p.url), p]));
  const out: Change[] = [];
  for (const a of prev) {
    const b = now.get(urlKey(a.url));
    if (!b) {
      if (curComplete && a.status === 200) out.push({ url: a.url, field: "gone", before: "200", after: "no encontrada en el crawl" });
      continue;
    }
    if (a.status !== b.status) out.push({ url: a.url, field: "status", before: String(a.status || "sin respuesta"), after: String(b.status || "sin respuesta") });
    // lo demás solo se compara entre páginas que respondieron bien
    if (a.status !== 200 || b.status !== 200) continue;
    if (a.noindex !== b.noindex) out.push({ url: a.url, field: "noindex", before: a.noindex ? "noindex" : "indexable", after: b.noindex ? "noindex" : "indexable" });
    if (norm(a.title) !== norm(b.title)) out.push({ url: a.url, field: "title", before: norm(a.title) || "(sin title)", after: norm(b.title) || "(sin title)" });
    if (norm(a.canonical) !== norm(b.canonical)) out.push({ url: a.url, field: "canonical", before: norm(a.canonical) || "(sin canonical)", after: norm(b.canonical) || "(sin canonical)" });
    if (norm(a.h1[0]) !== norm(b.h1[0])) out.push({ url: a.url, field: "h1", before: norm(a.h1[0]) || "(sin H1)", after: norm(b.h1[0]) || "(sin H1)" });
  }
  return out;
}

export const FIELD_LABEL: Record<Change["field"], string> = { status: "estado HTTP", title: "title", canonical: "canonical", noindex: "noindex", h1: "H1", gone: "página desaparecida" };

export type WatchAlert = { key: string; severity: "critical" | "warning"; title: string; detail: string; urls: string[] };

/**
 * Reglas sobre los cambios: lo grave es lo que toca páginas con tráfico o muchas páginas a la vez.
 * `impr` = impresiones de 28 días por urlKey.
 */
export function changeAlerts(changes: Change[], impr: Map<string, number>, opts: { massMin?: number } = {}): WatchAlert[] {
  const massMin = opts.massMin ?? 10;
  const hasTraffic = (u: string) => (impr.get(urlKey(u)) ?? 0) > 0;
  const out: WatchAlert[] = [];
  const noindexNew = changes.filter((c) => c.field === "noindex" && c.after === "noindex" && hasTraffic(c.url));
  if (noindexNew.length) out.push({ key: "noindex-new", severity: "critical", title: `noindex nuevo en ${noindexNew.length} página(s) con tráfico`, detail: "Estas páginas reciben impresiones en Google y ahora piden no indexarse. Si no fue intencional, quitar el noindex ya.", urls: noindexNew.map((c) => c.url) });
  const broke = changes.filter((c) => (c.field === "status" && c.before === "200" && !c.after.startsWith("3")) || c.field === "gone").filter((c) => hasTraffic(c.url));
  if (broke.length) out.push({ key: "broken-new", severity: "critical", title: `${broke.length} página(s) con tráfico dejaron de responder bien`, detail: "Antes respondían 200 y ahora dan error o no aparecen. Restaurar o redirigir con 301.", urls: broke.map((c) => `${c.url} (${c.after})`) });
  for (const field of ["canonical", "title"] as const) {
    const list = changes.filter((c) => c.field === field);
    if (list.length >= massMin) out.push({ key: `mass-${field}`, severity: field === "canonical" ? "critical" : "warning", title: `${FIELD_LABEL[field]} cambió en ${list.length} páginas a la vez`, detail: `Un cambio masivo suele venir de un deploy. Ejemplo: «${list[0].before}» → «${list[0].after}».`, urls: list.map((c) => c.url) });
  }
  return out;
}

/** robots.txt que bloquea todo el sitio a Googlebot o a todos. */
export function robotsBlocksAll(txt: string | null) {
  if (!txt) return false;
  let applies = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k)) applies = v === "*" || /googlebot/i.test(v);
    else if (applies && /^disallow$/i.test(k) && v === "/") return true;
  }
  return false;
}

/** Caída fuerte: últimos 7 días contra los 7 anteriores, con base suficiente para que no sea ruido. */
export function clickDrop(last7: number, prev7: number, minBase = 70, threshold = 0.4) {
  return prev7 >= minBase && last7 < prev7 * (1 - threshold);
}

// ---------- base de datos ----------

/** Cambios entre los dos últimos crawls terminados del proyecto. */
export async function latestCrawlChanges(projectId: string) {
  const [cur, prev] = await db.crawl.findMany({ where: { projectId, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" }, take: 2 });
  if (!cur || !prev) return null;
  const sel = { url: true, status: true, title: true, canonical: true, noindex: true, h1: true, error: true } as const;
  const [a, b] = await Promise.all([db.page.findMany({ where: { crawlId: prev.id }, select: sel }), db.page.findMany({ where: { crawlId: cur.id }, select: sel })]);
  return { current: cur, previous: prev, changes: diffCrawls(a, b, cur.status === "completed") };
}

async function impressionsByUrl(projectId: string) {
  const period = await gscPeriod(projectId);
  if (!period) return new Map<string, number>();
  const rows = await db.gscRow.groupBy({ by: ["page"], where: { projectId, date: { gte: period.start, lt: period.endExclusive } }, _sum: { impressions: true } });
  const m = new Map<string, number>();
  for (const r of rows) m.set(urlKey(r.page), (m.get(urlKey(r.page)) ?? 0) + (r._sum.impressions ?? 0));
  return m;
}

/** Destinatarios de avisos: los configurados (solo miembros) o, si no hay, dueños y admins del workspace. */
export async function alertRecipients(projectId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { workspaceId: true, settings: true } });
  const members = await db.membership.findMany({ where: { workspaceId: p.workspaceId }, select: { role: true, user: { select: { email: true } } } });
  const configured = ((((p.settings ?? {}) as any).alerts?.emails ?? []) as string[]).map((e) => e.toLowerCase());
  const allowed = new Set(members.map((m) => m.user.email.toLowerCase()));
  if (configured.length) return configured.filter((e) => allowed.has(e));
  return members.filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.user.email);
}

/** Evalúa todas las reglas, guarda los avisos nuevos y los envía por correo. Devuelve los nuevos. */
export async function runWatch(projectId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  if ((((p.settings ?? {}) as any).alerts?.immediate ?? true) === false) return [];
  const alerts: WatchAlert[] = [];
  const impr = await impressionsByUrl(projectId);

  // 1. crawl: home caída, robots que bloquea todo y cambios entre crawls
  const c = await latestCrawlChanges(projectId);
  const latest = c?.current ?? (await db.crawl.findFirst({ where: { projectId, status: { in: ["completed", "partial", "failed"] } }, orderBy: { startedAt: "desc" } }));
  if (latest) {
    const home = await db.page.findFirst({ where: { crawlId: latest.id, depth: 0 }, select: { url: true, status: true, error: true } });
    if (latest.status === "failed" || (home && (home.status !== 200 || home.error)))
      alerts.push({ key: `home-down-${latest.id}`, severity: "critical", title: "La home no responde bien", detail: latest.reason ?? `La página de inicio respondió ${home?.error ?? `HTTP ${home?.status}`}.`, urls: home ? [home.url] : [`https://${p.domain}/`] });
    if (robotsBlocksAll(latest.robots)) alerts.push({ key: "robots-all", severity: "critical", title: "robots.txt bloquea todo el sitio", detail: "Hay un «Disallow: /» para todos o para Googlebot: Google deja de rastrear el sitio.", urls: [`https://${p.domain}/robots.txt`] });
  }
  if (c) for (const a of changeAlerts(c.changes, impr)) alerts.push({ ...a, key: `${a.key}-${c.current.id}` });

  // 2. Search Console: caída fuerte de clics en la última semana
  const lastDay = await db.gscDay.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } });
  if (lastDay) {
    const end = new Date(lastDay.date.getTime() + DAY);
    const sum = async (from: Date, to: Date) => (await db.gscDay.aggregate({ where: { projectId, date: { gte: from, lt: to } }, _sum: { clicks: true } }))._sum.clicks ?? 0;
    const [l7, p7] = await Promise.all([sum(new Date(end.getTime() - 7 * DAY), end), sum(new Date(end.getTime() - 14 * DAY), new Date(end.getTime() - 7 * DAY))]);
    if (clickDrop(l7, p7)) alerts.push({ key: `clicks-drop-${lastDay.date.toISOString().slice(0, 10)}`, severity: "critical", title: `Los clics cayeron ${Math.round((1 - l7 / p7) * 100)} % en la última semana`, detail: `${l7} clics en los últimos 7 días con datos contra ${p7} en los 7 anteriores. Revisar cambios recientes, indexación y la sección Resultados.`, urls: [] });
  }

  // 3. rankings: caídas recientes (ya detectadas por computeAlerts)
  const drops = await db.alert.findMany({ where: { projectId, type: "drop", createdAt: { gte: new Date(Date.now() - 2 * DAY) } } });
  for (const d of drops) {
    const data = d.data as any;
    if ((data.from ?? 101) <= 10) alerts.push({ key: `rank-${d.key}-${d.id}`, severity: "warning", title: `«${d.key}» cayó de la posición ${data.from} a ${data.to ?? "fuera del top 100"}`, detail: "Era una keyword de primera página.", urls: data.url ? [data.url] : [] });
  }

  // 4. backlinks: dominios de autoridad perdidos en la última foto
  const bl = await db.backlinkSnapshot.findFirst({ where: { projectId, createdAt: { gte: new Date(Date.now() - 2 * DAY) } }, orderBy: { createdAt: "desc" } });
  if (bl) {
    const lost = ((bl.lost as any[]) ?? []).filter((d) => Number(d.rank) >= 300);
    if (lost.length) alerts.push({ key: `bl-lost-${bl.id}`, severity: "warning", title: `Se perdieron links de ${lost.length} dominio(s) de autoridad`, detail: lost.slice(0, 5).map((d) => `${d.domain} (rank ${d.rank})`).join(", "), urls: [] });
  }

  // guardar y enviar solo lo nuevo (misma clave: una vez por semana)
  const fresh: WatchAlert[] = [];
  for (const a of alerts) {
    const exists = await db.alert.findFirst({ where: { projectId, type: "watch", key: a.key, createdAt: { gte: new Date(Date.now() - 7 * DAY) } } });
    if (exists) continue;
    await db.alert.create({ data: { projectId, type: "watch", key: a.key, data: { severity: a.severity, title: a.title, detail: a.detail, urls: a.urls.slice(0, 20) } } });
    fresh.push(a);
  }
  if (fresh.length) {
    const to = await alertRecipients(projectId);
    const critical = fresh.filter((a) => a.severity === "critical").length;
    const { text, html } = mailTemplate(
      `${critical ? "⚠ " : ""}${fresh.length} aviso(s) SEO · ${p.name}`,
      fresh.flatMap((a) => [`${a.severity === "critical" ? "URGENTE — " : ""}${a.title}. ${a.detail}${a.urls.length ? ` Ej.: ${a.urls.slice(0, 3).join(", ")}` : ""}`]),
      appBaseUrl() ? { label: "Ver en FSV Search", url: `${appBaseUrl()}/p/${projectId}/results` } : undefined,
      "Recibes estos avisos como miembro del equipo del proyecto. Puedes cambiar quién los recibe en Resultados."
    );
    for (const email of to) await sendMail(email, `${critical ? "⚠ " : ""}Aviso SEO · ${p.name}: ${fresh[0].title}`, text, undefined, html).catch(() => "logged");
  }
  return fresh;
}
