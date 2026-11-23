"use client";
import { useState } from "react";
import { useProject } from "./Shell";
import { api, cx, fmtDate, Icon, plural, Spinner, Tabs, toast, useAction, useApi } from "./ui";

type Conn = { kind: "wordpress" | "shopify"; siteUrl: string; status: string; lastError: string | null; lastCheckAt: string | null; lastPushAt: string | null; info: any; pendingPush: number } | null;

/** Conexión directa con WordPress (plugin) o Shopify (API): aplica las correcciones en el origen, sin JavaScript. */
export function CmsConnect({ onChange }: { onChange?: () => void }) {
  const { id, project } = useProject();
  const { data, mutate } = useApi<{ connection: Conn; shopifyScopes: string[] }>(`/api/p/${id}/cms`, { refreshInterval: (d: any) => (d?.connection?.status === "pending" ? 15_000 : 0) });
  const [kind, setKind] = useState<"wordpress" | "shopify">("wordpress");
  const [url, setUrl] = useState("");
  const [shop, setShop] = useState("");
  const [token, setToken] = useState("");
  const refresh = async () => {
    await mutate();
    onChange?.();
  };
  const [connectWp, wpBusy] = useAction(async () => {
    await api(`/api/p/${id}/cms/wordpress`, "POST", { url: url || `https://${project?.domain ?? ""}` });
    await refresh();
  });
  const [connectShop, shopBusy] = useAction(async () => {
    await api(`/api/p/${id}/cms/shopify`, "POST", { shop, token });
    setToken("");
    toast("Tienda conectada", "ok");
    await refresh();
  });
  const [check, checking] = useAction(async () => {
    try {
      await api(`/api/p/${id}/cms/check`, "POST", {});
      toast("Conexión verificada", "ok");
    } finally {
      await refresh();
    }
  });
  const [push, pushing] = useAction(async () => {
    const r = await api<{ applied: number; failed: number; unsupported: number; errors: string[] }>(`/api/p/${id}/cms/push`, "POST", {});
    toast(r.failed ? `${r.applied} aplicadas · ${r.failed} con error: ${r.errors[0] ?? ""}` : `${plural(r.applied, "corrección aplicada", "correcciones aplicadas")} en Shopify${r.unsupported ? ` · ${r.unsupported} quedan para la línea de código` : ""}`, r.failed ? "error" : "ok");
    await refresh();
  });
  const [disconnect, disconnecting] = useAction(async () => {
    if (!confirm("¿Desconectar? Las correcciones dejan de aplicarse por esta vía.")) return;
    await api(`/api/p/${id}/cms`, "DELETE", {});
    await refresh();
  });
  if (!data) return <Spinner />;
  const c = data.connection;

  if (c?.kind === "wordpress") {
    const ok = c.status === "connected";
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={cx("inline-flex items-center gap-1.5 font-medium", ok ? "text-emerald-700 dark:text-emerald-400" : "text-ink-700 dark:text-ink-200")}>
            {ok ? <Icon name="check" /> : <Spinner className="h-3.5 w-3.5" />}
            {ok ? `WordPress conectado: ${c.info?.name ?? c.siteUrl}` : `Falta instalar el plugin en ${c.siteUrl}`}
          </span>
          {ok && <span className="text-ink-500">Plugin {c.info?.plugin} · WordPress {c.info?.wordpress}{c.info?.seo ? ` · funciona junto a ${c.info.seo}` : ""}</span>}
        </div>
        {ok ? (
          <p className="text-ink-600 dark:text-ink-300">Cada corrección que apruebes se aplica en el HTML que entrega tu servidor (Google y los asistentes de IA la ven sin ejecutar JavaScript), incluidas las redirecciones 301. Los artículos se envían como borrador.</p>
        ) : (
          <ol className="list-decimal space-y-1.5 pl-5 text-ink-600 dark:text-ink-300">
            <li><a className="font-medium text-acc hover:underline" href={`/api/p/${id}/cms/plugin`}>Descarga el plugin</a> (es solo para este sitio).</li>
            <li>En WordPress: Plugins → Añadir nuevo → Subir plugin → elige <code>fsv-search.zip</code> → Instalar ahora.</li>
            <li>Actívalo y presiona «Comprobar».</li>
          </ol>
        )}
        {c.lastError && !ok && c.lastCheckAt && <p className="text-sm text-amber-700 dark:text-amber-400">El plugin todavía no responde. {/plugin de FSV Search no está activo|otra conexión|firewall/.test(c.lastError) ? c.lastError : "Revisa que esté subido y activado, y vuelve a comprobar."}</p>}
        {c.lastError && ok && <p className="text-sm text-rose-600">{c.lastError}</p>}
        <div className="flex flex-wrap gap-2">
          <button className={ok ? "btn" : "btn-p"} disabled={checking} onClick={() => check()}>{checking ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="refresh" className="h-3.5 w-3.5" />}Comprobar</button>
          <a className="btn-g" href={`/api/p/${id}/cms/plugin`}><Icon name="down" className="h-3.5 w-3.5" />Descargar plugin</a>
          <button className="btn-g ml-auto" disabled={disconnecting} onClick={() => disconnect()}>Desconectar</button>
        </div>
        {c.lastCheckAt && <p className="text-xs text-ink-500">Última comprobación: {fmtDate(c.lastCheckAt, "datetime")}</p>}
      </div>
    );
  }

  if (c?.kind === "shopify") {
    const ok = c.status === "connected";
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={cx("inline-flex items-center gap-1.5 font-medium", ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600")}>
            <Icon name={ok ? "check" : "alert"} />{ok ? `Shopify conectado: ${c.info?.name ?? c.siteUrl}` : "La conexión con Shopify falló"}
          </span>
          {c.lastPushAt && <span className="text-ink-500">Último envío: {fmtDate(c.lastPushAt, "datetime")}</span>}
        </div>
        <p className="text-ink-600 dark:text-ink-300">Se escriben en la tienda: título y descripción SEO de productos, colecciones, páginas y artículos, el texto alternativo de las imágenes de producto y las redirecciones 301. Canonical, Open Graph y datos estructurados los aplica la línea de código pegada en <code>theme.liquid</code>.</p>
        {c.lastError && <p className="text-sm text-rose-600">{c.lastError}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-p" disabled={pushing || !ok || !c.pendingPush} onClick={() => push()}>{pushing ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="rocket" className="h-3.5 w-3.5" />}{c.pendingPush ? `Aplicar en Shopify (${c.pendingPush})` : "Todo aplicado en Shopify"}</button>
          <button className="btn" disabled={checking} onClick={() => check()}>Comprobar</button>
          <button className="btn-g ml-auto" disabled={disconnecting} onClick={() => disconnect()}>Desconectar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Tabs value={kind} onChange={setKind} items={[{ id: "wordpress", label: "WordPress" }, { id: "shopify", label: "Shopify" }]} />
      {kind === "wordpress" ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); connectWp(); }}>
          <p className="text-ink-600 dark:text-ink-300">Con el plugin de FSV Search las correcciones se aplican en tu servidor (sin JavaScript), las redirecciones 301 funcionan solas y los artículos llegan como borrador. Compatible con Yoast, Rank Math y All in One SEO.</p>
          <div className="flex flex-wrap gap-2">
            <input className="input min-w-0 flex-1" placeholder={`https://${project?.domain ?? "misitio.cl"}`} value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Dirección del sitio WordPress" />
            <button className="btn-p" disabled={wpBusy}>{wpBusy ? <Spinner className="h-3.5 w-3.5" /> : null}Conectar WordPress</button>
          </div>
        </form>
      ) : (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); connectShop(); }}>
          <details className="text-ink-600 dark:text-ink-300">
            <summary className="cursor-pointer">Cómo obtener el token (2 minutos)</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>En Shopify: Configuración → Apps y canales de venta → Desarrollar apps → Crear una app («FSV Search»).</li>
              <li>Configurar alcances de la API de Admin: <code>{data.shopifyScopes.join(", ")}</code>.</li>
              <li>Instalar la app y copiar el «token de acceso de la API de Admin» (empieza con <code>shpat_</code>; se ve una sola vez).</li>
            </ol>
          </details>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input className="input" placeholder="mitienda.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value)} aria-label="Dominio myshopify de la tienda" required />
            <input className="input" type="password" placeholder="shpat_…" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Token de la API de Admin" autoComplete="off" required />
            <button className="btn-p" disabled={shopBusy}>{shopBusy ? <Spinner className="h-3.5 w-3.5" /> : null}Conectar Shopify</button>
          </div>
          <p className="text-xs text-ink-500">El token se guarda cifrado y solo se usa para escribir las correcciones que apruebes.</p>
        </form>
      )}
    </div>
  );
}
