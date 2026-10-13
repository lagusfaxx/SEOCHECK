/**
 * Revisión de la configuración para producción. La muestra el panel /admin y el worker la escribe en el log al arrancar.
 * Solo dice si cada cosa está o no; nunca devuelve valores de claves.
 */
import { budgetLimits } from "./budget";
import { billingEnabled } from "./plans";

export type Check = { key: string; label: string; level: "ok" | "warn" | "error" | "info"; detail: string };

const has = (k: string) => Boolean(process.env[k]?.trim());

function encKeyOk() {
  const raw = process.env.TOKEN_ENC_KEY ?? "";
  if (!/^[A-Za-z0-9+/=_-]{43,}$/.test(raw)) return false;
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").length === 32;
}

export function productionChecks(): Check[] {
  const out: Check[] = [];
  const add = (key: string, label: string, ok: boolean, bad: Check["level"], okDetail: string, badDetail: string) =>
    out.push({ key, label, level: ok ? "ok" : bad, detail: ok ? okDetail : badDetail });

  const appUrl = process.env.APP_URL ?? "";
  add("app_url", "URL pública (APP_URL)", /^https:\/\/[^/]+/.test(appUrl), "error", appUrl, appUrl ? "Debe empezar con https://" : "Falta: sin ella fallan los links de los correos y las conexiones con Google e Instagram");
  add("enc_key", "Clave de cifrado (TOKEN_ENC_KEY)", encKeyOk(), "error", "Válida (32 bytes)", "Falta o no es de 32 bytes: genérala con openssl rand -base64 32. Sin ella no se pueden guardar conexiones de Google ni Instagram");
  const signup = process.env.SIGNUP_ENABLED === "true";
  add("mail", "Correo (RESEND_API_KEY y MAIL_FROM)", has("RESEND_API_KEY") && has("MAIL_FROM"), signup ? "error" : "warn", "Configurado", "Sin correo no llegan la verificación de cuenta, la recuperación de contraseña ni las invitaciones");
  add("google", "Google OAuth (GOOGLE_OAUTH_CLIENT_ID/SECRET)", has("GOOGLE_OAUTH_CLIENT_ID") && has("GOOGLE_OAUTH_CLIENT_SECRET"), "warn", "Search Console e inicio con Google habilitados", "Sin esto los clientes no pueden conectar Search Console ni entrar con Google");
  add("openai", "OpenAI (OPENAI_API_KEY)", has("OPENAI_API_KEY"), "warn", "Configurado", "Sin esto no hay generación de imágenes ni captions con OpenAI");
  add("serp", "Búsquedas en Google (SERPENT_API_KEY)", has("SERPENT_API_KEY"), "warn", "Configurado", "Sin esto no funcionan rankings ni investigación de keywords");
  add("volume", "Volumen de búsqueda", (has("DATAFORSEO_LOGIN") && has("DATAFORSEO_PASSWORD")) || has("APIFY_TOKEN"), "warn", "Configurado", "Sin DataForSEO ni Apify el volumen sale solo de Search Console o CSV");
  add("meta", "Instagram (META_APP_ID/SECRET)", has("META_APP_ID") && has("META_APP_SECRET"), "info", "Configurado", "Publicación en Instagram desactivada");
  add("basic_auth", "BASIC_AUTH", !has("BASIC_AUTH"), "warn", "Desactivado", "Activo: pide usuario y clave del navegador antes del login; bloquea el registro público");
  out.push({ key: "signup", label: "Registro abierto (SIGNUP_ENABLED)", level: "info", detail: signup ? "Abierto: cualquiera puede crear una cuenta (con correo verificado)" : "Cerrado: solo por invitación" });
  out.push({ key: "billing", label: "Cobro (BILLING_ENABLED)", level: "info", detail: billingEnabled() ? "Activo con Stripe" : "Apagado: todas las cuentas en Beta gratuita" });
  if (billingEnabled()) add("stripe", "Stripe", has("STRIPE_SECRET_KEY") && has("STRIPE_WEBHOOK_SECRET"), "error", "Configurado", "BILLING_ENABLED=true pero faltan STRIPE_SECRET_KEY o STRIPE_WEBHOOK_SECRET");
  const b = budgetLimits();
  out.push({ key: "budgets", label: "Presupuestos mensuales (USD)", level: "info", detail: Object.entries(b).map(([k, v]) => `${k}: ${v < 0 ? "sin límite" : v}`).join(" · ") });
  return out;
}

/** Para el log del worker: una línea por problema. */
export function logProductionChecks() {
  const bad = productionChecks().filter((c) => c.level === "error" || c.level === "warn");
  for (const c of bad) console[c.level === "error" ? "error" : "warn"](`[config] ${c.level === "error" ? "ERROR" : "aviso"} ${c.label}: ${c.detail}`);
  if (!bad.length) console.log("[config] configuración de producción OK");
}
