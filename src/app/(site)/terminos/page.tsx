import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL } from "@/components/site/Footer";
import { LegalPage } from "@/components/site/Legal";

export const metadata: Metadata = {
  title: "Términos de servicio",
  description: "Condiciones de uso de FSV Search, la plataforma de SEO de FSV.",
};

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "El servicio",
    body: (
      <p>
        FSV Search es una plataforma de SEO técnico, análisis de keywords, seguimiento de posiciones y creación de contenido, operada por FSV (razón social Full Stack Ventures SpA), Santiago de Chile. Al crear una
        cuenta o usar el servicio aceptas estos términos y la <Link href="/privacidad">política de privacidad</Link>.
      </p>
    ),
  },
  {
    title: "Planes, prueba y pagos",
    body: (
      <>
        <p>
          Al crear tu cuenta tienes una prueba gratuita de 7 días, sin tarjeta, con límites de uso reducidos. Después, el plan FSV Search se contrata por perfil (un sitio o marca) con un precio
          mensual publicado en fsvc.cl/search. Cada plan tiene límites de uso mensuales (por ejemplo investigaciones de keywords, briefs, informes, imágenes y textos con IA) que se renuevan cada mes
          calendario y no son acumulables.
        </p>
        <p className="mt-3">
          El pago se hace con Mercado Pago mediante una suscripción que cobra automáticamente cada mes el medio de pago que autorices. Puedes cancelarla en cualquier momento desde Ajustes → Plan: no
          se te volverá a cobrar y el plan sigue vigente hasta el fin del periodo pagado. Los periodos ya pagados no se reembolsan, salvo cuando la ley lo exija. Nunca te cobraremos sin que
          contrates un plan de forma expresa, y te avisaremos con anticipación de cualquier cambio de precio.
        </p>
      </>
    ),
  },
  {
    title: "Tu cuenta",
    body: (
      <ul>
        <li>Debes entregar un correo válido y mantener segura tu contraseña. Eres responsable de lo que se haga con tu cuenta.</li>
        <li>Solo puedes analizar sitios y conectar cuentas (Google, Instagram) que te pertenezcan o que estés autorizado a gestionar.</li>
        <li>Puedes invitar a personas de tu equipo; cada una acepta estos términos al entrar.</li>
      </ul>
    ),
  },
  {
    title: "Uso aceptable",
    body: (
      <ul>
        <li>No uses el servicio para atacar, saturar o rastrear sitios de terceros sin permiso, ni para enviar spam o publicar contenido ilegal o engañoso.</li>
        <li>No intentes acceder a datos de otras cuentas, evadir los límites de uso ni automatizar el registro de cuentas.</li>
        <li>Podemos suspender cuentas que incumplan estas reglas o pongan en riesgo el servicio.</li>
      </ul>
    ),
  },
  {
    title: "Tu contenido y tus datos",
    body: (
      <p>
        Los datos de tus sitios, los textos e imágenes que generas y lo que publicas siguen siendo tuyos. Nos das permiso para procesarlos solo para prestarte el servicio. El contenido generado con
        inteligencia artificial puede contener errores: revísalo antes de publicarlo. Tú decides qué se publica en tus cuentas.
      </p>
    ),
  },
  {
    title: "Servicios de terceros",
    body: (
      <p>
        Algunas funciones dependen de Google (Search Console), Meta (Instagram) y proveedores de datos e inteligencia artificial. Su disponibilidad y sus condiciones no dependen de nosotros; si uno
        cambia o deja de funcionar, la función relacionada puede verse afectada.
      </p>
    ),
  },
  {
    title: "Disponibilidad y responsabilidad",
    body: (
      <p>
        Hacemos nuestro mejor esfuerzo para que el servicio funcione de forma continua y segura, pero se entrega &quot;tal cual&quot;, sin garantías de disponibilidad ni de resultados
        en buscadores. En la medida que la ley lo permita, no respondemos por pérdidas indirectas, de ingresos o de posicionamiento derivadas del uso del servicio.
      </p>
    ),
  },
  {
    title: "Término",
    body: (
      <p>
        Puedes dejar de usar el servicio y pedir que eliminemos tu cuenta en cualquier momento escribiendo a <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Nosotros podemos terminar o
        suspender cuentas por incumplimiento de estos términos.
      </p>
    ),
  },
  {
    title: "Cambios y ley aplicable",
    body: (
      <p>
        Si cambiamos estos términos publicaremos la nueva versión aquí con su fecha y, si el cambio es importante, te avisaremos por correo. Se rigen por las leyes de Chile. Consultas:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    ),
  },
];

export default function TerminosPage() {
  return <LegalPage title="Términos de servicio" updated="14 de octubre de 2026" sections={SECTIONS} />;
}
