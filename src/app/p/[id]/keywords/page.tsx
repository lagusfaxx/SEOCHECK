"use client";
import { KeywordInsights } from "@/components/KeywordInsights";
import { useState } from "react";
import Board from "@/components/kw/Board";
import MindMap from "@/components/kw/MindMap";
import KwTable from "@/components/kw/Table";
import type { KwData, RunSources } from "@/components/kw/types";
import { useProject } from "@/components/Shell";
import { api, cx, Empty, fmt, Icon, Tabs, useLocal, fmtDate, Spinner } from "@/components/ui";
import { useAction, useApi } from "@/components/ui";
import { statusLabel } from "@/lib/status";

export default function KeywordsPage() {
  const { id, refreshJobs, jobs, project } = useProject();
  const chain: { provider: string; available: boolean; reason: string | null }[] = (project as any)?.volumeChain ?? [];
  const firstUsable = chain.find((c) => c.available)?.provider;
  const degraded = chain.filter((c) => !c.available && c.reason && !/^falta/.test(c.reason) && chain.indexOf(c) < chain.findIndex((x) => x.available));
  const [run, setRun] = useState<string>("");
  const key = `/api/p/${id}/keywords${run ? `?run=${run}` : ""}`;
  const { data, mutate } = useApi<KwData>(key);
  const [view, setView] = useLocal<"table" | "board" | "map">(`kwview:${id}`, "table");
  const [seeds, setSeeds] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [th, setTh] = useState(0.45);
  const running = jobs.some((j) => j.kind === "keywords.run" && (j.status === "running" || j.status === "queued"));

  const addSeed = (v: string) => {
    const parts = v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) setSeeds([...new Set([...seeds, ...parts])]);
    setDraft("");
  };
  const [start, starting] = useAction(async () => {
    const all = draft.trim() ? [...seeds, draft.trim()] : seeds;
    if (!all.length) return;
    await api(`/api/p/${id}/keywords/run`, "POST", { seeds: all, threshold: th });
    setSeeds([]);
    setDraft("");
    setRun("");
    refreshJobs();
    mutate();
  });
  const current = data?.runs.find((r) => r.id === data.runId);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <KeywordInsights runId={data?.runId} />
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="flex min-w-[280px] flex-1 flex-wrap items-center gap-1.5 rounded-lg border border-ink-200 px-2 py-1 focus-within:border-acc dark:border-ink-700">
          {seeds.map((s) => (
            <span key={s} className="chip">
              {s}
              <button onClick={() => setSeeds(seeds.filter((x) => x !== s))}><Icon name="x" className="h-3 w-3" /></button>
            </span>
          ))}
          <input
            className="min-w-[160px] flex-1 bg-transparent py-1 text-sm outline-none"
            placeholder={seeds.length ? "" : "seeds, separados por coma"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addSeed(draft); }
              if (e.key === "Backspace" && !draft && seeds.length) setSeeds(seeds.slice(0, -1));
            }}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-500" title="umbral de relevancia">
          <input type="range" min={0.2} max={0.8} step={0.05} value={th} onChange={(e) => setTh(Number(e.target.value))} />
          <span className="w-8 tabular-nums">{th.toFixed(2)}</span>
        </label>
        <CsvImport id={id} onDone={() => mutate()} />
        <button className="btn-p" onClick={() => start()} disabled={running || starting || (!seeds.length && !draft.trim())}>
          <Icon name="play" />
          {running || starting ? <><Spinner className="h-3.5 w-3.5" />Investigando…</> : "Investigar"}
        </button>
      </div>

      {degraded.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <Icon name="bell" />
          {degraded.map((c) => `${PROVIDER_NAME[c.provider] ?? c.provider}: ${c.reason}`).join(" · ")} — volumen desde {PROVIDER_NAME[firstUsable ?? ""] ?? "ningún proveedor"}
        </div>
      )}

      {data && data.runs.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={view} onChange={setView} items={[{ id: "table", label: "Tabla", icon: "table" }, { id: "board", label: "Clusters", icon: "board" }, { id: "map", label: "Mapa", icon: "map" }]} />
          <select className="input w-auto" value={data.runId ?? ""} onChange={(e) => setRun(e.target.value)}>
            {data.runs.map((r) => (
              <option key={r.id} value={r.id}>{r.seeds.join(", ")} · {fmtDate(r.createdAt)}</option>
            ))}
          </select>
          {current?.sources?.serp && <SourceBadges s={current.sources} />}
          {current && (
            <div className="flex gap-3 text-xs text-ink-500">
              {current.status !== "done" && <span className="chip">{statusLabel(current.status)}</span>}
              {Object.entries(current.stats ?? {}).map(([k, v]) => (
                <span key={k}>{k} <b className="text-ink-800 dark:text-ink-200">{fmt(v)}</b></span>
              ))}
            </div>
          )}
          {current && (
            <button className="btn ml-auto" disabled={running} title="re-correr: respeta lo fijado a mano" onClick={async () => { await api(`/api/p/${id}/keywords/rerun`, "POST", { runId: current.id }); refreshJobs(); }}>
              <Icon name="refresh" />Re-correr
            </button>
          )}
          {current && (
            <button className="btn-g" onClick={async () => { if (confirm("¿Borrar esta investigación?")) { await api(`/api/p/${id}/keywords/run`, "DELETE", { runId: current.id }); setRun(""); mutate(); } }}>
              <Icon name="trash" />
            </button>
          )}
        </div>
      )}

      {!data ? null : !data.runs.length ? (
        <Empty icon="key" title="Empieza tu research">Escribe algunas palabras semilla (lo que vende o hace el sitio) y presiona <b>Investigar</b>. Agrupamos las keywords en clusters según lo que Google muestra.</Empty>
      ) : view === "table" ? (
        <KwTable data={data} reload={() => mutate()} />
      ) : view === "board" ? (
        <Board data={data} reload={() => mutate()} setData={(d) => mutate(d, { revalidate: false })} />
      ) : (
        <MindMap data={data} reload={() => mutate()} />
      )}
    </div>
  );
}

