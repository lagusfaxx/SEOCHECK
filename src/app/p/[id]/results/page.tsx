"use client";
import { useState } from "react";
import { useProject } from "@/components/Shell";
import { GscConnect } from "@/components/GscConnect";
import { Ga4Card, type Ga4Data } from "@/components/Ga4Card";
import { WatchCard } from "@/components/WatchCard";
import { AiLocalCard } from "@/components/AiLocalCard";
import { api, Bar, cx, DataTable, Delta, Empty, fmt, Hint, pct, Spinner, Stat, useAction, useApi, type Col } from "@/components/ui";

type Pace = { mtd: number; projected: number | null; target: number | null; status: string | null; needPerDay: number | null; daysWithData: number; daysInMonth: number };
type Impact = { beforePerDay: number; afterPerDay: number; change: number | null; conclusive: boolean; note: string; impressionsBeforePerDay: number; impressionsAfterPerDay: number };
type Change = { id: string; kind: "manual" | "task"; date: string; title: string; scope: string | null; note: string | null; impact: Impact | null };
type Overview = {
  connected: boolean;
  kpis?: {
    period: { start: string; end: string; label: string };
    clicks: { now: number; before: number };
    impressions: { now: number; before: number };
    brand: { now: number; before: number };
    nonBrand: { now: number; before: number };
    nonBrandImpressions: { now: number; before: number };
    source: string;
  };
  sections?: { section: string; clicks: number; impressions: number; before: number; pages: number }[];
  goals: { clicks?: number | null; nonBrandClicks?: number | null };
  goalProgress?: { month: string; clicks: Pace; nonBrandClicks: Pace };
  annotations: Change[];
  decay?: { page: string; clicks: number[]; lost: number }[];
  opportunities?: { rows: { query: string; page: string; impressions: number; clicks: number; position: number; extraClicks: number }[]; extraClicks: number; note: string };
  competitors: null | {
    basis: string;
    keywords: number;
    ownShare: number;
    top: { domain: string; share: number; keywords: number; avgPosition: number; own: boolean }[];
    aiOverview: { keywords: number; cited: number; examples: { keyword: string; cited: boolean }[] };
    note: string;
  };
  ga4: Ga4Data;
};

type Sum = { target: string; backlinks: number; referringDomains: number; rank: number; brokenBacklinks: number };
type Backlinks = {
  configured: boolean;
  snapshot: null | {
    at: string; target: string; competitors: string[]; summary: Sum; previous: Sum | null; competitorSummaries: Sum[];
    newDomains: { domain: string; rank: number }[]; lost: { domain: string; rank: number }[];
    broken: { from: string; to: string; status: number | null; rank: number }[]; gap: { domain: string; rank: number }[]; errors: string[];
  };
};

const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const change = (now: number, before: number) => (before ? `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)} %` : "sin base");

function Kpi({ label, now, before, hint }: { label: string; now: number; before: number; hint?: string }) {
  return <Stat label={label} value={fmt(now)} hint={hint} tone={before && now < before * 0.9 ? "bad" : before && now > before * 1.1 ? "good" : undefined} sub={<>antes {fmt(before)} · {change(now, before)}</>} />;
}

function Goal({ label, p }: { label: string; p: Pace }) {
  if (p.target == null) return null;
  const share = p.target ? Math.min(1, p.mtd / p.target) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums">{fmt(p.mtd)} / {fmt(p.target)}</span>
      </div>
      <Bar value={share * 100} className="mt-1" />
      <div className={cx("mt-1 text-xs", p.status === "en ritmo" ? "text-emerald-600" : p.status === "cerca" ? "text-amber-600" : "text-rose-600")}>
        Proyección a fin de mes: {fmt(p.projected)} ({p.status}){p.needPerDay != null && p.status !== "en ritmo" ? ` · faltan ~${fmt(p.needPerDay)} clics/día` : ""} · {p.daysWithData} de {p.daysInMonth} días con datos
      </div>
    </div>
  );
}

