"use client";
import { useEffect, useState } from "react";
import { api, Icon, Spinner, useApi } from "../ui";

/** Avisos de la cuenta: confirmar el correo (con reenvío) y el resultado del link de verificación. */
export function AccountNotice({ className = "" }: { className?: string }) {
  const { data, mutate } = useApi<{ user: { email: string; verified: boolean } | null }>("/api/auth/me");
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("verified") === "1") setFlash({ ok: true, text: "Listo: tu correo quedó confirmado." });
    else if (q.get("verify_error")) setFlash({ ok: false, text: q.get("verify_error")! });
    if (q.get("verified") || q.get("verify_error") || q.get("welcome")) {
      ["verified", "verify_error", "welcome"].forEach((k) => q.delete(k));
      window.history.replaceState(null, "", window.location.pathname + (q.toString() ? `?${q}` : "") + window.location.hash);
      mutate();
    }
  }, [mutate]);

  const user = data?.user;
  return (
    <>
      {flash && (
        <div className={`${className} flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${flash.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"}`}>
          <Icon name={flash.ok ? "check" : "alert"} />
          <span className="flex-1">{flash.text}</span>
          <button onClick={() => setFlash(null)} className="text-xs opacity-70 hover:opacity-100">Cerrar</button>
        </div>
      )}
      {user && !user.verified && (
        <div className={`${className} flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200`}>
          <Icon name="mail" />
          <span className="flex-1">
            Confirma tu correo para crear proyectos: te enviamos un link a <b>{user.email}</b>.{sent && <> {sent}</>}
          </span>
          <button
            className="btn px-2 py-1 text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setSent((await api<{ message: string }>("/api/auth/resend", "POST", {})).message);
              } catch (e) {
                setSent(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : "Reenviar link"}
          </button>
        </div>
      )}
    </>
  );
}
