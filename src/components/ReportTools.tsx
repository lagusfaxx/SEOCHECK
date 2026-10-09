"use client";
import { useState } from "react";
import { useProject } from "./Shell";
import { api, Metric, plural, useApi } from "./ui";
export function ReportTools() {
  const { id } = useProject();
  const { data: r } = useApi<any>(`/api/p/${id}/report/executive`);
  const { data: history, mutate } = useApi<any[]>(
    `/api/p/${id}/report/history`,
  );
  const { data: schedule, mutate: reloadSchedule } = useApi<any>(
    `/api/p/${id}/report/schedule`,
  );
  const [mode, setMode] = useState("executive");
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const c = r?.comparison;
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Informe para clientes</h2>
        <select
          className="input w-auto"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="executive">Ejecutivo</option>
          <option value="technical">Técnico</option>
        </select>
        <a className="btn-p" href={`/api/p/${id}/report/pdf?mode=${mode}`}>
          Descargar PDF {mode === "technical" ? "técnico" : "ejecutivo"}
        </a>
        <details className="relative">
          <summary className="btn cursor-pointer">Más opciones</summary>
          <div className="absolute right-0 z-20 mt-1 min-w-52 rounded border border-ink-200 bg-white p-1 shadow-sm dark:border-ink-700 dark:bg-ink-900">
            {" "}
            <a
              className="block w-full px-3 py-2 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800"
              href={`/api/p/${id}/report?download=1`}
            >
              Markdown técnico
            </a>
            <a
              className="block w-full px-3 py-2 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800"
              href={`/api/p/${id}/report/csv`}
            >
              URLs afectadas (CSV)
            </a>
            <button
              className="block w-full px-3 py-2 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800"
              onClick={() =>
                run(async () => {
                  await api(`/api/p/${id}/report/save`, "POST", {});
                  await mutate();
                })
              }
            >
              Guardar versión
            </button>
          </div>
        </details>
      </div>
      {mode === "executive" && (
        <div className="space-y-2 text-sm">
          <p>
            {!r
              ? "Cargando resumen…"
              : c
                ? `Salud técnica ${c.health ?? "—"}/100${c.previousId ? ` · ${c.new ?? "—"} nuevas · ${c.resolved ?? "sin confirmar"} solucionadas` : " · Primera auditoría"}`
                : "Todavía no hay una auditoría terminada."}
          </p>
          {c?.partial && (
            <p className="text-amber-700">
              La auditoría es parcial. No se da por solucionado lo que no se
              pudo volver a comprobar.
            </p>
          )}
          <table className="tbl table-fixed">
            <colgroup>
              <col style={{ width: "56%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Hallazgo</th>
                <th className="!whitespace-normal">
                  <Metric label="Afectadas" />
                </th>
                <th className="!whitespace-normal">
                  <Metric label="Prioridad" />
                </th>
              </tr>
            </thead>
            <tbody>
              {r?.actions?.map((a: any) => (
                <tr key={`${a.title}:${a.pattern}`}>
                  <td className="!whitespace-normal break-words">
                    <b>{a.title}</b>
                    {a.pattern && <span className="ml-2 font-mono text-xs text-ink-500">{a.pattern}</span>}
                    <p className="mt-1 text-xs text-ink-500">{a.reason}</p>
                  </td>
                  <td className="whitespace-nowrap">{plural(a.affected, "URL", "URLs")}</td>
                  <td>{a.priorityLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mode === "technical" && (
        <p className="text-sm text-ink-500">
          El PDF técnico incluye evidencia e instrucciones. Descarga el
          Markdown técnico desde «Más opciones» para pasárselo a tu equipo o
          a tu asistente de programación.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">Programación</summary>
        <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          Guardar informe automáticamente{" "}
          <select
            className="input w-auto"
            value={schedule?.enabled ? schedule.frequency : "off"}
            onChange={(e) =>
              run(async () => {
                const value = e.target.value;
                await api(`/api/p/${id}/report/schedule`, "PATCH", {
                  frequency:
                    value === "off" ? (schedule?.frequency ?? "weekly") : value,
                  enabled: value !== "off",
                });
                await reloadSchedule();
              })
            }
          >
            <option value="off">Desactivado</option>
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensual</option>
          </select>
          {schedule?.enabled && (
            <span>
              Próximo: {new Date(schedule.nextAt).toLocaleString("es-CL")}
            </span>
          )}
        </label>
        <p className="text-xs text-ink-500">
          El worker guarda una versión de los últimos datos disponibles. La
          programación no ejecuta una auditoría nueva ni envía correos.
        </p>
      </details>
      {!!history?.length && (
        <details>
          <summary className="cursor-pointer text-sm">
            Versiones guardadas ({history.length})
          </summary>
          <ul className="mt-2 space-y-2 text-sm">
            {history.map((h) => (
              <li key={h.id}>
                {new Date(h.createdAt).toLocaleString("es-CL")} ·{" "}
                <a
                  className="text-acc underline"
                  href={`/api/p/${id}/report/pdf?snapshot=${h.id}`}
                >
                  PDF
                </a>{" "}
                ·{" "}
                <a
                  className="text-acc underline"
                  href={`/api/p/${id}/report/snapshot?snapshot=${h.id}`}
                >
                  Markdown
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p role="alert" className="text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}