export default function Results() {
  const { id, project } = useProject();
  const { data, mutate, isLoading } = useApi<Overview>(`/api/p/${id}/marketing`);
  const { data: bl } = useApi<Backlinks>(`/api/p/${id}/backlinks`);
  const [comp, setComp] = useState<string | null>(null);
  const [saveComp, savingComp] = useAction(async () => {
    await api(`/api/p/${id}/marketing/competitors`, "POST", { competitors: (comp ?? "").split(/[\s,;]+/).filter(Boolean) });
    setComp(null);
  });
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), title: "", scope: "", note: "" });
  const [goals, setGoals] = useState<{ clicks: string; nonBrandClicks: string } | null>(null);
  const [addNote, adding] = useAction(async () => {
    await api(`/api/p/${id}/marketing/annotations`, "POST", form);
    setForm({ ...form, title: "", scope: "", note: "" });
    await mutate();
  });
  const [delNote] = useAction(async (annotationId: string) => {
    await api(`/api/p/${id}/marketing/annotations`, "DELETE", { annotationId });
    await mutate();
  });
  const [saveGoals, savingGoals] = useAction(async () => {
    await api(`/api/p/${id}/marketing/goals`, "POST", goals);
    setGoals(null);
    await mutate();
  });

  if (!project) return null;
  if (isLoading || !data) return <div className="p-6"><Spinner /></div>;
  const k = data.kpis;
  const g = goals ?? { clicks: data.goals.clicks?.toString() ?? "", nonBrandClicks: data.goals.nonBrandClicks?.toString() ?? "" };

  const oppCols: Col<NonNullable<Overview["opportunities"]>["rows"][number]>[] = [
    { key: "q", label: "Consulta", get: (r) => r.query, render: (r) => <span className="block max-w-[260px] truncate" title={r.query}>{r.query}</span> },
    { key: "p", label: "Página", get: (r) => r.page, render: (r) => <span className="block max-w-[220px] truncate text-ink-500" title={r.page}>{path(r.page)}</span> },
    { key: "pos", label: "Pos.", get: (r) => r.position, render: (r) => fmt(r.position, 1), num: true },
    { key: "i", label: "Impr.", get: (r) => r.impressions, render: (r) => fmt(r.impressions), num: true },
    { key: "x", label: <span className="inline-flex items-center gap-1">Clics extra<Hint text="Estimación si la consulta llegara a la posición 3, con una curva de CTR promedio. Sirve para ordenar, no es una promesa." /></span>, get: (r) => r.extraClicks, render: (r) => <b>+{fmt(r.extraClicks)}</b>, num: true },
  ];

  return (
    <div className="max-w-6xl space-y-5 p-4 md:p-6">
      {!data.connected && <GscConnect />}

      {k && (
        <section className="card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Search Console · últimos 28 días con datos</h2>
            <span className="text-xs text-ink-500">{k.period.start} a {k.period.end} vs. 28 días anteriores</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label="Clics" now={k.clicks.now} before={k.clicks.before} />
            <Kpi label="Impresiones" now={k.impressions.now} before={k.impressions.before} />
            <Kpi label="Clics sin marca" now={k.nonBrand.now} before={k.nonBrand.before} hint="Consultas que no incluyen el nombre del sitio: es el tráfico que trae el SEO. Los clics de marca dependen más de la notoriedad." />
            <Kpi label="Clics de marca" now={k.brand.now} before={k.brand.before} />
          </div>
          <p className="mt-3 text-xs text-ink-500">{k.source}</p>
        </section>
      )}

      <WatchCard />

      <Ga4Card data={data.ga4} onChange={() => mutate()} />

      <section className="card space-y-3 p-4">
        <h2 className="text-base font-semibold">Objetivo del mes{data.goalProgress ? ` (${data.goalProgress.month})` : ""}</h2>
        {data.goalProgress && <Goal label="Clics" p={data.goalProgress.clicks} />}
        {data.goalProgress && <Goal label="Clics sin marca" p={data.goalProgress.nonBrandClicks} />}
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); saveGoals(); }}>
          <label className="text-xs">Clics/mes<input className="input mt-1 w-32" inputMode="numeric" value={g.clicks} onChange={(e) => setGoals({ ...g, clicks: e.target.value })} /></label>
          <label className="text-xs">Clics sin marca/mes<input className="input mt-1 w-32" inputMode="numeric" value={g.nonBrandClicks} onChange={(e) => setGoals({ ...g, nonBrandClicks: e.target.value })} /></label>
          <button className="btn" disabled={savingGoals || !goals}>Guardar objetivo</button>
        </form>
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-base font-semibold">Cambios y su efecto</h2>
          <p className="text-xs text-ink-500">Anota cada cambio publicado (nuevo title, contenido, migración, campaña). Se compara clics por día antes y después en el mismo alcance. Las tareas resueltas se miden solas.</p>
        </div>
        <form className="grid gap-2 md:grid-cols-[140px_1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); addNote(); }}>
          <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <input className="input" placeholder="Qué cambió (ej. nuevos titles en fichas)" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <input className="input" placeholder="Alcance: URL, /seccion/* o vacío = todo el sitio" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
          <button className="btn" disabled={adding || !form.title}>Anotar</button>
        </form>
        {data.annotations.length ? (
          <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
            {data.annotations.map((a) => (
              <li key={`${a.kind}${a.id}`} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-ink-500">{a.date} · {a.scope ? path(a.scope) : "todo el sitio"}{a.kind === "task" ? " · tarea resuelta" : ""}</div>
                </div>
                <div className="text-right text-xs">
                  {a.impact ? (
                    <>
                      <div className="tabular-nums">
                        {fmt(a.impact.beforePerDay, 1)} → {fmt(a.impact.afterPerDay, 1)} clics/día{" "}
                        {a.impact.change != null && <span className={cx(a.impact.conclusive ? (a.impact.change >= 0 ? "text-emerald-600" : "text-rose-600") : "text-ink-400")}>({a.impact.change >= 0 ? "+" : ""}{Math.round(a.impact.change * 100)} %)</span>}
                      </div>
                      <div className="text-ink-500">{a.impact.conclusive ? "" : "No concluyente: "}{a.impact.note}</div>
                    </>
                  ) : <span className="text-ink-400">sin Search Console</span>}
                  {a.kind === "manual" && <button className="mt-1 text-ink-400 hover:text-rose-600" onClick={() => delNote(a.id)}>Quitar</button>}
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty compact icon="clock" title="Sin cambios anotados">Anota el próximo cambio que publiques para medir su efecto.</Empty>}
      </section>

      {data.opportunities && (
        <section className="card p-4">
          <h2 className="text-base font-semibold">Dónde está el crecimiento: posiciones 4–20 (~+{fmt(data.opportunities.extraClicks)} clics/mes)</h2>
          <p className="mb-3 text-xs text-ink-500">{data.opportunities.note}</p>
          {data.opportunities.rows.length ? <DataTable rows={data.opportunities.rows} cols={oppCols} rowKey={(r) => r.query + r.page} initial={{ key: "x", dir: -1 }} /> : <Empty compact title="Sin oportunidades con datos suficientes" />}
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {data.sections && (
          <section className="card p-4">
            <h2 className="mb-2 text-base font-semibold">Por sección</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink-500"><th>Sección</th><th className="text-right">Clics</th><th className="text-right">Impr.</th><th className="text-right">Págs.</th></tr></thead>
              <tbody>
                {data.sections.map((s) => (
                  <tr key={s.section} className="border-t border-ink-100 dark:border-ink-800">
                    <td className="py-1.5">{s.section}</td>
                    <td className="text-right tabular-nums">{fmt(s.clicks)} <Delta from={s.before} to={s.clicks} /></td>
                    <td className="text-right tabular-nums">{fmt(s.impressions)}</td>
                    <td className="text-right tabular-nums">{s.pages}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {data.decay && (
          <section className="card p-4">
            <h2 className="text-base font-semibold">Contenido para refrescar</h2>
            <p className="mb-2 text-xs text-ink-500">Páginas que bajaron tres períodos de 28 días seguidos y perdieron 30 % o más de sus clics.</p>
            {data.decay.length ? (
              <ul className="space-y-1 text-sm">
                {data.decay.map((d) => (
                  <li key={d.page} className="flex justify-between gap-2"><span className="truncate" title={d.page}>{path(d.page)}</span><span className="shrink-0 tabular-nums text-ink-500">{d.clicks.join(" → ")} <span className="text-rose-600">−{fmt(d.lost)}</span></span></li>
                ))}
              </ul>
            ) : <Empty compact tone="good" icon="check" title="Ninguna página en caída sostenida" />}
          </section>
        )}
      </div>

      <section className="card space-y-3 p-4">
        <h2 className="text-base font-semibold">Backlinks</h2>
        {bl?.snapshot ? (
          <>
            <p className="text-xs text-ink-500">Foto del {bl.snapshot.at.slice(0, 10)} (se actualiza al ejecutar el análisis completo, una vez por semana). Dominios de referencia = sitios distintos que te enlazan.</p>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink-500"><th>Sitio</th><th className="text-right">Dominios de ref.</th><th className="text-right">Backlinks</th><th className="text-right">Rank</th></tr></thead>
              <tbody>
                {[bl.snapshot.summary, ...bl.snapshot.competitorSummaries].map((s) => (
                  <tr key={s.target} className={cx("border-t border-ink-100 dark:border-ink-800", s.target === bl.snapshot!.target && "font-semibold")}>
                    <td className="py-1.5">{s.target}{s.target === bl.snapshot!.target ? " (tú)" : ""}</td>
                    <td className="text-right tabular-nums">{fmt(s.referringDomains)}{s.target === bl.snapshot!.target && bl.snapshot!.previous ? <> <Delta from={bl.snapshot!.previous.referringDomains} to={s.referringDomains} /></> : null}</td>
                    <td className="text-right tabular-nums">{fmt(s.backlinks)}</td>
                    <td className="text-right tabular-nums">{fmt(s.rank)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid gap-4 text-sm md:grid-cols-3">
              <div><div className="lbl">Nuevos (30 días)</div>{bl.snapshot.newDomains.length ? bl.snapshot.newDomains.slice(0, 8).map((d) => <div key={d.domain}>{d.domain} <span className="text-ink-400">{d.rank}</span></div>) : <div className="text-ink-400">—</div>}</div>
              <div><div className="lbl">Perdidos</div>{bl.snapshot.lost.length ? bl.snapshot.lost.slice(0, 8).map((d) => <div key={d.domain}>{d.domain} <span className="text-ink-400">{d.rank}</span></div>) : <div className="text-ink-400">—</div>}</div>
              <div><div className="lbl inline-flex items-center gap-1">Enlazan a la competencia y no a ti<Hint text="Dominios que enlazan a todos los competidores de la tabla y no a tu sitio: los más fáciles de conseguir." /></div>{bl.snapshot.gap.length ? bl.snapshot.gap.slice(0, 8).map((d) => <div key={d.domain}>{d.domain} <span className="text-ink-400">{d.rank}</span></div>) : <div className="text-ink-400">—</div>}</div>
            </div>
            {bl.snapshot.broken.length > 0 && <p className="text-sm text-rose-600">{bl.snapshot.broken.length} backlink(s) llegan a páginas con error: redirígelas con 301 (detalle en el informe).</p>}
          </>
        ) : <Empty compact icon="globe" title={bl?.configured === false ? "Backlinks no disponible en este servidor" : "Sin datos de backlinks"}>{bl?.configured === false ? "" : "Se obtienen al ejecutar el análisis completo en Informe."}</Empty>}
        <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); saveComp(); }}>
          <input className="input flex-1" placeholder={`Competidores (opcional): ${bl?.snapshot?.competitors.join(", ") || "se eligen solos desde Google"}`} value={comp ?? ""} onChange={(e) => setComp(e.target.value)} />
          <button className="btn" disabled={savingComp || comp == null}>Guardar</button>
        </form>
      </section>

      <AiLocalCard />

      <section className="card p-4">
        <h2 className="text-base font-semibold">Competidores y visibilidad</h2>
        {data.competitors ? (
          <>
            <p className="mb-3 text-xs text-ink-500">{data.competitors.keywords} keywords ({data.competitors.basis}). {data.competitors.note}</p>
            <div className="mb-3 grid grid-cols-2 gap-4 md:grid-cols-3">
              <Stat label="Tu cuota de visibilidad" value={pct(data.competitors.ownShare)} />
              <Stat label="Keywords con AI Overview" value={fmt(data.competitors.aiOverview.keywords)} hint="Búsquedas donde Google muestra un resumen generado con IA arriba de los resultados: suele bajar el CTR orgánico." />
              <Stat label="Te cita el AI Overview" value={`${fmt(data.competitors.aiOverview.cited)} de ${fmt(data.competitors.aiOverview.keywords)}`} />
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink-500"><th>Dominio</th><th className="text-right">Cuota</th><th className="text-right">Keywords</th><th className="text-right">Pos. media</th></tr></thead>
              <tbody>
                {data.competitors.top.map((c) => (
                  <tr key={c.domain} className={cx("border-t border-ink-100 dark:border-ink-800", c.own && "font-semibold")}>
                    <td className="py-1.5">{c.domain}{c.own ? " (tú)" : ""}</td>
                    <td className="text-right tabular-nums">{pct(c.share)}</td>
                    <td className="text-right tabular-nums">{c.keywords}</td>
                    <td className="text-right tabular-nums">{fmt(c.avgPosition, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : <Empty compact icon="rank" title="Sin SERPs guardadas">Agrega keywords en Rankings o corre Keywords para ver competidores y AI Overviews.</Empty>}
      </section>
    </div>
  );
}
