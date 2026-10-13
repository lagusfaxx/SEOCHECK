/**
 * Mensajes para clientes: nunca nombres de proveedores, presupuestos, variables de entorno ni restos de API keys.
 * El dueño de la instancia ve el mensaje original; el detalle siempre queda en el log del servidor.
 */
const INTERNAL = /(api[\s_-]?key|sk-[a-z0-9]|bearer|openai|anthropic|dataforseo|serpent|apify|pagespeed|browserless|presupuesto|budget|saldo|cr[eé]ditos? de|credencial|prisma|econn|etimedout|enotfound|fetch failed|socket|worker|coolify|pg-boss|postgres|\.env|quota exceeded|rate limit|insufficient_quota)/i;
const ENV_VAR = /\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b/;

export const GENERIC_ERROR = "No pudimos completar esto en este momento. Intenta de nuevo en unos minutos; si sigue pasando, escríbenos a contacto@fsvc.cl.";

export function clientMessage(msg: string | null | undefined, admin: boolean): string | null {
  if (!msg || admin) return msg ?? null;
  return INTERNAL.test(msg) || ENV_VAR.test(msg) ? GENERIC_ERROR : msg;
}
