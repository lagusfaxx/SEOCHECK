"use client";
import { ProjectProgress } from "@/components/ProjectProgress";
import { NextActions } from "@/components/NextActions";
import Link from "next/link";
import type { ReactNode } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useProject } from "@/components/Shell";
import { api, cx, Delta, Empty, fmt, Icon, IconBadge, Score, Stat, useApi, useLocal, Spinner } from "@/components/ui";
import { Coverage } from "@/components/Coverage";

type W = { id: string; w: 1 | 2 | 3 };
const DEFAULT: W[] = [
  { id: "kpis", w: 3 },
  { id: "gsc", w: 2 },
  { id: "health", w: 1 },
  { id: "movers", w: 1 },
  { id: "alerts", w: 1 },
  { id: "actions", w: 1 },
  { id: "content", w: 1 },
  { id: "spend", w: 1 },
];

const PROV: Record<string, string> = { serpent: "Serpent", dataforseo: "DataForSEO", apify: "Apify", llm: "LLM" };

function Spend() {
  const { data } = useApi<any>("/api/usage", { refreshInterval: 30000 });
  if (!data) return null;
  return (
    <div className="space-y-2.5 text-sm">
      {data.providers.map((p: any) => {
        const pct = p.limitUsd > 0 ? (p.spentUsd / p.limitUsd) * 100 : p.limitUsd === 0 ? 100 : 0;
        const state = data.states.find((s: any) => s.provider === p.provider);
        return (
          <div key={p.provider}>
            <div className="flex items-baseline gap-2">
              <span>{PROV[p.provider] ?? p.provider}</span>
              {state && <span className="chip !bg-amber-100 !text-amber-800">{state.status === "no_balance" ? "sin saldo" : "credenciales"}</span>}
              <span className="ml-auto tabular-nums">
                ${p.spentUsd.toFixed(p.spentUsd < 1 ? 3 : 2)}
                <span className="text-ink-400"> / {p.limitUsd < 0 ? "∞" : p.limitUsd === 0 ? "bloqueado" : `$${p.limitUsd.toFixed(2)}`}</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
              <div className={cx("h-full rounded-full", pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-400" : "bg-acc")} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <div className="mt-0.5 text-[11px] text-ink-400">
              {fmt(p.calls)} llamadas{p.provider === "llm" && p.inputTokens ? ` · ${fmt(p.inputTokens)} in / ${fmt(p.outputTokens)} out tokens` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Block({ w, onResize, children, title }: { w: W; onResize: () => void; children: ReactNode; title: string }) {
  const s = useSortable({ id: w.id });
  return (
    <div
      ref={s.setNodeRef}
      style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
      className={cx("card group flex min-h-[180px] flex-col p-4", w.w === 3 ? "md:col-span-3" : w.w === 2 ? "md:col-span-2" : "", s.isDragging && "z-20 opacity-80 shadow-2xl")}
    >
      <div className="mb-3 flex items-center gap-2">
        <button {...s.attributes} {...s.listeners} className="cursor-grab text-ink-300 hover:text-ink-600 active:cursor-grabbing">
          <Icon name="grip" />
        </button>
        {WIDGET_ICON[w.id] && <IconBadge name={WIDGET_ICON[w.id].icon} tone={WIDGET_ICON[w.id].tone} size="sm" />}
        <span className="lbl">{title}</span>
        <button onClick={onResize} className="btn-g ml-auto px-1 py-0 text-xs opacity-0 group-hover:opacity-100">{w.w}/3</button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

const WIDGET_ICON: Record<string, { icon: string; tone: "acc" | "good" | "bad" | "warn" | "info" | "mute" }> = {
  kpis: { icon: "chart", tone: "acc" }, gsc: { icon: "gsc", tone: "info" }, health: { icon: "audit", tone: "good" }, movers: { icon: "trend", tone: "acc" },
  alerts: { icon: "bell", tone: "warn" }, actions: { icon: "bolt", tone: "acc" }, spend: { icon: "coin", tone: "mute" }, content: { icon: "content", tone: "info" },
};

/** Mientras falten pasos del wizard: recordatorio con el avance. */
function SetupBanner({ id }: { id: string }) {
  const { data } = useApi<{ status: Record<string, string>; finished: boolean; dismissed: boolean }>(`/api/p/${id}/onboarding`);
  if (!data || data.finished) return null;
  const done = Object.values(data.status).filter((s) => s === "done" || s === "skipped").length;
  const total = Object.keys(data.status).length;
  return (
    <Link href={`/p/${id}/start`} className="anim-in group flex items-center gap-4 rounded-xl border border-acc/30 bg-gradient-to-r from-acc-soft to-white p-4 transition hover:shadow-md dark:from-acc/20 dark:to-ink-900">
      <span className="ic-float"><IconBadge name="rocket" pulse /></span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Termina de configurar tu proyecto</div>
        <div className="text-sm text-ink-500">Llevas {done} de {total} pasos. Con todo listo, SEOCHECK prioriza con datos reales de Google.</div>
        <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/70 dark:bg-ink-800"><div className="h-full rounded-full bg-acc" style={{ width: `${(done / total) * 100}%` }} /></div>
      </div>
      <span className="btn-p hov-nudge shrink-0">Continuar<Icon name="chevr" /></span>
    </Link>
  );
}

const ALERT_LABEL: Record<string, string> = { drop: "Caída", cannibal: "Canibalización", lowctr: "CTR bajo" };

export default function Overview() {
  const { id, refreshJobs } = useProject();
  const { data } = useApi<any>(`/api/p/${id}/overview`);
  const [layout, setLayout] = useLocal<W[]>(`dash:${id}`, DEFAULT);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const items = [...layout, ...DEFAULT.filter((d) => !layout.some((l) => l.id === d.id))];

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const a = items.findIndex((x) => x.id === e.active.id), b = items.findIndex((x) => x.id === e.over!.id);
    setLayout(arrayMove(items, a, b));
  };
  const resize = (wid: string) => setLayout(items.map((x) => (x.id === wid ? { ...x, w: ((x.w % 3) + 1) as W["w"] } : x)));
  const run = async (path: string, body: object = {}) => {
    await api(`/api/p/${id}/${path}`, "POST", body);
    refreshJobs();
  };

  const st = data?.crawl?.stats ?? {};
  const gsc = (data?.gsc ?? []).map((r: any) => ({ d: String(r.d).slice(5, 10), clicks: r.clicks, impressions: r.impressions }));
  const sum = (k: string) => gsc.reduce((s: number, r: any) => s + r[k], 0);

  const render = (wid: string): [string, ReactNode] => {
    switch (wid) {
      case "kpis":
        return [
          "Estado",
          <div key="k" className="space-y-4">
          <Coverage projectId={id} />
          <div className="stagger grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-6">
            <Stat icon="key" label="Keywords" value={fmt(data?.keywords)} sub={`${fmt(data?.volume)} vol.`} hint="Keywords del último research y la suma de su volumen mensual de búsquedas." />
            <Stat icon="layers" label="Clusters" value={fmt(data?.clusters)} hint="Grupos de keywords que se atacan con una misma página." />
            <Stat icon="target" label="Trackeadas" value={fmt(data?.tracked)} sub={`${fmt(data?.top3)} top 3 · ${fmt(data?.top10)} top 10`} hint="Keywords a las que se les sigue la posición en Google, y cuántas están en el top 3 y top 10." />
            <Stat icon="rank" label="Pos. media" value={fmt(data?.avgPos, 1)} hint="Posición promedio de las keywords trackeadas que aparecen en el top 100. Más bajo es mejor." />
            <Stat icon="trend" label="Clicks 90d" value={fmt(sum("clicks"))} hint="Clics desde Google en los últimos 90 días (Search Console)." />
            <Stat icon="eye" label="Impr. 90d" value={fmt(sum("impressions"))} hint="Veces que tu sitio apareció en resultados de Google en 90 días (Search Console)." />
          </div>
          </div>,
        ];
      case "gsc":
        return [
          "Search Console",
          gsc.length ? (
            <ResponsiveContainer key="g" width="100%" height={200}>
              <AreaChart data={gsc} margin={{ left: -20, right: 0, top: 5 }}>
                <defs>
                  <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5b5bf6" stopOpacity={0.3} /><stop offset="100%" stopColor="#5b5bf6" stopOpacity={0} /></linearGradient>
                </defs>
                <XAxis dataKey="d" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={30} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Area type="monotone" dataKey="clicks" stroke="#5b5bf6" fill="url(#gc)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty key="g" compact icon="gsc" tone="info" title="Sin datos de Search Console"><button className="btn-p hov-spin mt-1" onClick={() => run("gsc/sync")}><Icon name="refresh" />Sincronizar</button></Empty>
          ),
        ];
      case "health":
        return [
          "Salud técnica",
          data?.crawl ? (
            <Link key="h" href={`/p/${id}/audit`} className="flex items-center gap-4">
              <div className="flex flex-col items-center gap-1">
                <Score value={st.health} size={84} />
                <span className="text-[11px] text-ink-400">{st.health == null ? "sin puntaje" : "de 100"}</span>
              </div>
              {data.crawl.status === "partial" && <span className="chip !bg-amber-100 !text-amber-800" title={data.crawl.reason ?? ""}>parcial</span>}
              <div className="space-y-1 text-sm">
                <div><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-rose-500" />{fmt(st.critical)}</div>
                <div><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-400" />{fmt(st.warning)}</div>
                <div><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-sky-400" />{fmt(st.info)}</div>
                <div className="text-xs text-ink-400">{fmt(st.pages)} urls</div>
              </div>
            </Link>
          ) : (
            <Empty key="h" compact icon="audit" tone="good" title="Aún no auditas el sitio"><button className="btn-p hov-nudge mt-1" onClick={() => run("audit")}><Icon name="play" />Crawlear</button></Empty>
          ),
        ];
      case "movers":
        return [
          "Movimientos",
          data?.movers?.length ? (
            <div key="m" className="space-y-1.5 text-sm">
              {data.movers.map((m: any) => (
                <div key={m.keyword} className="flex items-center gap-2">
                  <span className="truncate">{m.keyword}</span>
                  <span className="ml-auto tabular-nums">{m.pos ?? "–"}</span>
                  <span className="w-10 text-right"><Delta from={m.prev} to={m.pos} lowerIsBetter /></span>
                </div>
              ))}
            </div>
          ) : (
            <Empty key="m" compact icon="trend" title="Sin movimientos todavía"><Link className="btn mt-1" href={`/p/${id}/rank`}><Icon name="target" />Trackear keywords</Link></Empty>
          ),
        ];
      case "alerts":
        return [
          "Alertas",
          data?.alerts?.length ? (
            <div key="a" className="space-y-1.5 text-sm">
              {data.alerts.slice(0, 8).map((a: any) => (
                <Link key={a.id} href={`/p/${id}/rank`} className="flex items-center gap-2 hover:text-acc">
                  <span className={cx("chip", a.type === "drop" && "!bg-rose-100 !text-rose-700", a.type === "cannibal" && "!bg-amber-100 !text-amber-700")}>{a.type === "drop" && <Icon name="trend" className="h-3 w-3 -scale-y-100" />}{a.type === "cannibal" && <Icon name="alert" className="h-3 w-3" />}{ALERT_LABEL[a.type]}</span>
                  <span className="truncate">{a.key}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty key="a" compact icon="check" tone="good" title="Todo tranquilo">Sin alertas nuevas</Empty>
          ),
        ];
      case "actions":
        return [
          "Acciones",
          <div key="ac" className="grid grid-cols-2 gap-2">
            <button className="btn justify-center py-2.5" onClick={() => run("audit")}><Icon name="audit" />Crawl</button>
            <button className="btn justify-center py-2.5" onClick={() => run("rank/check")}><Icon name="rank" />Rankings</button>
            <button className="btn hov-spin justify-center py-2.5" onClick={() => run("gsc/sync")}><Icon name="gsc" />GSC</button>
            <button className="btn justify-center py-2.5" onClick={() => run("alerts")}><Icon name="bell" />Alertas</button>
          </div>,
        ];
      case "spend":
        return ["Gasto del mes", <Spend key="sp" />];
      case "content":
        return [
          "Contenido",
          data?.content?.length ? (
            <div key="c" className="space-y-2 text-sm">
              {data.content.map((c: any) => (
                <Link key={c.id} href={`/p/${id}/content/${c.id}`} className="flex items-center gap-2 hover:text-acc">
                  <span className="truncate">{c.keyword}</span>
                  <span className="ml-auto tabular-nums font-semibold">{c.score ?? <Spinner className="h-3.5 w-3.5 text-acc" />}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty key="c" compact icon="wand" tone="info" title="Sin análisis de contenido"><Link className="btn mt-1" href={`/p/${id}/content`}><Icon name="sparkle" />Optimizar una URL</Link></Empty>
          ),
        ];
    }
    return ["", null];
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <SetupBanner id={id} />
      <ProjectProgress />
      <NextActions />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div className="stagger-fade grid grid-cols-1 gap-4 md:grid-cols-3">
            {items.map((w) => {
              const [title, body] = render(w.id);
              return (
                <Block key={w.id} w={w} title={title} onResize={() => resize(w.id)}>
                  {body}
                </Block>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
