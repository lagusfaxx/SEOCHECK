"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApi } from "./ui";

/** Aviso arriba de cada página: días de prueba que quedan, plan vencido o pago pausado. Solo con el cobro activo. */
export function PlanNotice({ id, className = "" }: { id: string; className?: string }) {
  const path = usePathname();
  const { data: billing } = useApi<{ enabled: boolean }>(`/api/p/${id}/billing/config`);
  const { data: plan } = useApi<any>(billing?.enabled ? `/api/p/${id}/plan` : null);
  if (!billing?.enabled || !plan || plan.plan === "internal" || path?.endsWith("/settings")) return null;
  const href = `/p/${id}/settings#plan`;
  const sub = plan.subscription?.status;
  let text: string | null = null, tone = "bg-acc/10 text-ink-800 dark:text-ink-100";
  if (plan.expired) {
    text = plan.plan === "trial" ? "Terminó tu prueba gratis. Activa FSV Search para seguir creando trabajos; tus datos siguen guardados." : "Tu plan no está vigente: revisa el pago con Mercado Pago.";
    tone = "bg-rose-50 text-rose-800 dark:bg-rose-900/20 dark:text-rose-200";
  } else if (plan.plan === "trial") {
    const days = Math.max(0, Math.ceil((new Date(plan.trialEndsAt).getTime() - Date.now()) / 864e5));
    text = `${days === 0 ? "Hoy termina" : `Te ${days === 1 ? "queda 1 día" : `quedan ${days} días`} de`} tu prueba gratis de FSV Search.`;
  } else if (plan.plan === "pro" && (sub === "paused" || sub === "cancelled")) {
    text = `Tu suscripción está ${sub === "paused" ? "pausada" : "cancelada"}: el plan sigue hasta el ${new Date(plan.planValidUntil).toLocaleDateString("es-CL")}.`;
    tone = "bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200";
  }
  if (!text) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm ${tone} ${className}`}>
      <span>{text}</span>
      <Link href={href} className="font-medium text-acc underline-offset-2 hover:underline">
        {plan.plan === "pro" ? "Ver plan" : `Activar por $${plan.priceClp.toLocaleString("es-CL")}/mes`}
      </Link>
    </div>
  );
}
