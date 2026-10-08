/**
 * Errores de APIs externas clasificados: el usuario (y el informe) tienen que poder distinguir
 * "sin saldo" de "la API está caída", "límite de ritmo", "credenciales inválidas" o "tiempo agotado".
 */
export type FailKind = "timeout" | "down" | "no_balance" | "rate_limit" | "auth" | "bad_request" | "not_configured";

export class ProviderError extends Error {
  constructor(public provider: string, public kind: FailKind, message: string, public status?: number) {
    super(message);
    this.name = "ProviderError";
  }
  /** vale la pena reintentar en un rato (no es un problema de configuración) */
  get transient() {
    return this.kind === "timeout" || this.kind === "down" || this.kind === "rate_limit";
  }
}

export function httpFail(provider: string, status: number, body = ""): ProviderError {
  const detail = body.replace(/\s+/g, " ").slice(0, 160);
  if (status === 401 || status === 403) return new ProviderError(provider, "auth", `${provider}: la API key no es válida o no tiene permisos (HTTP ${status})`, status);
  if (status === 402) return new ProviderError(provider, "no_balance", `${provider}: sin saldo o créditos (HTTP 402)`, status);
  if (status === 429) return new ProviderError(provider, "rate_limit", `${provider}: límite de solicitudes alcanzado; se reintenta más tarde (HTTP 429)`, status);
  if (status >= 500) return new ProviderError(provider, "down", `${provider} está con problemas (HTTP ${status})`, status);
  return new ProviderError(provider, "bad_request", `${provider} rechazó la consulta (HTTP ${status})${detail ? `: ${detail}` : ""}`, status);
}

export function netFail(provider: string, e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = e as { name?: string; code?: string; cause?: { code?: string }; message?: string };
  const code = err?.cause?.code ?? err?.code ?? "";
  if (err?.name === "AbortError" || err?.name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT" || /timeout|aborted/i.test(err?.message ?? ""))
    return new ProviderError(provider, "timeout", `${provider} no respondió a tiempo`);
  return new ProviderError(provider, "down", `${provider} no está disponible (${code || err?.message || "error de red"})`);
}
