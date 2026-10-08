"use client";
import { useMemo, useState } from "react";
import { useProject } from "../Shell";
import { api, cx, DataTable, fmt, Icon, IntentChip, INTENT, type Col, fmtDate } from "../ui";
import type { Kw, KwData } from "./types";

const SRC: Record<string, string> = { seed: "Semilla manual", autocomplete: "Autocomplete", gsc: "Search Console", paa: "Preguntas de Google", related: "SERP relacionada", serp: "SERP", csv: "Keyword Planner" };
const VSRC: Record<string, string> = { gsc: "GSC impr.", dataforseo: "DataForSEO", apify: "Apify", csv: "Keyword Planner" };
const short = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}K` : String(n));

export default function KwTable({ data, reload }: { data: KwData; reload: () => void }) {
  const { id, refreshJobs } = useProject();
  const [q, setQ] = useState("");
  const [intent, setIntent] = useState<string>("");
  const [minVol, setMinVol] = useState(0);
  const [showEx, setShowEx] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const clusterName = useMemo(() => new Map(data.clusters.map((c) => [c.id, c.name])), [data.clusters]);
  const tracked = useMemo(() => new Set(data.tracked), [data.tracked]);

  const rows = data.keywords.filter((k) => (showEx || !k.excluded) && (!q || k.term.includes(q.toLowerCase())) && (!intent || k.intent === intent) && (k.volume ?? 0) >= minVol);
  const toggle = (kid: string) => setSel((s) => { const n = new Set(s); n.has(kid) ? n.delete(kid) : n.add(kid); return n; });
  const selected = data.keywords.filter((k) => sel.has(k.id));

  const cols: Col<Kw>[] = [
    { key: "sel", label: <input type="checkbox" checked={sel.size > 0 && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />, get: (k) => (sel.has(k.id) ? 1 : 0), render: (k) => <input type="checkbox" checked={sel.has(k.id)} onChange={() => toggle(k.id)} onClick={(e) => e.stopPropagation()} /> },
    { key: "term", label: "Keyword", get: (k) => k.term, render: (k) => <span className={cx(k.excluded && "text-ink-400 line-through")}>{k.term}{tracked.has(k.term) && <Icon name="rank" className="ml-1 inline h-3 w-3 text-acc" />}</span> },
    { key: "intent", label: "Intent", get: (k) => k.intent, render: (k) => <IntentChip intent={k.intent} /> },
    { key: "volume", label: "Vol.", get: (k) => k.volume, render: (k) => (k.volumeMin != null && k.volumeMax != null && k.volumeMin !== k.volumeMax ? <span title={`estimado ${fmt(k.volume)}`}>{short(k.volumeMin)}–{short(k.volumeMax)}</span> : fmt(k.volume)), num: true },
    { key: "vsrc", label: "Fuente vol.", get: (k) => k.volumeSource, render: (k) => (k.volumeSource ? <span className={cx("chip", k.volumeSource === "gsc" && "!bg-emerald-100 !text-emerald-700")} title={k.volumeAt ? `dato del ${fmtDate(k.volumeAt)}` : ""}>{VSRC[k.volumeSource] ?? k.volumeSource}</span> : <span className="text-ink-300">—</span>) },
    { key: "cpc", label: "CPC", get: (k) => k.cpc, render: (k) => fmt(k.cpc, 2), num: true },
    { key: "comp", label: "Comp.", get: (k) => k.competition, render: (k) => fmt(k.competition, 2), num: true },
    { key: "rel", label: "Relev.", get: (k) => k.relevance, render: (k) => fmt(k.relevance, 2), num: true },
    { key: "kd", label: "Dif.", get: (k) => k.difficulty, render: (k) => k.difficulty == null ? "–" : <span className={cx("tabular-nums", k.difficulty > 60 ? "text-rose-600" : k.difficulty > 35 ? "text-amber-600" : "text-emerald-600")}>{k.difficulty}</span>, num: true },
    { key: "relevance", label: "Relevancia", get:k=>k.relevance, render:k=><span title="Similitud con las semillas; no es una probabilidad de posicionar">{k.relevance==null?"Sin evaluar":`${Math.round(k.relevance*100)}%`}</span>, num:true },
    { key: "score", label: "Score", get: (k) => k.score, render: (k) => <b>{fmt(k.score)}</b>, num: true },
    { key: "cluster", label: "Cluster", get: (k) => (k.clusterId ? clusterName.get(k.clusterId) : null), render: (k) => <span className="text-ink-500">{k.clusterId ? clusterName.get(k.clusterId) : ""}</span> },
    { key: "src", label: "Fuente", get: (k) => k.sources.join(","), render: (k) => <span className="flex gap-1">{k.sources.map((s) => <span key={s} className="chip">{SRC[s] ?? s}</span>)}</span> },
  ];

  const csv = () => {
    const head = ["keyword", "intent", "volume", "cpc", "competition", "relevance", "difficulty", "score", "cluster"];
    const lines = rows.map((k) => [k.term, k.intent, k.volume, k.cpc, k.competition, k.relevance, k.difficulty, k.score, k.clusterId ? clusterName.get(k.clusterId) : ""].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "keywords.csv";
    a.click();
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 p-3 dark:border-ink-800">
        <div className="relative w-56">
          <Icon name="search" className="absolute left-2.5 top-2 h-4 w-4 text-ink-400" />
          <input className="input pl-8" placeholder="filtrar" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-36" value={intent} onChange={(e) => setIntent(e.target.value)}>
          <option value="">intent</option>
          {Object.entries(INTENT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input className="input w-28" type="number" min={0} placeholder="vol. mín" value={minVol || ""} onChange={(e) => setMinVol(Number(e.target.value))} />
        <label className="flex items-center gap-1 text-xs text-ink-500"><input type="checkbox" checked={showEx} onChange={(e) => setShowEx(e.target.checked)} />excluidas</label>
        <span className="text-xs text-ink-400">{fmt(rows.length)}</span>
        <div className="ml-auto flex gap-2">
          {sel.size > 0 && (
            <>
              <button className="btn" onClick={async () => { await api(`/api/p/${id}/rank`, "POST", { keywords: selected.map((k) => k.term) }); refreshJobs(); setSel(new Set()); reload(); }}><Icon name="rank" />Trackear {sel.size}</button>
              <button className="btn" onClick={async () => { await api(`/api/p/${id}/keywords`, "PATCH", { action: "exclude", ids: [...sel], value: !selected[0]?.excluded }); setSel(new Set()); reload(); }}><Icon name="x" />{selected[0]?.excluded ? "Incluir" : "Excluir"}</button>
            </>
          )}
          <button className="btn" onClick={csv}>CSV</button>
        </div>
      </div>
      <div className="max-h-[calc(100vh-260px)] overflow-auto">
        <DataTable rows={rows} cols={cols} rowKey={(k) => k.id} initial={{ key: "score", dir: -1 }} onRow={(k) => toggle(k.id)} />
      </div>
    </div>
  );
}
