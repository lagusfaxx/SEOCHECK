import { deleteInstagramUser, parseSignedRequest } from "@/lib/providers/meta";

export const dynamic = "force-dynamic";

/** Meta avisa acá cuando el usuario quita la app desde Instagram: se borran su token y sus estadísticas. */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const userId = parseSignedRequest(String(form.get("signed_request") ?? ""));
    await deleteInstagramUser(userId);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "inválido" }, { status: 400 });
  }
}
