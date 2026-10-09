/**
 * Estado de las APIs externas sin gastar saldo (sólo endpoints de cuenta/estado).
 *
 *   npm run providers            tabla legible; sale con código 1 si alguna API configurada falla
 *   npm run providers -- --json  JSON (para monitoreo / cron)
 */
import { providerHealth } from "../src/lib/providers/health";

const ICON: Record<string, string> = { ok: "✔", not_configured: "·" };

async function main() {
  const rows = await providerHealth({ fresh: true });
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else {
    for (const h of rows) {
      const extra = [h.balance, h.latencyMs != null ? `${h.latencyMs} ms` : null].filter(Boolean).join(" · ");
      console.log(`${ICON[h.status] ?? "✖"} ${h.label.padEnd(17)} ${h.status.padEnd(14)} ${h.status === "ok" ? "" : h.message}${extra ? `  (${extra})` : ""}`);
    }
  }
  process.exit(rows.some((h) => h.status !== "ok" && h.status !== "not_configured") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
