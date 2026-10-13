/** Al arrancar el servidor web: avisa en el log qué falta configurar para producción. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { logProductionChecks } = await import("./lib/prodcheck");
  logProductionChecks();
}
