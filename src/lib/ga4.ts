/**
 * Google Analytics 4 con la misma conexión de Google del proyecto (OAuth del cliente, sin claves).
 * Solo tráfico del canal Organic Search: sesiones, eventos clave (conversiones) e ingresos por landing y día.
 * Así se puede responder "cuánto vende el SEO" y qué landings convierten.
 */
import { db } from "./db";
import { projectClient } from "./gsc-oauth";
import { jobLog } from "./jobctx";
import { bareHost, sameSite } from "./util";
import { PRIVATE_PATH } from "./report-rules";

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const DAY = 864e5;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export type Ga4Settings = { property?: string; displayName?: string; currency?: string };
export const ga4Of = (settings: unknown): Ga4Settings => ((settings as any)?.ga4 ?? {}) as Ga4Settings;

/** ¿La conexión de Google del proyecto incluye permiso de Analytics? */
export async function ga4Status(projectId: string) {
  const c = await db.gscConnection.findUnique({ where: { projectId }, select: { scope: true, googleEmail: true } });
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { settings: true } });
  const last = await db.ga4Row.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } });
  return {
    connected: Boolean(c),
    hasScope: Boolean(c?.scope.includes("analytics")),
    email: c?.googleEmail ?? null,
    ...ga4Of(p.settings),
    lastDate: last ? isoDay(last.date) : null,
  };
}

async function client(projectId: string) {
  const c = await projectClient(projectId);
  if (!c) throw new Error("Google no está conectado: conecta la cuenta de Google del proyecto");
  return c.client;
}

function ga4Error(e: unknown): Error {
  const status = (e as any)?.response?.status;
  const msg = (e as any)?.response?.data?.error?.message ?? (e instanceof Error ? e.message : String(e));
  if (status === 403) return new Error(`Sin permiso para leer Google Analytics: vuelve a conectar Google marcando la casilla de Analytics, con una cuenta que tenga acceso a la propiedad. Detalle: ${msg}`);
  if (status === 401) return new Error("La conexión con Google ya no es válida: vuelve a conectarla.");
  return new Error(`Google Analytics: ${msg}`);
}

export type Ga4Property = { property: string; displayName: string; account: string; sites: string[] };

/** Propiedades GA4 que ve la cuenta conectada, con los sitios web de sus flujos de datos. */
export async function ga4Properties(projectId: string): Promise<Ga4Property[]> {
  const c = await client(projectId);
  let list: Omit<Ga4Property, "sites">[];
  try {
    const res = await c.request<{ accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[] }>({ url: "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200" });
    list = (res.data.accountSummaries ?? []).flatMap((a) => (a.propertySummaries ?? []).map((p) => ({ property: p.property, displayName: p.displayName, account: a.displayName })));
  } catch (e) {
    throw ga4Error(e);
  }
  // el sitio de cada propiedad sale de sus flujos web (defaultUri); sin flujo web no se puede asociar a un dominio
  const out: Ga4Property[] = [];
  for (let i = 0; i < Math.min(list.length, 100); i += 10)
    out.push(
      ...(await Promise.all(
        list.slice(i, i + 10).map(async (p) => {
          try {
            const r = await c.request<{ dataStreams?: { type?: string; webStreamData?: { defaultUri?: string } }[] }>({ url: `https://analyticsadmin.googleapis.com/v1beta/${p.property}/dataStreams?pageSize=50` });
            return { ...p, sites: [...new Set((r.data.dataStreams ?? []).map((s) => s.webStreamData?.defaultUri).filter((u): u is string => Boolean(u)).map(bareHost))] };
          } catch {
            return { ...p, sites: [] };
          }
        })
      ))
    );
  return out;
}

/** Las propiedades cuyo sitio web es el del proyecto (mismo dominio o subdominio). */
export const matchingProperties = (props: Ga4Property[], domain: string) => props.filter((p) => p.sites.some((s) => sameSite(s, domain)));

/**
 * Elige sola la propiedad de Analytics del proyecto si hay exactamente una del dominio. Devuelve la elegida, o las
 * candidatas si hay más de una (o ninguna). No reemplaza una propiedad ya elegida.
 */
export async function autoPickGa4(projectId: string) {
  const st = await ga4Status(projectId);
  if (!st.connected || !st.hasScope) return { chosen: null, candidates: [] as Ga4Property[], reason: "sin permiso de Analytics" };
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { domain: true } });
  if (st.property) return { chosen: st.property, candidates: [], reason: null };
  const candidates = matchingProperties(await ga4Properties(projectId), p.domain);
  if (candidates.length !== 1) return { chosen: null, candidates, reason: candidates.length ? "hay más de una propiedad del dominio" : `la cuenta no tiene una propiedad de Analytics con el sitio ${p.domain}` };
  await setGa4Property(projectId, candidates[0].property);
  return { chosen: candidates[0].property, candidates, reason: null };
}

