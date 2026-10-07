"use client";
import { useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useProject } from "../Shell";
import { api, cx, fmt, Icon, IntentChip } from "../ui";
import type { Cl, Kw, KwData, Tp } from "./types";

function Lock({ on, onUnlock, title }: { on: boolean; onUnlock: () => void; title: string }) {
  if (!on) return null;
  return (
    <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onUnlock(); }} title={`${title} · clic para desbloquear`} className="text-amber-600 hover:text-ink-400">
      <Icon name="lock" className="h-3 w-3" />
    </button>
  );
}

function KwChip({ k, onUnlock }: { k: Kw; onUnlock: () => void }) {
  const d = useDraggable({ id: `k:${k.id}` });
  return (
    <span ref={d.setNodeRef} {...d.listeners} {...d.attributes} className={cx("chip cursor-grab select-none", k.locked && "ring-1 ring-amber-300", d.isDragging && "opacity-30")} title={`${fmt(k.volume)} · score ${fmt(k.score)}`}>
      <Lock on={k.locked} onUnlock={onUnlock} title="asignación fijada" />
      {k.term}
      {k.volume != null && <span className="text-ink-400">{fmt(k.volume)}</span>}
    </span>
  );
}

function ClusterCard({ c, kws, open, onToggle, onPillar, onRename, onUnlock }: { c: Cl; kws: Kw[]; open: boolean; onToggle: () => void; onPillar: () => void; onRename: (n: string) => void; onUnlock: (target: { keywordId?: string; clusterId?: string }) => void }) {
  const drag = useDraggable({ id: `c:${c.id}` });
  const drop = useDroppable({ id: `cl:${c.id}` });
  return (
    <div ref={drop.setNodeRef} className={cx("rounded-lg border bg-white p-2.5 transition dark:bg-ink-900", c.isPillar ? "border-acc/60 ring-1 ring-acc/30" : "border-ink-200 dark:border-ink-800", drop.isOver && "ring-2 ring-acc", drag.isDragging && "opacity-30")}>
      <div className="flex items-center gap-1.5">
        <span ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} className="cursor-grab text-ink-300 hover:text-ink-600"><Icon name="grip" className="h-3.5 w-3.5" /></span>
        <button onClick={onPillar} title="pillar" className={cx("text-sm", c.isPillar ? "text-acc" : "text-ink-300 hover:text-ink-500")}>★</button>
        <input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && onRename(e.target.value)} className="min-w-0 flex-1 truncate bg-transparent text-sm font-medium outline-none focus:underline" />
        <Lock on={c.topicLocked || c.nameLocked || c.pillarLocked} onUnlock={() => onUnlock({ clusterId: c.id })} title={[c.topicLocked && "topic", c.nameLocked && "nombre", c.pillarLocked && "pillar"].filter(Boolean).join(", ") + " fijado"} />
        <IntentChip intent={c.intent} />
      </div>
      <button onClick={onToggle} className="mt-1 flex w-full items-center gap-2 text-xs text-ink-500">
        <span className="tabular-nums">{fmt(c.volume)} vol</span>
        <span>·</span>
        <span>{kws.length} kw</span>
        <Icon name={open ? "up" : "down"} className="ml-auto h-3 w-3" />
      </button>
      {open && <div className="mt-2 flex flex-wrap gap-1">{kws.map((k) => <KwChip key={k.id} k={k} onUnlock={() => onUnlock({ keywordId: k.id })} />)}</div>}
    </div>
  );
}

