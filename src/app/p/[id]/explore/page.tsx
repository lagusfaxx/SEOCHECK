"use client";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useProject } from "@/components/Shell";
import { api, cx, Icon, useLocal, useApi } from "@/components/ui";
import { TRANSFORMS, TYPE_LABEL, type GNode, type GResult, type GType } from "@/lib/graph-types";

type ND = GNode & { busy?: boolean; done?: string[] };
type GN = Node<ND>;

const STYLE: Record<GType, { cls: string; dot: string; icon: string }> = {
  site: { cls: "bg-ink-900 text-white border-ink-900 dark:bg-white dark:text-ink-900", dot: "bg-ink-900 dark:bg-white", icon: "home" },
  topic: { cls: "bg-acc text-white border-acc", dot: "bg-acc", icon: "map" },
  cluster: { cls: "bg-violet-50 text-violet-900 border-violet-300 dark:bg-violet-900/30 dark:text-violet-100 dark:border-violet-700", dot: "bg-violet-400", icon: "board" },
  keyword: { cls: "bg-sky-50 text-sky-900 border-sky-300 dark:bg-sky-900/30 dark:text-sky-100 dark:border-sky-700", dot: "bg-sky-400", icon: "key" },
  page: { cls: "bg-white text-ink-800 border-ink-200 dark:bg-ink-900 dark:text-ink-100 dark:border-ink-700", dot: "bg-ink-300", icon: "content" },
  domain: { cls: "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-700", dot: "bg-amber-400", icon: "ext" },
  issue: { cls: "bg-rose-50 text-rose-900 border-rose-300 dark:bg-rose-900/30 dark:text-rose-100 dark:border-rose-700", dot: "bg-rose-400", icon: "audit" },
  question: { cls: "bg-teal-50 text-teal-900 border-teal-300 dark:bg-teal-900/30 dark:text-teal-100 dark:border-teal-700", dot: "bg-teal-400", icon: "search" },
};
const OWN_PAGE = "bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-100 dark:border-emerald-700";

function GraphNode({ data, selected }: NodeProps<GN>) {
  const st = STYLE[data.type];
  const hidden = "!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent !left-1/2 !top-1/2";
  return (
    <div
      className={cx(
        "max-w-[220px] rounded-xl border px-3 py-1.5 shadow-sm transition",
        data.type === "page" && data.own ? OWN_PAGE : st.cls,
        selected && "ring-2 ring-amber-400 ring-offset-1 dark:ring-offset-ink-950",
        data.busy && "animate-pulse"
      )}
    >
      <Handle type="target" position={Position.Top} className={hidden} />
      <div className="flex items-center gap-1.5">
        <Icon name={st.icon} className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className={cx("truncate", data.type === "site" ? "text-sm font-semibold" : "text-xs font-medium")}>{data.label}</span>
      </div>
      {data.sub && <div className="mt-0.5 truncate text-[10px] opacity-70">{data.sub}</div>}
      <Handle type="source" position={Position.Bottom} className={hidden} />
    </div>
  );
}
const nodeTypes = { g: GraphNode };

function toNode(n: GNode, x: number, y: number): GN {
  return { id: n.id, type: "g", position: { x, y }, data: n };
}
const edgeOf = (source: string, target: string, label?: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  type: "straight",
  label,
  labelStyle: { fontSize: 10, fill: "#8b8ba1" },
  labelBgStyle: { fillOpacity: 0.8 },
  style: { stroke: "#b5b5c3", strokeWidth: 1 },
});

/** Layout de fuerzas simple: repulsión entre nodos + resortes en las aristas. */
function forceLayout(nodes: GN[], edges: Edge[], iterations = 300): GN[] {
  const pos = new Map(nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y, vx: 0, vy: 0 }]));
  const ids = [...pos.keys()];
  // con muchos nodos: más repulsión y aristas más largas para que no se amontonen
  const scale = Math.max(1, ids.length / 40);
  const rep = 60000 * scale;
  const len = 200 * Math.sqrt(scale);
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    for (let i = 0; i < ids.length; i++) {
      const a = pos.get(ids[i])!;
      for (let j = i + 1; j < ids.length; j++) {
        const b = pos.get(ids[j])!;
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random(); dy = Math.random(); d2 = 1; }
        const f = rep / d2;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const a = pos.get(e.source), b = pos.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = (d - len) * 0.05;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const p of pos.values()) {
      p.vx -= (p.x * 0.002) / scale; p.vy -= (p.y * 0.002) / scale;
      const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const max = 40 * Math.sqrt(scale) * cool + 1;
      if (v > max) { p.vx = (p.vx / v) * max; p.vy = (p.vy / v) * max; }
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.5; p.vy *= 0.5;
    }
  }
  return nodes.map((n) => ({ ...n, position: { x: pos.get(n.id)!.x, y: pos.get(n.id)!.y } }));
}

