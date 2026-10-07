"use client";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, useEdgesState, useNodesState, type Connection, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useProject } from "../Shell";
import { api, cx, fmt, Icon, IntentChip } from "../ui";
import type { Cl, Kw, KwData } from "./types";

type ND = { label: string; vol?: number; kind: "root" | "topic" | "cluster" | "kw"; pillar?: boolean; intent?: string | null; n?: number };

function MapNode({ data, selected }: NodeProps<Node<ND>>) {
  const d = data;
  const base = "rounded-xl border px-3 py-2 shadow-sm transition";
  const style =
    d.kind === "root"
      ? "border-ink-900 bg-ink-900 text-white text-base font-semibold dark:bg-white dark:text-ink-900"
      : d.kind === "topic"
        ? "border-acc bg-acc text-white font-semibold"
        : d.kind === "cluster"
          ? cx("bg-white dark:bg-ink-900", d.pillar ? "border-acc ring-2 ring-acc/30" : "border-ink-200 dark:border-ink-700")
          : "border-transparent bg-ink-100 text-xs dark:bg-ink-800 px-2 py-1";
  return (
    <div className={cx(base, style, selected && "ring-2 ring-amber-400")} style={{ maxWidth: d.kind === "kw" ? 180 : 230 }}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-ink-300" />
      <div className="flex items-center gap-1.5">
        {d.pillar && <span className="text-acc">★</span>}
        <span className="truncate text-sm">{d.label}</span>
      </div>
      {d.kind !== "kw" && d.kind !== "root" && (
        <div className={cx("mt-0.5 flex items-center gap-1.5 text-[11px]", d.kind === "topic" ? "text-white/80" : "text-ink-400")}>
          <span className="tabular-nums">{fmt(d.vol)}</span>
          {d.n != null && <span>· {d.n}</span>}
          {d.kind === "cluster" && <IntentChip intent={d.intent} />}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-ink-300" />
    </div>
  );
}

const nodeTypes = { m: MapNode };

function layout(data: KwData, showKw: boolean, rootLabel: string) {
  const nodes: Node<ND>[] = [];
  const edges: Edge[] = [];
  const kwBy = new Map<string, Kw[]>();
  for (const k of data.keywords) if (k.clusterId && !k.excluded) kwBy.set(k.clusterId, [...(kwBy.get(k.clusterId) ?? []), k]);
  const topics = data.topics
    .map((t) => ({ t, cs: data.clusters.filter((c) => c.topicId === t.id).sort((a, b) => Number(b.isPillar) - Number(a.isPillar) || b.volume - a.volume) }))
    .filter((x) => x.cs.length)
    .sort((a, b) => b.cs.reduce((s, c) => s + c.volume, 0) - a.cs.reduce((s, c) => s + c.volume, 0));
  const orphan = data.clusters.filter((c) => !c.topicId);
  nodes.push({ id: "root", type: "m", position: { x: 0, y: 0 }, data: { label: rootLabel, kind: "root" }, draggable: true });
  const T = topics.length + (orphan.length ? 1 : 0);
  const R1 = Math.max(420, T * 90);
  const placeTopic = (tid: string, name: string, cs: Cl[], i: number, saved: { x: number; y: number } | null) => {
    const ang = (i / Math.max(1, T)) * Math.PI * 2 - Math.PI / 2;
    const tp = saved ?? { x: Math.cos(ang) * R1, y: Math.sin(ang) * R1 };
    nodes.push({ id: `t:${tid}`, type: "m", position: tp, data: { label: name, kind: "topic", vol: cs.reduce((s, c) => s + c.volume, 0), n: cs.length } });
    edges.push({ id: `e:root:${tid}`, source: "root", target: `t:${tid}`, type: "simplebezier", style: { stroke: "#5b5bf6", strokeWidth: 2 } });
    const pillar = cs.find((c) => c.isPillar);
    cs.forEach((c, j) => {
      const spread = Math.min(Math.PI * 1.1, 0.3 * cs.length);
      const a2 = ang + (cs.length > 1 ? -spread / 2 + (spread * j) / (cs.length - 1) : 0);
      const R2 = 240 + cs.length * 14 + (j % 2) * 70;
      const cp = c.pos ?? { x: tp.x + Math.cos(a2) * R2, y: tp.y + Math.sin(a2) * R2 };
      nodes.push({ id: `c:${c.id}`, type: "m", position: cp, data: { label: c.name, kind: "cluster", vol: c.volume, pillar: c.isPillar, intent: c.intent, n: kwBy.get(c.id)?.length ?? 0 } });
      const src = c.isPillar || !pillar ? `t:${tid}` : `c:${pillar.id}`;
      edges.push({ id: `e:${src}:${c.id}`, source: src, target: `c:${c.id}`, type: "simplebezier", style: { stroke: c.isPillar ? "#5b5bf6" : "#b5b5c3", strokeDasharray: c.isPillar ? undefined : "4 3" } });
      if (showKw) {
        (kwBy.get(c.id) ?? []).filter((k) => k.term !== c.primary).slice(0, 12).forEach((k, m) => {
          nodes.push({ id: `k:${k.id}`, type: "m", position: { x: cp.x + 260, y: cp.y + (m - 3) * 32 }, data: { label: k.term, kind: "kw" } });
          edges.push({ id: `e:${c.id}:${k.id}`, source: `c:${c.id}`, target: `k:${k.id}`, type: "simplebezier", style: { stroke: "#d9d9e0" } });
        });
      }
    });
  };
  topics.forEach(({ t, cs }, i) => placeTopic(t.id, t.name, cs, i, t.pos));
  if (orphan.length) placeTopic("none", "sin topic", orphan, topics.length, null);
  return { nodes, edges };
}

export default function MindMap({ data, reload }: { data: KwData; reload: () => void }) {
  const { id, project } = useProject();
  const [showKw, setShowKw] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const initial = useMemo(() => layout(data, showKw, data.runs.find((r) => r.id === data.runId)?.seeds.join(" · ") || project?.domain || ""), [data, showKw, project?.domain]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
  }, [initial, setNodes, setEdges]);

  const onDragStop = useCallback(
    (_: unknown, _n: Node, moved: Node[]) => {
      const list = moved
        .filter((n) => (n.id.startsWith("t:") && n.id !== "t:none") || n.id.startsWith("c:"))
        .map((n) => ({ kind: n.id.startsWith("t:") ? "topic" : "cluster", id: n.id.slice(2), pos: n.position }));
      if (list.length) api(`/api/p/${id}/keywords`, "PATCH", { action: "positions", nodes: list });
    },
    [id]
  );

  // Conectar topic → cluster mueve el cluster a ese topic
  const onConnect = useCallback(
    async (c: Connection) => {
      const [s, t] = [c.source ?? "", c.target ?? ""];
      const topic = s.startsWith("t:") ? s : t.startsWith("t:") ? t : null;
      const cluster = s.startsWith("c:") ? s : t.startsWith("c:") ? t : null;
      if (!topic || !cluster) return;
      await api(`/api/p/${id}/keywords`, "PATCH", { action: "clusterTopic", clusterId: cluster.slice(2), topicId: topic === "t:none" ? null : topic.slice(2) });
      reload();
    },
    [id, reload]
  );

  const selCluster = sel?.startsWith("c:") ? data.clusters.find((c) => c.id === sel.slice(2)) : null;
  const selKws = selCluster ? data.keywords.filter((k) => k.clusterId === selCluster.id).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)) : [];

  return (
    <div className="card relative h-[calc(100vh-200px)] overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onDragStop}
        onConnect={onConnect}
        onNodeClick={(_, n) => setSel(n.id)}
        onPaneClick={() => setSel(null)}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(n) => ((n.data as ND).kind === "topic" ? "#5b5bf6" : (n.data as ND).pillar ? "#8b8bf9" : "#d9d9e0")} />
      </ReactFlow>
      <div className="absolute left-3 top-3 flex gap-2">
        <button className={cx("btn", showKw && "!border-acc !text-acc")} onClick={() => setShowKw(!showKw)}><Icon name="key" />keywords</button>
        <button className="btn" onClick={async () => {
          const reset = [...data.topics.map((t) => ({ kind: "topic", id: t.id, pos: null })), ...data.clusters.map((c) => ({ kind: "cluster", id: c.id, pos: null }))];
          await api(`/api/p/${id}/keywords`, "PATCH", { action: "positions", nodes: reset });
          reload();
        }}><Icon name="refresh" />auto</button>
      </div>
      {selCluster && (
        <div className="absolute right-3 top-3 max-h-[80%] w-72 overflow-y-auto rounded-xl border border-ink-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-ink-700 dark:bg-ink-900/95">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{selCluster.name}</span>
            <IntentChip intent={selCluster.intent} />
          </div>
          <div className="mt-1 text-xs text-ink-500">{fmt(selCluster.volume)} vol · score {fmt(selCluster.score)}</div>
          <div className="mt-3 space-y-1">
            {selKws.map((k) => (
              <div key={k.id} className="flex justify-between gap-2 text-sm">
                <span className="truncate">{k.term}</span>
                <span className="tabular-nums text-ink-400">{fmt(k.volume)}</span>
              </div>
            ))}
          </div>
          {selCluster.urls.length > 0 && (
            <div className="mt-3 border-t border-ink-100 pt-2 dark:border-ink-800">
              <div className="lbl mb-1">Top 10</div>
              {selCluster.urls.map((u, i) => (
                <a key={u} href={u} target="_blank" className="block truncate text-xs text-ink-500 hover:text-acc" rel="noreferrer">{i + 1}. {u.replace(/^https?:\/\/(www\.)?/, "")}</a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
