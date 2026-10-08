/**
 * Administración de usuarios desde la consola (por ejemplo en Coolify → Terminal del servicio web):
 *   npm run user -- reset <email>     link para elegir contraseña nueva (si no hay correo configurado)
 *   npm run user -- list              usuarios y sus workspaces
 */
import { db } from "../src/lib/db";
import { createReset } from "../src/lib/auth";

(async () => {
  const [cmd, email] = process.argv.slice(2);
  const base = (process.env.APP_URL ?? "https://TU-DOMINIO").replace(/\/$/, "");
  if (cmd === "reset" && email) {
    const u = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!u) throw new Error(`No existe el usuario ${email}`);
    console.log(`${base}/reset?token=${await createReset(u.id, 24)}  (vence en 24 h)`);
  } else if (cmd === "list") {
    for (const u of await db.user.findMany({ include: { memberships: { include: { workspace: true } } } }))
      console.log(u.email, "·", u.memberships.map((m) => `${m.workspace.name} (${m.role})`).join(", "));
  } else {
    console.log("uso: npm run user -- reset <email> | list");
  }
  await db.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
