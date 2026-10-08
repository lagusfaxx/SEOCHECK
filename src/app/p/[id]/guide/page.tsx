"use client";
import { useState } from "react";
import { useProject } from "@/components/Shell";
import { GscConnect } from "@/components/GscConnect";
const DNS: Record<string, string[]> = {
  "NIC Chile": [
    "Entra a nic.cl y abre Mis dominios. Selecciona el dominio .cl.",
    "Revisa los servidores DNS configurados. NIC Chile registra dominios: si el DNS está delegado a otro proveedor, el TXT se agrega allí, no en NIC.",
    "Abre el panel del proveedor que administra esos servidores y crea el TXT en la raíz (@). Si no tienes acceso, pide al responsable que agregue el valor completo.",
    "No cambies servidores DNS ni borres registros existentes para verificar Search Console.",
  ],
  Cloudflare: [
    "En dash.cloudflare.com selecciona tu dominio y entra en DNS → Records.",
    "Pulsa Add record y selecciona TXT. Name: @ (raíz). Content: el valor google-site-verification=… copiado de Google.",
    "Deja TTL en Auto y guarda. Los TXT no usan el proxy naranja.",
    "Regresa a Search Console y pulsa Verificar. Si falla, espera la propagación y comprueba que el registro esté en la zona correcta.",
  ],
  GoDaddy: [
    "Abre Mis productos → Dominios → Administrar DNS del dominio.",
    "Comprueba que los servidores de nombres sean administrados allí. Si están delegados, usa el proveedor indicado.",
    "Añade registro → TXT. Nombre/Host: @. Valor: google-site-verification=… completo. Mantén el TTL sugerido y guarda.",
    "No reemplaces el TXT de SPF ni otros registros. Regresa a Google para verificar.",
  ],
  Hostinger: [
    "En hPanel abre Dominios → dominio → DNS / Nameservers → DNS Zone Editor.",
    "Comprueba que el dominio use los DNS de Hostinger; si no, abre el proveedor activo.",
    "Agrega tipo TXT, nombre @ y el valor completo de verificación. Guarda sin modificar otros registros.",
    "Espera la propagación y vuelve a Verificar en Search Console.",
  ],
  "Google Domains / Squarespace": [
    "Google Domains migró a Squarespace Domains. Entra a domains.squarespace.com con la cuenta que recibió el dominio.",
    "Selecciona el dominio → DNS → DNS Settings → Custom Records.",
    "Añade TXT con Host @ y el texto google-site-verification=… completo.",
    "Si usas servidores de nombres personalizados, agrega el TXT en ese proveedor, no en Squarespace.",
  ],
  "Route 53": [
    "En AWS abre Route 53 → Hosted zones y selecciona la zona pública del dominio.",
    "Create record → TXT. Deja Record name vacío para la raíz; pega el valor de Google entre comillas si el editor lo exige.",
    "Usa la política Simple y guarda. No lo agregues a una zona privada.",
    "Comprueba que los nameservers del registrador correspondan a esta zona y vuelve a verificar.",
  ],
  Otro: [
    "Identifica quién administra los nameservers activos. El registrador y el proveedor DNS pueden ser distintos.",
    "Abre la zona DNS pública y crea un registro TXT en la raíz (@ o campo vacío según el panel).",
    "Pega exactamente google-site-verification=… y conserva los TXT existentes.",
    "Verifica en Google. Si no funciona, revisa el host (evita dominio.dominio), el valor y la propagación; esta puede tardar hasta 48 horas.",
  ],
};
export default function Guide() {
  const { project } = useProject();
  const [provider, setProvider] = useState("Cloudflare");
  const [step, setStep] = useState(0);
  const steps = [
    {
      title: "Crea la propiedad",
      content: (
        <>
          <a
            className="btn-p inline-flex"
            href="https://search.google.com/search-console/welcome"
            target="_blank"
            rel="noreferrer"
          >
            Abrir Search Console
          </a>
          <p className="mt-3">
            Elige “Dominio” y escribe <b>{project?.domain ?? "ejemplo.cl"}</b>,
            sin https:// ni rutas.
          </p>
          <details className="mt-3 text-sm">
            <summary>No tengo acceso al DNS</summary>
            <p>
              Elige “Prefijo de URL” y usa la dirección exacta de tu sitio.
              Google te ofrecerá otros métodos de verificación.
            </p>
          </details>
        </>
      ),
    },
    {
      title: "Verifica tu dominio",
      content: (
        <>
          <p>
            Copia el valor <code>google-site-verification=…</code> que te
            entrega Google.
          </p>
          <label className="mt-3 block text-sm">
            Proveedor DNS
            <select
              className="input mt-1"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {Object.keys(DNS).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
            {DNS[provider].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-ink-500">
            Vuelve a Google y pulsa Verificar. Conserva el TXT.
          </p>
          <details className="mt-3 text-sm">
            <summary>Google no encuentra el registro</summary>
            <p>
              Comprueba el proveedor DNS activo, el host raíz (@) y el valor
              completo. La propagación puede tardar hasta 48 horas. Conserva los
              registros existentes.
            </p>
          </details>
        </>
      ),
    },
    {
      title: "Conecta SEOCHECK",
      content: (
        <>
          <GscConnect />
          <details className="mt-3 text-sm">
            <summary>Enviar sitemap y esperar datos</summary>
            <p>
              En Search Console → Sitemaps envía la ruta indicada en robots.txt.
              Una propiedad nueva puede tardar varios días en mostrar consultas
              y clics.
            </p>
          </details>
        </>
      ),
    },
  ];
  return (
    <article className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Conectar Search Console</h1>
      <nav className="flex flex-wrap gap-2" aria-label="Pasos de conexión">
        {steps.map((s, i) => (
          <button
            key={s.title}
            className={step === i ? "btn-p" : "btn"}
            aria-current={step === i ? "step" : undefined}
            onClick={() => setStep(i)}
          >
            {i + 1}. {s.title}
          </button>
        ))}
      </nav>
      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">{steps[step].title}</h2>
        {steps[step].content}
      </section>
      <div className="flex justify-between">
        <button
          className="btn"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          Anterior
        </button>
        {step < 2 && (
          <button className="btn-p" onClick={() => setStep(step + 1)}>
            Siguiente
          </button>
        )}
      </div>
    </article>
  );
}
