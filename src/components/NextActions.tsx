"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useProject } from "./Shell";
import { api, Drawer, Metric, plural, useApi } from "./ui";

export const STATUS_LABEL: Record<string, string> = {
  detected: "Detectado",
  pending: "En progreso",
  resolved: "Solucionado",
  reappeared: "Reapareció",
  ignored: "Ignorado",
};
const PAGE_SIZE = 12;
const priorityLabel = (task: any) =>
  task.priorityLabel ??
  (task.severity === "critical"
    ? "Alta"
    : task.severity === "warning"
      ? "Media"
      : "Baja");

export function NextActions({ all = false }: { all?: boolean }) {
  const { id, jobs, refreshJobs } = useProject();
  const running = jobs.some(
    (j) => j.kind === "audit.crawl" && ["queued", "running"].includes(j.status),
  );
  const { data, mutate } = useApi<any>(`/api/p/${id}/tasks`, {
    refreshInterval: running ? 3000 : 10000,
  });
  const [filter, setFilter] = useState("open");
  const [raw, setRaw] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (all)
      setSelectedId(new URLSearchParams(window.location.search).get("task"));
  }, [all, id]);
  const verify = async () => {
    try {
      await api(`/api/p/${id}/audit`, "POST", { verification: true });
      refreshJobs();
      setNotice(
        "Verificación iniciada. Las tareas se actualizarán al terminar la auditoría.",
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const change = async (taskId: string, status: string) => {
    try {
      await api(`/api/p/${id}/tasks`, "PATCH", { taskId, status, group: !raw });
      await mutate();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const rows: any[] = all
    ? (raw ? (data?.tasks ?? []) : (data?.groups ?? [])).filter(
        (t: any) =>
          filter === "all" ||
          (filter === "open"
            ? !["resolved", "ignored"].includes(t.status)
            : t.status === filter),
      )
    : (data?.actions ?? []).slice(0, 3);
  const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = all
    ? rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
    : rows;
  const selected =
    (raw ? data?.tasks : data?.groups)?.find((t: any) => t.id === selectedId) ??
    data?.tasks?.find((t: any) => t.id === selectedId);
  if (!all && !rows.length) return null;

  return (
    <section className="card mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <h2 className="text-sm font-semibold">
          {all ? "Tareas" : "Qué requiere tu atención"}
        </h2>
        {all ? (
          <>
            <select
              aria-label="Vista de tareas"
              className="input w-auto"
              value={raw ? "raw" : "group"}
              onChange={(e) => {
                setRaw(e.target.value === "raw");
                setPage(0);
                setSelectedId(null);
              }}
            >
              <option value="group">Acciones agrupadas</option>
              <option value="raw">Incidencias individuales</option>
            </select>
            <select
              className="input ml-auto w-auto text-sm"
              aria-label="Filtrar tareas"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="open">Pendientes</option>
              <option value="all">Todas</option>
              {Object.entries(STATUS_LABEL).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <button className="btn text-xs" disabled={running} onClick={verify}>
              {running ? "Verificando…" : "Verificar correcciones"}
            </button>
          </>
        ) : (
          <Link
            className="ml-auto text-xs text-ink-500 underline-offset-4 hover:text-ink-900 hover:underline dark:hover:text-white"
            href={`/p/${id}/tasks`}
          >
            Ver tareas
          </Link>
        )}
      </div>
      {!data ? (
        <p className="px-4 pb-4 text-sm text-ink-500">Cargando…</p>
      ) : !rows.length ? (
        <p className="px-4 pb-4 text-sm text-ink-500">
          No hay tareas en esta vista.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-ink-200 bg-ink-50 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-900">
                <tr>
                  <th className="px-4 py-2 font-normal">Acción</th>
                  {all && raw ? (
                    <th className="hidden px-4 py-2 font-normal md:table-cell">
                      URL
                    </th>
                  ) : (
                    <th className="px-4 py-2 text-right font-normal">
                      <Metric label="Afectadas" />
                    </th>
                  )}
                  <th className="px-4 py-2 font-normal">
                    <Metric label="Prioridad" />
                  </th>
                  {all && <th className="px-4 py-2 font-normal">Estado</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {visible.map((t) => (
                  <tr
                    key={t.id}
                    className="hover:bg-ink-50 dark:hover:bg-ink-800/40"
                  >
                    <td className="px-4 py-3 font-medium">
                      {all ? (
                        <button
                          className="text-left hover:underline"
                          onClick={() => setSelectedId(t.id)}
                        >
                          {t.title}{" "}
                          {t.pattern && (
                            <span className="ml-2 text-xs font-normal text-ink-500">
                              {t.pattern}
                            </span>
                          )}
                        </button>
                      ) : (
                        <Link
                          className="hover:underline"
                          href={`/p/${id}/tasks?task=${encodeURIComponent(t.id)}`}
                        >
                          {t.title}{" "}
                          {t.pattern && (
                            <span className="ml-2 text-xs font-normal text-ink-500">
                              {t.pattern}
                            </span>
                          )}
                        </Link>
                      )}
                    </td>
                    {all && raw ? (
                      <td
                        className="hidden max-w-[320px] truncate px-4 py-3 text-xs text-ink-500 md:table-cell"
                        title={t.url ?? ""}
                      >
                        {t.url
                          ? t.url.replace(/^https?:\/\/[^/]+/, "") || "/"
                          : "—"}
                      </td>
                    ) : (
                      <td className="px-4 py-3 text-right tabular-nums text-ink-500">
                        {plural(t.affected ?? 1, "URL", "URLs")}
                      </td>
                    )}
                    <td className="px-4 py-3 text-xs text-ink-500">
                      {priorityLabel(t)}
                    </td>
                    {all && (
                      <td className="px-4 py-3 text-xs text-ink-500">
                        {STATUS_LABEL[t.status]}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {all && rows.length > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-ink-200 px-4 py-2 text-xs text-ink-500 dark:border-ink-800">
              <span>
                {currentPage * PAGE_SIZE + 1}–
                {Math.min((currentPage + 1) * PAGE_SIZE, rows.length)} de{" "}
                {rows.length}
              </span>
              <div className="flex gap-2">
                <button
                  className="btn text-xs"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Anterior
                </button>
                <button
                  className="btn text-xs"
                  disabled={currentPage === lastPage}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {notice && (
        <p role="status" className="px-4 py-2 text-xs text-ink-500">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      <Drawer open={all && !!selected} onClose={() => setSelectedId(null)}>
        {selected && (
          <div className="space-y-5 pt-6">
            <div>
              <h3 className="text-lg font-semibold">{selected.title}</h3>
              <p className="mt-1 text-sm text-ink-500">
                {STATUS_LABEL[selected.status]} · Prioridad{" "}
                {priorityLabel(selected).toLowerCase()}
              </p>
            </div>
            {selected.url && (
              <p className="break-all text-sm text-ink-500">{selected.url}</p>
            )}
            <p className="text-sm leading-relaxed">{selected.reason}</p>
            <div className="flex flex-wrap gap-2">
              {selected.source === "crawl" && (
                <button className="btn" disabled={running} onClick={verify}>
                  {running ? "Verificando…" : "Verificar con auditoría"}
                </button>
              )}
              {(selected.source === "crawl"
                ? ["pending", "ignored"]
                : ["pending", "resolved", "ignored"]
              )
                .filter((s) => s !== selected.status)
                .map((s) => (
                  <button
                    key={s}
                    className="btn"
                    onClick={() => change(selected.id, s)}
                  >
                    {s === "ignored"
                      ? "Ignorar"
                      : s === "resolved"
                        ? "Marcar solucionada"
                        : "Iniciar tarea"}
                  </button>
                ))}
            </div>
            {selected.fix && <p className="text-sm">{selected.fix}</p>}
            {selected.probableCause && (
              <p className="text-sm text-ink-500">{selected.probableCause}</p>
            )}
            {selected.priorityReason && (
              <details className="text-xs">
                <summary>Cómo se priorizó</summary>
                <p className="mt-2">{selected.priorityReason}</p>
              </details>
            )}
            {selected.members && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">
                  URLs individuales · {selected.members.length}
                </h4>
                <div className="max-h-72 overflow-auto">
                  <table className="tbl table-fixed"><colgroup><col style={{width:"75%"}}/><col style={{width:"25%"}}/></colgroup>
                    <thead>
                      <tr>
                        <th>URL</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.members.map((m: any) => (
                        <tr key={m.id}>
                          <td className="!whitespace-normal break-words">
                            <a
                              className="break-all text-xs underline"
                              href={`/p/${id}/audit?url=${encodeURIComponent(m.url ?? "")}`}
                            >
                              {m.url}
                            </a>
                            <details className="text-xs text-ink-500">
                              <summary>Evidencia e historial</summary>
                              <p>{m.reason}</p>
                              {m.events?.map((e: any) => (
                                <p key={e.id}>
                                  {new Date(e.createdAt).toLocaleString(
                                    "es-CL",
                                  )}{" "}
                                  · {STATUS_LABEL[e.status]} {e.note}
                                </p>
                              ))}
                            </details>
                          </td>
                          <td>{STATUS_LABEL[m.status]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <details className="text-xs text-ink-500">
              <summary className="cursor-pointer">Historial</summary>
              <ul className="mt-2 space-y-2">
                {selected.events?.map((e: any) => (
                  <li key={e.id}>
                    {new Date(e.createdAt).toLocaleString("es-CL", {
                      timeZone: "America/Santiago",
                    })}{" "}
                    · {STATUS_LABEL[e.status]}
                    {e.note ? ` · ${e.note}` : ""}
                  </li>
                ))}
              </ul>
            </details>
            {notice && (
              <p role="status" className="text-sm text-ink-500">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-rose-700">
                {error}
              </p>
            )}
          </div>
        )}
      </Drawer>
    </section>
  );
}
