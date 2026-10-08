"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "@/components/Shell";
import { api, Empty, fmt, Icon, Score, useAction, useApi, fmtDate, Spinner } from "@/components/ui";

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
  // ¿ya hay una URL del sitio rankeando para esta keyword? (Search Console)
  useEffect(() => {
    if (kw.trim().length < 3) return setTarget(null);
    const t = setTimeout(() => api(`/api/p/${id}/content/target?keyword=${encodeURIComponent(kw.trim())}&url=${encodeURIComponent(url)}`).then(setTarget).catch(() => setTarget(null)), 400);
    return () => clearTimeout(t);
  }, [kw, url, id]);
  return (
    <div className="space-y-4 p-4 md:p-6">
      <form
        className="card flex flex-wrap gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          analyze();
        }}
      >
        <input className="input min-w-[280px] flex-[2]" placeholder={`https://${project?.domain ?? ""}/…`} value={url} onChange={(e) => setUrl(e.target.value)} required />
        <input className="input min-w-[200px] flex-1" placeholder="keyword objetivo" value={kw} onChange={(e) => setKw(e.target.value)} required />
        <select className="input w-auto" value={pageKind} onChange={e=>setPageKind(e.target.value)} aria-label="Tipo de página"><option value="">Automático según página y SERP</option><option value="article">Artículo</option><option value="listing">Categoría / listado</option><option value="landing">Landing</option><option value="product">Producto</option></select>
        <button className="btn-p" disabled={analyzing}><Icon name="play" />{analyzing ? <><Spinner className="h-3.5 w-3.5" />Enviando…</> : "Analizar"}</button>
        {target?.gscUrl && (
          <div className={`w-full rounded-lg px-3 py-2 text-sm ${target.mismatch && url ? "bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200" : "bg-ink-50 text-ink-700 dark:bg-ink-800 dark:text-ink-200"}`}>
            {target.mismatch && url ? "Ojo: para esta keyword Google ya muestra otra URL tuya: " : "Para esta keyword ya rankea: "}
            <b className="break-all">{target.gscUrl}</b> ({fmt(target.impressions)} impr · pos {fmt(target.position, 1)})
            {url !== target.gscUrl && (
              <button type="button" className="btn-g ml-2 text-xs text-acc" onClick={() => setUrl(target.gscUrl!)}>usar esta</button>
            )}
          </div>
        )}
      </form>
      {!data?.length ? (
        <Empty icon="wand" tone="info" title="Optimiza tu primera página">Pon la URL y la keyword objetivo: comparamos tu página con las que rankean en Google y generamos un brief.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <Link key={c.id} href={`/p/${id}/content/${c.id}`} className="card group flex items-center gap-4 p-4 transition hover:border-acc">
              <Score value={c.score} size={56} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.keyword}</div>
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
