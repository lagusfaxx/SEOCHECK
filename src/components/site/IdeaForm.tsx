"use client";
import { useState } from "react";
import { IDEA_NEEDS, IDEA_STAGES } from "@/lib/site-content";

const field = "w-full rounded-sm border border-fsv-line bg-white px-4 py-3 text-[15px] outline-none transition placeholder:text-fsv-muted/70 focus:border-fsv-violet focus:ring-2 focus:ring-fsv-violet/15";
const pill = (on: boolean) =>
  `inline-flex min-h-[40px] cursor-pointer items-center rounded-full border px-4 text-sm transition ${on ? "border-fsv-ink bg-fsv-ink text-white" : "border-fsv-line bg-white text-fsv-ink hover:border-fsv-ink/40"}`;

/** "Cuéntanos tu idea": envía a /api/ideas (se guarda y se avisa por correo). */
export function IdeaForm() {
  const [stage, setStage] = useState("idea");
  const [needs, setNeeds] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: f.get("name"), email: f.get("email"), idea: f.get("idea"), link: f.get("link"), website: f.get("website"), stage, needs }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "No se pudo enviar. Intenta de nuevo.");
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  };

  if (state === "sent")
    return (
      <div role="status" className="rounded-sm border border-emerald-200 bg-emerald-50 p-10">
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-emerald-700">Llegó</div>
        <p className="mt-3 font-display text-3xl font-semibold tracking-tight">Gracias. Te escribimos esta semana.</p>
      </div>
    );

  return (
    <form onSubmit={submit} className="overflow-hidden rounded-sm border border-fsv-line bg-white">
      <div className="flex items-center justify-between border-b border-fsv-line px-6 py-3 font-mono text-xs text-fsv-muted">
        <span>tu-idea.txt</span>
        <span>5 min</span>
      </div>
      <div className="space-y-6 p-6 md:p-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2 text-sm font-medium">
            <span>Nombre</span>
            <input name="name" required maxLength={120} autoComplete="name" placeholder="Tu nombre" className={field} />
          </label>
          <label className="block space-y-2 text-sm font-medium">
            <span>Correo</span>
            <input name="email" type="email" required maxLength={200} autoComplete="email" placeholder="tu@correo.cl" className={field} />
          </label>
        </div>
        <fieldset>
          <legend className="mb-3 text-sm font-medium">¿En qué etapa estás?</legend>
          <div className="flex flex-wrap gap-2">
            {IDEA_STAGES.map((s) => (
              <label key={s.id} className={pill(stage === s.id)}>
                <input type="radio" name="stage" value={s.id} checked={stage === s.id} onChange={() => setStage(s.id)} className="sr-only" />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block space-y-2 text-sm font-medium">
          <span>Tu idea en pocas palabras</span>
          <textarea name="idea" required minLength={10} maxLength={4000} rows={4} placeholder="Ej: una app para reservar canchas de pádel en regiones. Ya tengo 40 interesados en un grupo de WhatsApp." className={field} />
        </label>
        <fieldset>
          <legend className="mb-3 text-sm font-medium">¿Con qué necesitas ayuda? Marca las que quieras.</legend>
          <div className="flex flex-wrap gap-2">
            {IDEA_NEEDS.map((n) => {
              const on = needs.includes(n);
              return (
                <label key={n} className={pill(on)}>
                  <input type="checkbox" checked={on} onChange={() => setNeeds(on ? needs.filter((x) => x !== n) : [...needs, n])} className="sr-only" />
                  {n}
                </label>
              );
            })}
          </div>
        </fieldset>
        <label className="block space-y-2 text-sm font-medium">
          <span>¿Tienes algo online? (opcional)</span>
          <input name="link" type="text" inputMode="url" maxLength={500} placeholder="https://" className={field} />
        </label>
        {/* campo trampa para bots: oculto para personas y lectores de pantalla */}
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute left-[-9999px] h-0 w-0 opacity-0" />
        {error && (
          <p role="alert" className="rounded-sm bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        )}
        <button type="submit" disabled={state === "sending"} className="w-full rounded-sm bg-fsv-violet px-6 py-4 font-medium text-white transition hover:brightness-110 disabled:opacity-60">
          {state === "sending" ? "Enviando…" : "Enviar"}
        </button>
        <p className="text-center text-xs text-fsv-muted">Lo que nos cuentas es confidencial.</p>
      </div>
    </form>
  );
}
