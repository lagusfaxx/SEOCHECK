/** Correcciones del proyecto: generarlas desde el último crawl, revisarlas, aprobarlas y publicarlas. */
import { randomBytes } from "crypto";
import { db } from "../db";
import { brandOf } from "../content/clean";
import { gscPeriod } from "../gsc-period";
import { resolvePlan } from "../plans";
import { currentValue, generateFixes, LIVE_KINDS, SERVER_KINDS, type FixPage, type FixQuery, type Proposal } from "./generate";
import { buildPayload, type LivePayload } from "./live";

export class FixError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const PAGE_SELECT = {
  url: true, finalUrl: true, status: true, redirects: true, title: true, metaDesc: true, h1: true, canonical: true, canonicalType: true, noindex: true, template: true,
  jsonldTypes: true, hreflang: true, images: true, links: true, commerce: true, inSitemap: true, inlinks: true, blocked: true, lastmod: true,
} as const;

export const latestCrawl = (projectId: string) =>
  db.crawl.findFirst({ where: { projectId, private: false, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" }, select: { id: true, startedAt: true, finishedAt: true, robots: true, status: true } });

/** Páginas del crawl en tandas: el HTML guardado pesa y no conviene traerlo todo de una vez. */
async function crawlPages(crawlId: string, withHtml: boolean): Promise<FixPage[]> {
  const out: FixPage[] = [];
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.page.findMany({ where: { crawlId }, select: { id: true, ...PAGE_SELECT, ...(withHtml ? { responseHtml: true } : {}) }, orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    out.push(...(rows as unknown as FixPage[]));
    cursor = rows[rows.length - 1].id;
    if (rows.length < 200) break;
  }
  return out;
}

async function gscFor(projectId: string) {
  const period = await gscPeriod(projectId).catch(() => null);
  if (!period) return { queries: undefined, impressions: undefined };
  const rows = await db.gscRow.groupBy({ by: ["page", "query"], where: { projectId, date: { gte: period.start, lte: period.end } }, _sum: { impressions: true, clicks: true }, _avg: { position: true }, orderBy: { _sum: { impressions: "desc" } }, take: 20_000 });
  const queries = new Map<string, FixQuery[]>();
  const impressions = new Map<string, number>();
  for (const r of rows) {
    const imp = r._sum.impressions ?? 0;
    impressions.set(r.page, (impressions.get(r.page) ?? 0) + imp);
    const list = queries.get(r.page) ?? [];
    if (list.length < 10) list.push({ query: r.query, impressions: imp, clicks: r._sum.clicks ?? 0, position: r._avg.position ?? 0 });
    queries.set(r.page, list);
  }
  return { queries, impressions };
}

/** La redirección quedó hecha: la URL antigua llega al destino en un solo salto. */
const redirectDone = (p: FixPage | undefined, to: string) => Boolean(p && p.finalUrl === to && Array.isArray(p.redirects) && (p.redirects as unknown[]).length === 1);

const keyOf = (f: { url: string; kind: string; target: string }) => `${f.url}\n${f.kind}\n${f.target}`;

/**
 * Regenera las correcciones desde el último crawl público. Lo que la persona ya decidió (aprobada, descartada o
 * editada) no se pisa; lo propuesto que dejó de aplicar se retira; lo que el sitio ya trae en su HTML queda verificado.
 */
export async function syncFixes(projectId: string) {
  const crawl = await latestCrawl(projectId);
  if (!crawl) return { crawl: null, created: 0, updated: 0, removed: 0, verified: 0 };
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { domain: true, name: true, language: true, settings: true } });
  const [pages, issues, gsc] = await Promise.all([crawlPages(crawl.id, true), db.issue.findMany({ where: { crawlId: crawl.id }, select: { url: true, code: true, detail: true } }), gscFor(projectId)]);
  const proposals = generateFixes(pages, { domain: project.domain, brand: brandOf(project), language: project.language, issues, ...gsc });
  const existing = await db.fix.findMany({ where: { projectId } });
  const have = new Map(existing.map((f) => [keyOf(f), f]));
  const want = new Map<string, Proposal>(proposals.map((p) => [keyOf(p), p]));
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  let created = 0, updated = 0, removed = 0, verified = 0;

  const fresh = proposals.filter((p) => !have.has(keyOf(p)));
  for (let i = 0; i < fresh.length; i += 500) created += (await db.fix.createMany({ data: fresh.slice(i, i + 500).map((p) => ({ projectId, ...p })), skipDuplicates: true })).count;

  for (const f of existing) {
    const p = want.get(keyOf(f));
    const page = f.url ? byUrl.get(f.url) : undefined;
    const now = page ? currentValue(page, f.kind, f.target) : null;
    const applied = f.kind === "jsonld" || f.kind === "hreflang" ? now != null : f.kind === "link" ? !pages.some((x) => x.links?.includes(f.target)) && pages.length > 0 : f.kind === "redirect" ? redirectDone(byUrl.get(f.target), f.after) : now != null && now === f.after;
    if (applied && f.status !== "verified" && f.status !== "discarded") {
      await db.fix.update({ where: { id: f.id }, data: { status: "verified", verifiedAt: new Date() } });
      verified++;
    } else if (f.status === "proposed" && !f.edited && f.source === "rules") {
      if (!p) {
        await db.fix.delete({ where: { id: f.id } });
        removed++;
      } else if (p.after !== f.after || p.before !== f.before || p.reason !== f.reason || p.impact !== f.impact) {
        await db.fix.update({ where: { id: f.id }, data: { after: p.after, before: p.before, reason: p.reason, code: p.code, impact: p.impact } });
        updated++;
      }
    } else if (f.status === "verified" && !applied && crawl.status === "completed") {
      // el sitio dejó de traer el valor: vuelve a quedar pendiente de publicar
      await db.fix.update({ where: { id: f.id }, data: { status: f.approvedAt ? "approved" : "proposed", verifiedAt: null } });
    } else if (p && (p.before !== f.before || p.impact !== f.impact)) {
      await db.fix.update({ where: { id: f.id }, data: { before: p.before, impact: p.impact } });
    }
  }
  bust(projectId);
  return { crawl: crawl.id, created, updated, removed, verified };
}

const RANK = "CASE status WHEN 'proposed' THEN 0 WHEN 'approved' THEN 1 WHEN 'verified' THEN 2 ELSE 3 END";

export async function listFixes(projectId: string, o: { status?: string; kind?: string; q?: string; take?: number; skip?: number } = {}) {
  const where = {
    projectId,
    ...(o.status && o.status !== "all" ? { status: o.status } : {}),
    ...(o.kind && o.kind !== "all" ? { kind: o.kind } : {}),
    ...(o.q ? { OR: [{ url: { contains: o.q, mode: "insensitive" as const } }, { after: { contains: o.q, mode: "insensitive" as const } }, { target: { contains: o.q, mode: "insensitive" as const } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.fix.findMany({ where, orderBy: [{ impact: "desc" }, { url: "asc" }, { kind: "asc" }], take: Math.min(o.take ?? 50, 200), skip: o.skip ?? 0 }),
    db.fix.count({ where }),
  ]);
  return { rows, total };
}

export async function fixSummary(projectId: string) {
  const [counts, live, crawl] = await Promise.all([
    db.fix.groupBy({ by: ["status", "kind"], where: { projectId }, _count: true }),
    db.liveSite.findUnique({ where: { projectId } }),
    latestCrawl(projectId),
  ]);
  const by = (s: string) => counts.filter((c) => c.status === s).reduce((n, c) => n + c._count, 0);
  const kinds: Record<string, number> = {};
  for (const c of counts) if (c.status === "proposed") kinds[c.kind] = (kinds[c.kind] ?? 0) + c._count;
  const approvedLive = counts.filter((c) => c.status === "approved" && LIVE_KINDS.has(c.kind)).reduce((n, c) => n + c._count, 0);
  const approvedManual = by("approved") - approvedLive;
  const installed = Boolean(live?.lastSeenAt && Date.now() - +live.lastSeenAt < 14 * 864e5);
  return {
    proposed: by("proposed"), approved: by("approved"), verified: by("verified"), discarded: by("discarded"), kinds,
    approvedLive, approvedManual,
    /** aprobadas que hoy ve un visitante: solo si el script está instalado y activo */
    published: installed && live?.enabled ? approvedLive : 0,
    live: live ? { key: live.key, enabled: live.enabled, lastSeenAt: live.lastSeenAt, lastSeenUrl: live.lastSeenUrl, hits: live.hits, installed } : null,
    crawl: crawl ? { id: crawl.id, at: crawl.finishedAt ?? crawl.startedAt } : null,
  };
}

const LIMITS: Record<string, number> = { title: 120, meta: 320, h1: 160, canonical: 2000, alt: 250, link: 2000, redirect: 2000, hreflang: 2000, og: 4000, jsonld: 20000 };

/** Valida el texto que escribe la persona: largo, URL del mismo sitio donde corresponde y JSON válido. */
function validate(kind: string, after: string, domain: string): string {
  let v = kind === "jsonld" || kind === "og" ? after.trim() : after.replace(/\s+/g, " ").trim();
  if (!v) throw new FixError("El valor no puede quedar vacío");
  if (v.length > (LIMITS[kind] ?? 2000)) throw new FixError(`El texto supera el máximo de ${LIMITS[kind] ?? 2000} caracteres`);
  if (["canonical", "link", "redirect", "hreflang"].includes(kind)) {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      throw new FixError("Escribe una URL completa (https://…)");
    }
    if (!/^https?:$/.test(u.protocol)) throw new FixError("La URL debe empezar con http:// o https://");
    const host = u.hostname.replace(/^www\./, "");
    if (kind !== "hreflang" && host !== domain && !host.endsWith(`.${domain}`)) throw new FixError(`La URL debe ser de ${domain}`);
    v = u.toString();
  }
  if (kind === "jsonld" || kind === "og") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(v);
    } catch {
      throw new FixError(kind === "jsonld" ? "El JSON-LD no es JSON válido" : "Formato inválido");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new FixError("Debe ser un objeto JSON");
    if (kind === "og" && Object.entries(parsed as object).some(([k, x]) => !/^(og|twitter|article|product):[a-z_:]+$/.test(k) || typeof x !== "string")) throw new FixError("Etiquetas no permitidas");
    if (kind === "jsonld" && !(parsed as Record<string, unknown>)["@type"]) throw new FixError("Al JSON-LD le falta @type");
  }
  return v;
}

export async function updateFix(projectId: string, id: string, patch: { after?: string; status?: string }, actor: string) {
  const f = await db.fix.findFirst({ where: { id, projectId } });
  if (!f) throw new FixError("La corrección no existe", 404);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { domain: true } });
  const data: Record<string, unknown> = {};
  if (patch.after != null && patch.after !== f.after) {
    data.after = validate(f.kind, String(patch.after), project.domain);
    data.edited = true;
    data.source = "manual";
  }
  if (patch.status != null) {
    if (!["proposed", "approved", "discarded"].includes(patch.status)) throw new FixError("Estado inválido");
    data.status = patch.status;
    data.approvedAt = patch.status === "approved" ? new Date() : null;
    data.approvedBy = patch.status === "approved" ? actor : null;
    data.verifiedAt = null;
  }
  const r = await db.fix.update({ where: { id }, data });
  bust(projectId);
  return r;
}

/** Aprobar, descartar o devolver a propuesta varias a la vez (por ids o por filtro). */
export async function bulkFixes(projectId: string, o: { ids?: string[]; kind?: string; from?: string; status: string }, actor: string) {
  if (!["proposed", "approved", "discarded"].includes(o.status)) throw new FixError("Estado inválido");
  const where = { projectId, ...(o.ids?.length ? { id: { in: o.ids.slice(0, 5000) } } : { status: o.from ?? "proposed", ...(o.kind && o.kind !== "all" ? { kind: o.kind } : {}) }) };
  const r = await db.fix.updateMany({ where, data: { status: o.status, approvedAt: o.status === "approved" ? new Date() : null, approvedBy: o.status === "approved" ? actor : null, verifiedAt: null } });
  bust(projectId);
  return { changed: r.count };
}

export async function ensureLive(projectId: string) {
  const have = await db.liveSite.findUnique({ where: { projectId } });
  if (have) return have;
  return db.liveSite.create({ data: { projectId, key: randomBytes(15).toString("base64url") } });
}
export async function setLive(projectId: string, o: { enabled?: boolean; rotate?: boolean }) {
  await ensureLive(projectId);
  const r = await db.liveSite.update({ where: { projectId }, data: { ...(o.enabled != null ? { enabled: o.enabled } : {}), ...(o.rotate ? { key: randomBytes(15).toString("base64url"), lastSeenAt: null, lastSeenUrl: null, hits: 0 } : {}) } });
  cache.clear();
  return r;
}

// ── lo que sirve el script: caché en memoria por clave (cada visita al sitio del cliente pasa por acá) ──
type Cached = { at: number; projectId: string | null; payload: LivePayload | null };
const cache = new Map<string, Cached>();
const TTL = 60_000;
function bust(projectId: string) {
  for (const [k, v] of cache) if (v.projectId === projectId) cache.delete(k);
}

/** Correcciones aprobadas que el script puede aplicar. null = clave desconocida; payload null = publicación en pausa o plan vencido. */
export async function livePayload(key: string): Promise<Cached | null> {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(key)) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.projectId ? hit : null;
  const site = await db.liveSite.findUnique({ where: { key }, include: { project: { select: { workspace: true } } } });
  let entry: Cached;
  if (!site) entry = { at: Date.now(), projectId: null, payload: null };
  else if (!site.enabled || resolvePlan(site.project.workspace).expired) entry = { at: Date.now(), projectId: site.projectId, payload: null };
  else {
    const fixes = await db.fix.findMany({ where: { projectId: site.projectId, status: "approved", kind: { in: [...SERVER_KINDS] } }, select: { url: true, kind: true, target: true, after: true }, take: 20_000 });
    entry = { at: Date.now(), projectId: site.projectId, payload: buildPayload(fixes) };
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, entry);
  return entry.projectId ? entry : null;
}

const pinged = new Map<string, number>();
/** El script avisa que está instalado: se guarda a lo más una vez por minuto por sitio. */
export async function recordPing(key: string, path: string) {
  const entry = await livePayload(key);
  if (!entry?.projectId) return;
  const last = pinged.get(key) ?? 0;
  if (Date.now() - last < 60_000) return;
  if (pinged.size > 5000) pinged.clear();
  pinged.set(key, Date.now());
  await db.liveSite.updateMany({ where: { key }, data: { lastSeenAt: new Date(), lastSeenUrl: path.slice(0, 300), hits: { increment: 1 } } });
}

/** Todo lo necesario para los archivos descargables. */
export async function fileContext(projectId: string) {
  const [project, crawl] = await Promise.all([db.project.findUniqueOrThrow({ where: { id: projectId }, select: { domain: true } }), latestCrawl(projectId)]);
  const pages = crawl ? await crawlPages(crawl.id, false) : [];
  const origin = (() => {
    try {
      return new URL(pages.find((p) => p.status === 200)?.url ?? `https://${project.domain}`).origin;
    } catch {
      return `https://${project.domain}`;
    }
  })();
  return { project, crawl, pages, origin };
}
