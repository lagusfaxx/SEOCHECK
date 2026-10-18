"use client";
import { useEffect, useState } from "react";
import { useProject } from "./Shell";
import { api, fmtDate, Spinner, useApi } from "./ui";

const clp = (n: number) => `$${n.toLocaleString("es-CL")}`;
const METERS = [
  ["projects", "Perfiles", false],
  ["research", "Investigaciones de keywords", true],
  ["keywords", "Keywords guardadas", false],
  ["rankings", "Keywords en seguimiento", false],
  ["briefs", "Briefs de contenido", true],
  ["reports", "Informes", true],
  ["images", "Imágenes con IA", true],
  ["ai", "Textos con IA", true],
] as const;

/** Uso del plan: lo que se cuenta por mes (o por toda la prueba) y lo que se cuenta por lo guardado. */
function Meters({ plan }: { plan: any }) {
  const period = plan.plan === "trial" ? "en la prueba" : "este mes";
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {METERS.map(([k, label, monthly]) => {
        const used = plan.usage?.[k] ?? 0, max = plan.limits[k];
        const unlimited = max >= 1_000_000, ratio = unlimited ? 0 : Math.min(1, used / Math.max(1, max));
        return (
          <div key={k} className="rounded-lg border border-ink-100 px-3 py-2 dark:border-ink-800">
            <div className="text-xs text-ink-500">{label}{monthly && <span className="text-ink-400"> · {period}</span>}</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums">{used.toLocaleString("es-CL")} <span className="font-normal text-ink-400">/ {unlimited ? "sin límite" : max.toLocaleString("es-CL")}</span></div>
            {!unlimited && <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800"><div className={`h-full rounded-full ${k === "projects" ? "bg-acc" : ratio >= 1 ? "bg-rose-500" : ratio >= 0.8 ? "bg-amber-400" : "bg-acc"}`} style={{ width: `${ratio * 100}%` }} /></div>}
          </div>
        );
      })}
    </div>
  );
}

function SeatPicker({ value, onChange, min }: { value: number; onChange: (n: number) => void; min: number }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-ink-200 dark:border-ink-700">
      <button type="button" className="px-3 py-1.5 text-lg leading-none disabled:opacity-40" disabled={value <= Math.max(1, min)} onClick={() => onChange(value - 1)} aria-label="Menos perfiles">−</button>
      <span className="w-10 text-center font-semibold tabular-nums">{value}</span>
      <button type="button" className="px-3 py-1.5 text-lg leading-none disabled:opacity-40" disabled={value >= 20} onClick={() => onChange(value + 1)} aria-label="Más perfiles">+</button>
    </div>
  );
}

