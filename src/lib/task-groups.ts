import { urlSection } from "./audit/insights";
import { ISSUE_FIX, ISSUE_WHY } from "./audit/fixes";
export type GroupableTask = {
  id: string;
  source: string;
  code: string | null;
  url: string | null;
  severity: string;
  priority: number;
  status: string;
  title: string;
  reason: string;
};
export const taskGroupKey = (t: GroupableTask) =>
  t.source === "crawl"
    ? JSON.stringify([t.code, t.url ? urlSection(t.url) : "sitio"])
    : t.id;
export function groupTasks<T extends GroupableTask>(
  rows: T[],
  rankedUrls = new Set<string>(),
  impressions = new Map<string, number>(),
) {
  const buckets = new Map<string, T[]>();
  for (const t of rows) {
    const key = taskGroupKey(t);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(t);
    else buckets.set(key, [t]);
  }
  return [...buckets.entries()]
    .map(([groupKey, members]) => {
      const first = [...members].sort((a, b) => a.id.localeCompare(b.id))[0];
      const active = members.filter(
        (t) => !["resolved", "ignored"].includes(t.status),
      );
      const affected = new Set(
        (active.length ? active : members).map((t) => t.url ?? t.id),
      ).size;
      const status = active.some((t) => t.status === "reappeared")
        ? "reappeared"
        : active.some((t) => t.status === "pending")
          ? "pending"
          : active.length
            ? "detected"
            : members.some((t) => t.status === "ignored")
              ? "ignored"
              : "resolved";
      const severity = members.some((t) => t.severity === "critical")
        ? "critical"
        : members.some((t) => t.severity === "warning")
          ? "warning"
          : "info";
      const ranked = active.filter(
        (t) => t.url && rankedUrls.has(t.url),
      ).length;
      const signal = active.reduce(
        (s, t) =>
          s +
          Math.max(
            0,
            (t.url ? impressions.get(t.url) : undefined) ?? t.priority,
          ),
        0,
      );
      const gscImpressions = active.reduce(
        (s, t) => s + (t.url ? (impressions.get(t.url) ?? 0) : 0),
        0,
      );
      const priority =
        (severity === "critical" ? 300 : severity === "warning" ? 150 : 50) +
        20 * Math.log1p(affected) +
        5 * Math.log1p(signal) +
        10 * Math.log1p(ranked);
      const pattern =
        first.source === "crawl" && first.url ? urlSection(first.url) : null;
      return {
        ...first,
        groupKey,
        status,
        severity,
        affected,
        pattern,
        priority,
        priorityLabel:
          severity === "critical" || priority >= 300
            ? "Alta"
            : priority >= 150
              ? "Media"
              : "Baja",
        reason:
          first.source === "crawl"
            ? (ISSUE_WHY[first.code ?? ""] ??
              "Incidencia detectada durante el análisis del sitio.")
            : first.reason,
        fix: ISSUE_FIX[first.code ?? ""] ?? "",
        probableCause:
          affected >= 3 && pattern?.includes("*")
            ? `Posible causa compartida en ${pattern}: se detectó el mismo problema en ${affected} URL${affected === 1 ? "" : "s"}. Es una inferencia por patrón; confirma la plantilla o configuración antes de aplicar un cambio global.`
            : null,
        gscImpressions,
        rankingUrls: ranked,
        priorityReason: `Severidad ${severity === "critical" ? "alta" : severity === "warning" ? "media" : "baja"} · ${affected} ${affected === 1 ? "URL afectada" : "URLs afectadas"}${gscImpressions ? ` · ${gscImpressions} impresiones GSC (28 días)` : ""}${ranked ? ` · ${ranked} URL${ranked === 1 ? "" : "s"} con rankings activos` : ""}. La relevancia de cada URL incorpora impresiones GSC o enlaces internos cuando no hay GSC.`,
        members,
        resolvedCount: members.filter((t) => t.status === "resolved").length,
      };
    })
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}
