"use client";
import { useMemo, useState } from "react";
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useProject } from "@/components/Shell";
import { api, cx, DataTable, Delta, Drawer, Empty, fmt, Icon, pct, Stat, Tabs, useApi, type Col } from "@/components/ui";

type Row = { key: string; clicks: number; impressions: number; ctr: number; position: number; n: number; prevClicks: number | null; prevPosition: number | null };

const expected = (pos: number) => [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018][Math.max(0, Math.min(9, Math.round(pos) - 1))] ?? 0.01;
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";

export default function GscPage() {
  const { id, project, refreshJobs } = useProject();
  const [days, setDays] = useState<"7" | "28" | "90">("28");
  const [dim, setDim] = useState<"query" | "page">("query");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "striking" | "lowctr">("all");
  const [sel, setSel] = useState<string | null>(null);
  const [rowsSel, setRowsSel] = useState<Set<string>>(new Set());
  const { data } = useApi<{ total: number; rows: Row[]; series: any[] }>(`/api/p/${id}/gsc?days=${days}&dim=${dim}&q=${encodeURIComponent(q)}`, { keepPreviousData: true });

  const rows = useMemo(() => {
    const r = (data?.rows ?? []).map((x) => ({ ...x, position: Number(x.position), ctr: Number(x.ctr) }));
    if (view === "striking") return r.filter((x) => x.position > 4 && x.position <= 20 && x.impressions >= 50);
    if (view === "lowctr") return r.filter((x) => x.position <= 10 && x.impressions >= 200 && x.ctr < expected(x.position) * 0.5);
    return r;
  }, [data, view]);
  const tot = useMemo(() => {
    const s = (data?.series ?? []).reduce((a: any, r: any) => ({ c: a.c + r.clicks, i: a.i + r.impressions, p: a.p + Number(r.position ?? 0) * r.impressions }), { c: 0, i: 0, p: 0 });
    return { clicks: s.c, impressions: s.i, ctr: s.i ? s.c / s.i : 0, position: s.i ? s.p / s.i : null };
  }, [data]);
  const series = (data?.series ?? []).map((r: any) => ({ d: String(r.d).slice(5, 10), clicks: r.clicks, impressions: r.impressions, position: r.position ? Number(Number(r.position).toFixed(1)) : null }));

  const cols: Col<Row>[] = [
    { key: "sel", label: "", get: (r) => (rowsSel.has(r.key) ? 1 : 0), render: (r) => <input type="checkbox" checked={rowsSel.has(r.key)} onClick={(e) => e.stopPropagation()} onChange={() => setRowsSel((s) => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; })} /> },
    { key: "key", label: dim === "query" ? "Query" : "Página", get: (r) => r.key, render: (r) => <span className="block max-w-[420px] truncate" title={r.key}>{dim === "page" ? path(r.key) : r.key}</span> },
    { key: "clicks", label: "Clicks", get: (r) => r.clicks, render: (r) => <>{fmt(r.clicks)} <Delta from={r.prevClicks} to={r.clicks} /></>, num: true },
    { key: "impr", label: "Impr.", get: (r) => r.impressions, render: (r) => fmt(r.impressions), num: true },
    { key: "ctr", label: "CTR", get: (r) => r.ctr, render: (r) => <span className={cx(r.position <= 10 && r.ctr < expected(r.position) * 0.5 && "text-rose-600")}>{pct(r.ctr)}</span>, num: true },
    { key: "pos", label: "Pos.", get: (r) => r.position, render: (r) => <>{fmt(r.position, 1)} <Delta from={r.prevPosition == null ? null : Number(r.prevPosition)} to={r.position} lowerIsBetter /></>, num: true },
    { key: "n", label: dim === "query" ? "Págs." : "Queries", get: (r) => r.n, render: (r) => <span className={cx(dim === "query" && r.n > 1 && "text-amber-600")}>{r.n}</span>, num: true },
  ];

  if (!project) return null;
  if (!project.gscProperty) return <div className="p-6"><Empty>configura la propiedad GSC en ajustes</Empty></div>;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={days} onChange={setDays} items={[{ id: "7", label: "7d" }, { id: "28", label: "28d" }, { id: "90", label: "90d" }]} />
        <Tabs value={dim} onChange={(d) => { setDim(d); setRowsSel(new Set()); }} items={[{ id: "query", label: "Queries" }, { id: "page", label: "Páginas" }]} />
        <Tabs value={view} onChange={setView} items={[{ id: "all", label: "Todo" }, { id: "striking", label: "Pos. 5–20" }, { id: "lowctr", label: "CTR bajo" }]} />
        <div className="relative">
          <Icon name="search" className="absolute left-2.5 top-2 h-4 w-4 text-ink-400" />
          <input className="input w-56 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="contiene" />
        </div>
        <div className="ml-auto flex gap-2">
          {dim === "query" && rowsSel.size > 0 && (
            <button className="btn" onClick={async () => { await api(`/api/p/${id}/rank`, "POST", { keywords: [...rowsSel] }); setRowsSel(new Set()); refreshJobs(); }}><Icon name="rank" />Trackear {rowsSel.size}</button>
          )}
          <button className="btn" onClick={async () => { await api(`/api/p/${id}/gsc/sync`, "POST", {}); refreshJobs(); }}><Icon name="refresh" />Sync</button>
        </div>
      </div>

      {!data?.total ? (
        <Empty>sin datos · presiona sync</Empty>
      ) : (
        <>
          <div className="card p-4">
            <div className="mb-3 grid grid-cols-4 gap-4">
              <Stat label="Clicks" value={fmt(tot.clicks)} hint={q ? "Suma de las consultas/páginas que calzan con el filtro." : "Totales del sitio, igual que el gráfico de Search Console. La tabla de abajo suma menos porque Google oculta las consultas poco frecuentes (anonimizadas)."} />
              <Stat label="Impresiones" value={fmt(tot.impressions)} />
              <Stat label="CTR" value={pct(tot.ctr)} />
              <Stat label="Posición" value={fmt(tot.position, 1)} />
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={series} margin={{ left: -20, right: -20 }}>
                <XAxis dataKey="d" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={30} />
                <YAxis yAxisId="c" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="p" orientation="right" reversed tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Area yAxisId="c" dataKey="clicks" stroke="#5b5bf6" fill="#5b5bf6" fillOpacity={0.15} strokeWidth={2} />
                <Line yAxisId="p" dataKey="position" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="card max-h-[calc(100vh-420px)] overflow-auto">
            <DataTable rows={rows} cols={cols} rowKey={(r) => r.key} initial={{ key: "clicks", dir: -1 }} onRow={(r) => setSel(r.key)} />
          </div>
        </>
      )}
      <Drawer open={!!sel} onClose={() => setSel(null)}>
        {sel && <Detail dim={dim} k={sel} days={days} />}
      </Drawer>
    </div>
  );
}

function Detail({ dim, k, days }: { dim: "query" | "page"; k: string; days: string }) {
  const { id } = useProject();
  const { data } = useApi<any[]>(`/api/p/${id}/gsc/detail?dim=${dim}&key=${encodeURIComponent(k)}&days=${days}`);
  return (
    <div>
      <h2 className="break-words pr-10 text-lg font-semibold">{dim === "page" ? path(k) : k}</h2>
      <div className="lbl mt-4">{dim === "query" ? "Páginas" : "Queries"}</div>
      <table className="tbl mt-1">
        <tbody>
          {data?.map((r) => (
            <tr key={r.key}>
              <td className="max-w-[300px] truncate">{dim === "query" ? path(r.key) : r.key}</td>
              <td className="num">{fmt(r.clicks)}</td>
              <td className="num text-ink-400">{fmt(r.impressions)}</td>
              <td className="num">{fmt(r.position, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
