"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "@/components/Shell";
import { api, contentScoreLabel, Empty, fmt, Icon, Score, useAction, useApi, fmtDate, Spinner } from "@/components/ui";

type Suggestion = { url: string; title: string | null; home: boolean; impressions?: number };
const pathOf = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const isHome = (u: string) => {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).pathname.replace(/\/+$/, "") === "";
  } catch {
    return false;
  }
};

const CONTENT_STATUS: Record<string, string> = { queued: "en cola", running: "analizando…", brief: "generando brief…", error: "falló" };

export default function ContentList() {
  const { id, project, refreshJobs } = useProject();
  const router = useRouter();
  const { data, mutate } = useApi<any[]>(`/api/p/${id}/content`, { refreshInterval: (d?: any[]) => (d?.some((c) => !["done", "error"].includes(c.status)) ? 3000 : 0) });
  const [url, setUrl] = useState("");
  const [kw, setKw] = useState("");
  const [pageKind,setPageKind] = useState("");
  const [analyze, analyzing] = useAction(async () => {
    const a = await api(`/api/p/${id}/content`, "POST", { url, keyword: kw, pageKind });
    refreshJobs();
    router.push(`/p/${id}/content/${a.id}`);
  });
  const [target, setTarget] = useState<{ gscUrl: string | null; impressions: number; position: number | null; mismatch: boolean } | null>(null);
  const [sugg, setSugg] = useState<{ suggestions: Suggestion[]; crawled: boolean } | null>(null);
  // ¿ya hay una URL del sitio rankeando para esta keyword? (Search Console)
  useEffect(() => {
    if (kw.trim().length < 3) return setTarget(null);
    const t = setTimeout(() => api(`/api/p/${id}/content/target?keyword=${encodeURIComponent(kw.trim())}&url=${encodeURIComponent(url)}`).then(setTarget).catch(() => setTarget(null)), 400);
    return () => clearTimeout(t);
  }, [kw, url, id]);
  // páginas del sitio que calzan con la keyword (última auditoría + Search Console): gratis, sin consultar Google
  useEffect(() => {
    if (kw.trim().length < 3) return setSugg(null);
    const t = setTimeout(() => api(`/api/p/${id}/content/suggest?keyword=${encodeURIComponent(kw.trim())}`).then(setSugg).catch(() => setSugg(null)), 400);
    return () => clearTimeout(t);
  }, [kw, id]);
  const home = isHome(url);
  const options = (sugg?.suggestions ?? []).filter((s) => !s.home && s.url !== url);
  const submit = () => {
    if (home && kw.trim() && !confirm(`La URL que pusiste es la página de inicio de ${project?.domain ?? "tu sitio"}.\n\nPara una keyword como «${kw.trim()}» Google suele mostrar una página específica (ficha, categoría o artículo), no la portada. ${options.length ? "Arriba te sugerimos páginas de tu sitio que calzan mejor." : ""}\n\n¿Analizar la página de inicio igual?`)) return;
    analyze();
  };
  return (
    <div className="space-y-4 p-4 md:p-6">
      <form
        className="card space-y-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1 space-y-1">
            <span className="text-xs font-medium text-ink-600 dark:text-ink-300">Keyword objetivo</span>
            <input className="input" placeholder="ej: torre montessori" value={kw} onChange={(e) => setKw(e.target.value)} required />
          </label>
          <label className="min-w-[280px] flex-[2] space-y-1">
            <span className="text-xs font-medium text-ink-600 dark:text-ink-300">Página a optimizar (URL completa, no solo el dominio)</span>
            <input className="input" placeholder={`https://${project?.domain ?? ""}/producto/…`} value={url} onChange={(e) => setUrl(e.target.value)} required />
          </label>
          <select className="input w-auto" value={pageKind} onChange={e=>setPageKind(e.target.value)} aria-label="Tipo de página"><option value="">Automático según página y SERP</option><option value="article">Artículo</option><option value="listing">Categoría / listado</option><option value="landing">Landing</option><option value="product">Producto</option></select>
          <button className="btn-p" disabled={analyzing}><Icon name="play" />{analyzing ? <><Spinner className="h-3.5 w-3.5" />Enviando…</> : "Analizar"}</button>
        </div>
        {options.length > 0 && (
          <div className="text-sm">
            <div className="text-xs text-ink-500">Páginas de tu sitio que calzan con «{kw.trim()}»{sugg?.crawled ? " (según tu última auditoría y Search Console)" : " (según Search Console)"}:</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {options.map((s) => (
                <button key={s.url} type="button" onClick={() => setUrl(s.url)} className="max-w-full truncate rounded-md border border-ink-200 px-2 py-1 text-left text-xs transition hover:border-acc hover:text-acc dark:border-ink-700" title={s.title ?? s.url}>
                  {pathOf(s.url)}
                  {s.impressions ? <span className="text-ink-400"> · {fmt(s.impressions)} impresiones</span> : null}
                </button>
              ))}
            </div>
          </div>
        )}
        {home && kw.trim().length >= 3 && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            Estás por analizar la <b>página de inicio</b>. Para «{kw.trim()}» Google suele mostrar una página específica (ficha, categoría o artículo).{" "}
            {options.length ? "Elige una de las sugeridas arriba." : sugg?.crawled ? "No encontramos una página de tu sitio que calce: quizás convenga crearla." : "Pega la URL de la página específica o corre una auditoría para que te sugiramos."}
          </div>
        )}
        {target?.gscUrl && (
          <div className={`w-full rounded-lg px-3 py-2 text-sm ${target.mismatch && url ? "bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200" : "bg-ink-50 text-ink-700 dark:bg-ink-800 dark:text-ink-200"}`}>
            {target.mismatch && url ? "Ojo: para esta keyword Google ya muestra otra URL tuya: " : "Para esta keyword ya rankea: "}
            <b className="break-all">{target.gscUrl}</b> ({fmt(target.impressions)} impresiones · posición {fmt(target.position, 1)})
            {url !== target.gscUrl && (
              <button type="button" className="btn-g ml-2 text-xs text-acc" onClick={() => setUrl(target.gscUrl!)}>usar esta</button>
            )}
          </div>
        )}
      </form>
      {!data?.length ? (
        <Empty icon="content" tone="info" title="Optimiza tu primera página">Pon la URL y la keyword objetivo: comparamos tu página con las que rankean en Google y generamos un brief.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <Link key={c.id} href={`/p/${id}/content/${c.id}`} className="card group flex items-center gap-4 p-4 transition hover:border-acc">
              <div className="flex flex-col items-center" title="Puntaje de 0 a 100 comparado con el top 10 de Google para esta keyword">
                <Score value={c.score} size={56} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.keyword}</div>
                {c.status === "done" && <div className="text-xs text-ink-500">{contentScoreLabel(c.score)}</div>}
                <div className="truncate text-xs text-ink-400">{c.url.replace(/^https?:\/\//, "")}</div>
                <div className="mt-1 text-xs text-ink-400">{c.status !== "done" ? CONTENT_STATUS[c.status] ?? c.status : fmtDate(c.createdAt)}</div>
              </div>
              <button
                className="btn-g opacity-0 group-hover:opacity-100"
                onClick={async (e) => { e.preventDefault(); await api(`/api/p/${id}/content`, "DELETE", { cid: c.id }); mutate(); }}
              >
                <Icon name="trash" />
              </button>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
