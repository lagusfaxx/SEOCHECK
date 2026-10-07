/**
 * Re-run respetando ediciones manuales: empareja grupos recién calculados con estructuras
 * existentes que se conservan (clusters o topics bloqueados). Un grupo se asigna a una
 * estructura existente si contiene su "ancla" (keyword primaria) o si al menos `minShare`
 * de sus miembros ya pertenecían a ella. Cada estructura existente absorbe a lo más un grupo; los
 * empates se resuelven por puntaje global (ancla > Jaccard), no por el orden de entrada.
 */
export type Existing = { id: string; anchor?: string | null; prevMembers: Set<string> };

export function matchGroups<G extends { members: string[] }>(groups: G[], existing: Existing[], minShare = 0.5): (string | null)[] {
  // Todos los pares candidatos, asignados de mayor a menor puntaje (independiente del orden de entrada)
  const pairs: { g: number; e: string; score: number }[] = [];
  groups.forEach((g, gi) => {
    for (const e of existing) {
      const hasAnchor = e.anchor != null && g.members.includes(e.anchor);
      const inter = g.members.filter((m) => e.prevMembers.has(m)).length;
      const share = inter / Math.max(1, g.members.length);
      // puntaje = Jaccard con la estructura previa (el ancla manda)
      const jaccard = inter / Math.max(1, g.members.length + e.prevMembers.size - inter);
      if (hasAnchor || share >= minShare) pairs.push({ g: gi, e: e.id, score: (hasAnchor ? 2 : 0) + jaccard });
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.g - b.g || a.e.localeCompare(b.e));
  const out: (string | null)[] = groups.map(() => null);
  const taken = new Set<string>();
  for (const p of pairs) {
    if (out[p.g] || taken.has(p.e)) continue;
    out[p.g] = p.e;
    taken.add(p.e);
  }
  return out;
}
