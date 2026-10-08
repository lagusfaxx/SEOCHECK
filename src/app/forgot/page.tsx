"use client";
import { AuthForm, LoginLink, post } from "@/components/auth/AuthForm";

export default function Forgot() {
  return (
    <AuthForm
      title="Recuperar contraseña"
      intro="Te mandamos un link para elegir una contraseña nueva. Vence en 1 hora."
      fields={[{ name: "email", label: "Email", type: "email", autoComplete: "username" }]}
      submit="Enviar link"
      onSubmit={async (v) => (await post("/api/auth/forgot", v)).message}
      footer={<LoginLink />}
    />
  );
}
