import { db } from "../db";
import { jobLog } from "../jobctx";

/** El proveedor respondió sin saldo / pago requerido: pasar al siguiente de la cadena. */
export class NoBalanceError extends Error {
  constructor(public provider: string, message: string, public status: "no_balance" | "auth_error" = "no_balance") {
    super(message);
    this.name = "NoBalanceError";
  }
}

const RETRY_HOURS = Number(process.env.PROVIDER_RETRY_HOURS ?? 6);

export async function markProvider(provider: string, status: "no_balance" | "auth_error", message: string) {
  const until = new Date(Date.now() + RETRY_HOURS * 3600_000);
  const prev = await db.providerState.findUnique({ where: { provider } });
  await db.providerState.upsert({
    where: { provider },
    create: { provider, status, message, until },
    update: { status, message, until, ...(prev?.status === status ? {} : { since: new Date() }) },
  });
  await jobLog("warn", `${provider}: ${status === "no_balance" ? "sin saldo" : "credenciales inválidas"} (${message}); se usa el siguiente proveedor hasta ${until.toISOString()}`);
}

export async function markProviderOk(provider: string) {
  await db.providerState.updateMany({ where: { provider, status: { not: "ok" } }, data: { status: "ok", message: null, until: null } });
}

/** null si se puede usar; si no, el motivo. */
export async function providerBlocked(provider: string): Promise<string | null> {
  const s = await db.providerState.findUnique({ where: { provider } });
  if (!s || s.status === "ok" || !s.until || s.until < new Date()) return null;
  return s.status === "no_balance" ? `sin saldo desde ${s.since.toISOString().slice(0, 10)}` : `credenciales inválidas (${s.message ?? ""})`;
}

export async function providerStates() {
  return db.providerState.findMany({ where: { status: { not: "ok" } } });
}
