"use client";
import { useEffect, useState } from "react";
import { useProject } from "./Shell";
import { api, cx, Icon, Spinner, useApi } from "./ui";

type Conn = { oauthConfigured: boolean; mode: "oauth" | "sa" | null; email: string | null; lastError: string | null; property: string | null };

/** Conectar Search Console con la cuenta de Google del cliente, explicando para qué sirve. */
export function GscConnect({ compact, returnTo }: { compact?: boolean; /** volver aquí después de autorizar en Google (p. ej. el wizard) */ returnTo?: string }) {
  const { id } = useProject();
  const { data: c, mutate } = useApi<Conn>(`/api/p/${id}/gsc/connection`);
  const { data: sites } = useApi<string[]>(c?.mode ? `/api/p/${id}/gsc/sites` : null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  // resultado del regreso desde Google (?gsc=ok o ?gsc_error=...)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // Google siempre vuelve a Ajustes: si la conexión se empezó en otra pantalla, regresar allá con el resultado
    const key = `sc:gscReturn:${id}`;
    let back: string | null = null;
    try {
      back = sessionStorage.getItem(key);
      if (back && (q.get("gsc") || q.get("gsc_error"))) sessionStorage.removeItem(key);
    } catch {
      /* sin storage: se queda en Ajustes */
    }
    if (back && back !== window.location.pathname && (q.get("gsc") || q.get("gsc_error"))) {
      window.location.replace(`${back}${window.location.search}`);
      return;
    }
    if (q.get("gsc") === "ok") setOk("Search Console conectado. Ya puedes sincronizar los datos.");
    if (q.get("gsc_error")) setErr(q.get("gsc_error")!);
    if (q.get("gsc") || q.get("gsc_error")) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, [id]);

  if (!c) return null;
  const connect = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ url: string }>(`/api/p/${id}/gsc/connect`, "POST", {});
      try {
        if (returnTo) sessionStorage.setItem(`sc:gscReturn:${id}`, returnTo);
      } catch {
        /* sin storage: vuelve a Ajustes */
      }
      window.location.href = r.url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <div id="gsc" className="card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <div className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", c.mode ? "bg-emerald-100 text-emerald-700" : "bg-acc-soft text-acc")}>
          <Icon name="gsc" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{c.mode ? "Search Console conectado" : "Conecta Google Search Console"}</div>
          {!compact && !c.mode && (
            <p className="mt-0.5 text-sm text-ink-500">
              Descubre con qué búsquedas te encuentran, qué páginas pierden tráfico y dónde tienes oportunidades. Es gratis, de Google, y SEOCHECK solo puede <b>leer</b> los datos.
            </p>
          )}
          {c.mode === "oauth" && <p className="mt-0.5 text-sm text-ink-500">Con la cuenta de Google <b>{c.email ?? "—"}</b>{c.property && <> · propiedad <b>{c.property}</b></>}</p>}
          {c.mode === "sa" && <p className="mt-0.5 text-sm text-ink-500">Con la cuenta de servicio de la instalación{c.property && <> · propiedad <b>{c.property}</b></>}. Puedes conectar la cuenta de Google del cliente para no depender de ella.</p>}
        </div>
        {c.mode === "oauth" ? (
          <button className="btn shrink-0" onClick={async () => { if (!confirm("¿Desconectar Search Console? Los datos ya sincronizados se mantienen.")) return; await api(`/api/p/${id}/gsc/connect`, "DELETE"); mutate(); }}>Desconectar</button>
        ) : (
          <button className="btn-p shrink-0" disabled={busy || !c.oauthConfigured} onClick={connect}>{busy ? <><Spinner className="h-4 w-4" />Conectando…</> : <><Icon name="globe" />Conectar con Google</>}</button>
        )}
      </div>
      {c.mode && sites && sites.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-500">Propiedad</span>
          <select className="input w-auto" value={c.property ?? ""} onChange={async (e) => { await api(`/api/p/${id}`, "PATCH", { gscProperty: e.target.value }); mutate(); }}>
            {!c.property && <option value="">elige…</option>}
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      {!c.oauthConfigured && !c.mode && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          El administrador de esta instalación todavía no configuró la conexión con Google (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET y TOKEN_ENC_KEY). Ver README.
        </p>
      )}
      {!c.mode && !compact && (
        <details className="text-sm text-ink-500">
          <summary className="cursor-pointer">¿Qué pierdo si sigo sin Search Console?</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>Clics, impresiones y posiciones reales de Google.</li>
            <li>Oportunidades (posición 4–20), CTR bajo, páginas que pierden tráfico y canibalización.</li>
            <li>Priorizar las tareas por tráfico real: sin GSC se estima con los links internos.</li>
            <li>Estado de indexación de tus páginas.</li>
          </ul>
          <p className="mt-1">La auditoría técnica, keywords, rankings y contenido funcionan igual.</p>
        </details>
      )}
      {c.lastError && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{c.lastError}</div>}
      {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{err}</div>}
      {ok && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">{ok}</div>}
    </div>
  );
}
