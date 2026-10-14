/**
 * Auditoría SEO gratis de una página (fsvc.cl/search/auditoria-gratis): imán de clientes. Usa el mismo parser del
 * crawler (React streaming, Cloudflare, etc.), sin APIs pagadas. Se protege con validación SSRF y rate limit por IP.
 */
import { fetchPage, describeFetchError } from "./audit/crawler";
import { safeFetch } from "./net/ssrf";

export type FreeCheck = { id: string; label: string; status: "ok" | "warn" | "bad"; detail: string; why: string };
export type FreeAudit = { url: string; finalUrl: string; score: number; checks: FreeCheck[]; title: string | null };

export class FreeAuditError extends Error {}

/** "tusitio.cl" → "https://tusitio.cl/" */
export function normalizeAuditUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new FreeAuditError("Escribe la dirección de tu sitio, por ejemplo tusitio.cl");
  let v = raw.trim();
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new FreeAuditError("Esa dirección no es válida");
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password) throw new FreeAuditError("Esa dirección no es válida");
  u.hash = "";
  return u.toString();
}

async function exists(url: string) {
  try {
    const { res } = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; FSVSearchBot/1.0; +https://fsvc.cl/search)" }, timeoutMs: 8000, maxRedirects: 3 });
    const ok = res.status === 200;
    const text = ok ? (await res.text()).slice(0, 200_000) : "";
    if (!ok) await res.body?.cancel().catch(() => {});
    return { ok, text };
  } catch {
    return { ok: false, text: "" };
  }
}

