/** Estados de crawl para la UI (compartido cliente/servidor). */
export const CRAWL_STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "en cola", cls: "bg-ink-100 text-ink-600" },
  running: { label: "en curso", cls: "bg-sky-100 text-sky-700" },
  completed: { label: "completado", cls: "bg-emerald-100 text-emerald-700" },
  partial: { label: "parcial", cls: "bg-amber-100 text-amber-800" },
  failed: { label: "fallido", cls: "bg-rose-100 text-rose-700" },
  cancelled: { label: "cancelado", cls: "bg-ink-100 text-ink-600" },
};
