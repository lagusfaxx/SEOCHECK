import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL } from "@/components/site/Footer";
import { LegalPage } from "@/components/site/Legal";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description: "Cómo FSV trata los datos personales en FSV Search, incluida la integración con Instagram.",
};

const UPDATED = "13 de octubre de 2026";

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Quiénes somos",
    body: (
      <p>
        FSV Search es una plataforma de SEO y contenido operada por FSV (razón social Full Stack Ventures SpA), Santiago de Chile (&quot;nosotros&quot;). Esta política explica qué datos tratamos, para qué y cómo puedes
        ejercer tus derechos. Contacto: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    ),
  },
  {
    title: "Datos que tratamos",
    body: (
      <ul>
        <li><b>Cuenta:</b> nombre, correo y contraseña (guardada como hash) de quienes usan la plataforma. Si entras con Google, recibimos tu nombre, correo y un identificador de tu cuenta de Google; nunca tu contraseña.</li>
        <li><b>Proyectos:</b> dominios, keywords, auditorías, rankings y contenidos que cargas o generas.</li>
        <li><b>Google Search Console</b> (si lo conectas): métricas de búsqueda de tus propiedades, con el acceso que autorizas por OAuth.</li>
        <li>
          <b>Instagram</b> (si conectas una cuenta profesional mediante Instagram Login): ID y nombre de usuario de la cuenta, el token de acceso (cifrado), la lista de tus publicaciones (texto,
          tipo, enlace y fecha) y sus estadísticas (alcance, me gusta, comentarios, guardados, compartidos e interacciones). No leemos mensajes directos ni datos de otras personas.
        </li>
        <li><b>Contenido para redes:</b> textos, prompts e imágenes que generas o subes para tus publicaciones.</li>
        <li><b>Pagos:</b> los procesa Stripe; no almacenamos datos de tarjetas.</li>
      </ul>
    ),
  },
  {
    title: "Para qué los usamos",
    body: (
      <ul>
        <li>Prestar el servicio: análisis SEO, reportes y recomendaciones para tus proyectos.</li>
        <li>Publicar en tu cuenta de Instagram las publicaciones que tú creas, inmediatamente o en la fecha que programes. Nunca publicamos sin una acción tuya.</li>
        <li>Mostrarte el rendimiento de tus publicaciones y sugerirte textos, hashtags y horarios a partir de lo que mejor funcionó en tu propia cuenta.</li>
        <li>Seguridad, soporte y cumplimiento legal.</li>
      </ul>
    ),
  },
  {
    title: "Con quién los compartimos",
    body: (
      <>
        <p>No vendemos ni arrendamos datos personales. Solo los compartimos con proveedores que necesitamos para operar, bajo sus propias políticas:</p>
        <ul>
          <li>Proveedores de inteligencia artificial (OpenAI o Anthropic) para generar textos e imágenes: reciben el contexto, las keywords, la foto de referencia que subas y, para sugerir textos, los textos de tus publicaciones con mejor rendimiento.</li>
          <li>Meta (Instagram) para publicar y leer estadísticas de tu cuenta.</li>
          <li>Infraestructura y servicios de correo (Resend) y pagos (Stripe).</li>
        </ul>
      </>
    ),
  },
  {
    title: "Cuánto tiempo los guardamos",
    body: (
      <p>
        Los datos de Instagram se guardan mientras la cuenta esté conectada. Al desconectarla en FSV Search, al quitar la app desde la configuración de Instagram o al pedir su eliminación, borramos el
        token y las estadísticas de inmediato. Los datos de tu cuenta y proyectos se conservan mientras uses el servicio y se eliminan cuando lo solicitas, salvo lo que la ley obligue a conservar.
      </p>
    ),
  },
  {
    title: "Seguridad",
    body: <p>Los tokens de acceso de Google e Instagram se guardan cifrados (AES-256-GCM). El acceso a cada proyecto está restringido a los usuarios de su espacio de trabajo.</p>,
  },
  {
    title: "Tus derechos y eliminación de datos",
    body: (
      <p>
        Puedes pedir acceso, rectificación, eliminación u oposición al tratamiento de tus datos escribiendo a <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Para borrar los datos obtenidos de
        Instagram sigue las <Link href="/privacidad/eliminacion">instrucciones de eliminación de datos</Link>.
      </p>
    ),
  },
  {
    title: "Cambios",
    body: <p>Si cambiamos esta política publicaremos la nueva versión en esta página con su fecha de actualización.</p>,
  },
];

export default function PrivacidadPage() {
  return <LegalPage title="Política de privacidad" updated={UPDATED} sections={SECTIONS} />;
}
