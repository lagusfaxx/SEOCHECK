"use client";
import { useState } from "react";
import { useProject } from "@/components/Shell";
import { api, cx, Empty, pct, useAction, useApi } from "@/components/ui";

type Data = {
  configured: boolean;
  local: { location?: string; businessName?: string; keywords?: string[] };
  ai: null | { at: string; engines: { engine: string; total: number; found: number; share: number }[]; keywords: { keyword: string; engines: { engine: string; found: boolean; position: number | null }[] }[]; topCited: { domain: string; count: number }[] };
  localRanks: null | { at: string; rows: { keyword: string; location: string; position: number | null; previous: number | null; rating: number | null; top: { name: string; rating: number | null }[] }[] };
};
const ENGINE: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", perplexity: "Perplexity" };

/** ¿Las IA citan el sitio? y posición en Google Maps para búsquedas locales. */
export function AiLocalCard() {
  const { id } = useProject();
  const { data, mutate } = useApi<Data>(`/api/p/${id}/ai-local`);
  const [form, setForm] = useState<{ location: string; businessName: string; keywords: string } | null>(null);
  const [save, saving] = useAction(async () => {
    await api(`/api/p/${id}/marketing/local`, "POST", { ...form, keywords: (form?.keywords ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean) });
    setForm(null);
    await mutate();
  });
  // IA y Maps usan las búsquedas de Google: sin ellas en la instalación, la tarjeta no aporta nada
  if (!data || !data.configured) return null;
  const f = form ?? { location: data.local.location ?? "", businessName: data.local.businessName ?? "", keywords: (data.local.keywords ?? []).join(", ") };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card space-y-3 p-4">
        <h2 className="text-base font-semibold">Visibilidad en IA</h2>
        {data.ai ? (
          <>
            <p className="text-xs text-ink-500">¿ChatGPT, Claude, Gemini y Perplexity citan tu sitio al responder tus keywords? Revisión del {data.ai.at.slice(0, 10)}.</p>
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              {data.ai.engines.map((e) => (
                <div key={e.engine} className="rounded-lg bg-ink-50 p-2 dark:bg-ink-800/50">
                  <div className="text-xs text-ink-500">{ENGINE[e.engine] ?? e.engine}</div>
                  <div className={cx("text-lg font-semibold tabular-nums", e.found ? "text-emerald-600" : "text-ink-400")}>{pct(e.share, 0)}</div>
                  <div className="text-xs text-ink-500">{e.found} de {e.total}</div>
                </div>
              ))}
            </div>
            <div className="text-xs text-ink-500">Más citados en tu lugar: {data.ai.topCited.slice(0, 6).map((c) => c.domain).join(", ") || "—"}</div>
          </>
        ) : <Empty compact icon="sparkle" title="Sin revisión todavía">Se revisan las keywords de Rankings al ejecutar el análisis completo (una vez por semana).</Empty>}
      </section>
      <section className="card space-y-3 p-4">
        <h2 className="text-base font-semibold">SEO local (Google Maps)</h2>
        {data.localRanks ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-500"><th>Búsqueda</th><th className="text-right">Posición</th><th className="text-right">Rating</th></tr></thead>
            <tbody>
              {data.localRanks.rows.map((r) => (
                <tr key={r.keyword} className="border-t border-ink-100 dark:border-ink-800" title={`Top 3: ${r.top.map((t) => t.name).join(", ")}`}>
                  <td className="py-1.5">{r.keyword}</td>
                  <td className={cx("text-right tabular-nums", r.position != null && r.position <= 3 ? "text-emerald-600" : "text-rose-600")}>{r.position ?? "no aparece"}{r.previous != null && r.position != null && r.previous !== r.position ? <span className="text-xs text-ink-400"> (antes {r.previous})</span> : null}</td>
                  <td className="text-right tabular-nums">{r.rating ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-xs text-ink-500">Configura dónde atiende el negocio y qué buscan tus clientes; se revisa al ejecutar el análisis completo.</p>}
        <form className="grid gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="grid gap-2 md:grid-cols-2">
            <input className="input" placeholder="Ciudad o comuna (ej. Providencia, Santiago)" value={f.location} onChange={(e) => setForm({ ...f, location: e.target.value })} />
            <input className="input" placeholder="Nombre del negocio en Google Maps" value={f.businessName} onChange={(e) => setForm({ ...f, businessName: e.target.value })} />
          </div>
          <input className="input" placeholder="Búsquedas locales, separadas por coma (máx. 5)" value={f.keywords} onChange={(e) => setForm({ ...f, keywords: e.target.value })} />
          <div><button className="btn" disabled={saving || !form}>Guardar</button></div>
        </form>
      </section>
    </div>
  );
}
