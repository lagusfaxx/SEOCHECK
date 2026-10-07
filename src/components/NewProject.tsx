"use client";
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
          r.push(`/p/${p.id}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="input text-base" placeholder="dominio.cl" value={f.domain} onChange={set("domain")} autoFocus required />
      <div className="grid grid-cols-2 gap-2">
        <select className="input" value={f.country} onChange={set("country")}>
          {["cl", "ar", "mx", "co", "pe", "es", "uy", "us"].map((c) => (
            <option key={c} value={c}>{c.toUpperCase()}</option>
          ))}
        </select>
        <select className="input" value={f.language} onChange={set("language")}>
          <option value="es">es</option>
          <option value="en">en</option>
          <option value="pt">pt</option>
        </select>
      </div>
      <input className="input" placeholder="sc-domain:dominio.cl  (opcional)" value={f.gscProperty} onChange={set("gscProperty")} />
      <button className="btn-p w-full justify-center" disabled={busy}>Crear</button>
    </form>
  );
}
