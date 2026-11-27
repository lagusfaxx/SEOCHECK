"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useProject } from "@/components/Shell";
import { api, CopyBtn, cx, Empty, Icon, Spinner, useAction } from "@/components/ui";

type Check = { id: string; tone: "good" | "warn" | "bad" | "info"; title: string; text: string; detail?: string };
type Proposal = { kind: string; target: string; before: string | null; after: string; reason: string; html: string };
type Result = { url: string; finalUrl: string; status: number; title: string | null; metaDesc: string | null; verdict: Check["tone"]; headline: string; counts: { bad: number; warn: number; good: number }; checks: Check[]; proposals: Proposal[] };

const TONE = {
  good: { icon: "check", cls: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40", word: "Bien" },
  info: { icon: "info", cls: "text-sky-600 bg-sky-50 dark:bg-sky-950/40", word: "Opcional" },
  warn: { icon: "alert", cls: "text-amber-600 bg-amber-50 dark:bg-amber-950/40", word: "Mejorar" },
  bad: { icon: "x", cls: "text-rose-600 bg-rose-50 dark:bg-rose-950/40", word: "Corregir" },
} as const;
const ORDER = { bad: 0, warn: 1, info: 2, good: 3 };
const KIND: Record<string, string> = { title: "Título", meta: "Descripción para Google", h1: "Encabezado principal", canonical: "Canonical", og: "Vista al compartir", jsonld: "Datos para Google", alt: "Texto de imagen", hreflang: "Hreflang" };

function Serp({ url, title, desc }: { url: string; title: string | null; desc: string | null }) {
  let host = url, path = "";
  try {
    const u = new URL(url);
    host = u.host;
    path = u.pathname.split("/").filter(Boolean).join(" › ");
  } catch {}
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-950">
      <div className="truncate text-xs text-ink-500">{host}{path ? ` › ${path}` : ""}</div>
      <div className="truncate text-[17px] leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">{title || "(sin título: Google inventa uno)"}</div>
      <div className="line-clamp-2 text-[13px] leading-snug text-ink-600 dark:text-ink-300">{desc || "(sin descripción: Google toma un fragmento de la página)"}</div>
    </div>
  );
}

export default function CheckPage() {
  const { id, project } = useProject();
  const [url, setUrl] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [showGood, setShowGood] = useState(false);
  const [run, busy] = useAction(async (u?: string) => {
    const target = (u ?? url).trim() || "/";
    setRes(null);
    setRes(await api<Result>(`/api/p/${id}/check`, "POST", { url: target }));
  });
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("url");
    if (q) {
      setUrl(q);
      run(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const sorted = res ? [...res.checks].sort((a, b) => ORDER[a.tone] - ORDER[b.tone]) : [];
  const issues = sorted.filter((c) => c.tone !== "good");
  const goods = sorted.filter((c) => c.tone === "good");
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <form className="card space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <div>
          <h2 className="font-semibold">¿Cómo ve Google esta página?</h2>
          <p className="text-sm text-ink-500">Pega la dirección de cualquier página de tu sitio. En segundos te decimos qué está bien, qué falta y te damos el cambio ya escrito.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-0 flex-1" placeholder={`https://${project?.domain ?? "tusitio.cl"}/una-pagina`} value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Dirección de la página" />
          <button className="btn-p" disabled={busy}>{busy ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="search" className="h-3.5 w-3.5" />}Revisar</button>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="text-ink-500">Prueba con:</span>
          {["/", "/contacto", "/blog"].map((p) => <button key={p} type="button" className="chip hover:bg-ink-200" onClick={() => { setUrl(p); run(p); }}>{p === "/" ? "la portada" : p}</button>)}
        </div>
      </form>

      {busy && <div className="card flex items-center gap-3 p-5 text-sm text-ink-500"><Spinner />Leyendo la página como lo hace Google…</div>}

      {res && (
        <>
          <div className="card p-5">
            <div className="flex flex-wrap items-start gap-4">
              <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-full", TONE[res.verdict].cls)}><Icon name={TONE[res.verdict].icon} className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1 basis-full sm:basis-0">
                <h2 className="text-lg font-semibold">{res.headline}</h2>
                <a href={res.finalUrl} target="_blank" rel="noreferrer" className="block truncate text-sm text-ink-500 hover:text-acc">{res.finalUrl}</a>
                <p className="mt-1 text-sm text-ink-500">{res.counts.good} puntos bien · {res.counts.warn} por mejorar · {res.counts.bad} por corregir</p>
              </div>
            </div>
            {res.status === 200 && (
              <div className="mt-4">
                <div className="lbl mb-1">Así aparece en Google hoy</div>
                <div className="max-w-xl"><Serp url={res.finalUrl} title={res.title} desc={res.metaDesc} /></div>
              </div>
            )}
          </div>

          {issues.length > 0 && (
            <div className="card divide-y divide-ink-100 dark:divide-ink-800">
              {issues.map((c) => (
                <div key={c.id} className="flex gap-3 p-4">
                  <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full", TONE[c.tone].cls)}><Icon name={TONE[c.tone].icon} className="h-3.5 w-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.title}</span><span className={cx("rounded px-1.5 py-0.5 text-[11px] font-medium", TONE[c.tone].cls)}>{TONE[c.tone].word}</span></div>
                    <p className="text-sm text-ink-600 dark:text-ink-300">{c.text}</p>
                    {c.detail && <p className="mt-1 break-words text-xs text-ink-400">Ahora: {c.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {res.proposals.length > 0 && (
            <div className="card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">Cambios ya escritos para esta página</h3>
                <Link href={`/p/${id}/fixes?q=${encodeURIComponent(new URL(res.finalUrl).pathname)}`} className="ml-auto text-sm text-acc hover:underline">Aprobar y publicar en Correcciones</Link>
              </div>
              <div className="space-y-3">
                {res.proposals.map((p) => (
                  <div key={`${p.kind}${p.target}`} className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
                    <div className="flex items-center gap-2 text-sm font-medium">{KIND[p.kind] ?? p.kind}<span className="ml-auto"><CopyBtn text={p.html} /></span></div>
                    <p className="text-xs text-ink-500">{p.reason}</p>
                    {p.kind === "jsonld" || p.kind === "og" ? (
                      <pre className="mt-2 max-h-48 overflow-auto rounded bg-ink-950 p-2 text-xs text-ink-100">{p.html}</pre>
                    ) : (
                      <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">{p.after}</div>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-ink-500">El próximo análisis del sitio las deja en Correcciones para aprobarlas y publicarlas en tu WordPress, Shopify o con la línea de código.</p>
            </div>
          )}

          {goods.length > 0 && (
            <div className="card p-4">
              <button className="flex w-full items-center gap-2 text-left text-sm font-medium" onClick={() => setShowGood(!showGood)}>
                <Icon name="check" className="h-4 w-4 text-emerald-600" />{goods.length} puntos que están bien
                <Icon name={showGood ? "up" : "down"} className="ml-auto h-4 w-4 text-ink-400" />
              </button>
              {showGood && (
                <ul className="mt-3 space-y-2">
                  {goods.map((c) => <li key={c.id} className="text-sm"><span className="font-medium">{c.title}.</span> <span className="text-ink-500">{c.text}</span></li>)}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {!res && !busy && (
        <div className="card p-4">
          <Empty icon="search" title="Revisamos 12 puntos que pesan en Google">Que cargue, que Google pueda mostrarla, título y descripción, encabezado, contenido, imágenes, datos para resultados enriquecidos, cómo se ve al compartirla, celulares, seguridad y velocidad del servidor.</Empty>
        </div>
      )}
    </div>
  );
}