/** Ajustes → Plan: estado, uso y suscripción con Mercado Pago. */
function PlanSection({ id, plan, billing, refresh }: { id: string; plan: any; billing: any; refresh: () => Promise<unknown> }) {
  const [seats, setSeats] = useState(1);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const sub = plan.subscription?.status as string | undefined;
  const active = plan.plan === "pro" && sub === "authorized";
  const minSeats = plan.usage?.projects ?? 1;
  useEffect(() => {
    setSeats(Math.max(plan.seats ?? 1, minSeats, 1));
  }, [plan.seats, minSeats]);

  // vuelta desde Mercado Pago: confirmar sin esperar el webhook
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("checkout") !== "mp") return;
    const preapprovalId = q.get("preapproval_id") ?? undefined;
    window.history.replaceState(null, "", window.location.pathname);
    setNote("Confirmando tu suscripción con Mercado Pago…");
    let tries = 0;
    const tick = async () => {
      const r = await api(`/api/p/${id}/billing/sync`, "POST", { preapprovalId }).catch(() => null);
      const p: any = await refresh();
      if (p?.subscription?.status === "authorized") return setNote("¡Listo! Tu suscripción está activa.");
      if (++tries < 6 && r) setTimeout(tick, 4000);
      else setNote("Mercado Pago todavía no confirma el pago. Si lo completaste, se activará en unos minutos.");
    };
    tick();
  }, [id, refresh]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const status = plan.expired
    ? ["Vencido", "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"]
    : plan.plan === "trial"
      ? [`Prueba hasta el ${fmtDate(plan.trialEndsAt)}`, "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"]
      : sub === "cancelled" || sub === "paused"
        ? [`${sub === "paused" ? "Pausada" : "Cancelada"} · vigente hasta el ${fmtDate(plan.planValidUntil)}`, "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200"]
        : ["Activo", "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">{plan.limits.label}</span>
        {billing?.enabled && plan.plan !== "internal" && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status[1]}`}>{status[0]}</span>}
      </div>
      {!billing?.enabled && (
        <p className="text-sm text-ink-600 dark:text-ink-300">
          FSV Search es gratis mientras dure la beta. Si necesitas más capacidad, escríbenos a <a className="text-acc underline" href="mailto:contacto@fsvc.cl">contacto@fsvc.cl</a>.
        </p>
      )}
      {plan.expired && plan.plan === "trial" && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">Terminaron tus 7 días gratis. Activa FSV Search para seguir creando auditorías, briefs, imágenes y publicaciones; tus datos siguen guardados.</p>}
      <Meters plan={plan} />
      {note && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">{note}</p>}

      {billing?.enabled && plan.plan !== "internal" && (active ? (
        <div className="rounded-xl border border-ink-100 p-4 dark:border-ink-800">
          <div className="text-sm">Suscripción mensual con Mercado Pago · <b>{plan.seats} {plan.seats === 1 ? "perfil" : "perfiles"}</b> · <b>{clp(plan.priceClp * plan.seats)}</b> al mes</div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <SeatPicker value={seats} onChange={setSeats} min={minSeats} />
            <button className="btn" disabled={!!busy || seats === plan.seats} onClick={() => run("seats", async () => { await api(`/api/p/${id}/billing/seats`, "POST", { seats }); await refresh(); setNote(`Desde el próximo cobro pagarás ${clp(plan.priceClp * seats)} al mes.`); })}>
              {busy === "seats" ? <Spinner /> : `Cambiar a ${seats} ${seats === 1 ? "perfil" : "perfiles"} (${clp(plan.priceClp * seats)}/mes)`}
            </button>
            <button className="btn-g text-rose-600" disabled={!!busy} onClick={() => confirm("¿Cancelar la suscripción? No se te volverá a cobrar y el plan sigue hasta el fin del periodo pagado.") && run("cancel", async () => { await api(`/api/p/${id}/billing/cancel`, "POST", {}); await refresh(); })}>
              {busy === "cancel" ? <Spinner /> : "Cancelar suscripción"}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-acc/30 bg-acc/5 p-4">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">FSV Search</span>
            <span className="text-2xl font-semibold tabular-nums">{clp(plan.priceClp)}</span>
            <span className="text-sm text-ink-500">al mes por perfil</span>
          </div>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
            Cada perfil (un sitio o marca) incluye al mes: {plan.plans.pro.research} investigaciones de keywords, {plan.plans.pro.briefs} briefs, {plan.plans.pro.reports} informes, {plan.plans.pro.images} imágenes y {plan.plans.pro.ai} textos con IA, {plan.plans.pro.rankings} keywords en seguimiento y auditorías de hasta {plan.plans.pro.urls.toLocaleString("es-CL")} páginas.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-ink-500">Perfiles</span>
              <SeatPicker value={seats} onChange={setSeats} min={minSeats} />
            </label>
            <label className="min-w-[14rem] flex-1 text-sm">
              <span className="mb-1 block text-xs text-ink-500">Correo de tu cuenta de Mercado Pago (si es distinto)</span>
              <input className="input" type="email" placeholder="el mismo de FSV Search" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn-p" disabled={!!busy || !billing.configured} onClick={() => run("checkout", async () => { const s = await api(`/api/p/${id}/billing/checkout`, "POST", { seats, payerEmail: email }); window.location.assign(s.url); })}>
              {busy === "checkout" ? <Spinner /> : `Pagar ${clp(plan.priceClp * seats)}/mes con Mercado Pago`}
            </button>
          </div>
          <p className="mt-3 text-xs text-ink-500">
            El cobro es automático cada mes con tu tarjeta de crédito o débito en Mercado Pago. Puedes cancelar cuando quieras desde aquí y el plan sigue hasta el fin del periodo pagado.
            {!billing.configured && " Los pagos se están configurando: vuelve a intentarlo en unas horas."}
          </p>
        </div>
      ))}
      {err && <p role="alert" className="text-sm text-rose-700">{err}</p>}
    </div>
  );
}
export function CommercialSettings() {
  const { id, project } = useProject();
  const { data: plan, mutate } = useApi<any>(`/api/p/${id}/plan`);
  const { data: billing } = useApi<any>(`/api/p/${id}/billing/config`);
  const { data: costs } = useApi<any>(project?.admin ? `/api/p/${id}/costs/jobs` : null);
  const [branding, setBranding] = useState({
    name: "",
    contact: "",
    color: "#5151db",
    logo: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (plan?.branding)
      setBranding({
        name: plan.branding.name ?? "",
        contact: plan.branding.contact ?? "",
        color: plan.branding.color ?? "#5151db",
        logo: plan.branding.logo ?? "",
      });
  }, [plan]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section id="plan" className="card scroll-mt-4 space-y-4 p-4">
      <h2 className="font-semibold">Plan</h2>
      {plan && <PlanSection id={id} plan={plan} billing={billing} refresh={mutate} />}
      {plan?.limits.whiteLabel ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api(`/api/p/${id}/branding`, "PATCH", branding);
              await mutate();
            });
          }}
        >
          <h3 className="font-semibold">Marca de la agencia (PDF ejecutivo)</h3>
          <input
            className="input"
            maxLength={100}
            required
            placeholder="Nombre de la agencia"
            value={branding.name}
            onChange={(e) => setBranding({ ...branding, name: e.target.value })}
          />
          <input
            className="input"
            maxLength={500}
            placeholder="Contacto y datos de la agencia"
            value={branding.contact}
            onChange={(e) =>
              setBranding({ ...branding, contact: e.target.value })
            }
          />
          <label className="flex gap-2 text-sm">
            Color{" "}
            <input
              type="color"
              value={branding.color}
              onChange={(e) =>
                setBranding({ ...branding, color: e.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            Logo PNG/JPEG (hasta 350 KB)
            <input
              className="input"
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 350000) {
                  setError("El logo supera 350 KB");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () =>
                  setBranding({ ...branding, logo: String(reader.result) });
                reader.readAsDataURL(f);
              }}
            />
          </label>
          <button
            className="btn"
            type="button"
            onClick={() => setBranding({ ...branding, logo: "" })}
          >
            Quitar logo
          </button>
          <button className="btn-p" disabled={busy}>
            Guardar marca
          </button>
        </form>
      ) : null}
      {project?.admin && <details>
        <summary className="cursor-pointer text-sm">
          Costo real por trabajo (solo administradores)
        </summary>
        <p className="my-2 text-xs text-ink-500">{costs?.note}</p>
        <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Tipo de trabajo</th>
              <th>Trabajos</th>
              <th>USD de proveedores</th>
            </tr>
          </thead>
          <tbody>
            {costs?.byKind.map((c: any) => (
              <tr key={c.kind}>
                <td>{c.kind}</td>
                <td>{c.jobs}</td>
                <td>${c.costUsd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="overflow-x-auto">
        <table className="tbl mt-3">
          <thead>
            <tr>
              <th>Trabajo</th>
              <th>Estado</th>
              <th>USD</th>
            </tr>
          </thead>
          <tbody>
            {costs?.jobs.slice(0, 20).map((j: any) => (
              <tr key={j.id}>
                <td>
                  {j.kind} · {new Date(j.createdAt).toLocaleDateString("es-CL")}
                </td>
                <td>{j.status}</td>
                <td>
                  {j.costUsd == null
                    ? "Sin costo registrado"
                    : `$${j.costUsd.toFixed(4)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </details>}
      {error && (
        <p role="alert" className="text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}
