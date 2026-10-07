"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { useProject } from "@/components/Shell";
import { api, cx, Icon } from "@/components/ui";

const PROVIDERS: [string, string][] = [
  ["serp", "Serpent"], ["volume", "DataForSEO"], ["embeddings", "Embeddings"], ["llm", "LLM"],
  ["gsc", "Search Console"], ["psi", "PageSpeed"], ["render", "Render JS"], ["indexnow", "IndexNow"],
];

export default function Settings() {
  const { id, project } = useProject();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [f, setF] = useState<any>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!project || f) return;
    const s = project.settings ?? {};
    setF({
      name: project.name, domain: project.domain, country: project.country, language: project.language, locationCode: (project as any).locationCode, gscProperty: project.gscProperty ?? "",
      brands: (s.brands ?? []).join(", "), strongDomains: (s.strongDomains ?? []).join(", "),
      maxKeywords: s.keywords?.maxKeywords ?? 400, serpTop: s.keywords?.serpTop ?? 150, minShared: s.keywords?.minShared ?? 3, useGsc: s.keywords?.useGsc ?? true,
      drop: s.alerts?.drop ?? 3, minImpressions: s.alerts?.minImpressions ?? 500,
    });
  }, [project, f]);
  if (!f || !project) return null;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    await api(`/api/p/${id}/_`, "PATCH", {
      name: f.name, domain: f.domain, country: f.country, language: f.language, locationCode: f.locationCode, gscProperty: f.gscProperty,
      settings: {
        brands: list(f.brands), strongDomains: list(f.strongDomains),
        keywords: { maxKeywords: Number(f.maxKeywords), serpTop: Number(f.serpTop), minShared: Number(f.minShared), useGsc: f.useGsc },
        alerts: { drop: Number(f.drop), minImpressions: Number(f.minImpressions) },
      },
    });
    mutate(`/api/p/${id}/_`);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const field = (label: string, k: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="lbl">{label}</span>
      <input className="input mt-1" value={f[k]} onChange={set(k)} {...props} />
    </label>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div className="card grid gap-3 p-4 md:grid-cols-3">
        {field("Nombre", "name")}
        {field("Dominio", "domain")}
        {field("Propiedad GSC", "gscProperty", { placeholder: "sc-domain:dominio.cl" })}
        {field("País", "country")}
        {field("Idioma", "language")}
        {field("location_code", "locationCode", { type: "number" })}
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-2">
        {field("Marcas (navegacional)", "brands", { placeholder: "marca, otra marca" })}
        {field("Dominios fuertes extra", "strongDomains", { placeholder: "competidor.cl" })}
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-4">
        {field("Máx. keywords", "maxKeywords", { type: "number" })}
        {field("SERPs por run", "serpTop", { type: "number" })}
        {field("URLs en común", "minShared", { type: "number", min: 1, max: 10 })}
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.useGsc} onChange={set("useGsc")} />queries GSC</label>
        {field("Alerta caída (pos.)", "drop", { type: "number" })}
        {field("Impr. mín. CTR", "minImpressions", { type: "number" })}
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-p" onClick={save}><Icon name={saved ? "check" : "check"} />{saved ? "Guardado" : "Guardar"}</button>
        <button className="btn ml-auto text-rose-600" onClick={async () => { if (!confirm(`¿Eliminar ${project.domain} y todos sus datos?`)) return; await api(`/api/p/${id}/_`, "DELETE"); router.push("/"); }}>
          <Icon name="trash" />Eliminar proyecto
        </button>
      </div>
      <div className="card grid grid-cols-2 gap-2 p-4 md:grid-cols-4">
        {PROVIDERS.map(([k, label]) => {
          const v = project.providers?.[k];
          const on = Boolean(v) && v !== "hash";
          return (
            <div key={k} className="flex items-center gap-2 text-sm">
              <span className={cx("h-2 w-2 rounded-full", on ? "bg-emerald-500" : v === "hash" ? "bg-amber-400" : "bg-ink-300")} />
              {label}
              {typeof v === "string" && <span className="text-xs text-ink-400">{v}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