function Explorer() {
  const { id, project, refreshJobs } = useProject();
  const key = `graph:${id}`;
  const [nodes, setNodes, onNodesChange] = useNodesState<GN>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [q, setQ] = useState("");
  const [graphName,setGraphName] = useState("");
  const [activeExploration,setActiveExploration] = useState("");
  const [filterText,setFilterText] = useState("");
  const [ownership,setOwnership] = useState("all");
  const [comparison,setComparison] = useState<any>(null);
  const {data:savedGraphs,mutate:reloadSaved} = useApi<any[]>(`/api/p/${id}/explorations`);
  const nodeAction = async (fn:()=>Promise<void>) => { try { await fn(); setNote(""); } catch(e) { setNote((e as Error).message); } };
  const [results, setResults] = useState<GNode[]>([]);
  const loaded = useRef(false);
  const rf = useReactFlow();

  const reset = useCallback(async () => {
    const root = await api<GNode>(`/api/p/${id}/graph/root`);
    setNodes([toNode(root, 0, 0)]);
    setEdges([]);
    setSel(root.id);
    setTimeout(() => rf.fitView({ maxZoom: 1.2, duration: 300 }), 50);
  }, [id, rf, setNodes, setEdges]);

  // cargar el grafo guardado (o empezar desde el sitio)
  useEffect(() => {
    loaded.current = false;
    let saved: { nodes: GN[]; edges: Edge[] } | null = null;
    try {
      const s = localStorage.getItem(key);
      saved = s ? JSON.parse(s) : null;
    } catch {}
    if (saved?.nodes?.length) {
      setNodes(saved.nodes.map((n) => ({ ...n, data: { ...n.data, busy: false } })));
      setEdges(saved.edges);
      setTimeout(() => rf.fitView({ maxZoom: 1.2 }), 50);
    } else reset();
    loaded.current = true;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(key, JSON.stringify({ nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })), edges }));
    } catch {}
  }, [nodes, edges, key]);

  // buscador
  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const t = setTimeout(() => api<GNode[]>(`/api/p/${id}/graph/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q, id]);

  const selNode = nodes.find((n) => n.id === sel);
  // estado más reciente para las expansiones en lote (entre awaits el closure queda viejo)
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [bulk, setBulk] = useState<string>("");

  const run = useCallback(
    async (nodeIdToExpand: string, t: string, fit = true) => {
      const parent = nodesRef.current.find((n) => n.id === nodeIdToExpand);
      if (!parent) return;
      setNote("");
      setNodes((ns) => ns.map((n) => (n.id === parent.id ? { ...n, data: { ...n.data, busy: true } } : n)));
      try {
        const r = await api<GResult>(`/api/p/${id}/graph/expand?type=${parent.data.type}&key=${encodeURIComponent(parent.data.key)}&t=${t}`);
        if (r.note) setNote(r.note);
        setNodes((ns) => {
          const have = new Set(ns.map((n) => n.id));
          const fresh = r.nodes.filter((n) => !have.has(n.id));
          // abrir en abanico hacia afuera del centro del grafo
          const cx0 = ns.reduce((s, n) => s + n.position.x, 0) / ns.length;
          const cy0 = ns.reduce((s, n) => s + n.position.y, 0) / ns.length;
          const px = parent.position.x, py = parent.position.y;
          const base = ns.length > 1 && (px !== cx0 || py !== cy0) ? Math.atan2(py - cy0, px - cx0) : -Math.PI / 2;
          const spread = Math.min(Math.PI * 2, Math.max(0.6, fresh.length * 0.32));
          const radius = 220 + fresh.length * 8;
          const added = fresh.map((n, i) => {
            const a = fresh.length === 1 ? base : base - spread / 2 + (spread * i) / Math.max(1, fresh.length - (spread >= Math.PI * 2 ? 0 : 1));
            return toNode(n, px + Math.cos(a) * radius, py + Math.sin(a) * radius);
          });
          return [...ns.map((n) => (n.id === parent.id ? { ...n, data: { ...n.data, busy: false, done: [...new Set([...(n.data.done ?? []), t])] } } : n)), ...added];
        });
        setEdges((es) => {
          const have = new Set(es.map((e) => e.id));
          return [...es, ...r.edges.map((e) => edgeOf(e.source, e.target, e.label)).filter((e) => !have.has(e.id))];
        });
        // la cámara sigue a lo recién expandido
        if (fit && r.nodes.length) setTimeout(() => rf.fitView({ nodes: [{ id: parent.id }, ...r.nodes.map((n) => ({ id: n.id }))], padding: 0.25, maxZoom: 1.2, duration: 400 }), 60);
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e));
        setNodes((ns) => ns.map((n) => (n.id === parent.id ? { ...n, data: { ...n.data, busy: false } } : n)));
      }
    },
    [id, rf, setNodes, setEdges]
  );

  const addNode = (n: GNode) => {
    setQ("");
    setResults([]);
    setNodes((ns) => {
      if (ns.some((x) => x.id === n.id)) return ns;
      const c = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      return [...ns, toNode(n, c.x, c.y)];
    });
    setSel(n.id);
  };

  const remove = (nid: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== nid));
    setEdges((es) => es.filter((e) => e.source !== nid && e.target !== nid));
    setSel(null);
  };

  // nodos sueltos que quedan sin conexión al borrar ramas
  const pruneLeaves = (nid: string) => {
    const kids = new Set(edges.filter((e) => e.source === nid || e.target === nid).map((e) => (e.source === nid ? e.target : e.source)));
    const keep = (k: string) => edges.some((e) => (e.source === k || e.target === k) && e.source !== nid && e.target !== nid);
    const drop = new Set([...kids].filter((k) => !keep(k) && nodes.find((n) => n.id === k)?.data.type !== "site"));
    setNodes((ns) => ns.filter((n) => !drop.has(n.id)).map((n) => (n.id === nid ? { ...n, data: { ...n.data, done: [] } } : n)));
    setEdges((es) => es.filter((e) => !drop.has(e.source) && !drop.has(e.target)));
  };

  const MAX_NODES = 400;
  const wait = () => new Promise((r) => setTimeout(r, 30));

  /** Corre todas las transformaciones pendientes de un nodo. */
  const expandAll = async (nid: string) => {
    const n = nodesRef.current.find((x) => x.id === nid);
    if (!n) return;
    for (const t of TRANSFORMS[n.data.type]) {
      if (nodesRef.current.find((x) => x.id === nid)?.data.done?.includes(t.id)) continue;
      await run(nid, t.id, false);
      await wait();
    }
    setTimeout(() => rf.fitView({ maxZoom: 1.2, duration: 400 }), 60);
  };

  /** Expande un nivel completo: todas las transformaciones de todos los nodos visibles. */
  const expandLevel = async () => {
    const level = nodesRef.current.filter((n) => TRANSFORMS[n.data.type].some((t) => !n.data.done?.includes(t.id))).map((n) => n.id);
    let i = 0;
    for (const nid of level) {
      if (nodesRef.current.length >= MAX_NODES) {
        setNote(`Se paró en ${MAX_NODES} nodos para que el mapa siga legible. Quita ramas o expande nodos puntuales.`);
        break;
      }
      setBulk(`${++i}/${level.length}`);
      const n = nodesRef.current.find((x) => x.id === nid);
      if (!n) continue;
      for (const t of TRANSFORMS[n.data.type]) {
        if (n.data.done?.includes(t.id)) continue;
        await run(nid, t.id, false);
        await wait();
      }
    }
    setBulk("");
    setNodes((ns) => forceLayout(ns, edgesRef.current));
    setTimeout(() => rf.fitView({ maxZoom: 1.2, duration: 400 }), 60);
  };
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const relayout = () => {
    // ordena solo lo visible: los tipos ocultos no ocupan espacio
    setNodes((ns) => {
      const show = ns.filter((n) => !hiddenTypes.includes(n.data.type) || n.data.type === "site");
      const ids = new Set(show.map((n) => n.id));
      const placed = new Map(forceLayout(show, edges.filter((e) => ids.has(e.source) && ids.has(e.target))).map((n) => [n.id, n.position]));
      return ns.map((n) => (placed.has(n.id) ? { ...n, position: placed.get(n.id)! } : n));
    });
    setTimeout(() => rf.fitView({ maxZoom: 1.2, duration: 400 }), 50);
  };

  const [hiddenTypes, setHiddenTypes] = useLocal<GType[]>(`graph:hidden:${id}`, []);
  // el sitio nunca se oculta: es la raíz
  const visibleNodes = useMemo(() => nodes.map(n=>({...n,hidden:n.data.type!=="site" && (hiddenTypes.includes(n.data.type) || (!!filterText&&!n.data.label.toLowerCase().includes(filterText.toLowerCase())) || (ownership!=="all" && n.data.type==="page" && (ownership==="own"?!n.data.own:!!n.data.own)))})),[nodes,hiddenTypes,filterText,ownership]);
  const visibleIds = new Set(visibleNodes.filter(n=>!n.hidden).map(n=>n.id));
  const visibleEdges = edges.map(e=>({...e,hidden:!visibleIds.has(e.source)||!visibleIds.has(e.target)}));

  const counts = useMemo(() => {
    const m = new Map<GType, number>();
    for (const n of nodes) m.set(n.data.type, (m.get(n.data.type) ?? 0) + 1);
    return m;
  }, [nodes]);

  return (
    <div className="relative min-h-[520px] flex-1">
      <ReactFlow
        nodes={visibleNodes}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => setSel(n.id)}
        onNodeDoubleClick={(_, n) => {
          const first = TRANSFORMS[n.data.type].find((t) => !n.data.done?.includes(t.id));
          if (first) run(n.id, first.id);
        }}
        onPaneClick={() => setSel(null)}
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(n) => ({ site: "#16161c", topic: "#5b5bf6", cluster: "#a78bfa", keyword: "#38bdf8", page: (n.data as ND).own ? "#34d399" : "#b5b5c3", domain: "#fbbf24", issue: "#fb7185", question: "#2dd4bf" })[(n.data as ND).type]} />
      </ReactFlow>

      {/* barra superior */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex w-[min(640px,calc(100%-24px))] flex-col gap-2">
        <div className="pointer-events-auto flex gap-2">
          <div className="relative flex-1">
            <input className="input bg-white/95 shadow-sm dark:bg-ink-900/95" placeholder="buscar keyword, página, cluster o dominio…" value={q} onChange={(e) => setQ(e.target.value)} />
            {results.length > 0 && (
              <div className="card absolute left-0 right-0 top-10 z-20 max-h-80 overflow-auto p-1 shadow-xl">
                {results.map((r) => (
                  <button key={r.id} onClick={() => addNode(r)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-800">
                    <span className={cx("h-2 w-2 shrink-0 rounded-full", STYLE[r.type].dot)} />
                    <span className="truncate">{r.label}</span>
                    <span className="ml-auto shrink-0 text-xs text-ink-400">{TYPE_LABEL[r.type]}{r.sub ? ` · ${r.sub}` : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="btn shadow-sm" disabled={!!bulk} onClick={expandLevel} title="expande todo lo que hay en el mapa (un nivel)"><Icon name="plus" />{bulk ? `Expandiendo ${bulk}` : "Expandir todo"}</button>
          <button className="btn shadow-sm" onClick={relayout} title="ordenar el grafo automáticamente"><Icon name="map" />Ordenar</button>
          <button className="btn shadow-sm" onClick={() => confirm("¿Empezar de nuevo desde el sitio?") && reset()} title="empezar de nuevo"><Icon name="refresh" /></button>
        </div>
        <div className="pointer-events-auto flex flex-wrap gap-1">
          <input className="input w-40" placeholder="Nombre de exploración" value={graphName} maxLength={100} onChange={e=>setGraphName(e.target.value)}/>
          <button className="btn" onClick={()=>nodeAction(async()=>{if(!graphName.trim())throw new Error("Escribe un nombre");const g=await api(`/api/p/${id}/explorations`,"POST",{name:graphName,eid:activeExploration||undefined,graph:{nodes:nodes.map(n=>({...n,data:{...n.data,busy:false}})),edges,filters:{text:filterText,ownership,hiddenTypes}}});setActiveExploration(g.id);await reloadSaved();})}>Guardar</button>
          <select aria-label="Exploraciones guardadas" className="input w-44" value={activeExploration} onChange={e=>nodeAction(async()=>{const eid=e.target.value;setActiveExploration(eid);if(!eid){setGraphName("");return;}const g=await api(`/api/p/${id}/explorations/one?eid=${eid}`);setNodes(g.graph.nodes);setEdges(g.graph.edges);setGraphName(g.name);setFilterText(g.graph.filters?.text??"");setOwnership(g.graph.filters?.ownership??"all");setHiddenTypes(g.graph.filters?.hiddenTypes??[]);setSel(null);})}><option value="">Nueva exploración</option>{savedGraphs?.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>
          {activeExploration&&<button className="btn" onClick={()=>nodeAction(async()=>{await api(`/api/p/${id}/explorations`,"DELETE",{eid:activeExploration});setActiveExploration("");setGraphName("");await reloadSaved();})}>Borrar guardada</button>}
          <input className="input w-40" placeholder="Filtrar nodos visibles" value={filterText} onChange={e=>setFilterText(e.target.value)}/>
          <select aria-label="Filtro de propiedad" className="input w-auto" value={ownership} onChange={e=>setOwnership(e.target.value)}><option value="all">Todas las páginas</option><option value="own">Páginas propias</option><option value="external">Competidores</option></select>
        </div>
        {note&&!selNode&&<p className="pointer-events-auto rounded bg-amber-50 p-2 text-xs text-amber-800">{note}</p>}
        <div className="flex flex-wrap gap-1">
          {(Object.keys(STYLE) as GType[]).filter((t) => counts.get(t)).map((t) => (
            <button
              key={t}
              title={hiddenTypes.includes(t) ? "mostrar este tipo" : "ocultar este tipo"}
              onClick={() => setHiddenTypes(hiddenTypes.includes(t) ? hiddenTypes.filter((x) => x !== t) : [...hiddenTypes, t])}
              className={cx("chip pointer-events-auto bg-white/90 shadow-sm transition hover:ring-1 hover:ring-acc dark:bg-ink-900/90", hiddenTypes.includes(t) && "line-through opacity-40")}
            >
              <span className={cx("h-2 w-2 rounded-full", t === "page" ? "bg-emerald-400" : STYLE[t].dot)} />
              {TYPE_LABEL[t]} {counts.get(t)}
            </button>
          ))}
        </div>
      </div>

      {/* panel del nodo seleccionado */}
      {selNode ? (
        <div className="card absolute bottom-3 right-3 top-3 z-10 flex w-[min(320px,calc(100%-24px))] flex-col overflow-hidden shadow-xl">
          <div className="border-b border-ink-100 p-3 dark:border-ink-800">
            <div className="flex items-center gap-2">
              <span className={cx("h-2.5 w-2.5 rounded-full", selNode.data.type === "page" && selNode.data.own ? "bg-emerald-400" : STYLE[selNode.data.type].dot)} />
              <span className="lbl">{TYPE_LABEL[selNode.data.type]}{selNode.data.type === "page" ? (selNode.data.own ? " · tuya" : " · externa") : ""}</span>
              <button className="btn-g ml-auto px-1" onClick={() => setSel(null)}><Icon name="x" className="h-4 w-4" /></button>
            </div>
            <div className="mt-1 break-words font-semibold">{selNode.data.label}</div>
            {selNode.data.sub && <div className="mt-0.5 text-xs text-ink-500">{selNode.data.sub}</div>}
            {selNode.data.url && (
              <a href={selNode.data.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 break-all text-xs text-acc">
                {selNode.data.url}<Icon name="ext" className="h-3 w-3 shrink-0" />
              </a>
            )}
          </div>
          <div className="flex-1 space-y-1 overflow-auto p-2">
            <button className="btn mb-2 w-full" onClick={()=>nodeAction(async()=>{await api(`/api/p/${id}/tasks`,"POST",{title:selNode.data.label.slice(0,200),reason:`Revisar ${TYPE_LABEL[selNode.data.type]} desde la exploración: ${selNode.data.key}`.slice(0,2000),url:selNode.data.url});setNote("Tarea creada");})}>Crear tarea desde este nodo</button>
            {selNode.data.type==="cluster"&&<button className="btn mb-2 w-full" onClick={()=>nodeAction(async()=>{const url=prompt("URL propia para el brief");if(!url)return;const a=await api(`/api/p/${id}/content/cluster`,"POST",{clusterId:selNode.data.key,url});refreshJobs();window.location.assign(`/p/${id}/content/${a.id}`);})}>Generar brief del cluster</button>}
            {selNode.data.type==="page"&&!selNode.data.own&&<button className="btn mb-2 w-full" onClick={()=>nodeAction(async()=>{const ownUrl=prompt("URL propia para comparar",`https://${project?.domain}/`);if(!ownUrl)return;setComparison(await api(`/api/p/${id}/content/competitor`,"POST",{ownUrl,competitorUrl:selNode.data.url??selNode.data.key}));})}>Comparar con tu contenido</button>}
            {comparison&&<div className="mb-2 rounded bg-ink-100 p-2 text-xs dark:bg-ink-800"><p>Comparación medida · {new Date(comparison.fetchedAt).toLocaleString("es-CL")}</p><p>Palabras editoriales: {comparison.own.words} propias / {comparison.competitor.words} competidor</p><p>H2 propios: {comparison.own.headings.filter((h:any)=>h.tag==="h2").length}; competidor: {comparison.competitor.headings.filter((h:any)=>h.tag==="h2").length}</p><p>Encabezados del competidor: {comparison.competitor.headings.map((h:any)=>h.text).join(" · ")}</p></div>}
            <div className="flex items-center px-1 pb-1">
              <span className="lbl">Expandir</span>
              {TRANSFORMS[selNode.data.type].length > 1 && (
                <button className="btn-g ml-auto text-xs text-acc" disabled={selNode.data.busy || !!bulk} onClick={() => expandAll(selNode.id)}>todo</button>
              )}
            </div>
            {TRANSFORMS[selNode.data.type].map((t) => {
              const done = selNode.data.done?.includes(t.id);
              return (
                <button key={t.id} disabled={selNode.data.busy} onClick={() => run(selNode.id, t.id)} className={cx("w-full rounded-lg border px-3 py-2 text-left transition hover:border-acc hover:bg-acc-soft/50 disabled:opacity-50 dark:hover:bg-acc/10", done ? "border-ink-100 dark:border-ink-800" : "border-ink-200 dark:border-ink-700")}>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {t.label}
                    {done && <Icon name="check" className="ml-auto h-3.5 w-3.5 text-emerald-500" />}
                  </div>
                  <div className="text-xs text-ink-400">{t.desc}</div>
                </button>
              );
            })}
            {!TRANSFORMS[selNode.data.type].length && <div className="px-1 text-sm text-ink-400">Sin transformaciones para este tipo.</div>}
            {note && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">{note}</div>}
          </div>
          <div className="flex gap-2 border-t border-ink-100 p-2 dark:border-ink-800">
            <button className="btn flex-1 justify-center text-xs" onClick={() => pruneLeaves(selNode.id)}>Contraer</button>
            {selNode.data.type !== "site" && <button className="btn flex-1 justify-center text-xs" onClick={() => remove(selNode.id)}><Icon name="trash" />Quitar</button>}
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-3 right-3 z-10 hidden rounded-lg bg-white/90 px-3 py-2 text-xs text-ink-500 shadow-sm dark:bg-ink-900/90 md:block">
          Clic en un nodo para ver qué puedes expandir · doble clic expande lo siguiente
        </div>
      )}
    </div>
  );
}

export default function ExplorePage() {
  return (
    <ReactFlowProvider>
      <Explorer />
    </ReactFlowProvider>
  );
}
