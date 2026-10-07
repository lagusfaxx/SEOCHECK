"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useProject } from "@/components/Shell";
import { api, cx, Delta, Empty, fmt, Icon, Score, Stat, useApi, useLocal } from "@/components/ui";

type W = { id: string; w: 1 | 2 | 3 };
const DEFAULT: W[] = [
  { id: "kpis", w: 3 },
  { id: "gsc", w: 2 },
  { id: "health", w: 1 },
  { id: "movers", w: 1 },
  { id: "alerts", w: 1 },
  { id: "actions", w: 1 },
  { id: "content", w: 1 },
];

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
        <span className="lbl">{title}</span>
        <button onClick={onResize} className="btn-g ml-auto px-1 py-0 text-xs opacity-0 group-hover:opacity-100">{w.w}/3</button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
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
          <div key="k" className="grid grid-cols-2 gap-6 md:grid-cols-6">
            <Stat label="Keywords" value={fmt(data?.keywords)} sub={`${fmt(data?.volume)} vol.`} />
            <Stat label="Clusters" value={fmt(data?.clusters)} />
            <Stat label="Trackeadas" value={fmt(data?.tracked)} sub={`${fmt(data?.top3)} top 3 · ${fmt(data?.top10)} top 10`} />
            <Stat label="Pos. media" value={fmt(data?.avgPos, 1)} />
            <Stat label="Clicks 90d" value={fmt(sum("clicks"))} />
            <Stat label="Impr. 90d" value={fmt(sum("impressions"))} />
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
            <Empty key="g">sin datos · <button className="ml-1 text-acc" onClick={() => run("gsc/sync")}>sincronizar</button></Empty>
          ),
        ];
      case "health":
        return [
          "Salud técnica",
          data?.crawl ? (
            <Link key="h" href={`/p/${id}/audit`} className="flex items-center gap-4">
              <Score value={st.health} size={84} />
              <div className="space-y-1 text-sm">
                <div><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-rose-500" />{fmt(st.critical)}</div>
                <div><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-400" />{fmt(st.warning)}</div>
                <div><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-sky-400" />{fmt(st.info)}</div>
                <div className="text-xs text-ink-400">{fmt(st.pages)} urls</div>
              </div>
            </Link>
          ) : (
            <Empty key="h"><button className="text-acc" onClick={() => run("audit")}>crawlear</button></Empty>
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
            <Empty key="m"><Link className="text-acc" href={`/p/${id}/rank`}>trackear keywords</Link></Empty>
          ),
        ];
      case "alerts":
        return [
          "Alertas",
          data?.alerts?.length ? (
            <div key="a" className="space-y-1.5 text-sm">
              {data.alerts.slice(0, 8).map((a: any) => (
                <Link key={a.id} href={`/p/${id}/rank`} className="flex items-center gap-2 hover:text-acc">
                  <span className={cx("chip", a.type === "drop" && "!bg-rose-100 !text-rose-700", a.type === "cannibal" && "!bg-amber-100 !text-amber-700")}>{ALERT_LABEL[a.type]}</span>
                  <span className="truncate">{a.key}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty key="a">—</Empty>
          ),
        ];
      case "actions":
        return [
          "Acciones",
          <div key="ac" className="grid grid-cols-2 gap-2">
            <button className="btn justify-center" onClick={() => run("audit")}><Icon name="audit" />Crawl</button>
            <button className="btn justify-center" onClick={() => run("rank/check")}><Icon name="rank" />Rankings</button>
            <button className="btn justify-center" onClick={() => run("gsc/sync")}><Icon name="gsc" />GSC</button>
            <button className="btn justify-center" onClick={() => run("alerts")}><Icon name="bell" />Alertas</button>
          </div>,
        ];
      case "content":
        return [
          "Contenido",
          data?.content?.length ? (
            <div key="c" className="space-y-2 text-sm">
              {data.content.map((c: any) => (
                <Link key={c.id} href={`/p/${id}/content/${c.id}`} className="flex items-center gap-2 hover:text-acc">
                  <span className="truncate">{c.keyword}</span>
                  <span className="ml-auto tabular-nums font-semibold">{c.score ?? "…"}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty key="c"><Link className="text-acc" href={`/p/${id}/content`}>optimizar una URL</Link></Empty>
          ),
        ];
    }
    return ["", null];
  };

  return (
    <div className="p-4 md:p-6">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
