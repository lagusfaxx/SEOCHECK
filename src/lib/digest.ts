/**
 * Resumen por correo de cada informe programado: lo que marketing necesita leer en un minuto
 * (clics sin marca, objetivo, efecto de los últimos cambios, qué hacer ahora) con un link a la app.
 * Solo se envía a miembros del workspace, para que la herramienta no sirva para mandar correo a terceros.
 */
import { db } from "./db";
import { marketingOverview } from "./marketing";
import { projectActions } from "./tasks";
import { mailTemplate, sendMail } from "./mail";
import { appBaseUrl } from "./util";
import { backlinksOverview } from "./backlinks";

type Overview = Awaited<ReturnType<typeof marketingOverview>>;
const n = (v: number | null | undefined) => (v == null ? "–" : Math.round(v).toLocaleString("es-CL"));
const delta = (now: number, before: number) => (before ? ` (${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)} % vs 28 días anteriores)` : "");

/** Párrafos del resumen. Puro: se testea sin base ni correo. */
export function digestParagraphs(mk: Overview, actions: { title: string }[], bl?: { summary: { referringDomains: number }; previous: { referringDomains: number } | null; newDomains: unknown[]; lost: unknown[]; broken: unknown[] } | null): string[] {
  const out: string[] = [];
  if (mk.connected && mk.kpis) {
    const k = mk.kpis;
    out.push(`Del ${k.period.start} al ${k.period.end}: ${n(k.clicks.now)} clics${delta(k.clicks.now, k.clicks.before)}. Sin marca: ${n(k.nonBrand.now)}${delta(k.nonBrand.now, k.nonBrand.before)}.`);
    const g = mk.goalProgress?.clicks;
    if (g?.target != null) out.push(`Objetivo ${mk.goalProgress!.month}: ${n(g.mtd)} de ${n(g.target)} clics, proyección ${n(g.projected)} (${g.status}).`);
    const done = mk.annotations.filter((a) => a.impact?.conclusive).slice(0, 3);
    for (const a of done) out.push(`Efecto de «${a.title}» (${a.date}): ${a.impact!.beforePerDay} → ${a.impact!.afterPerDay} clics/día${a.impact!.change != null ? ` (${a.impact!.change >= 0 ? "+" : ""}${Math.round(a.impact!.change * 100)} %)` : ""}.`);
    if (mk.ga4 && !mk.ga4.empty) out.push(`Desde buscadores: ${n(mk.ga4.current.keyEvents)} conversiones${delta(mk.ga4.current.keyEvents, mk.ga4.previous.keyEvents)}${mk.ga4.current.revenue ? ` e ingresos por ${n(mk.ga4.current.revenue)}${mk.ga4.currency ? ` ${mk.ga4.currency}` : ""}` : ""} (Google Analytics).`);
    if (mk.opportunities?.extraClicks) out.push(`Crecimiento disponible: ~${n(mk.opportunities.extraClicks)} clics/mes estimados si las consultas en posición 4–20 llegan al top 3.`);
    if (mk.decay?.length) out.push(`${mk.decay.length} página(s) vienen cayendo hace 3 meses: conviene refrescarlas.`);
  } else out.push("Search Console no está conectado: sin datos de clics ni impresiones.");
  if (bl) out.push(`Backlinks: ${n(bl.summary.referringDomains)} dominios de referencia${bl.previous ? ` (${bl.summary.referringDomains - bl.previous.referringDomains >= 0 ? "+" : ""}${bl.summary.referringDomains - bl.previous.referringDomains} desde la foto anterior)` : ""}, ${bl.newDomains.length} nuevos y ${bl.lost.length} perdidos.${bl.broken.length ? ` ${bl.broken.length} llegan a páginas con error: recuperarlos con 301.` : ""}`);
  if (actions.length) out.push(`Qué hacer ahora: ${actions.slice(0, 3).map((a, i) => `${i + 1}) ${a.title}`).join(" ")}`);
  return out;
}

export async function sendDigest(projectId: string) {
  const schedule = await db.reportSchedule.findUnique({ where: { projectId } });
  if (!schedule?.recipients.length) return { sent: 0 };
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const members = await db.membership.findMany({ where: { workspaceId: p.workspaceId }, select: { user: { select: { email: true } } } });
  const allowed = new Set(members.map((m) => m.user.email.toLowerCase()));
  const to = schedule.recipients.filter((e) => allowed.has(e.toLowerCase()));
  if (!to.length) return { sent: 0 };
  const [mk, acts, bl] = await Promise.all([marketingOverview(projectId), projectActions(projectId), backlinksOverview(projectId)]);
  const { text, html } = mailTemplate(
    `Resultados SEO · ${p.name}`,
    digestParagraphs(mk, acts.actions, bl.snapshot),
    appBaseUrl() ? { label: "Ver resultados", url: `${appBaseUrl()}/p/${projectId}/results` } : undefined,
    "Recibes este correo porque está activado en Informe → Programación. Puedes quitarte ahí."
  );
  let sent = 0;
  for (const email of to) if ((await sendMail(email, `Resultados SEO · ${p.name}`, text, undefined, html)) === "sent") sent++;
  return { sent };
}
