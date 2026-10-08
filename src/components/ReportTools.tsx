"use client";
import { useState } from "react";
import { useProject } from "./Shell";
import { api, useApi } from "./ui";
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
        <a className="btn" href={`/api/p/${id}/report/pdf`}>
          Descargar PDF ejecutivo
        </a>
        <a className="btn" href={`/api/p/${id}/report?download=1`}>
          Markdown técnico
        </a>
        <a className="btn" href={`/api/p/${id}/report/csv`}>
          URLs afectadas (CSV)
        </a>
        <button
          className="btn"
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
      {mode === "executive" && (
        <div className="space-y-2 text-sm">
          <p>
            {c
              ? `Salud ${c.previousHealth ?? "—"} → ${c.health ?? "—"} · ${c.new ?? "—"} nuevas · ${c.resolved ?? "sin confirmar"} solucionadas`
              : "Todavía no hay una auditoría terminada."}
          </p>
          {c?.partial && (
            <p className="text-amber-700">
              La auditoría es parcial. No se da por solucionado lo que no se
              pudo volver a comprobar.
            </p>
          )}
          <ol className="list-decimal space-y-2 pl-5">
            {r?.actions?.map((a: any) => (
              <li key={a.title}>
                <b>{a.title}</b> · {a.affected} incidencias
                <p className="text-ink-500">{a.reason}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
      {mode === "technical" && (
        <p className="text-sm text-ink-500">
          El Markdown que aparece debajo conserva la evidencia y las
          instrucciones para Claude Code. El CSV contiene las URLs, sin
          repetirlas en el resumen ejecutivo.
        </p>
      )}
      <label className="flex flex-wrap items-center gap-2 text-sm">
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
