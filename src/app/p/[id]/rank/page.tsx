"use client";
import { RankingExtras } from "@/components/RankingExtras";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useProject } from "@/components/Shell";
import { api, cx, DataTable, Delta, Drawer, Empty, fmt, Icon, jobBusy, pct, Spark, Tabs, useAction, useApi, type Col, fmtDate, Spinner } from "@/components/ui";

type Check = { id: string; date: string; position: number | null; url: string | null; features: string[]; competitors: { domain: string; position: number; url: string }[] };
type Tracked = { id: string; keyword: string; frequency: string; active: boolean; checks: Check[] };
type Alert = { id: string; type: string; key: string; data: any; seen: boolean; createdAt: string };

const FEAT: Record<string, string> = { ads: "ads", paa: "PAA", related: "rel", videos: "video", shopping: "shop", snippet: "snippet", ai_overview: "AIO", knowledge: "KP", local: "local" };
const path = (u: string | null) => (u ? u.replace(/^https?:\/\/[^/]+/, "") || "/" : "–");

export default function RankPage() {
  const { id, refreshJobs, project, jobs } = useProject();
  const checking = jobBusy(jobs, "rank.check");
  const [days, setDays] = useState(30);
  const { data, mutate } = useApi<{ tracked: Tracked[]; alerts: Alert[] }>(`/api/p/${id}/rank?days=${days}`);
  const [add, setAdd] = useState("");
  // Quick siempre trae el top 100: esto es solo un filtro de vista
  const [view, setView] = useState<"10" | "100">("100");
  const [freq, setFreq] = useState<string>("");
  const [sel, setSel] = useState<Tracked | null>(null);
  const [atab, setAtab] = useState<"all" | "drop" | "cannibal" | "lowctr">("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const [submit, adding] = useAction(async () => {
    const kws = add.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!kws.length) return;
    await api(`/api/p/${id}/rank`, "POST", { keywords: kws, frequency: freq || undefined });
    setAdd("");
    refreshJobs();
    mutate();
  });
  const [recheck, recheckBusy] = useAction(async () => { await api(`/api/p/${id}/rank/check`, "POST", { ids: checked.size ? [...checked] : undefined }); refreshJobs(); });

  const rows = (data?.tracked ?? []).map((t) => {
    const last = t.checks.at(-1);
    const prev = t.checks.at(-2);
    const ranked = t.checks.map((c) => c.position).filter((x): x is number => x != null);
    return { t, last, prev, pos: last?.position ?? null, best: ranked.length ? Math.min(...ranked) : null };
  });
  type R = (typeof rows)[number];
  const cols: Col<R>[] = [
    { key: "sel", label: "", get: (r) => (checked.has(r.t.id) ? 1 : 0), render: (r) => <input type="checkbox" checked={checked.has(r.t.id)} onClick={(e) => e.stopPropagation()} onChange={() => setChecked((s) => { const n = new Set(s); n.has(r.t.id) ? n.delete(r.t.id) : n.add(r.t.id); return n; })} /> },
    { key: "kw", label: "Keyword", get: (r) => r.t.keyword },
    { key: "pos", label: "Pos.", get: (r) => r.pos, render: (r) => <b className={cx("tabular-nums", r.pos != null && r.pos <= 3 && "text-emerald-600")}>{r.pos ?? (r.last ? ">100" : "…")}</b>, num: true },
    { key: "d", label: "Δ", get: (r) => (r.prev?.position ?? 101) - (r.pos ?? 101), render: (r) => <Delta from={r.prev?.position ?? null} to={r.pos} lowerIsBetter />, num: true },
    { key: "best", label: "Mejor", get: (r) => r.best, num: true },
    { key: "trend", label: "", get: () => 0, render: (r) => <Spark data={r.t.checks.map((c) => c.position)} invert /> },
    { key: "url", label: "URL", get: (r) => r.last?.url, render: (r) => <span className="block max-w-[260px] truncate text-ink-500">{path(r.last?.url ?? null)}</span> },
    { key: "feat", label: "SERP", get: (r) => r.last?.features.length, render: (r) => <span className="flex gap-1">{r.last?.features.map((f) => <span key={f} className="chip">{FEAT[f] ?? f}</span>)}</span> },
    { key: "f", label: "", get: (r) => r.t.frequency, render: (r) => <span className="text-xs text-ink-400">{r.t.frequency === "daily" ? "diario" : "semanal"}</span> },
  ];

  const alerts = (data?.alerts ?? []).filter((a) => atab === "all" || a.type === atab);
  const unseen = (data?.alerts ?? []).filter((a) => !a.seen).length;

  return (
    <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <RankingExtras />
        <div className="card flex flex-wrap items-start gap-2 p-3">
          <textarea className="input min-h-[38px] flex-1" rows={add.includes("\n") ? 4 : 1} placeholder="keywords a trackear (una por línea)" value={add} onChange={(e) => setAdd(e.target.value)} />
          <select className="input w-auto" value={freq} onChange={(e) => setFreq(e.target.value)} title="frecuencia (por defecto la del proyecto)">
            <option value="">{(project?.settings?.rank?.frequency ?? "weekly") === "daily" ? "diario (proyecto)" : "semanal (proyecto)"}</option>
            <option value="daily">diario</option>
            <option value="weekly">semanal</option>
          </select>
          <button className="btn-p" disabled={adding || !add.trim()} onClick={() => submit()}><Icon name="plus" />{adding ? <><Spinner className="h-3.5 w-3.5" />Agregando…</> : "Agregar"}</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={String(days) as "7" | "30" | "90"} onChange={(v) => setDays(Number(v))} items={[{ id: "7", label: "7d" }, { id: "30", label: "30d" }, { id: "90", label: "90d" }]} />
          <Tabs value={view} onChange={setView} items={[{ id: "10", label: "≤10" }, { id: "100", label: "≤100" }]} />
          <button className="btn hov-spin" disabled={!rows.length || checking || recheckBusy} title={checking ? "Ya hay una revisión en curso" : !rows.length ? "Primero agrega keywords" : undefined} onClick={() => recheck()}><Icon name="refresh" />{checking || recheckBusy ? <><Spinner className="h-3.5 w-3.5" />Revisando…</> : `Revisar ${checked.size || "todas"}`}</button>
          {checked.size > 0 && (
            <button className="btn" onClick={async () => { if (!confirm(`¿Dejar de trackear ${checked.size}?`)) return; await api(`/api/p/${id}/rank`, "DELETE", { ids: [...checked] }); setChecked(new Set()); mutate(); }}><Icon name="trash" /></button>
          )}
        </div>
        {rows.length ? (
          <div className="card max-h-[calc(100vh-260px)] overflow-auto">
            <DataTable rows={view === "10" ? rows.filter((r) => r.pos != null && r.pos <= 10) : rows} cols={cols} rowKey={(r) => r.t.id} initial={{ key: "pos", dir: 1 }} onRow={(r) => setSel(r.t)} />
          </div>
        ) : (
          <Empty icon="target" title="Sin keywords trackeadas">Agrega arriba las keywords que te importan y revisamos tu posición en Google cada semana (o cada día).</Empty>
        )}
      </div>

      <div className="card h-fit p-3">
        <div className="mb-2 flex items-center gap-2">
          <Icon name="bell" />
          <span className="lbl">Alertas</span>
          {unseen > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[11px] text-white">{unseen}</span>}
          <button className="btn-g ml-auto text-xs" onClick={async () => { await api(`/api/p/${id}/alerts`, "PATCH", {}); mutate(); }}>marcar vistas</button>
        </div>
        <Tabs value={atab} onChange={setAtab} items={[{ id: "all", label: "Todas" }, { id: "drop", label: "Caídas" }, { id: "cannibal", label: "Canib." }, { id: "lowctr", label: "CTR" }]} />
        <div className="mt-3 max-h-[calc(100vh-240px)] space-y-2 overflow-y-auto">
          {alerts.map((a) => (
            <div key={a.id} className={cx("rounded-lg border p-2.5 text-sm", a.seen ? "border-ink-100 opacity-60 dark:border-ink-800" : "border-ink-200 dark:border-ink-700")}>
              <div className="flex items-center gap-2">
                <span className={cx("chip", a.type === "drop" && "!bg-rose-100 !text-rose-700", a.type === "cannibal" && "!bg-amber-100 !text-amber-700", a.type === "lowctr" && "!bg-sky-100 !text-sky-700")}>
                  {a.type === "drop" ? "caída" : a.type === "cannibal" ? "canibalización" : a.type === "urlchange" ? "Cambio de URL" : "CTR bajo"}
                </span>
                <span className="truncate font-medium">{a.key}</span>
              </div>
              <div className="mt-1 text-xs text-ink-500">
                {a.type === "urlchange" && <>{path(a.data.from)} → {path(a.data.to)}</>}
                {a.type === "drop" && <>{a.data.from ?? "–"} → {a.data.to ?? "fuera"} · {path(a.data.url)}</>}
                {a.type === "cannibal" && (a.data.pages ?? a.data.urls?.map((u: string) => ({ page: u })) ?? []).map((p: any) => (
                  <div key={p.page} className="truncate">{path(p.page)}{p.impressions != null && <span className="text-ink-400"> · {fmt(p.impressions)} impr · pos {fmt(p.position, 1)}</span>}</div>
                ))}
                {a.type === "lowctr" && <>{fmt(a.data.impressions)} impr · CTR {pct(a.data.ctr)} (esperado {pct(a.data.expected)}) · pos {fmt(a.data.position, 1)}<div className="truncate">{path(a.data.page)}</div></>}
              </div>
            </div>
          ))}
          {!alerts.length && <div className="py-6 text-center text-sm text-ink-300">—</div>}
        </div>
      </div>

      <Drawer open={!!sel} onClose={() => setSel(null)} wide>
        {sel && <RankDetail t={sel} onChange={() => mutate()} />}
      </Drawer>
    </div>
  );
}

