import {
  BillingError,
  handleStripeEvent,
  verifyStripeEvent,
} from "@/lib/billing";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature)
    return Response.json({ error: "Falta firma" }, { status: 400 });
  let event;
  try {
    event = verifyStripeEvent(await req.text(), signature);
  } catch (e) {
    return Response.json(
      { error: "Firma inválida o webhook sin configurar" },
      { status: e instanceof BillingError ? e.status : 400 },
    );
  }
  try {
    await handleStripeEvent(event);
    return Response.json({ received: true });
  } catch (e) {
    console.error("[stripe] No se pudo procesar evento", event.id);
    return Response.json(
      { error: "No se pudo procesar el pago" },
      { status: e instanceof BillingError ? e.status : 500 },
    );
  }
}
