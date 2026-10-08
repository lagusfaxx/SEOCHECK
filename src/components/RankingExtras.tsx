"use client";
import { useState } from "react";
import { useProject } from "./Shell";
import { api, useApi } from "./ui";
export function RankingExtras() {
  const { id, project, refreshJobs } = useProject();
  const { data, mutate } = useApi<any[]>(`/api/p/${id}/rank/opportunities`);
  const { data: ranks } = useApi<any>(`/api/p/${id}/rank`);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const movers = (ranks?.tracked ?? []).map((t: any) => {
    const [prev, now] = t.checks.slice(-2);
    return {
      keyword: t.keyword,
      delta:
        prev?.position != null && now?.position != null
          ? prev.position - now.position
          : 0,
    };
  });
  return (
    <section className="card mb-4 space-y-3 p-4">
      <h2 className="font-semibold">Oportunidades y movimientos</h2>
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div>
          <b>Ganadores</b>
          {movers
            .filter((m: any) => m.delta > 0)
            .sort((a: any, b: any) => b.delta - a.delta)
            .slice(0, 5)
            .map((m: any) => (
              <p key={m.keyword}>
                {m.keyword} · +{m.delta} posiciones
              </p>
            ))}
        </div>
        <div>
          <b>Perdedores</b>
          {movers
            .filter((m: any) => m.delta < 0)
            .sort((a: any, b: any) => a.delta - b.delta)
            .slice(0, 5)
            .map((m: any) => (
              <p key={m.keyword}>
                {m.keyword} · {m.delta} posiciones
              </p>
            ))}
        </div>
      </div>
      <details>
        <summary className="cursor-pointer text-sm">
          Consultas GSC en posiciones 4–20 sin monitorear ({data?.length ?? 0})
        </summary>
        {data?.length ? (
          <>
            <ul className="my-2 text-sm">
              {data.map((o) => (
                <li key={o.keyword}>
                  {o.keyword} · {o.impressions} impresiones · pos.{" "}
                  {o.position.toFixed(1)}
                </li>
              ))}
            </ul>
            <button
              className="btn-p"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/api/p/${id}/rank`, "POST", {
                    keywords: data.map((o) => o.keyword),
                    check: false,
                  });
                  refreshJobs();
                  await mutate();
                })
              }
            >
              Monitorear oportunidades
            </button>
            <p className="text-xs text-ink-500">
              Se agregan con la frecuencia del proyecto. No se cobra una
              revisión inmediata.
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-500">
            Conecta y sincroniza Search Console para encontrar consultas reales
            con margen de mejora.
          </p>
        )}
      </details>
      <details>
        <summary className="cursor-pointer text-sm">
          Alertas configurables
        </summary>
        <div className="my-2 flex flex-wrap gap-3 text-sm">
          {Object.entries({
            dropsEnabled: "Caídas",
            cannibalEnabled: "Canibalización",
            ctrEnabled: "CTR bajo",
            urlChangesEnabled: "Cambio de URL rankeada",
          }).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                defaultChecked={project?.settings?.alerts?.[key] !== false}
                onChange={(e) =>
                  run(async () => {
                    await api(`/api/p/${id}/_`, "PATCH", {
                      settings: { alerts: { [key]: e.target.checked } },
                    });
                  })
                }
              />{" "}
              {label}
            </label>
          ))}
        </div>
        <p className="text-xs text-ink-500">
          Los umbrales de caída e impresiones se ajustan en Ajustes. Desactivar
          una alerta no borra su historial.
        </p>
      </details>
      {error && (
        <p role="alert" className="text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}
