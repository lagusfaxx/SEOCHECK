"use client";
import { useEffect, useState } from "react";
import { AuthForm, LoginLink, post } from "@/components/auth/AuthForm";

export default function Reset() {
  const [invite, setInvite] = useState(false);
  useEffect(() => setInvite(new URLSearchParams(window.location.search).get("invite") === "1"), []);
  return (
    <AuthForm
      title={invite ? "Bienvenido: elige tu contraseña" : "Elige una contraseña nueva"}
      intro={invite ? "Te invitaron a un equipo en SEOCHECK. Con esta contraseña vas a entrar de ahora en adelante." : "Al cambiarla se cierran las sesiones abiertas en otros dispositivos."}
      fields={[{ name: "password", label: "Contraseña", type: "password", autoComplete: "new-password", hint: "Mínimo 10 caracteres" }]}
      confirmPassword
      submit="Guardar y entrar"
      onSubmit={async (v) => {
        const token = new URLSearchParams(window.location.search).get("token") ?? "";
        await post("/api/auth/reset", { token, password: v.password });
        window.location.href = "/";
      }}
      footer={<LoginLink />}
    />
  );
}
