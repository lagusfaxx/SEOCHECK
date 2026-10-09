import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/auth";
import { sendMail } from "@/lib/mail";
import { IDEA_NEEDS, IDEA_STAGES } from "@/lib/site-content";

/** Casilla que recibe el aviso de cada idea nueva. */
const INBOX = process.env.IDEAS_INBOX ?? "contacto@fsvc.cl";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Formulario público "Cuéntanos tu idea" (fsvc.cl/ventures): guarda la idea y avisa por correo.
 * Sin sesión: se protege con rate limit por IP y un campo trampa para bots.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const limit = await rateLimit(`ideas:${ip}`, 5, 60 * 60_000);
  if (!limit.ok) return json({ error: "Recibimos varias ideas desde tu conexión. Intenta de nuevo en un rato o escríbenos a contacto@fsvc.cl." }, 429);

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // campo trampa: invisible para personas; si viene lleno es un bot. Se responde OK para no darle pistas.
  if (typeof b.website === "string" && b.website.trim()) return json({ ok: true });

  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = str(b.name, 120);
  const email = str(b.email, 200).toLowerCase();
  const idea = str(b.idea, 4000);
  const stage = IDEA_STAGES.some((s) => s.id === b.stage) ? String(b.stage) : "idea";
  const needs = Array.isArray(b.needs) ? [...new Set(b.needs.filter((n): n is string => typeof n === "string" && IDEA_NEEDS.includes(n)))] : [];
  let link = str(b.link, 500) || null;
  if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
  if (link) {
    try {
      new URL(link);
    } catch {
      link = null;
    }
  }

  if (!name) return json({ error: "Escribe tu nombre" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Revisa tu correo" }, 400);
  if (idea.length < 10) return json({ error: "Cuéntanos un poco más de tu idea" }, 400);

  const row = await db.ideaSubmission.create({ data: { name, email, stage, idea, needs, link, ip } });
  const stageLabel = IDEA_STAGES.find((s) => s.id === stage)?.label ?? stage;
  await sendMail(
    INBOX,
    `Nueva idea: ${name} (${stageLabel})`,
    [`Nombre: ${name}`, `Correo: ${email}`, `Etapa: ${stageLabel}`, `Necesita: ${needs.join(", ") || "—"}`, `Link: ${link ?? "—"}`, "", idea, "", `ID: ${row.id}`].join("\n"),
  ).catch((e) => console.error("[ideas] aviso por correo falló", e));
  return json({ ok: true });
}
