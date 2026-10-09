"use client";
import { CommercialSettings } from "@/components/CommercialSettings";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { useProject } from "@/components/Shell";
import { api, cx, Icon } from "@/components/ui";
import { AccountCard, TeamCard } from "@/components/Account";
import { GscConnect } from "@/components/GscConnect";

const PROVIDERS: [string, string][] = [
  ["serp", "Serpent"], ["volume", "Volumen"], ["embeddings", "Embeddings"], ["llm", "LLM"],
  ["gsc", "Search Console"], ["psi", "PageSpeed"], ["render", "Render JS"], ["indexnow", "IndexNow"],
];

export default function Settings() {
  const { id, project } = useProject();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [f, setF] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!project || f) return;
    const s = project.settings ?? {};
    setF({
      name: project.name, domain: project.domain, country: project.country, language: project.language, locationCode: (project as any).locationCode, gscProperty: project.gscProperty ?? "",
      brands: (s.brands ?? []).join(", "), strongDomains: (s.strongDomains ?? []).join(", "),
      maxKeywords: s.keywords?.maxKeywords ?? 400, serpTop: s.keywords?.serpTop ?? 150, minShared: s.keywords?.minShared ?? 3, useGsc: s.keywords?.useGsc ?? true,
      autocomplete: s.keywords?.autocomplete ?? true, serpExpansion: s.keywords?.serpExpansion ?? 20,
      userAgent: s.crawler?.userAgent ?? "", maxPerPattern: s.crawler?.maxPerPattern ?? 50,
      ignoreParams: (s.crawler?.ignoreParams ?? ["utm_*", "gclid", "fbclid", "msclkid", "sessionid", "phpsessid", "sid"]).join(", "),
      rankFrequency: s.rank?.frequency ?? "weekly",
      drop: s.alerts?.drop ?? 3, minImpressions: s.alerts?.minImpressions ?? 500,
    });
  }, [project, f]);
  if (!f || !project) return null;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    setErr(null);
    try {
    await api(`/api/p/${id}/_`, "PATCH", {
      name: f.name, domain: f.domain, country: f.country, language: f.language, locationCode: f.locationCode, gscProperty: f.gscProperty,
      settings: {
        brands: list(f.brands), strongDomains: list(f.strongDomains),
        keywords: { maxKeywords: Number(f.maxKeywords), serpTop: Number(f.serpTop), minShared: Number(f.minShared), useGsc: f.useGsc, autocomplete: f.autocomplete, serpExpansion: Number(f.serpExpansion) },
        crawler: { userAgent: f.userAgent.trim(), maxPerPattern: Number(f.maxPerPattern), ignoreParams: list(f.ignoreParams) },
        rank: { frequency: f.rankFrequency },
        alerts: { drop: Number(f.drop), minImpressions: Number(f.minImpressions) },
      },
    });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
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
      <CommercialSettings />
      <div className="card grid gap-3 p-4 md:grid-cols-3">
        {field("Nombre", "name")}
        {field("Dominio", "domain")}
        {field("Propiedad GSC", "gscProperty", { placeholder: "sc-domain:dominio.cl" })}
        {field("País", "country")}
        {field("Idioma", "language")}
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-2">
        {field("Marcas (navegacional)", "brands", { placeholder: "marca, otra marca" })}
        {field("Dominios fuertes extra", "strongDomains", { placeholder: "competidor.cl" })}
      </div>
      <details className="card p-4"><summary className="cursor-pointer text-sm">Opciones avanzadas</summary><div className="mt-3 space-y-3">
        {field("Código de ubicación del proveedor", "locationCode", { type: "number" })}
      <div className="card grid gap-3 p-4 md:grid-cols-4">
        {field("Máx. keywords", "maxKeywords", { type: "number" })}
        {field("SERPs por run", "serpTop", { type: "number" })}
        {field("URLs en común", "minShared", { type: "number", min: 1, max: 10 })}
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.useGsc} onChange={set("useGsc")} />queries GSC</label>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.autocomplete} onChange={set("autocomplete")} />autocomplete</label>
        {field("SERPs 2ª ronda", "serpExpansion", { type: "number", min: 0, title: "PAA/related de los seeds; 0 = desactivado" })}
        {field("Alerta caída (pos.)", "drop", { type: "number" })}
        {field("Impr. mín. CTR", "minImpressions", { type: "number" })}
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-3">
        <div className="md:col-span-3">{field("User-agent del crawler", "userAgent", { placeholder: "por defecto CRAWLER_UA" })}</div>
        {field("Máx. URLs por patrón", "maxPerPattern", { type: "number", min: 0, title: "0 = sin límite" })}
        <div className="md:col-span-2">{field("Parámetros a ignorar", "ignoreParams", { placeholder: "utm_*, gclid, orderby  (* = todos)" })}</div>
      </div>
      </div></details>
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="block">
          <span className="lbl">Rank tracking</span>
          <select className="input mt-1 w-auto" value={f.rankFrequency} onChange={set("rankFrequency")}>
            <option value="weekly">semanal</option>
            <option value="daily">diario</option>
          </select>
        </label>
        <span className="pb-2 text-xs text-ink-400">se aplica a todas las keywords monitoreadas del proyecto</span>
      </div>
      {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{err}</div>}
      <div className="flex items-center gap-2">
        <button className="btn-p" onClick={save}><Icon name={saved ? "check" : "check"} />{saved ? "Guardado" : "Guardar"}</button>
        <button className="btn ml-auto text-rose-600" onClick={async () => { if (!confirm(`¿Eliminar ${project.domain} y todos sus datos?`)) return; await api(`/api/p/${id}/_`, "DELETE"); router.push("/"); }}>
          <Icon name="trash" />Eliminar proyecto
        </button>
      </div>
      <div id="providers" className="card grid grid-cols-2 gap-2 p-4 md:grid-cols-4">
        {PROVIDERS.map(([k, label]) => {
          const v = project.providers?.[k];
          const on = Boolean(v) && v !== "hash";
          return (
            <div key={k} className="flex items-center gap-2 text-sm">
              <span className={cx("h-2 w-2 rounded-full", on ? "bg-emerald-500" : v === "hash" ? "bg-amber-400" : "bg-ink-300")} />
              {label} <span className="text-xs text-ink-500">{on ? "Activo" : "Sin configurar"}</span>
              {typeof v === "string" && <span className="text-xs text-ink-400">{v}</span>}
            </div>
          );
        })}
      </div>
      <GscConnect />
      <TeamCard />
      <AccountCard />
    </div>
  );
}
