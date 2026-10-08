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
  const { id, project } = useProject();
  const [provider, setProvider] = useState("Cloudflare");
  return (
    <article className="mx-auto max-w-3xl space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Search Console desde cero</h1>
      <p>
        Search Console es gratuito y muestra cómo Google encuentra tu sitio:
        consultas, clics, impresiones, páginas indexadas y problemas de rastreo.
        SEOCHECK usa acceso de lectura para priorizar trabajo con datos de tu
        sitio.
      </p>
      <ol className="list-decimal space-y-4 pl-5">
        <li>
          <b>Usa una cuenta de Google del negocio.</b> Abre{" "}
          <a
            className="text-acc underline"
            href="https://search.google.com/search-console/welcome"
            target="_blank"
            rel="noreferrer"
          >
            Search Console
          </a>
          . Asegúrate de poder administrar el DNS de{" "}
          {project?.domain ?? "tu dominio"}.
        </li>
        <li>
          <b>Agrega una propiedad de Dominio.</b> Escribe solo{" "}
          {project?.domain ?? "ejemplo.cl"}, sin https:// ni rutas. La propiedad
          de dominio incluye http, https y subdominios. Si no controlas DNS, la
          alternativa es “Prefijo de URL” con la URL exacta y un método
          compatible con tu sitio.
        </li>
        <li>
          <b>Copia el TXT de verificación.</b> Google entrega un valor que
          comienza con <code>google-site-verification=</code>. Es único para tu
          propiedad. No uses un ejemplo ni lo recortes.
        </li>
        <li>
          <b>Agrega el TXT al proveedor DNS activo.</b> Sigue la guía del panel
          elegido debajo. No cambies nameservers, correo ni registros A/CNAME.
        </li>
        <li>
          <b>Verifica.</b> Vuelve a Google y pulsa Verificar. Si aún no lo
          detecta, espera la propagación. Conserva el TXT después: Google puede
          volver a comprobar la propiedad.
        </li>
        <li>
          <b>Envía tu sitemap.</b> En Search Console → Sitemaps, introduce su
          URL (por ejemplo sitemap.xml). Busca la ruta real en robots.txt; no
          todos los sitios usan el mismo nombre.
        </li>
        <li>
          <b>Conecta SEOCHECK.</b> Autoriza lectura con la misma cuenta.
          Selecciona la propiedad, sincroniza y revisa el resultado. Una
          propiedad nueva puede tardar varios días en mostrar datos; una
          sincronización vacía no significa que la conexión haya fallado.
        </li>
      </ol>
      <section className="card space-y-3 p-4">
        <label>
          Proveedor de DNS{" "}
          <select
            className="input mt-2"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            {Object.keys(DNS).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <ol className="list-decimal space-y-2 pl-5">
          {DNS[provider].map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>
      <section className="card p-4">
        <h2 className="font-semibold">Cómo debe quedar el registro</h2>
        <table className="tbl mt-2">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Host</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>TXT</td>
              <td>@ (raíz)</td>
              <td className="break-all">
                google-site-verification=TU_VALOR_DE_GOOGLE
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-sm text-ink-500">
          Ejemplo ilustrativo. Las etiquetas de cada panel pueden variar.
        </p>
      </section>
      <GscConnect />
      <p className="text-sm text-ink-500">
        Puedes continuar sin GSC: auditoría técnica, contenido y rankings siguen
        disponibles, pero no tendrás consultas reales, tráfico de Google ni
        prioridades basadas en impresiones.
      </p>
    </article>
  );
}
