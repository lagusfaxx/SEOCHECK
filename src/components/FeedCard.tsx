"use client";
import { useState } from "react";
import { useProject } from "@/components/Shell";
import { api, CopyBtn, useAction } from "@/components/ui";

const LABEL: Record<string, string> = { diario: "Diario (clics, impresiones, sesiones, conversiones, ingresos)", paginas: "Páginas (28 días)", consultas: "Consultas (28 días)", tareas: "Tareas", rankings: "Rankings" };

/** Enlaces CSV de solo lectura para Google Sheets (IMPORTDATA) y Looker Studio. */
export function FeedCard() {
  const { id } = useProject();
  const [urls, setUrls] = useState<Record<string, string> | null>(null);
  const [msg, setMsg] = useState("");
  const [gen, generating] = useAction(async () => {
    if (!confirm("Se generan enlaces nuevos y los anteriores dejan de funcionar. ¿Continuar?")) return;
    setUrls((await api<{ urls: Record<string, string> }>(`/api/p/${id}/marketing/feed`, "POST", {})).urls);
    setMsg("");
  });
  const [revoke] = useAction(async () => {
    await api(`/api/p/${id}/marketing/feed`, "POST", { revoke: true });
    setUrls(null);
    setMsg("Enlaces revocados.");
  });
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Exportar a Google Sheets o Looker Studio</h2>
        <div className="flex gap-2">
          <button className="btn" disabled={generating} onClick={gen}>Generar enlaces</button>
          <button className="btn-g text-rose-600" onClick={revoke}>Revocar</button>
        </div>
      </div>
      <p className="text-xs text-ink-500">CSV que se actualiza solo. En Sheets: <code>=IMPORTDATA("enlace")</code>. En Looker Studio: conector de Google Sheets sobre esa hoja. Quien tenga el enlace puede leer los datos: compártelo solo con tu equipo.</p>
      {urls && (
        <ul className="space-y-1 text-xs">
          {Object.entries(urls).map(([k, u]) => (
            <li key={k} className="flex items-center gap-2">
              <span className="w-64 shrink-0 text-ink-500">{LABEL[k] ?? k}</span>
              <code className="truncate">{u}</code>
              <CopyBtn text={u} />
            </li>
          ))}
        </ul>
      )}
      {urls && <p className="text-xs text-amber-600">Copia los enlaces ahora: por seguridad no se vuelven a mostrar.</p>}
      {msg && <p className="text-xs text-ink-500">{msg}</p>}
    </section>
  );
}
