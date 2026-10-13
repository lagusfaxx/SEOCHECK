import { randomBytes } from "node:crypto";
import { deleteInstagramUser, parseSignedRequest } from "@/lib/providers/meta";

export const dynamic = "force-dynamic";

/** Solicitud de eliminación de datos de Meta: borra en el acto y responde con la URL de estado y un código. */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const userId = parseSignedRequest(String(form.get("signed_request") ?? ""));
    await deleteInstagramUser(userId);
    const code = randomBytes(8).toString("hex");
    const base = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, "");
    console.log(`[meta] datos eliminados para un usuario de Instagram, código ${code}`);
    return Response.json({ url: `${base}/privacidad/eliminacion?codigo=${code}`, confirmation_code: code });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "inválido" }, { status: 400 });
  }
}
