/**
 * Revisión de seguridad gratis (fsvc.cl/pentest/revision-gratis): solo pasiva, lo mismo que ve un navegador al
 * visitar la portada (cabeceras, cookies, redirección a HTTPS y certificado). No envía ataques ni prueba rutas.
 * Validación SSRF en la petición HTTP y en la conexión TLS.
 */
import tls from "node:tls";
import { assertUrlAllowed, makeSafeLookup, safeFetch } from "./net/ssrf";
import { normalizeAuditUrl, FreeAuditError, type FreeCheck } from "./free-audit";

export type SecurityCheck = { url: string; finalUrl: string; score: number; checks: FreeCheck[] };

const UA = "Mozilla/5.0 (compatible; FSVSecurityCheck/1.0; +https://fsvc.cl/pentest)";

/** Vencimiento del certificado (días). null si no se pudo leer. */
function certDaysLeft(host: string): Promise<{ days: number; issuer: string } | null> {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: host, lookup: makeSafeLookup() as never, timeout: 8000, rejectUnauthorized: false }, () => {
      const c = sock.getPeerCertificate();
      sock.end();
      if (!c?.valid_to) return resolve(null);
      resolve({ days: Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 864e5), issuer: String((c.issuer as Record<string, string> | undefined)?.O ?? "") });
    });
    sock.on("error", () => resolve(null));
    sock.on("timeout", () => {
      sock.destroy();
      resolve(null);
    });
  });
}

export async function runSecurityCheck(raw: unknown): Promise<SecurityCheck> {
  const url = normalizeAuditUrl(raw);
  const host = assertUrlAllowed(url).hostname;
  let r;
  try {
    r = await safeFetch(url.replace(/^http:/, "https:"), { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, timeoutMs: 15000, maxRedirects: 5 });
  } catch {
    throw new FreeAuditError("No pudimos abrir el sitio por HTTPS. Revisa que la dirección esté bien escrita y que sea pública.");
  }
  const { res, finalUrl } = r;
  await res.body?.cancel().catch(() => {});
  const h = res.headers;
  const [httpRedirect, cert] = await Promise.all([
    // se siguen las redirecciones: lo que importa es terminar en HTTPS
    safeFetch(`http://${host}/`, { headers: { "User-Agent": UA }, timeoutMs: 8000, maxRedirects: 4 })
      .then(async ({ res: r0, finalUrl: f0, redirects }) => {
        await r0.body?.cancel().catch(() => {});
        return redirects.length > 0 && /^https:/i.test(f0);
      })
      .catch(() => null),
    certDaysLeft(new URL(finalUrl).hostname),
  ]);

  const checks: FreeCheck[] = [];
  const add = (id: string, label: string, status: FreeCheck["status"], detail: string, why: string) => checks.push({ id, label, status, detail, why });

  add("https", "HTTPS", new URL(finalUrl).protocol === "https:" ? "ok" : "bad", new URL(finalUrl).protocol === "https:" ? "El sitio carga por HTTPS" : "No carga por HTTPS", "Sin HTTPS, cualquiera en la misma red puede leer o modificar lo que se envía, incluidas contraseñas.");
  add("redirect", "HTTP redirige a HTTPS", httpRedirect ? "ok" : httpRedirect === null ? "warn" : "bad", httpRedirect ? "Sí" : httpRedirect === null ? "No se pudo comprobar" : "No redirige", "Quien escriba la dirección sin https debería llegar siempre a la versión segura.");
  if (cert) add("cert", "Certificado TLS", cert.days > 20 ? "ok" : cert.days > 0 ? "warn" : "bad", cert.days > 0 ? `Vence en ${cert.days} días${cert.issuer ? ` · ${cert.issuer}` : ""}` : "Vencido", "Un certificado vencido hace que los navegadores bloqueen el sitio con una advertencia.");

  const hsts = h.get("strict-transport-security") ?? "";
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? 0);
  add("hsts", "Strict-Transport-Security (HSTS)", !hsts ? "bad" : maxAge >= 15552000 ? "ok" : "warn", hsts ? `max-age=${maxAge}` : "No está", "Obliga al navegador a usar siempre HTTPS con tu dominio. Recomendado: al menos 6 meses (15552000).");
  const csp = h.get("content-security-policy");
  const cspRo = h.get("content-security-policy-report-only");
  add("csp", "Content-Security-Policy", csp ? "ok" : cspRo ? "warn" : "bad", csp ? "Configurada" : cspRo ? "Solo en modo reporte" : "No está", "Limita desde dónde se pueden cargar scripts: es la defensa principal contra la inyección de código (XSS).");
  const xfo = h.get("x-frame-options");
  const frameAncestors = /frame-ancestors/i.test(csp ?? "");
  add("frames", "Protección contra clickjacking", xfo || frameAncestors ? "ok" : "bad", xfo ? `X-Frame-Options: ${xfo}` : frameAncestors ? "CSP frame-ancestors" : "No está", "Impide que otro sitio muestre el tuyo dentro de un iframe para engañar a tus usuarios.");
  const xcto = (h.get("x-content-type-options") ?? "").toLowerCase();
  add("nosniff", "X-Content-Type-Options", xcto === "nosniff" ? "ok" : "warn", xcto || "No está", "Con «nosniff» el navegador no ejecuta como script archivos que no lo son.");
  add("referrer", "Referrer-Policy", h.get("referrer-policy") ? "ok" : "warn", h.get("referrer-policy") ?? "No está", "Controla qué parte de tus URLs se comparte con otros sitios.");
  add("permissions", "Permissions-Policy", h.get("permissions-policy") ? "ok" : "warn", h.get("permissions-policy") ? "Configurada" : "No está", "Desactiva funciones del navegador que tu sitio no usa (cámara, micrófono, ubicación).");

  const cookies = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  if (cookies.length) {
    const weak = cookies.filter((c) => !/;\s*secure/i.test(c) || !/;\s*samesite=/i.test(c));
    add("cookies", "Cookies seguras", weak.length ? "warn" : "ok", weak.length ? `${weak.length} de ${cookies.length} cookie(s) sin Secure o SameSite` : `${cookies.length} cookie(s) con Secure y SameSite`, "Las cookies sin Secure pueden viajar sin cifrar, y sin SameSite quedan más expuestas a ataques CSRF.");
  }
  const leak = [h.get("server"), h.get("x-powered-by")].filter((v): v is string => !!v && /\d/.test(v));
  add("leak", "Versiones expuestas", leak.length ? "warn" : "ok", leak.length ? leak.join(" · ") : "No se muestran versiones", "Mostrar la versión exacta del servidor o del framework le ahorra trabajo a un atacante.");

  const pts = checks.reduce((s, c) => s + (c.status === "ok" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
  return { url, finalUrl, checks, score: Math.round((pts / Math.max(1, checks.length)) * 100) };
}
