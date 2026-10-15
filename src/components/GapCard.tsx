"use client";
import { useProject } from "@/components/Shell";
import { DataTable, Empty, fmt, Hint, useApi, type Col } from "@/components/ui";

const M = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
type Item = { keyword: string; volume: number; peaks: number[]; competitors: { domain: string; position: number; url: string | null }[] };
type Data = { gap: null | { at: string; competitors: string[]; total: number; items: Item[]; errors: string[] }; upcoming: { keyword: string; volume: number; peaks: string }[] };

/** Keywords de la competencia que el sitio no tiene, y temas que entran en temporada. */
export function GapCard() {
  const { id } = useProject();
  const { data } = useApi<Data>(`/api/p/${id}/keyword-gap`);
  if (!data) return null;
  const cols: Col<Item>[] = [
    { key: "k", label: "Keyword", get: (r) => r.keyword },
    { key: "v", label: "Búsquedas/mes", get: (r) => r.volume, render: (r) => fmt(r.volume), num: true },
    { key: "c", label: "Competidor (pos.)", get: (r) => r.competitors[0]?.position ?? 99, render: (r) => <span className="text-xs">{r.competitors.map((c) => `${c.domain} (${c.position})`).join(", ")}</span> },
    { key: "p", label: <span className="inline-flex items-center gap-1">Meses pico<Hint text="Meses en que se busca 20 % o más que el promedio del año. Publica o actualiza 1–2 meses antes." /></span>, get: (r) => r.peaks[0] ?? 13, render: (r) => (r.peaks.length ? r.peaks.map((m) => M[m - 1]).join(", ") : <span className="text-ink-400">pareja</span>) },
  ];
  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-base font-semibold">Keywords de la competencia que no tienes</h2>
      {data.upcoming.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-900/20">
          <b>Se viene la temporada:</b> {data.upcoming.slice(0, 8).map((u) => `«${u.keyword}» (${u.peaks})`).join(" · ")}. Publica o actualiza ese contenido ahora.
        </div>
      )}
      {data.gap?.items.length ? (
        <>
          <p className="text-xs text-ink-500">DataForSEO, {data.gap.at.slice(0, 10)}: {data.gap.total} keywords donde {data.gap.competitors.join(", ")} está en el top 20 y tu sitio no aparece. Revisa que el negocio lo ofrezca antes de crear contenido.</p>
          <DataTable rows={data.gap.items} cols={cols} rowKey={(r) => r.keyword} initial={{ key: "v", dir: -1 }} />
        </>
      ) : <Empty compact icon="key" title="Sin datos todavía">Se calcula una vez al mes al ejecutar el análisis completo, con los competidores de Resultados o los que más aparecen en tus búsquedas.</Empty>}
    </section>
  );
}