const PROVIDER_NAME: Record<string, string> = { dataforseo: "DataForSEO", apify: "Apify", csv: "CSV Keyword Planner" };

function SourceBadges({ s }: { s: RunSources }) {
  const items: [string, string, boolean][] = [
    ["SERP", s.serp === "real" ? "real" : "sin SERP", s.serp === "real"],
    ["Embeddings", s.embeddings === "trigram-hash" ? "trigram-hash" : s.embeddings ?? "?", s.embeddings !== "trigram-hash"],
    ["Volumen", (s.volumes === "real" ? PROVIDER_NAME[s.volumeProvider ?? ""] ?? s.volumeProvider ?? "real" : s.volumes === "gsc" ? "solo GSC" : "sin volumen") + (s.volumeSkipped?.length ? ` (saltado: ${s.volumeSkipped.join("; ")})` : ""), (s.volumes === "real" || s.volumes === "gsc") && !s.volumeSkipped?.length],
    ...(s.gsc && s.gsc !== "none" ? [["GSC", s.gsc === "real" ? "real" : "error", s.gsc === "real"] as [string, string, boolean]] : []),
  ];
  return (
    <div className="flex gap-1.5">
      {items.map(([k, v, ok]) => (
        <span key={k} title={k} className={cx("rounded-md px-1.5 py-0.5 text-[11px] font-medium", ok ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300")}>
          {k} · {v}
        </span>
      ))}
    </div>
  );
}

/** Importa el CSV exportado de Keyword Planner (UTF-16, tabs) como fuente de volumen. */
function CsvImport({ id, onDone }: { id: string; onDone: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <label className={cx("btn cursor-pointer", busy && "opacity-50")} title="CSV de Keyword Planner">
      <Icon name="table" />
      {busy ? <Spinner className="h-3.5 w-3.5" /> : msg ?? "CSV"}
      <input
        type="file"
        accept=".csv,text/csv,text/tab-separated-values"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            const res = await fetch(`/api/p/${id}/volumes/csv`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: await file.arrayBuffer() });
            const j = await res.json();
            setMsg(res.ok ? `${j.imported} importadas · ${j.updated} actualizadas` : j.error ?? "error");
            if (res.ok) onDone();
          } finally {
            setBusy(false);
            setTimeout(() => setMsg(null), 6000);
          }
        }}
      />
    </label>
  );
}
