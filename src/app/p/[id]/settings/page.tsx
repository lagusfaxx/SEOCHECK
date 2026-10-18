"use client";
import { CommercialSettings } from "@/components/CommercialSettings";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { useProject } from "@/components/Shell";
import { api, Icon } from "@/components/ui";
import { AccountCard, TeamCard } from "@/components/Account";
import { GscConnect } from "@/components/GscConnect";
import { COUNTRIES, LANGUAGES } from "@/lib/locations";

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

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
    // el código de ubicación sigue al país: volúmenes y búsquedas del país elegido
    setF({ ...f, [k]: v, ...(k === "country" ? { locationCode: COUNTRIES.find((c) => c.code === v)?.location ?? f.locationCode } : {}) });
  };
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

  const select = (label: string, k: string, options: { code: string; name: string }[]) => (
    <label className="block">
      <span className="lbl">{label}</span>
      <select className="input mt-1" value={f[k]} onChange={set(k)}>
        {options.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
      </select>
    </label>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <section className="card space-y-4 p-4">
        <h2 className="font-semibold">Proyecto</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {field("Nombre", "name")}
          {field("Dominio", "domain", { placeholder: "dominio.cl" })}
          {select("País de búsqueda", "country", COUNTRIES)}
          {select("Idioma", "language", LANGUAGES)}
          {field("Tus marcas", "brands", { placeholder: "marca, otra marca", title: "Separadas por coma: las búsquedas que las incluyen se cuentan como tráfico de marca" })}
          <label className="block">
            <span className="lbl">Revisión de rankings</span>
            <select className="input mt-1" value={f.rankFrequency} onChange={set("rankFrequency")}>
              <option value="weekly">Semanal</option>
              <option value="daily">Diaria</option>
            </select>
          </label>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-500">Opciones avanzadas</summary>
          <div className="mt-3 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {field("Propiedad de Search Console", "gscProperty", { placeholder: "sc-domain:dominio.cl" })}
              {field("Dominios fuertes extra", "strongDomains", { placeholder: "competidor.cl" })}
              {field("Código de ubicación", "locationCode", { type: "number", title: "Se ajusta solo al cambiar el país" })}
            </div>
            <div>
              <div className="lbl mb-1">Keywords</div>
              <div className="grid gap-3 md:grid-cols-3">
                {field("Máx. keywords", "maxKeywords", { type: "number" })}
                {field("SERPs por investigación", "serpTop", { type: "number" })}
                {field("URLs en común para agrupar", "minShared", { type: "number", min: 1, max: 10 })}
                {field("SERPs 2ª ronda", "serpExpansion", { type: "number", min: 0, title: "PAA/related de las semillas; 0 = desactivado" })}
                <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.useGsc} onChange={set("useGsc")} />Usar consultas de Search Console</label>
                <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.autocomplete} onChange={set("autocomplete")} />Usar autocompletado</label>
              </div>
            </div>
            <div>
              <div className="lbl mb-1">Alertas</div>
              <div className="grid gap-3 md:grid-cols-2">
                {field("Avisar caídas de más de (posiciones)", "drop", { type: "number" })}
                {field("Impresiones mínimas para CTR bajo", "minImpressions", { type: "number" })}
              </div>
            </div>
            <div>
              <div className="lbl mb-1">Rastreo</div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">{field("User-agent del rastreo", "userAgent", { placeholder: "por defecto el de la instalación" })}</div>
                {field("Máx. URLs por patrón", "maxPerPattern", { type: "number", min: 0, title: "0 = sin límite" })}
                {field("Parámetros a ignorar", "ignoreParams", { placeholder: "utm_*, gclid, orderby  (* = todos)" })}
              </div>
            </div>
          </div>
        </details>
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{err}</div>}
        <button className="btn-p" onClick={save}><Icon name="check" />{saved ? "Guardado" : "Guardar cambios"}</button>
      </section>
      <GscConnect />
      <TeamCard />
      <AccountCard />
      <CommercialSettings />
      <div className="flex justify-end">
        <button className="btn text-rose-600" onClick={async () => { if (!confirm(`¿Eliminar ${project.domain} y todos sus datos? No se puede deshacer.`)) return; await api(`/api/p/${id}/_`, "DELETE"); router.push("/app"); }}>
          <Icon name="trash" />Eliminar proyecto
        </button>
      </div>
    </div>
  );
}
