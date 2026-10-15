"use client";
import { useState } from "react";
import { useProject } from "@/components/Shell";
import { api, cx, Empty, fmtDate, useAction, useApi } from "@/components/ui";

type Watch = {
  alerts: { id: string; at: string; severity: "critical" | "warning"; title: string; detail: string; urls: string[] }[];
  changes: null | { from: string; to: string; total: number; byField: Record<string, number>; sample: { url: string; field: string; before: string; after: string }[] };
  immediate: boolean;
  recipients: string[];
};

/** Avisos inmediatos (home caída, noindex nuevo, caídas…) y cambios entre los dos últimos crawls. */
export function WatchCard() {
  const { id } = useProject();
  const { data, mutate } = useApi<Watch>(`/api/p/${id}/watch`);
  const [emails, setEmails] = useState<string | null>(null);
  const [save, saving] = useAction(async (immediate: boolean) => {
    await api(`/api/p/${id}/marketing/alerts`, "POST", { immediate, emails: (emails ?? data?.recipients.join(", ") ?? "").split(/[\s,;]+/).filter(Boolean) });
    setEmails(null);
    await mutate();
  });
  if (!data) return null;
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Avisos</h2>
        <label className="flex items-center gap-1.5 text-xs text-ink-500">
          <input type="checkbox" checked={data.immediate} disabled={saving} onChange={(e) => save(e.target.checked)} /> Avisar por correo al instante
        </label>
      </div>
      {data.alerts.length ? (
        <ul className="space-y-2 text-sm">
          {data.alerts.map((a) => (
            <li key={a.id} className={cx("rounded-lg border-l-4 px-3 py-2", a.severity === "critical" ? "border-rose-500 bg-rose-50 dark:bg-rose-900/20" : "border-amber-400 bg-amber-50 dark:bg-amber-900/20")}>
              <div className="font-medium">{a.title}</div>
              <div className="text-xs text-ink-600 dark:text-ink-300">{fmtDate(a.at, "datetime")} · {a.detail}</div>
              {a.urls?.length > 0 && <div className="mt-1 truncate text-xs text-ink-500" title={a.urls.join("\n")}>{a.urls.slice(0, 3).join(" · ")}{a.urls.length > 3 ? ` (+${a.urls.length - 3})` : ""}</div>}
            </li>
          ))}
        </ul>
      ) : <Empty compact tone="good" icon="check" title="Sin avisos en los últimos 30 días">Se revisa después de cada auditoría, sincronización de Search Console y revisión de rankings.</Empty>}
      {data.changes && data.changes.total > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">{data.changes.total} cambio(s) entre los dos últimos crawls ({Object.entries(data.changes.byField).map(([f, n]) => `${f}: ${n}`).join(", ")})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {data.changes.sample.map((c, i) => <li key={i} className="truncate" title={`${c.before} → ${c.after}`}><b>{c.field}</b> {c.url.replace(/^https?:\/\/[^/]+/, "") || "/"}: «{c.before}» → «{c.after}»</li>)}
          </ul>
        </details>
      )}
      <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); save(data.immediate); }}>
        <input className="input flex-1" placeholder="Correos del equipo que reciben avisos" value={emails ?? data.recipients.join(", ")} onChange={(e) => setEmails(e.target.value)} />
        <button className="btn" disabled={saving || emails == null}>Guardar</button>
      </form>
    </section>
  );
}
