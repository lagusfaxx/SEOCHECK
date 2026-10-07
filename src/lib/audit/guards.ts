/** Detección de WAF y protección contra trampas de crawl (facetas, calendarios, ids infinitos). */

type HeaderBag = { get(name: string): string | null };

/**
 * Página de bloqueo/challenge de un WAF (no es contenido válido del sitio):
 * - Cloudflare: header `cf-mitigated`, o 403/503 con "Just a moment...", `cf-chl`/`challenge-platform`,
 *   "Attention Required! | Cloudflare".
 * - DataDome (`x-datadome`, server DataDome, captcha-delivery), PerimeterX (`px-captcha`),
 *   Akamai ("Access Denied" servido por AkamaiGHost).
 */
export function detectWaf(status: number, headers: HeaderBag, html: string): boolean {
  if (headers.get("cf-mitigated")) return true;
  if (status !== 403 && status !== 503 && status !== 429 && status !== 405) return false;
  const head = html.slice(0, 20000);
  const server = headers.get("server") ?? "";
  return (
    /<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(head) ||
    /cf-chl|challenge-platform|cf_chl_opt|__cf_chl_/i.test(head) ||
    /Attention Required! \| Cloudflare/i.test(head) ||
    (/cloudflare/i.test(server) && /captcha|challenge/i.test(head)) ||
    Boolean(headers.get("x-datadome")) || /datadome/i.test(server) || /captcha-delivery\.com/i.test(head) ||
    /px-captcha|_pxCaptcha|perimeterx/i.test(head) ||
    (/akamaighost/i.test(server) && /Access Denied/i.test(head))
  );
}

/** Patrón de URL: números → {n}, ids largos/hex/uuid → {id}; query reducida a nombres de parámetros. */
export function urlPattern(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname
      .split("/")
      .map((seg) =>
        /^\d+$/.test(seg) ? "{n}" : /^[0-9a-f]{8,}$/i.test(seg) || /^[0-9a-f-]{32,36}$/i.test(seg) ? "{id}" : seg.replace(/\d+/g, "{n}")
      )
      .join("/");
    const keys = [...new Set([...u.searchParams.keys()])].sort();
    return `${path}${keys.length ? `?${keys.join("&")}` : ""}`;
  } catch {
    return raw;
  }
}

export const DEFAULT_IGNORE_PARAMS = ["utm_*", "gclid", "fbclid", "msclkid", "sessionid", "phpsessid", "sid"];

/** Quita parámetros ignorados (`*` = todos, `prefijo_*` = comodín). */
export function stripParams(raw: string, ignore: string[]): string {
  if (!ignore.length) return raw;
  try {
    const u = new URL(raw);
    if (ignore.includes("*")) {
      u.search = "";
      return u.toString();
    }
    const res = ignore.map((p) => new RegExp(`^${p.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`));
    for (const k of [...u.searchParams.keys()]) if (res.some((r) => r.test(k.toLowerCase()))) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return raw;
  }
}

/** Cuenta URLs por patrón y dice si una URL nueva supera el límite. */
export class PatternLimiter {
  private counts = new Map<string, number>();
  readonly skipped = new Map<string, number>();
  constructor(private max: number) {}
  allow(url: string): boolean {
    if (!this.max) return true;
    const p = urlPattern(url);
    const n = this.counts.get(p) ?? 0;
    if (n >= this.max) {
      this.skipped.set(p, (this.skipped.get(p) ?? 0) + 1);
      return false;
    }
    this.counts.set(p, n + 1);
    return true;
  }
}
