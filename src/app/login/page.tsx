"use client";
import Link from "next/link";
import { useEffect } from "react";
import { AuthForm, backTo, post } from "@/components/auth/AuthForm";

export default function Login() {
  // instancia nueva sin usuarios: ir a crear el dueño
  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((j) => {
      if (j.user) window.location.href = backTo();
      else if (j.setup) window.location.href = "/setup";
    }).catch(() => {});
  }, []);
  return (
    <AuthForm
      title="Iniciar sesión"
      fields={[
        { name: "email", label: "Email", type: "email", autoComplete: "username" },
        { name: "password", label: "Contraseña", type: "password", autoComplete: "current-password" },
      ]}
      submit="Entrar"
      onSubmit={async (v) => {
        await post("/api/auth/login", v);
        window.location.href = backTo();
      }}
      footer={<Link className="text-acc" href="/forgot">¿Olvidaste tu contraseña?</Link>}
    />
  );
}
