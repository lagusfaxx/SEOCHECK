import { handleMpNotification, verifyMpSignature } from "@/lib/mercadopago";
export const runtime = "nodejs";

/**
 * Webhook de Mercado Pago (suscripciones). Llega como POST ?data.id=…&type=… con un cuerpo { type, data: { id } }.
 * Con MP_WEBHOOK_SECRET se exige la firma; igual nunca se usa el cuerpo: se relee la suscripción en la API.
 */
const TOPICS: Record<string, string> = { preapproval: "subscription_preapproval", authorized_payment: "subscription_authorized_payment" };

export async function POST(req: Request) {
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as { type?: string; topic?: string; data?: { id?: unknown } };
  const rawType = url.searchParams.get("type") ?? url.searchParams.get("topic") ?? body.type ?? body.topic ?? "";
  const type = TOPICS[rawType] ?? rawType;
  const dataId = String(url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? body.data?.id ?? "").slice(0, 100);
  if (!dataId) return Response.json({ ignored: true });
  if (process.env.MP_WEBHOOK_SECRET && !verifyMpSignature(req.headers.get("x-signature"), req.headers.get("x-request-id"), dataId))
    return Response.json({ error: "Firma inválida" }, { status: 401 });
  try {
    const applied = await handleMpNotification(type, dataId);
    return Response.json({ received: true, applied });
  } catch (e) {
    console.error("[mercadopago] no se pudo procesar el aviso", type, dataId, e instanceof Error ? e.message : e);
    // 500: Mercado Pago reintenta
    return Response.json({ error: "No se pudo procesar" }, { status: 500 });
  }
}