/** Guarda la propiedad elegida (debe estar entre las que ve la cuenta) y su moneda. */
export async function setGa4Property(projectId: string, property: string) {
  if (!/^properties\/\d+$/.test(property)) throw new Error("Propiedad GA4 inválida");
  const props = await ga4Properties(projectId);
  const found = props.find((p) => p.property === property);
  if (!found) throw new Error("La cuenta conectada no tiene acceso a esa propiedad");
  // un proyecto de taupoc.cl no puede usar la analítica de tacos.cl
  const proj = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { domain: true } });
  if (!found.sites.some((s) => sameSite(s, proj.domain)))
    throw new Error(`La propiedad «${found.displayName}» no es de ${proj.domain}${found.sites.length ? ` (su sitio es ${found.sites.join(", ")})` : " (no tiene un flujo web con ese dominio)"}.`);
  const c = await client(projectId);
  let currency: string | undefined;
  try {
    currency = (await c.request<{ currencyCode?: string }>({ url: `https://analyticsadmin.googleapis.com/v1beta/${property}` })).data.currencyCode;
  } catch {
    /* sin moneda se muestra el número solo */
  }
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { settings: true } });
  const settings = (p.settings ?? {}) as Record<string, any>;
  await db.project.update({ where: { id: projectId }, data: { settings: { ...settings, ga4: { property, displayName: found.displayName, currency } } } });
  await db.ga4Row.deleteMany({ where: { projectId } });
  return { property, displayName: found.displayName, currency };
}

/** Ruta de la landing sin dominio, query ni barra final: así cruza con las páginas de Search Console. */
export function landingPath(raw: string) {
  let path = raw || "/";
  try {
    path = new URL(raw, "https://x.invalid").pathname;
  } catch {
    path = raw.split("?")[0];
  }
  return path.replace(/\/+$/, "") || "/";
}

/** Filas de runReport → registros por día y landing (sumando las que quedan iguales al normalizar). */
export function parseReport(rows: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]) {
  const out = new Map<string, { date: string; landing: string; sessions: number; keyEvents: number; revenue: number }>();
  for (const r of rows) {
    const [d, landing] = r.dimensionValues.map((x) => x.value);
    if (!/^\d{8}$/.test(d)) continue;
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const path = landingPath(landing === "(not set)" ? "/" : landing);
    const k = `${date}|${path}`;
    const e = out.get(k) ?? { date, landing: path, sessions: 0, keyEvents: 0, revenue: 0 };
    e.sessions += Number(r.metricValues[0]?.value ?? 0);
    e.keyEvents += Number(r.metricValues[1]?.value ?? 0);
    e.revenue += Number(r.metricValues[2]?.value ?? 0);
    out.set(k, e);
  }
  return [...out.values()];
}

/** Sincroniza los últimos días (90 la primera vez; luego desde el último dato menos 3 por datos tardíos). */
export async function syncGa4(projectId: string, backfillDays = 90) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { settings: true } });
  const { property } = ga4Of(p.settings);
  if (!property) throw new Error("Falta elegir la propiedad de Google Analytics");
  const c = await client(projectId);
  const last = await db.ga4Row.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } });
  const end = new Date(Date.now() - DAY);
  const start = last ? new Date(last.date.getTime() - 3 * DAY) : new Date(end.getTime() - backfillDays * DAY);
  const all: ReturnType<typeof parseReport> = [];
  for (let offset = 0; ; offset += 100000) {
    let res;
    try {
      res = await c.request<{ rows?: any[]; rowCount?: number }>({
        url: `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`,
        method: "POST",
        data: {
          dateRanges: [{ startDate: isoDay(start), endDate: isoDay(end) }],
          dimensions: [{ name: "date" }, { name: "landingPagePlusQueryString" }],
          metrics: [{ name: "sessions" }, { name: "keyEvents" }, { name: "totalRevenue" }],
          dimensionFilter: { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { value: "Organic Search" } } },
          limit: 100000,
          offset,
        },
      });
    } catch (e) {
      throw ga4Error(e);
    }
    all.push(...parseReport(res.data.rows ?? []));
    if (!res.data.rows?.length || offset + 100000 >= (res.data.rowCount ?? 0)) break;
  }
  await db.ga4Row.deleteMany({ where: { projectId, date: { gte: new Date(`${isoDay(start)}T00:00:00Z`) } } });
  for (let i = 0; i < all.length; i += 1000)
    await db.ga4Row.createMany({ data: all.slice(i, i + 1000).map((r) => ({ projectId, date: new Date(`${r.date}T00:00:00Z`), landing: r.landing, sessions: r.sessions, keyEvents: r.keyEvents, revenue: r.revenue })), skipDuplicates: true });
  await jobLog("info", `Google Analytics: ${all.length} filas (${isoDay(start)} a ${isoDay(end)})`);
  return all.length;
}

