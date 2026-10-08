"use client";
import { useState } from "react";
import { useProject } from "./Shell";
import { api, useApi } from "./ui";
import type { Brief } from "@/lib/content/analyze";
export function ContentTools({
  cid,
  brief,
  onChange,
}: {
  cid: string;
  brief: Brief | null;
  onChange: (b: any) => void;
}) {
  const { id } = useProject();
  const { data: versions, mutate } = useApi<any[]>(
    `/api/p/${id}/content/versions?cid=${cid}`,
  );
  const [section, setSection] = useState("titles");
  const [comparison, setComparison] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      if (brief) await api(`/api/p/${id}/content`, "PATCH", { cid, brief });
      await fn();
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card space-y-3 p-3">
      <p className="text-sm">
        <b>Recomendaciones editoriales</b> ·{" "}
        {brief?.provenance === "ai"
          ? "Generadas con IA"
          : "Reglas y edición manual"}
        . Los datos medidos de tu página y de competidores aparecen en el
        análisis; estas propuestas requieren revisión.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          className="input w-auto"
          value={section}
          onChange={(e) => setSection(e.target.value)}
        >
          {Object.entries({
            titles: "Títulos",
            metas: "Meta descriptions",
            outline: "H2 / H3",
            intro: "Introducción",
            filters: "Filtros",
            links: "Enlaces",
            faq: "FAQ",
            notes: "Notas",
          }).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={busy || !brief}
          onClick={() =>
            run(async () => {
              const a = await api(`/api/p/${id}/content/section`, "POST", {
                cid,
                section,
              });
              onChange(a.brief);
            })
          }
        >
          Regenerar solo esta sección
        </button>
        <a
          className="btn"
          href={`/api/p/${id}/content/implementation?cid=${cid}`}
        >
          Enviar a implementación · Claude Code
        </a>
        <button
          className="btn"
          disabled={busy || !brief}
          onClick={() =>
            run(async () =>
              setComparison(
                await api(`/api/p/${id}/content/compare`, "POST", { cid }),
              ),
            )
          }
        >
          Comparar con lo implementado
        </button>
      </div>
      {!!versions?.length && (
        <details>
          <summary className="cursor-pointer text-sm">
            Historial de versiones ({versions.length})
          </summary>
          <ul className="max-h-48 space-y-1 overflow-auto text-sm">
            {versions.map((v) => (
              <li key={v.id}>
                {new Date(v.createdAt).toLocaleString("es-CL")} · {v.source}{" "}
                <button
                  className="btn-g text-acc"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const a = await api(
                        `/api/p/${id}/content/restore`,
                        "POST",
                        { cid, versionId: v.id },
                      );
                      onChange(a.brief);
                    })
                  }
                >
                  Restaurar
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {comparison && (
        <div className="space-y-1 text-sm">
          <b>
            Comprobado {new Date(comparison.fetchedAt).toLocaleString("es-CL")}
          </b>
          <p>
            Title: {comparison.title.matches ? "✓ coincide" : "Revisar"} · Meta:{" "}
            {comparison.meta.matches ? "✓ coincide" : "Revisar"}
          </p>
          {comparison.headings.map((h: any) => (
            <p key={h.id}>
              {h.passes === true ? "✓" : h.passes === false ? "✗" : "○"}{" "}
              {h.tag.toUpperCase()} {h.text} · {h.state ?? "opcional"} ·{" "}
              {h.present ? "presente" : "ausente"}
            </p>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}
