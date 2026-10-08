"use client";
import { useEffect, useState } from "react";
import { useProject } from "./Shell";
import { api, useApi } from "./ui";
export function CommercialSettings() {
  const { id } = useProject();
  const { data: plan, mutate } = useApi<any>(`/api/p/${id}/plan`);
  const { data: billing } = useApi<any>(`/api/p/${id}/billing/config`);
  const { data: costs } = useApi<any>(`/api/p/${id}/costs/jobs`);
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
    <section className="card space-y-4 p-4">
      <h2 className="font-semibold">Plan, informes y costos</h2>
      {plan && (
        <>
          <p className="text-sm">
            Plan actual: <b>{plan.limits.label}</b> · {plan.reportCredits ?? 0}{" "}
            informes sueltos disponibles{plan.expired && " · Expirado"}
            {plan.plan === "trial" &&
              ` · termina ${new Date(plan.trialEndsAt).toLocaleDateString("es-CL")}`}
          </p>
          <table className="tbl">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Proyectos</th>
                <th>URLs/crawl</th>
                <th>Keywords</th>
                <th>Rankings</th>
                <th>Briefs</th>
                <th>Informes</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(plan.plans).map(([k, p]: [string, any]) => (
                <tr key={k}>
                  <td>{p.label}</td>
                  <td>{p.projects}</td>
                  <td>{p.urls}</td>
                  <td>{p.keywords}</td>
                  <td>{p.rankings}</td>
                  <td>{p.briefs}</td>
                  <td>{p.reports}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-ink-500">
            Los límites de proyectos, keywords y rankings se comparten en el
            workspace. Briefs e informes se cuentan por mes UTC en planes pagos
            y por toda la prueba gratuita. No hay planes ilimitados.
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {["seo", "agency", "report"].map((product) => (
          <button
            className="btn"
            key={product}
            disabled={
              busy ||
              !billing?.configured ||
              !billing?.products.find((p: any) => p.product === product)
                ?.available
            }
            onClick={() =>
              run(async () => {
                const s = await api(`/api/p/${id}/billing/checkout`, "POST", {
                  product,
                });
                window.location.assign(s.url);
              })
            }
          >
            {product === "report"
              ? "Comprar informe suelto"
              : product === "agency"
                ? "Suscripción Agencia"
                : "Suscripción SEO"}
          </button>
        ))}
        <button
          className="btn"
          disabled={busy || !billing?.configured}
          onClick={() =>
            run(async () => {
              const s = await api(`/api/p/${id}/billing/portal`, "POST", {});
              window.location.assign(s.url);
            })
          }
        >
          Administrar suscripción
        </button>
      </div>
      {!billing?.configured && (
        <p className="text-sm text-ink-500">
          Los cobros están pendientes de activación. Los importes se definirán
          en Stripe antes de habilitar la compra.
        </p>
      )}
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
      ) : (
        <p className="text-sm text-ink-500">
          Logo, colores y datos de la agencia en informes: exclusivos del plan
          Agencia.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">
          Costo real por trabajo
        </summary>
        <p className="my-2 text-xs text-ink-500">{costs?.note}</p>
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
      </details>
      {error && (
        <p role="alert" className="text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}
