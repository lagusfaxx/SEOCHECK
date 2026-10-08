"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { IconBadge, Spinner } from "../ui";

type Field = { name: string; label: string; type?: string; autoComplete?: string; hint?: string };

/** Formulario de acceso: campos, error claro y botón deshabilitado mientras envía. */
export function AuthForm({
  title, intro, fields, submit, onSubmit, footer, confirmPassword,
}: {
  title: string;
  intro?: ReactNode;
  fields: Field[];
  submit: string;
  onSubmit: (v: Record<string, string>) => Promise<string | void>;
  footer?: ReactNode;
  /** pide repetir el campo "password" */
  confirmPassword?: boolean;
}) {
  const [v, setV] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="grid min-h-screen place-items-center bg-ink-50 p-4 dark:bg-ink-950">
      <form
        className="card anim-in w-full max-w-sm space-y-4 p-6 shadow-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          setMsg("");
          if (confirmPassword && v.password !== v.password2) return setErr("Las contraseñas no coinciden");
          setBusy(true);
          try {
            const m = await onSubmit(v);
            if (m) setMsg(m);
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="ic-float"><IconBadge name="search" anim="draw" pulse /></span>
            <span className="text-sm font-semibold tracking-wide text-acc">SEOCHECK</span>
          </div>
          <h1 className="text-lg font-semibold">{title}</h1>
          {intro && <p className="mt-1 text-sm text-ink-500">{intro}</p>}
        </div>
        {[...fields, ...(confirmPassword ? [{ name: "password2", label: "Repite la contraseña", type: "password", autoComplete: "new-password" }] : [])].map((f) => (
          <label key={f.name} className="block text-sm">
            <span className="text-ink-600 dark:text-ink-300">{f.label}</span>
            <input
              className="input mt-1"
              type={f.type ?? "text"}
              autoComplete={f.autoComplete}
              required={f.name !== "name"}
              value={v[f.name] ?? ""}
              onChange={(e) => setV({ ...v, [f.name]: e.target.value })}
            />
            {"hint" in f && f.hint && <span className="mt-0.5 block text-xs text-ink-400">{f.hint}</span>}
          </label>
        ))}
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{err}</div>}
        {msg && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">{msg}</div>}
        <button className="btn-p w-full justify-center" disabled={busy}>{busy ? <Spinner className="h-4 w-4" /> : submit}</button>
        {footer && <div className="text-center text-sm text-ink-500">{footer}</div>}
      </form>
    </main>
  );
}

export async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "Algo falló, intenta de nuevo");
  return j;
}

export const backTo = () => {
  const n = new URLSearchParams(window.location.search).get("next");
  // solo rutas internas (evita redirecciones abiertas a otros sitios)
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/";
};

export const LoginLink = () => <Link className="text-acc" href="/login">Volver a iniciar sesión</Link>;
