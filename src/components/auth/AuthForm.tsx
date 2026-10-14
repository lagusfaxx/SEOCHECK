"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, Spinner } from "../ui";

type Field = { name: string; label: ReactNode; type?: "text" | "email" | "password" | "checkbox"; autoComplete?: string; hint?: string; optional?: boolean };

const POINTS = [
  ["audit", "Auditoría técnica", "Encuentra lo que frena a tu sitio en Google."],
  ["gsc", "Datos reales de Search Console", "Clics, impresiones y oportunidades por página."],
  ["bolt", "Tareas priorizadas", "Qué arreglar primero, explicado para tu equipo."],
] as const;

/** Puntaje simple de contraseña (0–4): largo y variedad de caracteres. */
function strength(pw: string): number {
  if (!pw) return 0;
  let s = pw.length >= 10 ? 1 : 0;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
const STRENGTH = [
  ["Muy corta", "bg-rose-500"],
  ["Débil", "bg-rose-500"],
  ["Aceptable", "bg-amber-400"],
  ["Buena", "bg-emerald-500"],
  ["Muy buena", "bg-emerald-600"],
] as const;

function PasswordInput({ value, onChange, autoComplete, isNew }: { value: string; onChange: (v: string) => void; autoComplete?: string; isNew: boolean }) {
  const [show, setShow] = useState(false);
  const s = strength(value);
  return (
    <>
      <div className="relative mt-1">
        <input className="input pr-10" type={show ? "text" : "password"} autoComplete={autoComplete} required value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => setShow(!show)} className="absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-400 hover:text-ink-700" aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} title={show ? "Ocultar" : "Mostrar"}>
          <Icon name={show ? "eyeOff" : "eye"} />
        </button>
      </div>
      {isNew && value && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex flex-1 gap-1">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i <= s ? STRENGTH[s][1] : "bg-ink-200 dark:bg-ink-700"}`} />
            ))}
          </div>
          <span className="w-20 text-right text-xs text-ink-500">{STRENGTH[s][0]}</span>
        </div>
      )}
    </>
  );
}

export function GoogleButton({ label, next }: { label: string; next?: string }) {
  return (
    <a href={`/api/auth/google-login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="btn w-full justify-center border border-ink-200 bg-white py-2.5 text-ink-800 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100">
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
      </svg>
      {label}
    </a>
  );
}

/** Pantallas de acceso: panel de marca + formulario con errores claros. */
export function AuthForm({
  title, intro, fields, submit, onSubmit, footer, confirmPassword, google, below,
}: {
  title: string;
  intro?: ReactNode;
  fields: Field[];
  submit: string;
  onSubmit: (v: Record<string, string>) => Promise<string | void>;
  footer?: ReactNode;
  /** pide repetir el campo "password" */
  confirmPassword?: boolean;
  /** botón "Continuar con Google" arriba del formulario */
  google?: { label: string; next?: string } | null;
  below?: ReactNode;
}) {
  const [v, setV] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // errores que vuelven por URL (p. ej. desde Google)
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("error");
    if (e) setErr(e);
  }, []);

  const all: Field[] = [...fields, ...(confirmPassword ? [{ name: "password2", label: "Repite la contraseña", type: "password" as const, autoComplete: "new-password" }] : [])];

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_1fr] dark:bg-ink-950">
      <aside className="relative hidden overflow-hidden bg-[#0f0f1a] p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-[#5151db]/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-48 -left-24 h-[24rem] w-[24rem] rounded-full bg-[#5151db]/20 blur-3xl" />
        <Link href="/search" className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/fsv-search-white.png" alt="FSV Search" className="h-7 w-auto" />
        </Link>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">SEO técnico y contenido, con datos reales de Google.</h2>
          <ul className="mt-8 space-y-5">
            {POINTS.map(([icon, t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10"><Icon name={icon} /></span>
                <span>
                  <span className="block font-medium">{t}</span>
                  <span className="block text-sm text-white/60">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-white/40">© {new Date().getFullYear()} FSV · Santiago, Chile</p>
      </aside>

      <div className="flex flex-col px-4 py-8 sm:px-8">
        <Link href="/search" className="lg:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/fsv-search.png" alt="FSV Search" className="h-6 w-auto dark:invert" />
        </Link>
        <div className="my-auto w-full max-w-sm self-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {intro && <p className="mt-2 text-sm text-ink-500">{intro}</p>}

          {google && (
            <div className="mt-6 space-y-4">
              <GoogleButton label={google.label} next={google.next} />
              <div className="flex items-center gap-3 text-xs text-ink-400">
                <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" />o con tu correo<span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" />
              </div>
            </div>
          )}

          <form
            className="mt-6 space-y-4"
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
            {all.map((f) =>
              f.type === "checkbox" ? (
                <label key={f.name} className="flex items-start gap-2.5 text-sm text-ink-600 dark:text-ink-300">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#5151db]" required={!f.optional} checked={v[f.name] === "1"} onChange={(e) => setV({ ...v, [f.name]: e.target.checked ? "1" : "" })} />
                  <span>{f.label}</span>
                </label>
              ) : (
                <label key={f.name} className="block text-sm">
                  <span className="font-medium text-ink-700 dark:text-ink-200">{f.label}</span>
                  {f.type === "password" ? (
                    <PasswordInput value={v[f.name] ?? ""} onChange={(x) => setV({ ...v, [f.name]: x })} autoComplete={f.autoComplete} isNew={f.autoComplete === "new-password" && f.name === "password"} />
                  ) : (
                    <input className="input mt-1" type={f.type ?? "text"} autoComplete={f.autoComplete} required={!f.optional} value={v[f.name] ?? ""} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
                  )}
                  {f.hint && <span className="mt-1 block text-xs text-ink-400">{f.hint}</span>}
                </label>
              ),
            )}
            {err && <div role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{err}</div>}
            {msg && <div role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">{msg}</div>}
            <button className="btn-p w-full justify-center py-2.5" disabled={busy}>{busy ? <Spinner className="h-4 w-4" /> : submit}</button>
          </form>
          {below}
          {footer && <div className="mt-6 text-center text-sm text-ink-500">{footer}</div>}
        </div>
        <p className="text-center text-xs text-ink-400">
          <Link href="/privacidad" className="hover:text-ink-600">Privacidad</Link> · <Link href="/terminos" className="hover:text-ink-600">Términos</Link> · <a href="mailto:contacto@fsvc.cl" className="hover:text-ink-600">Ayuda</a>
        </p>
      </div>
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
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/app";
};

/** Config pública de acceso: registro abierto y login con Google. */
export function useAuthConfig() {
  const [c, setC] = useState<{ signup: boolean; google: boolean; trialDays: number | null } | null>(null);
  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((j) => {
      if (j.user) window.location.href = backTo();
      else if (j.setup) window.location.href = "/setup";
      else setC({ signup: Boolean(j.signup), google: Boolean(j.google), trialDays: j.trialDays ?? null });
    }).catch(() => setC({ signup: false, google: false, trialDays: null }));
  }, []);
  return c;
}

export const LoginLink = () => <Link className="font-medium text-acc" href="/login">Volver a iniciar sesión</Link>;
