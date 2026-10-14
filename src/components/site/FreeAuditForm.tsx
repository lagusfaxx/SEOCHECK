"use client";
import Link from "next/link";
import { useState } from "react";

type Check = { id: string; label: string; status: "ok" | "warn" | "bad"; detail: string; why: string };
type Result = { url: string; finalUrl: string; score: number; title: string | null; checks: Check[] };

const DOT = { ok: "bg-emerald-500", warn: "bg-amber-400", bad: "bg-rose-500" } as const;
const WORD = { ok: "Bien", warn: "Mejorable", bad: "Problema" } as const;

type Final = { title: string; text: string; label: string; href: string };

/** Formulario y resultado de una revisión gratis (SEO de una página o seguridad pasiva). */
export function FreeAuditForm({ endpoint = "/api/public/audit", scoreLabel = "Puntaje SEO básico de", button = "Auditar gratis", final }: { endpoint?: string; scoreLabel?: string; button?: string; final: Final }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [r, setR] = useState<Result | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setR(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "No pudimos auditar el sitio");
      setR(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const bad = r?.checks.filter((c) => c.status !== "ok").length ?? 0;
  return (
    <div>
      <form onSubmit={run} className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="audit-url">Dirección del sitio</label>
        <input
          id="audit-url"
          className="min-w-0 flex-1 rounded-sm border border-fsv-line bg-white px-4 py-3 text-base outline-none transition focus:border-fsv-violet"
          placeholder="tusitio.cl"
          inputMode="url"
          autoComplete="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button className="inline-flex items-center justify-center gap-2 rounded-sm bg-fsv-violet px-6 py-3 font-medium text-white transition hover:brightness-110 disabled:opacity-60" disabled={busy}>
          {busy ? "Analizando…" : button}
        </button>
      </form>
      {err && <p role="alert" className="mt-4 rounded-sm bg-rose-50 px-4 py-3 text-sm text-rose-800">{err}</p>}

      {r && (
        <div className="mt-10" aria-live="polite">
          <div className="flex flex-wrap items-center gap-6 border-y border-fsv-line py-6">
            <div className={`font-display text-6xl font-semibold tracking-tight ${r.score >= 80 ? "text-emerald-600" : r.score >= 50 ? "text-amber-500" : "text-rose-600"}`}>{r.score}</div>
            <div className="min-w-0">
              <div className="text-sm text-fsv-muted">{scoreLabel}</div>
              <div className="truncate font-medium">{r.finalUrl}</div>
              <div className="mt-1 text-sm text-fsv-muted">{bad ? `${bad} punto${bad === 1 ? "" : "s"} por mejorar` : "Todo en orden en los puntos básicos"}</div>
            </div>
          </div>
          <ul className="divide-y divide-fsv-line">
            {r.checks.map((c) => (
              <li key={c.id} className="py-4">
                <div className="flex items-start gap-3">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[c.status]}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <span className="font-medium">{c.label}</span>
                      <span className="text-xs uppercase tracking-wider text-fsv-muted">{WORD[c.status]}</span>
                    </div>
                    <div className="mt-0.5 break-words text-sm text-fsv-ink/80">{c.detail}</div>
                    {c.status !== "ok" && <p className="mt-1 text-sm text-fsv-muted">{c.why}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-8 rounded-sm bg-fsv-ink p-6 text-white">
            <p className="font-display text-xl font-semibold tracking-tight">{final.title}</p>
            <p className="mt-2 text-sm text-white/70">{final.text}</p>
            <Link href={final.href} className="mt-5 inline-flex items-center gap-2 rounded-sm bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
              {final.label} <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