/** Totales y landings del período (mismas fechas que Search Console) contra el período anterior. */
export async function ga4Overview(projectId: string, period: { start: Date; endExclusive: Date; prevStart: Date } | null) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { settings: true } });
  const g = ga4Of(p.settings);
  if (!g.property) return null;
  const last = await db.ga4Row.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } });
  if (!last) return { property: g.displayName ?? g.property, currency: g.currency ?? null, empty: true as const };
  // sin Search Console se usan los últimos 28 días de GA4
  const end = period?.endExclusive ?? new Date(last.date.getTime() + DAY);
  const start = period?.start ?? new Date(end.getTime() - 28 * DAY);
  const prevStart = period?.prevStart ?? new Date(start.getTime() - 28 * DAY);
  const sum = async (gte: Date, lt: Date) => {
    const r = await db.ga4Row.aggregate({ where: { projectId, date: { gte, lt } }, _sum: { sessions: true, keyEvents: true, revenue: true } });
    return { sessions: r._sum.sessions ?? 0, keyEvents: r._sum.keyEvents ?? 0, revenue: r._sum.revenue ?? 0 };
  };
  const [cur, prev, byLanding] = await Promise.all([
    sum(start, end),
    sum(prevStart, start),
    db.ga4Row.groupBy({ by: ["landing"], where: { projectId, date: { gte: start, lt: end } }, _sum: { sessions: true, keyEvents: true, revenue: true } }),
  ]);
  const all = byLanding.map((r) => ({ landing: r.landing, sessions: r._sum.sessions ?? 0, keyEvents: r._sum.keyEvents ?? 0, revenue: r._sum.revenue ?? 0 }));
  // páginas privadas (admin, cuenta, checkout) no se buscan en Google: si aparecen como landing orgánica es tráfico
  // interno o atribución de sesión, no un resultado del SEO
  const isPrivate = (l: string) => PRIVATE_PATH.test(`${l}/`);
  const priv = all.filter((r) => isPrivate(r.landing));
  const landings = all
    .filter((r) => !isPrivate(r.landing))
    .map((r) => ({ ...r, conversionRate: r.sessions ? r.keyEvents / r.sessions : 0 }))
    .sort((a, b) => b.revenue - a.revenue || b.keyEvents - a.keyEvents || b.sessions - a.sessions)
    .slice(0, 20);
  return {
    property: g.displayName ?? g.property,
    currency: g.currency ?? null,
    empty: false as const,
    period: { start: isoDay(start), end: isoDay(new Date(end.getTime() - DAY)) },
    current: cur,
    previous: prev,
    landings,
    privateLandings: { count: priv.length, sessions: priv.reduce((s, r) => s + r.sessions, 0), examples: priv.slice(0, 3).map((r) => r.landing) },
    // la medición se valida antes de interpretar ceros
    checks: [
      ...(cur.sessions > 0 && cur.keyEvents === 0 ? ["No hay eventos clave en el período: antes de leer «0 conversiones», confirma en GA4 que las compras o contactos estén marcados como eventos clave."] : []),
      ...(cur.keyEvents > 0 && cur.revenue === 0 ? ["Hay conversiones pero ingresos 0: si el sitio vende en línea, revisa que el evento purchase envíe value y currency."] : []),
      ...(priv.length ? [`${priv.length} landing(s) privadas con ${priv.reduce((s, r) => s + r.sessions, 0)} sesiones «orgánicas» (${priv.slice(0, 3).map((r) => r.landing).join(", ")}): suele ser tráfico interno o del equipo. Excluye tu tráfico interno en GA4; no se muestran en la tabla.`] : []),
    ],
    note: "Google Analytics, canal Organic Search (todos los buscadores, no solo Google; no es lo mismo que los clics de Search Console). Eventos clave = las conversiones configuradas en GA4. Depende del consentimiento de cookies y del modelo de atribución de GA4.",
  };
}
