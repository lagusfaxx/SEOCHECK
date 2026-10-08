"use client";
import Link from "next/link";
import { useState } from "react";
import { useProject } from "./Shell";
import { api, useApi } from "./ui";
export const STATUS_LABEL: Record<string, string> = {
  detected: "Detectado",
  pending: "Pendiente",
  resolved: "Solucionado",
  reappeared: "Reapareció",
  ignored: "Ignorado",
};
const CATEGORY: Record<string, string> = {
  fix: "🔴 Arregla primero",
  opportunity: "🟠 Oportunidades",
  improvement: "🟡 Mejoras",
};
export function NextActions({ all = false }: { all?: boolean }) {
  const { id } = useProject();
  const { data, mutate } = useApi<any>(`/api/p/${id}/tasks`);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("open");
  const change = async (taskId: string, status: string, group = false) => {
    try {
      await api(`/api/p/${id}/tasks`, "PATCH", { taskId, status, group });
      await mutate();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const rows = all
    ? (data?.tasks ?? []).filter(
        (t: any) =>
          filter === "all" ||
          (filter === "open"
            ? !["resolved", "ignored"].includes(t.status)
            : t.status === filter),
      )
    : (data?.actions ?? []);
  return (
    <section className="card mb-4 space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">
          {all ? "Tareas del proyecto" : "¿Qué hago ahora?"}
        </h2>
        {!all && (
          <Link className="btn ml-auto" href={`/p/${id}/tasks`}>
            Ver todas las tareas
          </Link>
        )}
        {all && (
          <select
            className="input w-auto"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="open">Pendientes</option>
            <option value="all">Todas</option>
            {Object.entries(STATUS_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        )}
      </div>
      {!data ? (
        <p>Cargando prioridades…</p>
      ) : !rows.length ? (
        <p className="text-sm text-ink-500">
          No hay tareas en esta vista. Ejecuta una auditoría para detectar
          problemas y confirmar correcciones.
        </p>
      ) : (
        <ol className="space-y-3">
          {rows.map((t: any) => (
            <li
              key={t.id}
              className="rounded-lg border border-ink-200 p-3 dark:border-ink-700"
            >
              <div className="flex flex-wrap gap-2 text-sm">
                <span>{CATEGORY[t.category] ?? CATEGORY.improvement}</span>
                <span className="chip">{STATUS_LABEL[t.status]}</span>
                <b>{t.title}</b>
                {t.affected > 1 && (
                  <span>{t.affected} incidencias agrupadas</span>
                )}
              </div>
              <p className="mt-1 text-sm text-ink-500">{t.reason}</p>
              {t.url && (
                <span className="mt-1 block break-all text-xs text-ink-400">
                  {t.url}
                </span>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {["pending", "resolved", "ignored"]
                  .filter((s) => s !== t.status)
                  .map((s) => (
                    <button
                      key={s}
                      className="btn text-xs"
                      onClick={() => change(t.id, s, !all && t.affected > 1)}
                    >
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                {all && (
                  <details className="text-xs">
                    <summary>Historial</summary>
                    {t.events.map((e: any) => (
                      <p key={e.id}>
                        {new Date(e.createdAt).toLocaleString("es-CL")} ·{" "}
                        {STATUS_LABEL[e.status]}
                        {e.note ? ` · ${e.note}` : ""}
                      </p>
                    ))}
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {!all && !!data?.improved?.length && (
        <details className="text-sm">
          <summary>🟢 Lo que mejoró · últimas tareas solucionadas</summary>
          {data.improved.map((t: any) => (
            <p key={t.id}>
              {t.title} · {t.url}
            </p>
          ))}
        </details>
      )}
      {error && (
        <p className="text-rose-700" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
