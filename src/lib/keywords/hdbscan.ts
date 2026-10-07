/**
 * HDBSCAN compacto (O(n²)) para cientos/miles de puntos.
 * Distancia = 1 - coseno. Devuelve etiqueta por punto (-1 = ruido).
 */
import { cosine } from "../util";

export function hdbscan(points: number[][], minClusterSize = 3, minSamples = minClusterSize): number[] {
  const n = points.length;
  if (n === 0) return [];
  if (n < minClusterSize * 2) return new Array(n).fill(0);

  const dist = (i: number, j: number) => Math.max(0, 1 - cosine(points[i], points[j]));
  const D: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    D.push(new Float64Array(n));
    for (let j = 0; j < i; j++) D[i][j] = D[j][i] = dist(i, j);
  }
  const k = Math.min(minSamples, n - 1);
  const core = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = Array.from(D[i]).sort((a, b) => a - b);
    core[i] = row[k];
  }
  const mreach = (i: number, j: number) => Math.max(core[i], core[j], D[i][j]);

  // MST con Prim
  const inTree = new Uint8Array(n);
  const best = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const edges: [number, number, number][] = [];
  let cur = 0;
  inTree[0] = 1;
  for (let step = 1; step < n; step++) {
    for (let j = 0; j < n; j++) {
      if (inTree[j]) continue;
      const d = mreach(cur, j);
      if (d < best[j]) { best[j] = d; from[j] = cur; }
    }
    let nxt = -1, bd = Infinity;
    for (let j = 0; j < n; j++) if (!inTree[j] && best[j] < bd) { bd = best[j]; nxt = j; }
    edges.push([from[nxt], nxt, bd]);
    inTree[nxt] = 1;
    cur = nxt;
  }
  edges.sort((a, b) => a[2] - b[2]);

  // Dendrograma (single linkage) con union-find
  const parent = new Int32Array(2 * n).map((_, i) => i);
  const size = new Int32Array(2 * n).fill(1);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const left: number[] = [], right: number[] = [], lambdaNode: number[] = [];
  let next = n;
  for (const [a, b, d] of edges) {
    const ra = find(a), rb = find(b);
    parent[ra] = parent[rb] = next;
    size[next] = size[ra] + size[rb];
    left[next - n] = ra; right[next - n] = rb;
    lambdaNode[next - n] = d > 0 ? 1 / d : 1e9;
    next++;
  }
  const root = next - 1;
  const sz = (x: number) => size[x];

  // Árbol condensado
  type C = { id: number; parent: number; birth: number; stability: number; children: number[]; points: number[] };
  const clusters: C[] = [];
  const newCluster = (p: number, birth: number) => {
    const c: C = { id: clusters.length, parent: p, birth, stability: 0, children: [], points: [] };
    clusters.push(c);
    if (p >= 0) clusters[p].children.push(c.id);
    return c.id;
  };
  const leaves = (x: number): number[] => {
    const out: number[] = [], st = [x];
    while (st.length) { const y = st.pop()!; if (y < n) out.push(y); else st.push(left[y - n], right[y - n]); }
    return out;
  };
  const stack: [number, number][] = [[root, newCluster(-1, 0)]];
  while (stack.length) {
    const [node, cid] = stack.pop()!;
    if (node < n) { clusters[cid].points.push(node); continue; }
    const lam = lambdaNode[node - n];
    const l = left[node - n], r = right[node - n];
    const big = (x: number) => sz(x) >= minClusterSize;
    const c = clusters[cid];
    if (big(l) && big(r)) {
      c.stability += (lam - c.birth) * sz(node);
      stack.push([l, newCluster(cid, lam)], [r, newCluster(cid, lam)]);
    } else {
      for (const child of [l, r]) {
        if (big(child)) { stack.push([child, cid]); }
        else {
          for (const p of leaves(child)) { c.stability += lam - c.birth; c.points.push(p); }
        }
      }
    }
  }
  // Puntos que siguen en el cluster hasta el final suman su lambda máximo (aprox.)
  // Selección EOM
  const selected = new Set<number>();
  const best2 = new Map<number, number>();
  const order = [...clusters].sort((a, b) => b.id - a.id);
  for (const c of order) {
    const childSum = c.children.reduce((s, ch) => s + (best2.get(ch) ?? 0), 0);
    if (c.children.length && childSum > c.stability) best2.set(c.id, childSum);
    else {
      best2.set(c.id, c.stability);
      const rm = [...c.children];
      while (rm.length) { const x = rm.pop()!; selected.delete(x); rm.push(...clusters[x].children); }
      selected.add(c.id);
    }
  }
  // La raíz sola no es un cluster útil si tiene hijos
  if (selected.has(0) && clusters[0].children.length) {
    selected.delete(0);
    for (const ch of clusters[0].children) selected.add(ch);
  }
  const labels = new Array(n).fill(-1);
  let lbl = 0;
  for (const cid of selected) {
    const all: number[] = [], st = [cid];
    while (st.length) { const x = st.pop()!; all.push(...clusters[x].points); st.push(...clusters[x].children); }
    for (const p of all) labels[p] = lbl;
    lbl++;
  }
  return labels;
}

/**
 * Topics: HDBSCAN y, si no separa nada (un solo grupo con n ≥ 6), clustering aglomerativo
 * average-linkage cortado en el percentil 75 de similitudes por pares.
 */
export function topicLabels(points: number[][], minClusterSize = 2): number[] {
  const labels = hdbscan(points, minClusterSize, minClusterSize);
  const distinct = new Set(labels.filter((l) => l >= 0));
  if (distinct.size > 1 || points.length < 6) return labels;
  const n = points.length;
  const S: number[][] = points.map((a) => points.map((b) => cosine(a, b)));
  const sims: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) sims.push(S[i][j]);
  sims.sort((a, b) => a - b);
  const th = sims[Math.floor(sims.length * 0.75)];
  let groups: number[][] = points.map((_, i) => [i]);
  const avg = (a: number[], b: number[]) => {
    let s = 0;
    for (const i of a) for (const j of b) s += S[i][j];
    return s / (a.length * b.length);
  };
  for (;;) {
    let best = -Infinity, bi = -1, bj = -1;
    for (let i = 0; i < groups.length; i++)
      for (let j = 0; j < i; j++) {
        const v = avg(groups[i], groups[j]);
        if (v > best) { best = v; bi = i; bj = j; }
      }
    if (bi < 0 || best < th) break;
    groups[bj] = groups[bj].concat(groups[bi]);
    groups = groups.filter((_, k) => k !== bi);
  }
  const out = new Array(n).fill(-1);
  groups.forEach((g, l) => g.forEach((i) => (out[i] = l)));
  return out;
}