function RankDetail({ t, onChange }: { t: Tracked; onChange: () => void }) {
  const { id } = useProject();
  const series = t.checks.map((c) => ({ d: fmtDate(c.date, "dm"), pos: c.position }));
  const last = t.checks.at(-1);
  const urls = [...new Set(t.checks.map((c) => c.url).filter(Boolean))];
  return (
    <div>
      <h2 className="pr-10 text-lg font-semibold">{t.keyword}</h2>
      <div className="mt-2 flex gap-2">
        <select className="input w-auto" defaultValue={t.frequency} onChange={async (e) => { await api(`/api/p/${id}/rank`, "PATCH", { id: t.id, frequency: e.target.value }); onChange(); }}>
          <option value="daily">diario</option>
          <option value="weekly">semanal</option>
        </select>

      </div>
      <div className="mt-4 h-56">
        <ResponsiveContainer>
          <LineChart data={series} margin={{ left: -20, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
            <XAxis dataKey="d" tick={{ fontSize: 10 }} />
            <YAxis reversed domain={[1, "dataMax"]} allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Line type="monotone" dataKey="pos" stroke="#5b5bf6" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {urls.length > 1 && (
        <div className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {urls.length} URLs distintas: {urls.map((u) => path(u)).join(" · ")}
        </div>
      )}
      {last && (
        <div className="mt-4">
          <div className="lbl mb-1">Top 10 · {fmtDate(last.date)}</div>
          <table className="tbl">
            <tbody>
              {[...last.competitors, ...(last.position && last.position <= 10 ? [{ domain: "★ tú", position: last.position, url: last.url! }] : [])]
                .sort((a, b) => a.position - b.position)
                .map((c) => (
                  <tr key={c.position + c.url}>
                    <td className="w-8 tabular-nums">{c.position}</td>
                    <td className={cx(c.domain.startsWith("★") && "font-semibold text-acc")}>{c.domain}</td>
                    <td className="max-w-[320px] truncate text-ink-400">{path(c.url)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
