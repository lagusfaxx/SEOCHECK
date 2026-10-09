"use client";
import { AuthForm, post } from "@/components/auth/AuthForm";

export default function Setup() {
  return (
    <AuthForm
      title="Crea la cuenta de administrador"
      intro="Es la primera vez que se abre esta instalación. Esta cuenta será la dueña de los proyectos que ya existan."
      fields={[
        { name: "name", label: "Nombre (opcional)", autoComplete: "name" },
        { name: "email", label: "Email", type: "email", autoComplete: "username" },
        { name: "password", label: "Contraseña", type: "password", autoComplete: "new-password", hint: "Mínimo 10 caracteres" },
      ]}
      confirmPassword
      submit="Crear cuenta"
      onSubmit={async (v) => {
        await post("/api/auth/setup", v);
        window.location.href = "/app";
      }}
    />
  );
}
