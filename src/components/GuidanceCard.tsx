"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useProject } from "./Shell";
import { api, useApi, fmtDate } from "./ui";
import { useSeoView, type SeoView } from "./useSeoView";
import {
  SITE_LABELS,
  GOAL_LABELS,
  type SiteType,
  type Goal,
} from "@/lib/advice/plan";
import type { AdviceReport } from "@/lib/advice/service";
export function GuidanceCard() {
  const { id, jobs, refreshJobs } = useProject(),
    [view, setView] = useSeoView(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const running = jobs.some(
    (j) =>
      ["advice.explain", "report.full"].includes(j.kind) &&
      ["queued", "running"].includes(j.status),
  );
  const { data, error, mutate } = useApi<AdviceReport>(
    id ? `/api/p/${id}/pro/advice` : null,
    { refreshInterval: running ? 3000 : 0 },
  );
  useEffect(() => {
    if (!running) void mutate();
  }, [running, mutate]);
  async function update(body: object) {
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/p/${id}/pro/advice/profile`, "PATCH", body);
      await mutate();
      setMessage("Objetivo guardado.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }
  async function explain() {
    setBusy(true);
    setMessage("");
    try {
      const r = await api<any>(`/api/p/${id}/pro/advice/analyze`, "POST", {});
      setMessage(
        r.status === "reused"
          ? "Ya hay una explicación vigente para estos datos."
          : r.status === "skipped"
            ? "Todavía no hay acciones medidas que explicar."
            : "Preparando explicaciones con la evidencia del proyecto…",
      );
      refreshJobs();
      await mutate();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "No se pudo preparar la explicación",
      );
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <section className="card p-4">
        <h2 className="font-semibold">Tu plan de mejora</h2>
        <p role="alert" className="mt-2 text-sm">
          No se pudo cargar el plan. Puedes seguir consultando las tareas.
        </p>
        <button className="btn mt-2" onClick={() => mutate()}>
          Reintentar
        </button>
        <Link className="btn ml-2" href={`/p/${id}/tasks`}>
          Abrir tareas
        </Link>
      </section>
    );
  if (!data)
    return (
      <section className="card p-4" aria-busy="true">
        <p role="status">Preparando tus próximas acciones…</p>
      </section>
    );
  const limit = view === "guided" ? 3 : 8;
  return (
    <section
      className="card overflow-hidden"
      aria-labelledby="guidance-heading"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-ink-200 px-4 py-3 dark:border-ink-800">
        <div className="min-w-0 flex-1">
          <h2 id="guidance-heading" className="font-semibold">
            Tu plan de mejora
          </h2>
          <p className="text-sm text-ink-500">
            {SITE_LABELS[data.effectiveType]} · {data.goalLabel}
          </p>
        </div>
        <label className="text-sm">
          Vista{" "}
          <select
            aria-label="Vista"
            className="input ml-2 w-auto"
            value={view}
            onChange={(e) => setView(e.target.value as SeoView)}
          >
            <option value="guided">Guiada</option>
            <option value="technical">Técnica</option>
          </select>
        </label>
      </header>
      <div className="space-y-4 p-4">
        {!data.coverage.crawlAt && (
          <div className="space-y-2">
            <p>
              Empieza revisando el sitio. Después verás qué corregir, por qué y
              cómo comprobar el resultado.
            </p>
            <Link className="btn-p" href={`/p/${id}/audit`}>
              Revisar mi sitio
            </Link>
            <Link className="btn ml-2" href={`/p/${id}/start`}>
              Ver configuración inicial
            </Link>
          </div>
        )}
        {data.coverage.crawlAt && (
          <p className="text-sm text-ink-500">
            {data.coverage.pages}{" "}
            {data.coverage.pages === 1
              ? "página revisada"
              : "páginas revisadas"}{" "}
            · {fmtDate(data.coverage.crawlAt)}
            {data.coverage.partial ? " · Auditoría parcial" : ""}
          </p>
        )}
        {!!data.actions.length && (
          <ol className="divide-y divide-ink-200 dark:divide-ink-800">
            {data.actions.slice(0, limit).map((a) => (
              <li key={a.id} className="space-y-2 py-3 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="font-medium hover:underline"
                    href={`/p/${id}/${a.href}`}
                  >
                    {a.title}
                  </Link>
                  <span className="text-xs text-ink-500">
                    Prioridad {a.priority.toLowerCase()} · {a.affected}{" "}
                    {a.affected === 1 ? "URL" : "URLs"} ·{" "}
                    {a.confidence === "observado"
                      ? "Observado"
                      : a.confidence === "hipótesis"
                        ? "Por comprobar"
                        : "Revisión manual"}
                  </span>
                </div>
                <p className="text-sm">{a.ai?.explanation ?? a.why}</p>
                {a.ai && (
                  <p className="text-xs text-ink-500">
                    Explicación sugerida con IA · basada en la evidencia
                    indicada
                  </p>
                )}
                <details className="text-sm">
                  <summary className="cursor-pointer text-acc">
                    Qué hacer y cómo comprobarlo
                  </summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    {(a.ai?.steps ?? a.steps).map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  <p className="mt-2">
                    <strong>Comprobar:</strong> {a.ai?.verify ?? a.verify}
                  </p>
                  {a.ai && (
                    <p className="mt-2 text-ink-500">
                      Hallazgo medido: {a.why}
                    </p>
                  )}
                  <div className="mt-2 space-y-2">
                    {a.evidence.map((e) => (
                      <div
                        key={e.id}
                        className="rounded border border-ink-200 p-2 text-xs dark:border-ink-800"
                      >
                        <p>
                          {e.source}
                          {e.at ? ` · ${fmtDate(e.at)}` : ""}
                        </p>
                        {e.url && <p className="break-all">{e.url}</p>}
                        <p>{e.observation}</p>
                      </div>
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
        {data.coverage.crawlAt && !data.actions.length && (
          <p className="text-sm">
            No hay acciones automáticas pendientes en la evidencia revisada.
            Completa las fuentes faltantes y las revisiones manuales antes de
            concluir que todo está cubierto.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Link className="btn" href={`/p/${id}/tasks`}>
            Ver todas las tareas
          </Link>
          <Link className="btn" href={`/p/${id}/pro`}>
            Abrir herramientas detalladas
          </Link>
          {data.ai.available &&
            data.profile.aiEnabled &&
            data.permissions?.analyze && (
              <button
                className="btn"
                disabled={
                  busy ||
                  running ||
                  !data.actions.length ||
                  data.ai.state === "ready"
                }
                onClick={explain}
              >
                {running
                  ? "Preparando explicación…"
                  : data.ai.state === "ready"
                    ? "Explicación vigente"
                    : "Explicar acciones con IA"}
              </button>
            )}
        </div>
        {data.ai.state === "unavailable" && (
          <p className="text-xs text-ink-500">
            La conexión de IA no está habilitada. Las acciones medidas siguen
            disponibles.
          </p>
        )}
        {data.ai.state === "error" && (
          <p role="status" className="text-xs text-ink-500">
            No se pudo validar la explicación de IA. Conservamos las
            recomendaciones por reglas; puedes intentarlo más tarde.
          </p>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer">
            Fuentes y revisiones que faltan
          </summary>
          <ul className="mt-3 divide-y divide-ink-200 dark:divide-ink-800">
            {data.checks.map((c) => (
              <li className="py-2" key={c.key}>
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{c.title}</strong>
                  <span className="text-xs text-ink-500">
                    {c.status === "available"
                      ? "Con datos"
                      : c.status === "missing"
                        ? "Faltan datos"
                        : "Requiere revisión"}
                  </span>
                </div>
                <p className="my-1 text-ink-500">{c.detail}</p>
                <Link
                  className="text-acc underline"
                  href={`/p/${id}/${c.href}`}
                >
                  Abrir {c.title.toLowerCase()}
                </Link>
              </li>
            ))}
          </ul>
          {data.notes.map((n) => (
            <p className="mt-2 text-xs text-ink-500" key={n}>
              {n}
            </p>
          ))}
        </details>
        {data.permissions?.manage && (
          <details className="text-sm">
            <summary className="cursor-pointer">
              Adaptar el plan a mi negocio
            </summary>
            <div className="mt-3 flex flex-wrap gap-4">
              <label>
                Tipo de sitio
                <select
                  className="input mt-1"
                  disabled={busy}
                  value={data.profile.siteType}
                  onChange={(e) =>
                    update({ siteType: e.target.value as SiteType })
                  }
                >
                  {Object.entries(SITE_LABELS).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Objetivo
                <select
                  className="input mt-1"
                  disabled={busy}
                  value={data.profile.goal}
                  onChange={(e) => update({ goal: e.target.value as Goal })}
                >
                  {Object.entries(GOAL_LABELS).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                disabled={busy}
                checked={data.profile.aiEnabled}
                onChange={(e) => update({ aiEnabled: e.target.checked })}
              />
              Explicar acciones con IA al completar un informe, si la conexión
              está habilitada
            </label>
            <p className="mt-2 text-xs text-ink-500">
              Las explicaciones usan los límites de uso disponibles y se
              reutilizan mientras la evidencia siga vigente.
            </p>
          </details>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
