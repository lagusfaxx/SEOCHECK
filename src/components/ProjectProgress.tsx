"use client";
import Link from "next/link";
import { useProject } from "./Shell";
import { api, useApi } from "./ui";
import { GLOSSARY } from "@/lib/glossary";
import { useState } from "react";

export function GlossaryTerm({
  term,
  children,
}: {
  term: string;
  children?: React.ReactNode;
}) {
  return (
    <abbr
      title={GLOSSARY[term] ?? term}
      className="cursor-help decoration-dotted underline underline-offset-4"
      tabIndex={0}
    >
      {children ?? term}
    </abbr>
  );
}
export function ProjectProgress() {
  const { id } = useProject();
  const { data, mutate } = useApi<any>(`/api/p/${id}/onboarding`);
  const [error, setError] = useState("");
  if (!data) return null;
  const update = async (body: object) => {
    try {
      await api(`/api/p/${id}/onboarding`, "PATCH", body);
      await mutate();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const steps = [
    ["gsc", "Conectar Search Console", "settings"],
    ["crawl", "Primera auditoría", "audit"],
    ["keywords", "Investigar keywords", "keywords"],
    ["rankings", "Monitorear posiciones", "rank"],
    ["report", "Generar primer informe", "report"],
  ];
  return (
    <section
      className="card mb-4 space-y-3 p-4"
      aria-label="Checklist del proyecto"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">
          Tu proyecto · {steps.filter(([k]) => data.completed[k]).length}/
          {steps.length} pasos
        </h2>
        <label className="ml-auto text-sm">
          Experiencia{" "}
          <select
            className="input ml-2 w-auto"
            value={data.experience}
            onChange={(e) => update({ experience: e.target.value })}
          >
            <option value="beginner">Principiante</option>
            <option value="seo">SEO</option>
            <option value="agency">Agencia</option>
          </select>
        </label>
        <Link href={`/p/${id}/guide`} className="btn">
          Guía de Search Console y DNS
        </Link>
      </div>
      <ol className="flex flex-wrap gap-3 text-sm">
        {steps.map(([k, label, href]) => (
          <li key={k}>
            <Link
              href={`/p/${id}/${href}`}
              className={data.completed[k] ? "text-emerald-700" : "text-acc"}
            >
              {data.completed[k] ? "✓" : "○"} {label}
            </Link>
            {k === "gsc" && !data.completed.gsc && (
              <button
                className="ml-2 text-xs underline"
                onClick={() => update({ skipGsc: !data.skipGsc })}
              >
                {data.skipGsc ? "Volver a conectar" : "Continuar sin GSC"}
              </button>
            )}
          </li>
        ))}
      </ol>
      {data.skipGsc && (
        <p className="text-sm text-amber-700">
          Sin GSC podrás auditar páginas, pero perderás clics, impresiones,
          consultas reales, tendencias y oportunidades de CTR.
        </p>
      )}
      {data.experience === "beginner" && (
        <p className="text-sm text-ink-500">
          Comienza con una auditoría. En el resumen verás las tareas pendientes.
        </p>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer">Glosario SEO</summary>
        <dl className="mt-2 grid gap-2 md:grid-cols-2">
          {Object.entries(GLOSSARY).map(([term, text]) => (
            <div key={term}>
              <dt className="font-semibold">{term}</dt>
              <dd className="text-ink-500">{text}</dd>
            </div>
          ))}
        </dl>
      </details>
      {error && (
        <p role="alert" className="text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}

