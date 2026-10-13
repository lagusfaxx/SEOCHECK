"use client";
import Link from "next/link";
import { AuthForm, backTo, post, useAuthConfig } from "@/components/auth/AuthForm";

export default function Login() {
  const cfg = useAuthConfig();
  const next = typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("next") ?? undefined;
  return (
    <AuthForm
      title="Bienvenido de vuelta"
      intro="Entra a tu cuenta de FSV Search."
      google={cfg?.google ? { label: "Continuar con Google", next } : null}
      fields={[
        { name: "email", label: "Correo", type: "email", autoComplete: "username" },
        { name: "password", label: "Contraseña", type: "password", autoComplete: "current-password" },
      ]}
      submit="Entrar"
      onSubmit={async (v) => {
        await post("/api/auth/login", v);
        window.location.href = backTo();
      }}
      below={
        <div className="mt-3 text-right text-sm">
          <Link className="text-acc" href="/forgot">¿Olvidaste tu contraseña?</Link>
        </div>
      }
      footer={cfg?.signup ? <>¿No tienes cuenta? <Link className="font-medium text-acc" href="/signup">Crea una gratis</Link></> : <>¿No tienes cuenta? <a className="font-medium text-acc" href="mailto:contacto@fsvc.cl">Pide acceso</a></>}
    />
  );
}
