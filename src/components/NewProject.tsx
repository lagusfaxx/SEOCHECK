"use client";
import { COUNTRIES, LANGUAGES } from "@/lib/locations";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./ui";

export default function NewProject({ onDone }: { onDone?: () => void }) {
  const r = useRouter();
  const [f, setF] = useState({ domain: "", country: "cl", language: "es", gscProperty: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const p = await api("/api/projects", "POST", f);
          onDone?.();
          r.push(`/p/${p.id}/start`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="input text-base" placeholder="dominio.cl" value={f.domain} onChange={set("domain")} autoFocus required />
      <div className="grid grid-cols-2 gap-2">
        <select className="input" aria-label="País de búsqueda" value={f.country} onChange={set("country")}>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
        <select className="input" aria-label="Idioma" value={f.language} onChange={set("language")}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.name}</option>
          ))}
        </select>
      </div>
      <input className="input" placeholder="sc-domain:dominio.cl  (opcional)" value={f.gscProperty} onChange={set("gscProperty")} />
      <button className="btn-p w-full justify-center" disabled={busy}>Crear</button>
    </form>
  );
}
