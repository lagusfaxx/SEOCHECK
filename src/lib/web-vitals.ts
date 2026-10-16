/** CLS no tiene unidad. Los registros históricos de PSI guardaban centésimas sin marcador. */
export function fieldCls(
  field:
    | { cls?: { p75?: number | null } | null; clsUnit?: string }
    | null
    | undefined,
): number | null {
  const n = field?.cls?.p75;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return field?.clsUnit === "ratio" ? n : n / 100;
}
export function vitalStatus(
  metric: "lcp" | "inp" | "cls",
  value: number | null,
) {
  if (value == null || !Number.isFinite(value) || value < 0) return "Sin datos";
  const thresholds = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25] }[
    metric
  ];
  return value <= thresholds[0]
    ? "Bueno"
    : value <= thresholds[1]
      ? "Necesita mejora"
      : "Deficiente";
}
