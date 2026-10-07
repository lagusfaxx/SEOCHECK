/**
 * Re-run respetando ediciones manuales: empareja grupos recién calculados con estructuras
 * existentes que se conservan (clusters o topics bloqueados). Un grupo se asigna a una
 * estructura existente si contiene su "ancla" (keyword primaria) o si al menos `minShare`
 * de sus miembros ya pertenecían a ella. Cada estructura existente absorbe a lo más un grupo.
 */
export type Existing = { id: string; anchor?: string | null; prevMembers: Set<string> };

export function matchGroups<G extends { members: string[] }>(groups: G[], existing: Existing[], minShare = 0.5): (string | null)[] {
  const taken = new Set<string>();
  return groups.map((g) => {
    let best: string | null = null;
    let bestScore = 0;
    for (const e of existing) {
      if (taken.has(e.id)) continue;
      const hasAnchor = e.anchor != null && g.members.includes(e.anchor);
      const share = g.members.filter((m) => e.prevMembers.has(m)).length / Math.max(1, g.members.length);
      const score = hasAnchor ? 2 + share : share;
      if ((hasAnchor || share >= minShare) && score > bestScore) {
        best = e.id;
        bestScore = score;
      }
    }
    if (best) taken.add(best);
    return best;
  });
}
