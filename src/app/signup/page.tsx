"use client";
import Link from "next/link";
import { AuthForm, LoginLink, post, useAuthConfig } from "@/components/auth/AuthForm";

export default function Signup() {
  const cfg = useAuthConfig();
  if (cfg && !cfg.signup)
    return (
      <AuthForm
        title="El registro está cerrado"
        intro="Por ahora FSV Search funciona por invitación. Escríbenos a contacto@fsvc.cl y te damos acceso."
        fields={[]}
        submit="Escribir a contacto@fsvc.cl"
        onSubmit={async () => {
          window.location.href = "mailto:contacto@fsvc.cl?subject=Acceso%20a%20FSV%20Search";
        }}
        footer={<LoginLink />}
      />
    );
  return (
    <AuthForm
      title="Crea tu cuenta"
      intro={cfg?.trialDays ? `${cfg.trialDays} días gratis. Sin tarjeta de crédito.` : "Gratis durante la beta. Sin tarjeta de crédito."}
      google={cfg?.google ? { label: "Registrarme con Google", next: "/app" } : null}
      fields={[
        { name: "name", label: "Nombre", autoComplete: "name" },
        { name: "company", label: "Empresa o sitio", autoComplete: "organization", optional: true, hint: "Opcional: así se llamará tu espacio de trabajo" },
        { name: "email", label: "Correo", type: "email", autoComplete: "username" },
        { name: "password", label: "Contraseña", type: "password", autoComplete: "new-password", hint: "Mínimo 10 caracteres" },
        {
          name: "terms",
          type: "checkbox",
          label: (
            <>
              Acepto los <Link className="text-acc underline" href="/terminos" target="_blank">términos de servicio</Link> y la{" "}
              <Link className="text-acc underline" href="/privacidad" target="_blank">política de privacidad</Link>.
            </>
          ),
        },
      ]}
      submit="Crear cuenta"
      onSubmit={async (v) => {
        await post("/api/auth/signup", { name: v.name, company: v.company, email: v.email, password: v.password, terms: v.terms === "1" });
        window.location.href = "/app?welcome=1";
      }}
      footer={<>¿Ya tienes cuenta? <Link className="font-medium text-acc" href="/login">Inicia sesión</Link></>}
    />
  );
}
