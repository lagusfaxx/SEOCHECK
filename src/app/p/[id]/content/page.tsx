"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "@/components/Shell";
import { api, contentScoreLabel, Empty, fmt, Icon, Score, useAction, useApi, fmtDate, Spinner } from "@/components/ui";

type Suggestion = { url: string; title: string | null; home: boolean; impressions?: number; source: string };
type SuggestResult = { suggestions: Suggestion[]; known: boolean; discovered: "sitemap" | "minicrawl" | null; scanned: number };
const SOURCE_NOTE: Record<string, string> = {
  known: "según tu última auditoría y Search Console",
  sitemap: "según el sitemap de tu sitio",
  minicrawl: "según una revisión rápida de los enlaces de tu sitio",
};
const pathOf = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const isHome = (u: string) => {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).pathname.replace(/\/+$/, "") === "";
  } catch {
    return false;
  }
};

/** «Hace 2 h», «Ayer», o la fecha. */
const ago = (d: string) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "Recién";
  if (m < 60) return `Hace ${m} min`;
  if (m < 24 * 60) return `Hace ${Math.round(m / 60)} h`;
  if (m < 48 * 60) return "Ayer";
  return fmtDate(d);
};

const CONTENT_STATUS: Record<string, string> = { queued: "en cola", running: "analizando…", brief: "generando brief…", error: "falló" };

