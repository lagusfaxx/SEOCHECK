"use client";
import { useProject } from "../Shell";
import { api, cx, fmtDate, useAction, useApi } from "../ui";
import ExpertPanel from "./ExpertPanel";

type Run = { id: string; status: string; reason: string | null; private: boolean; rulesVersion: string | null; startedAt: string; finishedAt: string | null; pages: number | null; startUrl: string | null };
const STATUS: Record<string, string> = {
  queued: "en cola",
  running: "en curso",
  pausing: "pausando…",
  paused: "en pausa",
  completed: "completo",
  partial: "parcial",
  failed: "fallido",
  cancelled: "cancelado",
};

/** Ejecuciones del crawl: pausar y reanudar, y cuáles son privadas (staging, fuera de informes). */
function Runs() {
  const { id } = useProject();
  const { data, mutate } = useApi<Run[]>(id ? `/api/p/${id}/pro/crawl/runs` : null, { refreshInterval: 5000 });
  const [act, busy] = useAction(async (path: "pause" | "resume", crawlId: string) => {
    await api(`/api/p/${id}/pro/crawl/${path}`, "POST", { crawlId });
    await mutate();
  });
  if (!data?.length) return null;
  return (
    <section className="card space-y-2 p-4">
      <h2 className="text-base font-semibold">Ejecuciones</h2>
      <ul className="divide-y text-sm">
        {data.slice(0, 8).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className={cx("rounded px-1.5 py-0.5 text-xs", r.status === "paused" || r.status === "pausing" ? "bg-amber-100 text-amber-900" : r.status === "failed" ? "bg-rose-100 text-rose-900" : "bg-ink-100 text-ink-700")}>{STATUS[r.status] ?? r.status}</span>
            <span>{fmtDate(r.startedAt, "datetime")}</span>
            {r.pages != null && <span className="text-ink-500">{r.pages} URLs</span>}
            {r.private && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-900" title={r.startUrl ?? ""}>privado · no entra en informes</span>}
            {r.rulesVersion && <span className="text-xs text-ink-400">reglas {r.rulesVersion}</span>}
            {r.reason && <span className="w-full text-xs text-ink-500">{r.reason}</span>}
            <span className="ml-auto">
              {(r.status === "running" || r.status === "queued") && (
                <button className="btn text-xs" disabled={busy} onClick={() => act("pause", r.id)}>Pausar</button>
              )}
              {r.status === "paused" && (
                <button className="btn text-xs" disabled={busy} onClick={() => act("resume", r.id)}>Reanudar</button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CrawlPro() {
  return (
    <div className="space-y-4">
      <Runs />
    <ExpertPanel
      kind="crawl"
      links={[{ title: "Ejecutar auditoría", path: "audit" }]}
      forms={[
        {
          title: "Renderizar JavaScript por sección",
          path: "settings",
          method: "PATCH",
          hint: "Con render se compara el HTML que entrega el servidor con la página después de JavaScript (title, robots, canonical, H1, links y texto). Sin rutas = todo el sitio.",
          fields: [
            { name: "render", label: "Renderizar", type: "select", options: ["true", "false"], parse: "json", required: true },
            { name: "renderPaths", label: "Rutas a renderizar (una por línea)", type: "textarea", parse: "lines", placeholder: "/productos/*\n/blog/" },
          ],
        },
        {
          title: "Auditoría privada (staging)",
          path: "private",
          hint: "Rastrea un sitio de prueba con usuario/clave o cookie. Las credenciales se guardan cifradas y solo se envían a ese host. El resultado no entra en informes, tareas ni avisos.",
          fields: [
            { name: "startUrl", label: "URL de inicio", type: "url", required: true, placeholder: "https://staging.tusitio.cl/" },
            { name: "user", label: "Usuario (opcional)" },
            { name: "pass", label: "Clave (opcional)" },
            { name: "cookie", label: "Cookie de sesión (opcional)" },
            { name: "maxPages", label: "Máximo de páginas", type: "number", parse: "number", placeholder: "200" },
          ],
        },
        {
          title: "User-agent de rastreo",
          path: "settings",
          method: "PATCH",
          fields: [
            {
              name: "userAgent",
              label: "User-agent",
              required: true,
              placeholder: "SEOCheckBot/1.0",
            },
          ],
        },
        {
          title: "Controlar facetas",
          path: "settings",
          method: "PATCH",
          hint: "Los parámetros de seguimiento se eliminan; las facetas útiles se conservan hasta el límite por patrón.",
          fields: [
            {
              name: "maxPerPattern",
              label: "Máximo de URLs por patrón",
              type: "number",
              parse: "number",
              required: true,
            },
            {
              name: "ignoreParams",
              label: "Parámetros a ignorar (uno por línea)",
              type: "textarea",
              parse: "lines",
              placeholder: "utm_*\ngclid\nfbclid",
            },
          ],
        },
        {
          title: "Reglas de plantilla",
          path: "settings",
          method: "PATCH",
          fields: [
            {
              name: "templates",
              label: "Reglas de rutas",
              type: "textarea",
              parse: "json",
              required: true,
              placeholder: '[{"name":"product","pattern":"/tienda/*"}]',
            },
          ],
        },
        {
          title: "Extracción personalizada",
          path: "settings",
          method: "PATCH",
          hint: "CSS, XPath simple o regex. XPath: //tag[@atributo='valor'], /text() y /@atributo.",
          fields: [
            {
              name: "extract",
              label: "Reglas de extracción",
              type: "textarea",
              parse: "json",
              required: true,
              placeholder:
                '[{"name":"sku","type":"css","selector":"[itemprop=sku]","attr":"content"}]',
            },
          ],
        },
      ]}
    />
    </div>
  );
}
