"use client";
import { useMemo, useState } from "react";
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useProject } from "@/components/Shell";
import { GscConnect } from "@/components/GscConnect";
import { api, cx, DataTable, Delta, Drawer, Empty, fmt, Hint, Icon, jobBusy, pct, Stat, Tabs, useAction, useApi, type Col, Spinner } from "@/components/ui";

type Row = { key: string; clicks: number; impressions: number; ctr: number; position: number; n: number; prevClicks: number | null; prevPosition: number | null };

const expected = (pos: number) => [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018][Math.max(0, Math.min(9, Math.round(pos) - 1))] ?? 0.01;
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";

export default function GscPage() {
  const { id, project, jobs, refreshJobs } = useProject();
  const syncing = jobBusy(jobs, "gsc.sync");
  const [sync, syncBusy] = useAction(async () => { await api(`/api/p/${id}/gsc/sync`, "POST", {}); refreshJobs(); });
  const [track, trackBusy] = useAction(async () => { await api(`/api/p/${id}/rank`, "POST", { keywords: [...rowsSel] }); setRowsSel(new Set()); refreshJobs(); });
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
    { key: "key", label: dim === "query" ? "Consulta" : "Página", get: (r) => r.key, render: (r) => <span className="block max-w-[420px] truncate" title={r.key}>{dim === "page" ? path(r.key) : r.key}</span> },
    { key: "clicks", label: "Clics", get: (r) => r.clicks, render: (r) => <>{fmt(r.clicks)} <Delta from={r.prevClicks} to={r.clicks} /></>, num: true },
    { key: "impr", label: "Impresiones", get: (r) => r.impressions, render: (r) => fmt(r.impressions), num: true },
    { key: "ctr", label: "CTR", get: (r) => r.ctr, render: (r) => <span className={cx(r.position <= 10 && r.ctr < expected(r.position) * 0.5 && "text-rose-600")}>{pct(r.ctr)}</span>, num: true },
    { key: "pos", label: "Posición", get: (r) => r.position, render: (r) => <>{fmt(r.position, 1)} <Delta from={r.prevPosition == null ? null : Number(r.prevPosition)} to={r.position} lowerIsBetter /></>, num: true },
    { key: "n", label: <span className="inline-flex items-center gap-1">{dim === "query" ? "Páginas" : "Consultas"}<Hint text={dim === "query" ? "Cuántas páginas de tu sitio aparecen en Google para esta consulta. Más de una (en amarillo) puede ser canibalización: tus páginas compiten entre sí." : "Cuántas consultas distintas hicieron aparecer esta página en Google."} /></span>, get: (r) => r.n, render: (r) => <span className={cx(dim === "query" && r.n > 1 && "text-amber-600")}>{r.n}</span>, num: true },
  ];

  if (!project) return null;
  if (!project.gscProperty || !project.providers?.gsc) return <div className="max-w-3xl p-4 md:p-6"><GscConnect /></div>;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={days} onChange={setDays} items={[{ id: "7", label: "7d", title: "Últimos 7 días" }, { id: "28", label: "28d", title: "Últimos 28 días" }, { id: "90", label: "90d", title: "Últimos 90 días" }]} />
        <Tabs value={dim} onChange={(d) => { setDim(d); setRowsSel(new Set()); }} items={[{ id: "query", label: "Consultas", title: "Lo que la gente escribió en Google" }, { id: "page", label: "Páginas", title: "Tus páginas que aparecieron en Google" }]} />
        <Tabs value={view} onChange={setView} items={[{ id: "all", label: "Todo" }, { id: "striking", label: "Posición 5–20", title: "Cerca de la primera página: con poco trabajo pueden subir" }, { id: "lowctr", label: "CTR bajo", title: "En el top 10 pero con menos clics de lo normal para su posición: revisa título y meta descripción" }]} />
        <div className="relative">
          <Icon name="search" className="absolute left-2.5 top-2 h-4 w-4 text-ink-400" />
          <input className="input w-56 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" />
        </div>
        <div className="ml-auto flex gap-2">
          {dim === "query" && rowsSel.size > 0 && (
            <button className="btn" disabled={trackBusy} onClick={() => track()}><Icon name="rank" />Monitorear {rowsSel.size}</button>
          )}
          <button className="btn hov-spin" disabled={syncing || syncBusy} title={syncing ? "Ya hay una sincronización en curso" : undefined} onClick={() => sync()}>{syncing || syncBusy ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="refresh" />}{syncing ? "Sincronizando…" : "Sincronizar"}</button>
        </div>
      </div>

      {!data?.total ? (
        <Empty icon="gsc" tone="info" title="Aún no hay datos de Search Console">Presiona <b>Sincronizar</b> para traer clics, impresiones y posiciones reales de Google.</Empty>
      ) : (
        <>
          <div className="card p-4">
            <div className="mb-3 grid grid-cols-4 gap-4">
              <Stat label="Clics" value={fmt(tot.clicks)} hint={q ? "Suma de las consultas/páginas que calzan con el filtro." : "Totales del sitio, igual que el gráfico de Search Console. La tabla de abajo suma menos porque Google oculta las consultas poco frecuentes (anonimizadas)."} />
              <Stat label="Impresiones" value={fmt(tot.impressions)} />
              <Stat label="CTR" value={pct(tot.ctr)} />
              <Stat label="Posición" value={fmt(tot.position, 1)} />
            </div>
            <div className="mb-1 flex flex-wrap items-center gap-4 text-xs text-ink-500" aria-label="Leyenda del gráfico">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#5b5bf6]" />Clics por día (eje izquierdo)</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-[#f59e0b]" />Posición promedio (eje derecho; más arriba es mejor)</span>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={series} margin={{ left: -20, right: -20 }}>
                <XAxis dataKey="d" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={30} />
                <YAxis yAxisId="c" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="p" orientation="right" reversed tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, name: any) => [name === "position" ? fmt(Number(v), 1) : fmt(Number(v)), name === "position" ? "Posición promedio" : "Clics"]} />
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
      <div className="lbl mt-4">{dim === "query" ? "Páginas que aparecen para esta consulta" : "Consultas para las que aparece esta página"}</div>
      <table className="tbl mt-1">
        <thead><tr><th>{dim === "query" ? "Página" : "Consulta"}</th><th className="num">Clics</th><th className="num">Impresiones</th><th className="num">Posición</th></tr></thead>
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
