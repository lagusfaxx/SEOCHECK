/**
 * Conexión directa con el CMS del sitio.
 *
 * WordPress: el plugin de FSV Search (generado por proyecto, ver plugin.ts) aplica las correcciones en el HTML que
 * entrega el servidor y hace las redirecciones 301. Esta app le habla por su API REST con peticiones firmadas
 * (HMAC-SHA256 con un secreto que solo conocen el plugin y la app): comprobar la instalación, limpiar su caché y
 * crear artículos como borrador.
 *
 * Shopify: token de una app personalizada de la tienda (Admin API). Escribe título y descripción SEO de productos,
 * colecciones, páginas y artículos del blog, el texto alternativo de las imágenes de producto y las redirecciones.
 */
import { createHmac, randomBytes } from "crypto";
import { safeFetch } from "../net/ssrf";

export type CmsKind = "wordpress" | "shopify";
export class CmsError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
type FetchLike = typeof safeFetch;
/** En pruebas se inyecta un fetch que puede llegar a servidores locales. */
let fetcher: FetchLike = safeFetch;
export const setCmsFetch = (f: FetchLike | null) => void (fetcher = f ?? safeFetch);

export const newSecret = () => randomBytes(24).toString("base64url");

// ── WordPress ────────────────────────────────────────────────────────────────

export function normalizeWpUrl(raw: string): string {
  let u: URL;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) && !/^https?:\/\//i.test(raw.trim())) throw new CmsError("La dirección debe empezar con https://");
  try {
    u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new CmsError("Escribe la dirección del sitio, por ejemplo https://misitio.cl");
  }
  if (!/^https?:$/.test(u.protocol)) throw new CmsError("La dirección debe empezar con https://");
  return `${u.origin}${u.pathname.replace(/\/(wp-admin|wp-login\.php).*$/, "").replace(/\/+$/, "")}`;
}

/** Firma: HMAC(secreto, tiempo \n método \n ruta \n cuerpo). La ruta es la de la API REST (/fsv-search/v1/…). */
export function wpSignature(secret: string, time: number, method: string, route: string, body: string) {
  return createHmac("sha256", secret).update(`${time}\n${method}\n${route}\n${body}`).digest("hex");
}

export async function wpRequest<T = any>(site: string, secret: string, method: "GET" | "POST", route: string, payload?: unknown): Promise<T> {
  const body = payload == null ? "" : JSON.stringify(payload);
  const time = Math.floor(Date.now() / 1000);
  // ?rest_route= funciona con y sin enlaces permanentes
  const url = `${site}/?rest_route=${encodeURIComponent(route)}`;
  let r: Awaited<ReturnType<FetchLike>>;
  try {
    r = await fetcher(url, {
      method,
      headers: { "content-type": "application/json", "x-fsv-time": String(time), "x-fsv-signature": wpSignature(secret, time, method, route, body), "user-agent": "FSV-Search/1.0" },
      body: method === "POST" ? body : undefined,
      timeoutMs: 20_000,
    });
  } catch (e) {
    throw new CmsError(`No se pudo conectar con ${site}: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
  const text = await r.res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (r.res.status === 404 || json?.code === "rest_no_route") throw new CmsError("El sitio respondió, pero el plugin de FSV Search no está activo. Súbelo y actívalo en Plugins → Añadir nuevo → Subir plugin.", 409);
  if (r.res.status === 401 || r.res.status === 403) throw new CmsError(json?.code === "fsv_bad_signature" ? "El plugin instalado es de otra conexión: descarga el plugin de nuevo e instálalo en reemplazo del anterior." : "El sitio rechazó la conexión (un firewall o plugin de seguridad puede estar bloqueando la API REST).", 409);
  if (r.res.status >= 400 || !json) throw new CmsError(`El sitio respondió con error ${r.res.status}${json?.message ? `: ${json.message}` : ""}`, 502);
  return json as T;
}

export type WpStatus = { plugin: string; wordpress: string; name: string; url: string; seo: string | null };

// ── Shopify ──────────────────────────────────────────────────────────────────

export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

export function normalizeShop(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const shop = s.endsWith(".myshopify.com") ? s : `${s.replace(/\.myshopify$/, "")}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new CmsError("Escribe el dominio de la tienda en Shopify, por ejemplo mitienda.myshopify.com (lo ves en Configuración → Dominios)");
  return shop;
}

export async function shopifyGql<T = any>(shop: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let r: Awaited<ReturnType<FetchLike>>;
  try {
    r = await fetcher(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-access-token": token, "user-agent": "FSV-Search/1.0" },
      body: JSON.stringify({ query, variables }),
      timeoutMs: 30_000,
      maxRedirects: 0,
    });
  } catch (e) {
    throw new CmsError(`No se pudo conectar con Shopify: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
  const json: any = await r.res.json().catch(() => null);
  if (r.res.status === 401 || r.res.status === 403) throw new CmsError("Shopify rechazó el token: revisa que sea el «token de acceso de la API de Admin» de la app y que tenga los permisos pedidos.", 409);
  if (r.res.status === 404) throw new CmsError("No existe una tienda con ese dominio en Shopify.", 409);
  if (r.res.status >= 400 || !json) throw new CmsError(`Shopify respondió con error ${r.res.status}`, 502);
  if (json.errors?.length) {
    const msg = json.errors.map((e: any) => e.message).join("; ");
    if (/access denied|scope/i.test(msg)) throw new CmsError(`Al token le falta un permiso: ${msg}. Agrega los permisos indicados en la app de Shopify y vuelve a instalarla.`, 409);
    throw new CmsError(`Shopify: ${msg}`, 502);
  }
  return json.data as T;
}

export const SHOPIFY_SCOPES = ["write_products", "write_content", "write_online_store_navigation", "write_files"];

/** Recurso de Shopify al que corresponde una URL de la tienda. */
export function shopifyResourceOf(url: string): { type: "product" | "collection" | "page" | "article"; handle: string } | null {
  let path = "";
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  // con idioma (/en/products/x) o dentro de una colección (/collections/a/products/x)
  const m =
    path.match(/\/products\/([^/]+)\/?$/) ? { type: "product" as const, handle: path.match(/\/products\/([^/]+)\/?$/)![1] }
    : path.match(/\/collections\/([^/]+)\/?$/) ? { type: "collection" as const, handle: path.match(/\/collections\/([^/]+)\/?$/)![1] }
    : path.match(/\/pages\/([^/]+)\/?$/) ? { type: "page" as const, handle: path.match(/\/pages\/([^/]+)\/?$/)![1] }
    : path.match(/\/blogs\/[^/]+\/([^/]+)\/?$/) ? { type: "article" as const, handle: path.match(/\/blogs\/[^/]+\/([^/]+)\/?$/)![1] }
    : null;
  return m && /^[\w-]+$/u.test(m.handle) ? m : null;
}

/** Nombre del archivo de una imagen de Shopify sin tamaño ni versión: "foto_800x800.jpg?v=1" → "foto". */
export function shopifyImageStem(src: string): string {
  try {
    const name = decodeURIComponent(new URL(src, "https://x.invalid").pathname.split("/").pop() ?? "");
    return name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_(\d+x\d*|\d*x\d+|small|medium|large|grande|compact|master|pico|icon|thumb)(@\dx)?$/i, "").toLowerCase();
  } catch {
    return "";
  }
}
