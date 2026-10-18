"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "./Shell";
import { api, useApi } from "./ui";
export function KeywordInsights({ runId }: { runId?: string }) {
  const { id, refreshJobs } = useProject();
  const { data, mutate } = useApi<any[]>(
    `/api/p/${id}/keywords/insights${runId ? `?run=${runId}` : ""}`,
  );
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <details className="card mb-4 p-4">
      <summary className="cursor-pointer font-semibold">
        Qué hacer con cada cluster
      </summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {data?.map((c) => (
          <article key={c.id} className="rounded-lg border border-ink-200 p-3">
            <h3 className="font-semibold">{c.name}</h3>
            <p className="text-sm">
              {c.status === "potential-cannibal"
                ? "Posible canibalización"
                : c.status === "mapped"
                  ? c.pages?.[0] ? <>Página: <a className="text-acc hover:underline" href={c.pages[0]} target="_blank" rel="noreferrer">{c.pages[0].replace(/^https?:\/\/[^/]+/, "") || "/"}</a></> : "Con página"
                  : "Sin página detectada"}{" "}
              ·{" "}
              <b>
                {c.recommendation === "consolidate"
                  ? "Revisar y consolidar"
                  : c.recommendation === "optimize"
                    ? "Optimizar"
                    : c.recommendation === "review"
                      ? "Revisar: fuera del catálogo"
                      : "Evaluar página nueva"}
              </b>
            </p>
            {c.overlaps.length > 0 && (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-ink-500">Por qué van juntas</summary>
                <p className="mt-1 text-ink-500">{c.note}</p>
                {c.overlaps.slice(0, 5).map((o: any) => (
                  <p key={o.keyword}>
                    {o.keyword}:{" "}
                    {o.shared == null
                      ? "sin evidencia SERP"
                      : `${o.shared} de ${o.denominator} resultados de Google en común`}
                  </p>
                ))}
              </details>
            )}
            <button
              className="btn mt-2 mr-2"
              onClick={async () => {
                try {
                  const url = prompt(
                    "Página propia para este cluster (vacío para quitar asignación)",
                    c.pages[0] ?? "",
                  );
                  if (url === null) return;
                  await api(`/api/p/${id}/keywords`, "PATCH", {
                    action: "mapPage",
                    clusterId: c.id,
                    url,
                  });
                  await mutate();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Asignar página
            </button>
            <button
              className="btn mt-2"
              onClick={async () => {
                try {
                  const url =
                    c.pages[0] ??
                    prompt(
                      "URL propia para el brief (puede ser la página que crearás)",
                    );
                  if (!url) return;
                  const a = await api(`/api/p/${id}/content`, "POST", {
                    url,
                    keyword: c.primary,
                  });
                  refreshJobs();
                  router.push(`/p/${id}/content/${a.id}`);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Generar brief
            </button>
          </article>
        ))}
      </div>
      {error && <p className="text-rose-700">{error}</p>}
    </details>
  );
}
