import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Pública a propósito: Instagram descarga la imagen desde acá al publicar. El id (cuid) no es adivinable. */
export async function GET(_req: Request, { params }: { params: { imageId: string } }) {
  if (!/^[a-z0-9]{20,40}$/.test(params.imageId)) return new Response("no existe", { status: 404 });
  const img = await db.socialImage.findUnique({ where: { id: params.imageId }, select: { mime: true, data: true } });
  if (!img) return new Response("no existe", { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: { "Content-Type": img.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