export async function runFreeAudit(raw: unknown): Promise<FreeAudit> {
  const url = normalizeAuditUrl(raw);
  let p;
  try {
    p = await fetchPage(url, false, { userAgent: "Mozilla/5.0 (compatible; FSVSearchBot/1.0; +https://fsvc.cl/search)" });
  } catch (e) {
    throw new FreeAuditError(`No pudimos abrir el sitio: ${describeFetchError(e)}`);
  }
  if (p.error === "blocked_by_waf") throw new FreeAuditError("El sitio bloqueó nuestra visita (firewall o protección anti-bots). Con una cuenta puedes configurar el rastreo.");
  if (!p.status) throw new FreeAuditError("No pudimos abrir el sitio. Revisa que la dirección esté bien escrita y que sea pública.");

  const final = new URL(p.finalUrl);
  const [robots, sitemapDirect] = await Promise.all([exists(`${final.origin}/robots.txt`), exists(`${final.origin}/sitemap.xml`)]);
  const sitemapInRobots = /^\s*sitemap\s*:/im.test(robots.text);

  const checks: FreeCheck[] = [];
  const add = (id: string, label: string, status: FreeCheck["status"], detail: string, why: string) => checks.push({ id, label, status, detail, why });

  add("status", "La página responde", p.status === 200 ? "ok" : "bad", p.status === 200 ? `HTTP 200${p.redirects.length ? ` tras ${p.redirects.length} redirección(es)` : ""}` : `HTTP ${p.status}`, "Google solo indexa páginas que responden 200. Un error deja la página fuera de los resultados.");
  add("https", "Conexión segura (HTTPS)", final.protocol === "https:" ? "ok" : "bad", final.protocol === "https:" ? "Usa HTTPS" : "No usa HTTPS", "HTTPS es una señal de posicionamiento y los navegadores marcan los sitios sin él como no seguros.");
  add("redirects", "Redirecciones", p.redirects.length <= 1 ? "ok" : "warn", p.redirects.length ? `${p.redirects.length} salto(s) hasta ${p.finalUrl}` : "Sin redirecciones", "Las cadenas de redirecciones hacen más lenta la carga y diluyen señales: lo ideal es una sola.");
  add("speed", "Tiempo de respuesta del servidor", p.responseMs < 800 ? "ok" : p.responseMs < 2000 ? "warn" : "bad", `${p.responseMs} ms`, "Un servidor lento retrasa todo lo demás. Bajo 800 ms es bueno.");
  if (p.status !== 200) return finish(url, p.finalUrl, p.title, checks);

  const tl = p.title?.length ?? 0;
  add("title", "Título (title)", !p.title ? "bad" : tl > 60 || tl < 25 ? "warn" : "ok", p.title ? `«${p.title}» (${tl} caracteres)` : "No tiene", "Es el texto azul que se ve en Google. Lo ideal: entre 25 y 60 caracteres, con la keyword principal al inicio.");
  const ml = p.metaDesc?.length ?? 0;
  add("meta", "Meta descripción", !p.metaDesc ? "warn" : ml > 155 || ml < 70 ? "warn" : "ok", p.metaDesc ? `${ml} caracteres` : "No tiene", "Es el texto bajo el título en Google. Una buena descripción (70 a 155 caracteres) aumenta los clics.");
  add("h1", "Encabezado principal (H1)", p.h1.length === 1 ? "ok" : p.h1.length ? "warn" : "bad", p.h1.length ? (p.h1.length === 1 ? `«${p.h1[0].slice(0, 80)}»` : `${p.h1.length} H1 en la página`) : "No tiene", "Un solo H1 que diga de qué trata la página ayuda a Google a entender el tema.");
  add("words", "Cantidad de contenido", p.wordCount >= 250 ? "ok" : p.wordCount >= 80 ? "warn" : "bad", `${p.wordCount} palabras`, "Con muy poco texto Google tiene poco para entender y posicionar la página. En páginas que deben rankear, apunta a más de 250 palabras útiles.");
  add("index", "Google puede indexarla", p.noindex ? "bad" : "ok", p.noindex ? "Tiene noindex" : "Sin noindex", "Una página con noindex no aparece en Google. Correcto en páginas privadas, grave en páginas importantes.");
  if (p.nofollow) add("nofollow", "Links seguibles", "warn", "Tiene nofollow", "Con nofollow Google no sigue los links de la página, y lo que enlaza no recibe su autoridad.");
  add("canonical", "URL canónica", p.canonicalType === "self" ? "ok" : p.canonicalType === "none" ? "warn" : "warn", p.canonicalType === "self" ? "Apunta a sí misma" : p.canonicalType === "none" ? "No tiene" : `Apunta a ${p.canonical}`, "El canonical le dice a Google cuál es la versión principal de la página y evita contenido duplicado.");
  add("schema", "Datos estructurados", p.jsonldErrors ? "bad" : p.jsonldTypes.length ? "ok" : "warn", p.jsonldErrors ? `${p.jsonldErrors} bloque(s) JSON-LD con error` : p.jsonldTypes.length ? p.jsonldTypes.slice(0, 5).join(", ") : "No tiene", "Los datos estructurados (JSON-LD) permiten resultados enriquecidos: precios, valoraciones, preguntas frecuentes.");
  add("alt", "Texto alternativo en imágenes", p.imgNoAlt === 0 ? "ok" : p.imgNoAlt <= 3 ? "warn" : "bad", p.imgNoAlt ? `${p.imgNoAlt} imagen(es) sin alt` : "Todas tienen alt", "El texto alternativo ayuda a posicionar en Google Imágenes y mejora la accesibilidad.");
  add("robots", "robots.txt", robots.ok ? "ok" : "warn", robots.ok ? "Existe" : "No se encontró", "robots.txt indica a Google qué puede rastrear y dónde está tu sitemap.");
  add("sitemap", "Sitemap", sitemapDirect.ok || sitemapInRobots ? "ok" : "warn", sitemapDirect.ok ? "/sitemap.xml existe" : sitemapInRobots ? "Declarado en robots.txt" : "No se encontró", "El sitemap ayuda a Google a descubrir todas tus páginas.");
  return finish(url, p.finalUrl, p.title, checks);
}

function finish(url: string, finalUrl: string, title: string | null, checks: FreeCheck[]): FreeAudit {
  const pts = checks.reduce((s, c) => s + (c.status === "ok" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
  return { url, finalUrl, title, checks, score: Math.round((pts / Math.max(1, checks.length)) * 100) };
}
