"use client";
import { useEffect, useRef, useState } from "react";
import { useProject } from "@/components/Shell";
import { api, cx, DataTable, Empty, fmt, pct, Stat, useAction, useApi, type Col } from "@/components/ui";

type Sums = { sessions: number; keyEvents: number; revenue: number };
export type Ga4Data = null | { property: string; currency: string | null; empty: true } | {
  property: string; currency: string | null; empty: false; period: { start: string; end: string };
  current: Sums; previous: Sums; note: string; checks: string[];
  landings: { landing: string; sessions: number; keyEvents: number; revenue: number; conversionRate: number }[];
};
type Status = { connected: boolean; hasScope: boolean; email: string | null; property?: string; displayName?: string; lastDate: string | null };

const money = (v: number, cur: string | null) => (cur ? new Intl.NumberFormat("es-CL", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(v) : fmt(v));
const change = (now: number, before: number) => (before ? `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)} %` : "sin base");

/** Conversiones e ingresos del tráfico orgánico (GA4), con la misma conexión de Google del proyecto. */
export function Ga4Card({ data, onChange }: { data: Ga4Data; onChange: () => void }) {
  const { id, project } = useProject();
  const domain = project?.domain ?? "el sitio";
  const { data: st, mutate } = useApi<Status>(`/api/p/${id}/ga4/status`);
  const [pick, setPick] = useState(false);
  type Prop = { property: string; displayName: string; account: string; sites: string[] };
  const { data: props, error: propsErr } = useApi<Prop[]>(pick ? `/api/p/${id}/ga4/properties` : null);
  // al conectar: elegir sola la propiedad cuyo sitio es el del proyecto; la lista solo aparece si hay más de una
  const [auto, setAuto] = useState<{ busy: boolean; candidates: Prop[]; reason: string | null } | null>(null);
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || !st?.connected || !st.hasScope || st.property) return;
    tried.current = true;
    setAuto({ busy: true, candidates: [], reason: null });
    api<{ chosen: string | null; candidates: Prop[]; reason: string | null }>(`/api/p/${id}/ga4/auto`, "POST", {})
      .then(async (r) => {
        setAuto({ busy: false, candidates: r.candidates, reason: r.reason });
        if (r.chosen) {
          await mutate();
          onChange();
        }
      })
      .catch((e) => setAuto({ busy: false, candidates: [], reason: e instanceof Error ? e.message : String(e) }));
  }, [st, id, mutate, onChange]);
  const [connect, connecting] = useAction(async () => {
    const r = await api<{ url: string }>(`/api/p/${id}/gsc/connect`, "POST", {});
    window.location.href = r.url;
  });
  const [choose, choosing] = useAction(async (property: string) => {
    await api(`/api/p/${id}/ga4/property`, "POST", { property });
    setPick(false);
    await mutate();
    onChange();
  });

  const cols: Col<Extract<NonNullable<Ga4Data>, { empty: false }>["landings"][number]>[] = [
    { key: "l", label: "Landing", get: (r) => r.landing, render: (r) => <span className="block max-w-[320px] truncate" title={r.landing}>{r.landing}</span> },
    { key: "s", label: "Sesiones", get: (r) => r.sessions, render: (r) => fmt(r.sessions), num: true },
    { key: "k", label: "Conversiones", get: (r) => r.keyEvents, render: (r) => fmt(r.keyEvents), num: true },
    { key: "c", label: "Tasa", get: (r) => r.conversionRate, render: (r) => pct(r.conversionRate), num: true },
    { key: "r", label: "Ingresos", get: (r) => r.revenue, render: (r) => money(r.revenue, data && "currency" in data ? data.currency : null), num: true },
  ];

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Conversiones e ingresos del SEO</h2>
        {st?.displayName && <span className="text-xs text-ink-500">Google Analytics · {st.displayName}{st.lastDate ? ` · datos hasta ${st.lastDate}` : ""}{!pick && <button className="btn-g" onClick={() => setPick(true)}>Cambiar</button>}</span>}
      </div>
      {st && (!st.connected || !st.hasScope) && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink-500">
            {data && !data.empty
              ? "Estos datos ya no se actualizan: la conexión con Google no está activa o no incluye Analytics."
              : st.connected
                ? "La conexión de Google no incluye permiso de Analytics: vuelve a conectar y marca la casilla de Google Analytics."
                : "Conecta tu cuenta de Google para ver ventas y contactos que trae el SEO."}
          </span>
          <button className="btn-p" disabled={connecting} onClick={connect}>{st.connected ? "Volver a conectar Google" : "Conectar Google"}</button>
        </div>
      )}
      {!st ? null : (!st.connected || !st.hasScope) && (!data || data.empty) ? null : !st.property || pick ? (
        <div className="space-y-2 text-sm">
          {(() => {
            // solo propiedades cuyo sitio web es el del proyecto: nunca la de otro dominio
            const list = pick ? props : auto?.candidates;
            if (pick && propsErr) return <div className="text-rose-600">{String(propsErr.message ?? propsErr)}</div>;
            if ((pick && !props) || auto?.busy) return <div className="text-ink-500">Buscando la propiedad de Analytics de {domain} y cargando sus datos…</div>;
            if (list && list.length > (pick ? 0 : 1))
              return (
                <>
                  {!pick && <p className="text-ink-500">Hay más de una propiedad de {domain}. ¿Cuál usamos?</p>}
                  <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                    {list.map((p) => (
                      <li key={p.property} className="flex items-center justify-between gap-2 py-1.5">
                        <span>{p.displayName} <span className="text-xs text-ink-400">{p.sites.join(", ")} · {p.account}</span></span>
                        {p.property === st.property ? <span className="text-xs text-emerald-600">en uso</span> : <button className="btn" disabled={choosing} onClick={() => choose(p.property)}>{choosing ? "Cargando 90 días…" : "Usar esta"}</button>}
                      </li>
                    ))}
                  </ul>
                  {pick && <button className="btn-g text-xs" onClick={() => setPick(false)}>Cerrar</button>}
                </>
              );
            return (
              <div className="text-ink-500">
                La cuenta {st.email} no tiene una propiedad de Google Analytics 4 con el sitio {domain}
                {auto?.reason && !/sitio/.test(auto.reason) ? ` (${auto.reason})` : ""}. Revisa en Analytics que el flujo de datos web use ese dominio, o conecta otra cuenta.
                {pick && <button className="btn-g ml-2 text-xs" onClick={() => setPick(false)}>Cerrar</button>}
              </div>
            );
          })()}
        </div>
      ) : !data || data.empty ? (
        <Empty compact icon="chart" title="Sin datos todavía">Se sincroniza todos los días con Search Console.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Sesiones orgánicas" value={fmt(data.current.sessions)} sub={<>antes {fmt(data.previous.sessions)} · {change(data.current.sessions, data.previous.sessions)}</>} />
            <Stat label="Conversiones" value={fmt(data.current.keyEvents)} tone={data.current.keyEvents < data.previous.keyEvents * 0.9 ? "bad" : data.current.keyEvents > data.previous.keyEvents * 1.1 ? "good" : undefined} sub={<>antes {fmt(data.previous.keyEvents)} · {change(data.current.keyEvents, data.previous.keyEvents)}</>} hint="Eventos clave de GA4 (compras, formularios, WhatsApp…) en sesiones que llegaron desde buscadores." />
            <Stat label="Ingresos" value={money(data.current.revenue, data.currency)} sub={<>antes {money(data.previous.revenue, data.currency)} · {change(data.current.revenue, data.previous.revenue)}</>} />
            <Stat label="Tasa de conversión" value={pct(data.current.sessions ? data.current.keyEvents / data.current.sessions : null)} />
          </div>
          <p className={cx("text-xs text-ink-500")}>{data.period.start} a {data.period.end}. {data.note}</p>
          {data.checks?.map((c) => <p key={c} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">{c}</p>)}
          <DataTable rows={data.landings} cols={cols} rowKey={(r) => r.landing} initial={{ key: "r", dir: -1 }} />
        </>
      )}
    </section>
  );
}