function TopicCol({ t, clusters, children, onRename, onDelete, onUnlock }: { t: Tp | null; clusters: Cl[]; children: React.ReactNode; onRename?: (n: string) => void; onDelete?: () => void; onUnlock?: () => void }) {
  const drop = useDroppable({ id: `t:${t?.id ?? "none"}` });
  const vol = clusters.reduce((s, c) => s + c.volume, 0);
  return (
    <div ref={drop.setNodeRef} className={cx("flex w-72 shrink-0 flex-col rounded-xl bg-ink-100/70 p-2 dark:bg-ink-900/60", t?.forcedSplit && "border border-dashed border-amber-400/70 bg-amber-50/40 dark:bg-amber-950/10", drop.isOver && "ring-2 ring-acc")}>
      <div className="flex items-center gap-1 px-1 pb-2">
        {t ? (
          <input defaultValue={t.name} onBlur={(e) => e.target.value !== t.name && onRename?.(e.target.value)} className="min-w-0 flex-1 truncate bg-transparent text-sm font-semibold outline-none focus:underline" />
        ) : (
          <span className="flex-1 text-sm font-semibold text-ink-400">sin topic</span>
        )}
        {t && <Lock on={t.nameLocked} onUnlock={() => onUnlock?.()} title="nombre fijado" />}
        {t?.forcedSplit && <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" title="split forzado: HDBSCAN no separó, agrupado por average linkage">forzado</span>}
        <span className="text-xs tabular-nums text-ink-400">{fmt(vol)}</span>
        {onDelete && <button className="btn-g p-0.5" onClick={onDelete}><Icon name="x" className="h-3 w-3" /></button>}
      </div>
      <div className="flex min-h-[60px] flex-col gap-2 overflow-y-auto">{children}</div>
    </div>
  );
}

export default function Board({ data, reload, setData }: { data: KwData; reload: () => void; setData: (d: KwData) => void }) {
  const { id } = useProject();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const kwBy = useMemo(() => {
    const m = new Map<string, Kw[]>();
    for (const k of data.keywords) if (k.clusterId && !k.excluded) m.set(k.clusterId, [...(m.get(k.clusterId) ?? []), k]);
    return m;
  }, [data.keywords]);
  const byTopic = (tid: string | null) => data.clusters.filter((c) => c.topicId === tid).sort((a, b) => Number(b.isPillar) - Number(a.isPillar) || b.volume - a.volume);
  const patch = (body: object) => api(`/api/p/${id}/keywords`, "PATCH", body);

  const onEnd = async (e: DragEndEvent) => {
    setDrag(null);
    const a = String(e.active.id), o = e.over ? String(e.over.id) : null;
    if (!o) return;
    if (a.startsWith("k:")) {
      const kid = a.slice(2);
      const cid = o.startsWith("cl:") ? o.slice(3) : null;
      if (!cid) return;
      setData({ ...data, keywords: data.keywords.map((k) => (k.id === kid ? { ...k, clusterId: cid, locked: true } : k)) });
      await patch({ action: "move", keywordId: kid, clusterId: cid });
      reload();
    } else if (a.startsWith("c:")) {
      const cid = a.slice(2);
      let tid: string | null | undefined;
      if (o.startsWith("t:")) tid = o.slice(2) === "none" ? null : o.slice(2);
      else if (o.startsWith("cl:")) tid = data.clusters.find((c) => c.id === o.slice(3))?.topicId ?? null;
      if (tid === undefined) return;
      setData({ ...data, clusters: data.clusters.map((c) => (c.id === cid ? { ...c, topicId: tid!, topicLocked: true, isPillar: c.topicId === tid ? c.isPillar : false } : c)) });
      await patch({ action: "clusterTopic", clusterId: cid, topicId: tid });
      reload();
    }
  };

  const activeKw = drag?.startsWith("k:") ? data.keywords.find((k) => k.id === drag.slice(2)) : null;
  const activeCl = drag?.startsWith("c:") ? data.clusters.find((c) => c.id === drag.slice(2)) : null;
  const card = (c: Cl) => (
    <ClusterCard
      key={c.id}
      c={c}
      kws={kwBy.get(c.id) ?? []}
      open={open.has(c.id)}
      onToggle={() => setOpen((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
      onPillar={async () => { await patch({ action: "pillar", clusterId: c.id }); reload(); }}
      onRename={async (name) => { await patch({ action: "renameCluster", clusterId: c.id, name }); reload(); }}
      onUnlock={async (target) => { await patch({ action: "unlock", ...target }); reload(); }}
    />
  );
  const unassigned = byTopic(null);

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={(e: DragStartEvent) => setDrag(String(e.active.id))} onDragEnd={onEnd} onDragCancel={() => setDrag(null)}>
      <div className="flex items-center gap-2 pb-3">
        <button className="btn" onClick={() => setOpen(open.size ? new Set() : new Set(data.clusters.map((c) => c.id)))}>{open.size ? "Contraer" : "Expandir"}</button>
        <button className="btn" onClick={async () => { await api(`/api/p/${id}/keywords/topic`, "POST", { runId: data.runId, name: "nuevo topic" }); reload(); }}><Icon name="plus" />Topic</button>
        <span className="text-xs text-ink-400">{data.topics.length} topics · {data.clusters.length} clusters</span>
      </div>
      <div className="flex h-[calc(100vh-240px)] gap-3 overflow-x-auto pb-4">
        {data.topics
          .map((t) => ({ t, cs: byTopic(t.id) }))
          .sort((a, b) => b.cs.reduce((s, c) => s + c.volume, 0) - a.cs.reduce((s, c) => s + c.volume, 0))
          .map(({ t, cs }) => (
            <TopicCol
              key={t.id}
              t={t}
              clusters={cs}
              onRename={async (name) => { await patch({ action: "renameTopic", topicId: t.id, name }); reload(); }}
              onDelete={async () => { await api(`/api/p/${id}/keywords/topic`, "DELETE", { topicId: t.id }); reload(); }}
              onUnlock={async () => { await patch({ action: "unlock", topicId: t.id }); reload(); }}
            >
              {cs.map(card)}
            </TopicCol>
          ))}
        {(unassigned.length > 0 || drag?.startsWith("c:")) && <TopicCol t={null} clusters={unassigned}>{unassigned.map(card)}</TopicCol>}
      </div>
      <DragOverlay>
        {activeKw && <span className="chip shadow-lg ring-1 ring-acc">{activeKw.term}</span>}
        {activeCl && <div className="w-64 rounded-lg border border-acc bg-white p-2 text-sm font-medium shadow-xl dark:bg-ink-900">{activeCl.name}</div>}
      </DragOverlay>
    </DndContext>
  );
}