export default function ContentList() {
  const { id, project, refreshJobs } = useProject();
  const router = useRouter();
  const { data, mutate } = useApi<any[]>(`/api/p/${id}/content`, { refreshInterval: (d?: any[]) => (d?.some((c) => !["done", "error"].includes(c.status)) ? 3000 : 0) });
  // se puede llegar con la keyword y la URL prellenadas (p. ej. desde «Analizar esa página»)
  const [url, setUrl] = useState("");
  const [kw, setKw] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("keyword")) setKw(q.get("keyword")!);
    if (q.get("url")) setUrl(q.get("url")!);
  }, []);
  const [pageKind,setPageKind] = useState("");
  const [analyze, analyzing] = useAction(async () => {
    const a = await api(`/api/p/${id}/content`, "POST", { url, keyword: kw, pageKind });
    refreshJobs();
    router.push(`/p/${id}/content/${a.id}`);
  });
  const [target, setTarget] = useState<{ gscUrl: string | null; impressions: number; position: number | null; mismatch: boolean } | null>(null);
  const [sugg, setSugg] = useState<SuggestResult | null>(null);
  const [searching, setSearching] = useState(false);
  // ¿ya hay una URL del sitio rankeando para esta keyword? (Search Console)
  useEffect(() => {
    if (kw.trim().length < 3) return setTarget(null);
    const t = setTimeout(() => api(`/api/p/${id}/content/target?keyword=${encodeURIComponent(kw.trim())}&url=${encodeURIComponent(url)}`).then(setTarget).catch(() => setTarget(null)), 400);
    return () => clearTimeout(t);
  }, [kw, url, id]);
  // páginas del sitio que calzan con la keyword: auditoría + Search Console, o sitemap / mini-crawl en proyectos
  // nuevos. Gratis: no consulta Google ni gasta créditos.
  useEffect(() => {
    if (kw.trim().length < 3) return setSugg(null);
    let alive = true;
    const t = setTimeout(() => {
      setSearching(true);
      api<SuggestResult>(`/api/p/${id}/content/suggest?keyword=${encodeURIComponent(kw.trim())}`)
        .then((r) => alive && setSugg(r))
        .catch(() => alive && setSugg(null))
        .finally(() => alive && setSearching(false));
    }, 500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [kw, id]);
  const home = isHome(url);
  const all = sugg?.suggestions ?? [];
  const options = all.filter((s) => s.url !== url);
  // la portada solo merece aviso si no es la página que mejor calza con la keyword
  const homeIsBest = !!all[0]?.home;
  const warnHome = home && kw.trim().length >= 3 && !homeIsBest;
  const submit = () => {
    if (warnHome && !confirm(`La URL que pusiste es la página de inicio de ${project?.domain ?? "tu sitio"}.\n\nPara una keyword como «${kw.trim()}» Google suele mostrar una página específica (ficha, categoría o artículo). ${options.length ? "Arriba hay páginas de tu sitio que calzan mejor." : ""}\n\n¿Analizar la página de inicio igual?`)) return;
    analyze();
  };
  // los fallidos se muestran con «Reintentar» por 24 h; después salen de la lista principal
  const recent = (data ?? []).filter((c) => c.status !== "error" || Date.now() - new Date(c.createdAt).getTime() < 864e5);
  const [retry] = useAction(async (c: any) => {
    const a = await api(`/api/p/${id}/content`, "POST", { url: c.url, keyword: c.keyword, pageKind: c.pageKind ?? "" });
    await api(`/api/p/${id}/content`, "DELETE", { cid: c.id }).catch(() => {});
    refreshJobs();
    router.push(`/p/${id}/content/${a.id}`);
  });
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Contenido</h1>
        <p className="text-sm text-ink-500">Optimiza una página para una búsqueda de Google.</p>
      </header>
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
        {searching && !sugg && kw.trim().length >= 3 && (
          <div className="flex items-center gap-2 text-xs text-ink-500"><Spinner className="h-3 w-3" />Buscando páginas de tu sitio que calcen…</div>
        )}
        {sugg && kw.trim().length >= 3 && !all.length && !searching && (
          <div className="text-xs text-ink-500">
            No encontramos una página claramente relacionada con «{kw.trim()}»{sugg.scanned ? ` entre ${fmt(sugg.scanned)} páginas revisadas` : ""}. Pega la URL que quieres optimizar.
          </div>
        )}
        {options.length > 0 && (
          <div className="text-sm">
            <div className="text-xs text-ink-500">Páginas de tu sitio que calzan con «{kw.trim()}» ({SOURCE_NOTE[sugg?.known ? "known" : sugg?.discovered ?? "known"]}):</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {options.map((s) => (
                <button key={s.url} type="button" onClick={() => setUrl(s.url)} className="max-w-full truncate rounded-md border border-ink-200 px-2 py-1 text-left text-xs transition hover:border-acc hover:text-acc dark:border-ink-700" title={s.title ?? s.url}>
                  {s.home ? "página de inicio" : pathOf(s.url)}
                  {s.impressions ? <span className="text-ink-400"> · {fmt(s.impressions)} impresiones</span> : null}
                </button>
              ))}
            </div>
          </div>
        )}
        {warnHome && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            Estás por analizar la <b>página de inicio</b>. Para «{kw.trim()}» Google suele mostrar una página específica (ficha, categoría o artículo).
            {options.length ? " Revisa las sugeridas arriba." : ""} Después del análisis te diremos qué tipo de página prefiere Google.
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
      <section>
        <h2 className="lbl">Análisis recientes</h2>
        {!recent.length ? (
          <Empty icon="content" tone="info" title="Aún no analizas ninguna página">Escribe la búsqueda de Google que te interesa y la página que quieres que aparezca: la comparamos con las que ya están arriba y te decimos qué cambiar.</Empty>
        ) : (
          <ul className="mt-2 divide-y divide-ink-100 rounded-xl border border-ink-200 bg-white dark:divide-ink-800 dark:border-ink-800 dark:bg-ink-900">
            {recent.map((c) => (
              <li key={c.id} className="group flex items-center gap-4 px-4 py-3">
                <Link href={`/p/${id}/content/${c.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="w-14 shrink-0 text-center">
                    {c.status === "done" ? <b className="text-lg tabular-nums">{c.score}</b> : c.status === "error" ? <Icon name="alert" className="mx-auto h-5 w-5 text-rose-500" /> : <Spinner className="mx-auto h-4 w-4 text-acc" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium first-letter:uppercase group-hover:text-acc">{c.keyword}</div>
                    <div className="truncate text-sm text-ink-500">
                      {c.status === "done" ? contentScoreLabel(c.score) : c.status === "error" ? "No se pudo completar el análisis" : CONTENT_STATUS[c.status] ?? c.status}
                    </div>
                  </div>
                  <div className="hidden min-w-0 max-w-[40%] text-right text-xs text-ink-400 sm:block">
                    <div className="truncate">{c.url.replace(/^https?:\/\//, "")}</div>
                    <div>{ago(c.createdAt)}</div>
                  </div>
                </Link>
                {c.status === "error" && (
                  <button className="btn text-xs" disabled={analyzing} title="Vuelve a correr el análisis (consume créditos como uno nuevo)" onClick={() => retry(c)}>
                    <Icon name="refresh" />Reintentar
                  </button>
                )}
                <button
                  className="btn-g opacity-0 group-hover:opacity-100"
                  aria-label="Borrar análisis"
                  onClick={async () => { if (!confirm("¿Borrar este análisis?")) return; await api(`/api/p/${id}/content`, "DELETE", { cid: c.id }); mutate(); }}
                >
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
