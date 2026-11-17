"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { useProject } from "@/components/Shell";
import { api, CopyBtn, cx, Empty, fmt, fmtDate, Icon, plural, Spinner, Tabs, toast, useAction, useApi } from "@/components/ui";

type Fix = { id: string; url: string; kind: string; target: string; before: string | null; after: string; reason: string; code: string | null; source: string; status: string; edited: boolean; html: string; live: boolean };
type Summary = { proposed: number; approved: number; verified: number; discarded: number; kinds: Record<string, number>; approvedLive: number; approvedManual: number; published: number; live: { installed: boolean; enabled: boolean; lastSeenAt: string | null } | null; crawl: { at: string } | null };
type List = { rows: Fix[]; total: number; summary: Summary; ai: boolean };
type Tab = "proposed" | "approved" | "verified" | "discarded" | "publish";

const KIND: Record<string, { label: string; plural: string }> = {
  title: { label: "Título", plural: "Títulos" },
  meta: { label: "Descripción", plural: "Descripciones" },
  h1: { label: "Encabezado H1", plural: "Encabezados H1" },
  canonical: { label: "Canonical", plural: "Canonical" },
  og: { label: "Vista al compartir", plural: "Vista al compartir" },
  jsonld: { label: "Datos estructurados", plural: "Datos estructurados" },
  alt: { label: "Texto de imagen", plural: "Textos de imagen" },
  hreflang: { label: "Hreflang", plural: "Hreflang" },
  link: { label: "Link roto", plural: "Links rotos" },
  redirect: { label: "Redirección 301", plural: "Redirecciones 301" },
};
const ORDER = ["title", "meta", "h1", "link", "redirect", "canonical", "jsonld", "og", "alt", "hreflang"];
const TEXT_KINDS = new Set(["title", "meta", "h1", "alt"]);
const LIMIT: Record<string, number> = { title: 60, meta: 155 };

const pathOf = (u: string) => {
  try {
    const x = new URL(u);
    return decodeURI(x.pathname + x.search) || "/";
  } catch {
    return u;
  }
};

/** Cómo se vería el resultado en Google con el texto nuevo. */
function SerpPreview({ url, title, desc }: { url: string; title: string; desc?: string | null }) {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {}
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-950">
      <div className="truncate text-xs text-ink-500">{host} › {pathOf(url).split("/").filter(Boolean).join(" › ")}</div>
      <div className="truncate text-[17px] leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">{title}</div>
      {desc && <div className="line-clamp-2 text-[13px] leading-snug text-ink-600 dark:text-ink-300">{desc}</div>}
    </div>
  );
}

function FixCard({ f, tab, onChange, selected, onSelect }: { f: Fix; tab: Tab; onChange: () => void; selected: boolean; onSelect: (v: boolean) => void }) {
  const { id } = useProject();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(f.after);
  const [code, setCode] = useState(false);
  useEffect(() => setText(f.after), [f.after]);
  const [set, busy] = useAction(async (patch: { status?: string; after?: string }) => {
    await api(`/api/p/${id}/fixes`, "PATCH", { id: f.id, ...patch });
    setEdit(false);
    onChange();
  });
  const isText = TEXT_KINDS.has(f.kind);
  const isCode = f.kind === "jsonld" || f.kind === "og";
  const max = LIMIT[f.kind];
  return (
    <div className={cx("card p-4", selected && "ring-2 ring-acc/40")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        {tab === "proposed" && <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--acc,#4f46e5)]" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label="Seleccionar corrección" />}
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-ink-900 dark:text-ink-100">{KIND[f.kind]?.label ?? f.kind}{f.kind === "jsonld" ? ` · ${f.target}` : ""}</span>
            {f.url ? (
              <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-ink-500 hover:text-acc" title={f.url}>{pathOf(f.url)}</a>
            ) : (
              <span className="text-ink-500">todo el sitio</span>
            )}
            {f.source === "ai" && <span className="chip">Generado con IA</span>}
            {f.edited && <span className="chip">Editado</span>}
            {!f.live && <span className="chip" title="Este cambio se hace en el servidor o en la plantilla: se entrega como archivo o instrucción en Publicar">Se entrega como archivo</span>}
          </div>
          <p className="mt-0.5 text-sm text-ink-500">{f.reason}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {busy && <Spinner />}
          {tab === "proposed" && (
            <>
              <button className="btn-p" disabled={busy} onClick={() => set({ status: "approved" })}><Icon name="check" className="h-3.5 w-3.5" />Aprobar</button>
              {(isText || isCode || f.kind === "link" || f.kind === "redirect" || f.kind === "canonical") && <button className="btn-g" disabled={busy} onClick={() => setEdit(!edit)}>Editar</button>}
              <button className="btn-g" disabled={busy} onClick={() => set({ status: "discarded" })} title="No aplicar este cambio">Descartar</button>
            </>
          )}
          {tab === "approved" && <button className="btn-g" disabled={busy} onClick={() => set({ status: "proposed" })}>Quitar aprobación</button>}
          {tab === "discarded" && <button className="btn-g" disabled={busy} onClick={() => set({ status: "proposed" })}>Recuperar</button>}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <div className="lbl">{f.kind === "redirect" || f.kind === "link" ? "URL con error" : "Ahora"}</div>
          <div className={cx("mt-1 break-words rounded-lg bg-ink-50 px-3 py-2 text-sm dark:bg-ink-800/60", f.before ? "text-ink-600 dark:text-ink-300" : "italic text-ink-400")}>
            {f.kind === "redirect" || f.kind === "link" ? <>{pathOf(f.target)}{f.kind === "redirect" && f.before ? <span className="ml-2 text-ink-400">({/^\d+$/.test(f.before) ? `responde ${f.before}` : f.before})</span> : null}</> : f.kind === "alt" ? <span className="break-all">{f.target.split("/").pop()} <span className="italic text-ink-400">(sin texto)</span></span> : f.before ? f.before.slice(0, 400) : "No tiene"}
          </div>
        </div>
        <div className="min-w-0">
          <div className="lbl flex items-center justify-between">
            <span>{f.kind === "redirect" ? "Redirigir a" : f.kind === "link" ? "Nuevo destino" : "Nuevo"}</span>
            {max && <span className={cx("normal-case tabular-nums", (edit ? text : f.after).length > max ? "text-amber-600" : "text-ink-400")}>{(edit ? text : f.after).length}/{max}</span>}
          </div>
          {edit ? (
            <div className="mt-1">
              <textarea className={cx("input", isCode && "font-mono text-xs")} rows={isCode ? 12 : f.kind === "meta" ? 3 : 2} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
              <div className="mt-1.5 flex gap-1">
                <button className="btn-p" disabled={busy || !text.trim()} onClick={() => set({ after: text })}>Guardar</button>
                <button className="btn-g" onClick={() => { setEdit(false); setText(f.after); }}>Cancelar</button>
              </div>
            </div>
          ) : isCode ? (
            <div className="mt-1">
              {f.kind === "og" && <OgPreview json={f.after} />}
              <button className="btn-g mt-1 px-0 text-xs" onClick={() => setCode(!code)}><Icon name={code ? "up" : "down"} className="h-3.5 w-3.5" />{code ? "Ocultar código" : "Ver el código"}</button>
              {code && <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-ink-950 p-3 text-xs leading-relaxed text-ink-100">{f.html}</pre>}
            </div>
          ) : (
            <div className="mt-1 break-words rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-ink-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-ink-100">{f.kind === "redirect" || f.kind === "link" || f.kind === "canonical" || f.kind === "hreflang" ? pathOf(f.after) : f.after}</div>
          )}
        </div>
      </div>
      {!edit && (f.kind === "title" || f.kind === "meta") && f.url && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-ink-500">Cómo se vería en Google</summary>
          <div className="mt-1.5 max-w-xl"><SerpPreview url={f.url} title={f.kind === "title" ? f.after : f.before && f.kind !== "meta" ? f.before : pathOf(f.url)} desc={f.kind === "meta" ? f.after : undefined} /></div>
        </details>
      )}
      {!edit && f.kind !== "redirect" && f.kind !== "link" && <div className="mt-2 flex items-center gap-1 text-xs text-ink-400"><CopyBtn text={f.html} /><span>Copiar HTML</span></div>}
    </div>
  );
}

function OgPreview({ json }: { json: string }) {
  let t: Record<string, string> = {};
  try {
    t = JSON.parse(json);
  } catch {}
  return (
    <div className="max-w-sm overflow-hidden rounded-lg border border-ink-200 dark:border-ink-800">
      {t["og:image"] && <div className="truncate bg-ink-100 px-3 py-2 text-xs text-ink-500 dark:bg-ink-800">Imagen: {t["og:image"].split("/").pop()}</div>}
      <div className="px-3 py-2">
        <div className="truncate text-sm font-medium">{t["og:title"]}</div>
        {t["og:description"] && <div className="line-clamp-2 text-xs text-ink-500">{t["og:description"]}</div>}
      </div>
    </div>
  );
}

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold", done ? "bg-emerald-600 text-white" : "bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900")}>{done ? <Icon name="check" className="h-3.5 w-3.5" /> : n}</span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="mt-3 text-sm">{children}</div>
    </div>
  );
}

const Code = ({ text }: { text: string }) => (
  <div className="flex items-start gap-1 rounded-lg bg-ink-950 p-3">
    <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all text-xs leading-relaxed text-ink-100">{text}</pre>
    <span className="shrink-0 rounded bg-ink-800 text-ink-100"><CopyBtn text={text} /></span>
  </div>
);

function Publish({ summary, onChange }: { summary: Summary; onChange: () => void }) {
  const { id } = useProject();
  const { data: live, mutate } = useApi<any>(`/api/p/${id}/fixes/live`, { refreshInterval: (d: any) => (d?.installed ? 0 : 10_000) });
  const [scope, setScope] = useState<"approved" | "all">("approved");
  const { data: files } = useApi<any>(`/api/p/${id}/fixes/files?scope=${scope}`);
  const [format, setFormat] = useState("apache");
  const [robots, setRobots] = useState(false);
  const [toggle, busy] = useAction(async (enabled: boolean) => {
    await api(`/api/p/${id}/fixes/live`, "POST", { enabled });
    await mutate();
    onChange();
  });
  const file = (name: string, extra = "") => `/api/p/${id}/fixes/file?name=${name}&scope=${scope}${extra}&download=1`;
  const [copyMd, copying] = useAction(async () => {
    const res = await fetch(`/api/p/${id}/fixes/file?name=implementation&scope=${scope}`);
    await navigator.clipboard.writeText(await res.text());
    toast("Instrucciones copiadas", "ok");
  });
  if (!live) return <div className="p-6"><Spinner /></div>;
  return (
    <div className="space-y-4">
      <Step n={1} title="Publica en el sitio con una línea de código" done={live.installed}>
        <p className="text-ink-600 dark:text-ink-300">
          Pega esta línea una sola vez dentro del <code>&lt;head&gt;</code> de tu sitio (en WordPress, Shopify, Wix o Webflow va en «código personalizado» o en el tema). Desde ahí, cada corrección que apruebes se publica sola: títulos, descripciones, canonical, datos estructurados, textos de imagen y links rotos.
        </p>
        <div className="mt-3"><Code text={live.snippet} /></div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {live.installed ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400"><Icon name="check" />Instalado: visto por última vez el {fmtDate(live.lastSeenAt, "datetime")}{live.lastSeenUrl ? ` en ${live.lastSeenUrl}` : ""}</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-ink-500"><Spinner className="h-3.5 w-3.5" />Esperando la primera visita con el código instalado…</span>
          )}
          <span className="text-ink-500">{live.enabled ? `${plural(live.approvedLive, "corrección aprobada se publica", "correcciones aprobadas se publican")} por esta vía.` : "Publicación en pausa: el sitio se ve como antes."}</span>
          <button className="btn-g" disabled={busy} onClick={() => toggle(!live.enabled)}>{live.enabled ? "Pausar publicación" : "Reanudar publicación"}</button>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-ink-500">Para programadores: aplicar desde el servidor (recomendado en sitios con SSR)</summary>
          <p className="mt-2 text-ink-600 dark:text-ink-300">El mismo contenido está disponible como JSON por página. Pídelo al renderizar y escribe los valores directo en el HTML: así todos los buscadores y los asistentes de IA los leen sin ejecutar JavaScript. Respuesta cacheable 5 minutos.</p>
          <div className="mt-2"><Code text={`GET ${live.api}\n\n→ { "head": { "title", "description", "canonical", "openGraph", "jsonLd", "hreflang", "imageAlt", "links" } }`} /></div>
        </details>
        <p className="mt-3 text-xs text-ink-500">Google aplica estos cambios cuando procesa la página con JavaScript. Pausar la publicación o quitar la línea devuelve el sitio a su estado original: no se modifica nada en tu servidor.</p>
      </Step>

      <Step n={2} title="Archivos listos para subir">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-ink-500">Incluir:</span>
          <Tabs value={scope} onChange={setScope} items={[{ id: "approved", label: `Solo aprobadas (${summary.approved})` }, { id: "all", label: `Aprobadas y por revisar (${summary.approved + summary.proposed})` }]} />
        </div>
        {!files ? <Spinner /> : !files.crawl ? <Empty compact title="Sin análisis del sitio">Analiza el sitio para generar los archivos.</Empty> : (
          <div className="divide-y divide-ink-100 dark:divide-ink-800">
            <div className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-full sm:basis-0">
                <div className="font-medium">Redirecciones 301 <span className="font-normal text-ink-500">· {plural(files.redirects.count, "redirección", "redirecciones")}</span></div>
                <div className="text-ink-500">Páginas con error que reciben visitas o links, cada una hacia su equivalente. En el formato de tu servidor.</div>
              </div>
              <select className="input w-auto" value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Formato del servidor">
                {files.redirects.formats.map((f: any) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <a className={cx("btn", !files.redirects.count && "pointer-events-none opacity-50")} href={file("redirects", `&format=${format}`)}><Icon name="down" />Descargar</a>
            </div>
            <div className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-full sm:basis-0">
                <div className="font-medium">sitemap.xml <span className="font-normal text-ink-500">· {fmt(files.sitemap.count)} de {fmt(files.sitemap.total)} URLs analizadas</span></div>
                <div className="text-ink-500">Solo las páginas que responden bien y se pueden indexar: sin errores, redirecciones, filtros ni zonas privadas.</div>
              </div>
              <a className="btn" href={file("sitemap")}><Icon name="down" />Descargar</a>
            </div>
            <div className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-full sm:basis-0">
                  <div className="font-medium">robots.txt</div>
                  <div className="text-ink-500">Conserva tus reglas, bloquea carrito, cuenta y checkout si existen y declara el sitemap.</div>
                </div>
                <button className="btn-g" onClick={() => setRobots(!robots)}>{robots ? "Ocultar" : "Ver"}</button>
                <a className="btn" href={file("robots")}><Icon name="down" />Descargar</a>
              </div>
              {robots && <div className="mt-2 grid gap-3 md:grid-cols-2"><div><div className="lbl mb-1">Actual</div><pre className="max-h-64 overflow-auto rounded-lg bg-ink-50 p-3 text-xs dark:bg-ink-800/60">{files.robots.current || "No tiene robots.txt"}</pre></div><div><div className="lbl mb-1">Recomendado</div><Code text={files.robots.proposed} /></div></div>}
            </div>
            <div className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-full sm:basis-0">
                <div className="font-medium">Títulos y descripciones (CSV) <span className="font-normal text-ink-500">· {plural(files.meta.count, "página", "páginas")}</span></div>
                <div className="text-ink-500">Una fila por página con el texto actual y el nuevo, para importar en tu CMS o pasarlo a quien edita el sitio.</div>
              </div>
              <a className={cx("btn", !files.meta.count && "pointer-events-none opacity-50")} href={file("meta")}><Icon name="down" />Descargar</a>
            </div>
            <div className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-full sm:basis-0">
                <div className="font-medium">Instrucciones para tu programador o asistente de código <span className="font-normal text-ink-500">· {plural(files.implementation.count, "cambio", "cambios")}</span></div>
                <div className="text-ink-500">Cada cambio con su página, el valor actual y el HTML nuevo exacto. Pégalo en Claude Code, Cursor o envíalo al equipo.</div>
              </div>
              <button className={cx("btn-g", !files.implementation.count && "pointer-events-none opacity-50")} disabled={copying} onClick={() => copyMd()}><Icon name="copy" />Copiar</button>
              <a className={cx("btn", !files.implementation.count && "pointer-events-none opacity-50")} href={file("implementation")}><Icon name="down" />Descargar .md</a>
            </div>
          </div>
        )}
      </Step>

      <Step n={3} title="Comprueba el resultado">
        <p className="text-ink-600 dark:text-ink-300">Cuando el sitio ya trae un cambio en su propio HTML, la corrección pasa sola a «Ya en el sitio» en el siguiente análisis. <Link className="text-acc hover:underline" href={`/p/${id}/audit`}>Volver a analizar el sitio</Link></p>
      </Step>
    </div>
  );
}

const PAGE = 30;

export default function Fixes() {
  const { id } = useProject();
  const { mutate } = useSWRConfig();
  const [tab, setTab] = useState<Tab>("proposed");
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const status = tab === "publish" ? "proposed" : tab;
  const key = `/api/p/${id}/fixes?status=${status}&kind=${kind}&q=${encodeURIComponent(q)}&take=${PAGE}&skip=${page * PAGE}`;
  const { data, mutate: reload, isLoading } = useApi<List>(key, { keepPreviousData: true });
  useEffect(() => { setPage(0); setSel(new Set()); }, [tab, kind, q]);
  const refresh = async () => {
    setSel(new Set());
    await reload();
    mutate(`/api/p/${id}/fixes/summary`);
  };
  const [bulk, bulking] = useAction(async (to: string, ids?: string[]) => {
    const r = await api<{ changed: number }>(`/api/p/${id}/fixes/bulk`, "POST", ids ? { ids, status: to } : { from: "proposed", kind, status: to });
    toast(`${plural(r.changed, "corrección", "correcciones")} ${to === "approved" ? "aprobadas" : "descartadas"}`, "ok");
    await refresh();
  });
  const [regen, regenerating] = useAction(async () => {
    const r = await api<{ created: number; verified: number; removed: number }>(`/api/p/${id}/fixes/sync`, "POST", {});
    toast(r.created || r.verified || r.removed ? `${r.created} nuevas · ${r.verified} ya en el sitio · ${r.removed} retiradas` : "Sin cambios: las correcciones ya están al día", "ok");
    await refresh();
  });
  const [improve, improving] = useAction(async () => {
    const ids = sel.size ? [...sel] : undefined;
    const r = await api<{ improved: number; total: number }>(`/api/p/${id}/fixes/improve`, "POST", { ids });
    toast(r.total ? `${r.improved} de ${r.total} textos reescritos` : "No hay títulos ni descripciones por reescribir", "ok");
    await refresh();
  });

  const s = data?.summary;
  if (!data || !s) return <div className="p-6"><Spinner /></div>;
  if (!s.crawl) {
    return (
      <div className="p-4 md:p-6">
        <div className="card p-6">
          <Empty icon="wand" title="Primero hay que analizar el sitio">
            Con el análisis, FSV Search escribe las correcciones concretas de cada página y las deja listas para publicar.
            <Link className="btn-p mt-3" href={`/p/${id}/audit`}>Analizar el sitio</Link>
          </Empty>
        </div>
      </div>
    );
  }
  const kinds = ORDER.filter((k) => s.kinds[k]);
  const pages = Math.ceil(data.total / PAGE);
  const textSel = data.rows.some((r) => (r.kind === "title" || r.kind === "meta") && !r.edited);
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="card flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{fmt(s.proposed)}</div>
          <div className="text-sm text-ink-500">por revisar</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{fmt(s.approved)}</div>
          <div className="text-sm text-ink-500">aprobadas</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums text-emerald-600">{fmt(s.verified)}</div>
          <div className="text-sm text-ink-500">ya en el sitio</div>
        </div>
        <div className="min-w-0 flex-1 basis-full text-sm sm:basis-0">
          {s.live?.installed && s.live.enabled ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"><Icon name="check" />Publicación activa: {plural(s.approvedLive, "corrección publicada", "correcciones publicadas")} en el sitio{s.approvedManual ? ` · ${s.approvedManual} en archivos` : ""}</span>
          ) : s.approved ? (
            <span className="text-ink-600 dark:text-ink-300">Tienes {plural(s.approved, "corrección aprobada", "correcciones aprobadas")} sin publicar. <button className="text-acc hover:underline" onClick={() => setTab("publish")}>Publicarlas</button></span>
          ) : (
            <span className="text-ink-500">Revisa cada cambio, aprueba los que quieras y publícalos sin tocar el código de cada página.</span>
          )}
        </div>
        <button className="btn-g" disabled={regenerating} onClick={() => regen()} title="Vuelve a calcular las correcciones con el último análisis. No toca lo aprobado, descartado ni editado.">{regenerating ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="refresh" className="h-3.5 w-3.5" />}Actualizar</button>
      </div>

      <Tabs wrap value={tab} onChange={setTab} items={[
        { id: "proposed", label: `Por revisar (${s.proposed})` },
        { id: "approved", label: `Aprobadas (${s.approved})` },
        { id: "verified", label: `Ya en el sitio (${s.verified})` },
        { id: "discarded", label: `Descartadas (${s.discarded})` },
        { id: "publish", label: "Publicar", icon: "rocket" },
      ]} />

      {tab === "publish" ? <Publish summary={s} onChange={refresh} /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {tab === "proposed" && kinds.length > 1 && (
              <div className="flex flex-wrap gap-1">
                <button className={cx("chip", kind === "all" && "!bg-ink-900 !text-white dark:!bg-ink-100 dark:!text-ink-900")} onClick={() => setKind("all")}>Todas</button>
                {kinds.map((k) => <button key={k} className={cx("chip", kind === k && "!bg-ink-900 !text-white dark:!bg-ink-100 dark:!text-ink-900")} onClick={() => setKind(k)}>{KIND[k]?.plural ?? k} · {s.kinds[k]}</button>)}
              </div>
            )}
            <input className="input ml-auto w-full sm:w-56" placeholder="Buscar por URL o texto" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {tab === "proposed" && data.total > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {sel.size ? (
                <>
                  <span className="text-ink-500">{plural(sel.size, "seleccionada", "seleccionadas")}</span>
                  <button className="btn-p" disabled={bulking} onClick={() => bulk("approved", [...sel])}>Aprobar seleccionadas</button>
                  <button className="btn-g" disabled={bulking} onClick={() => bulk("discarded", [...sel])}>Descartar</button>
                </>
              ) : (
                <button className="btn-p" disabled={bulking || Boolean(q)} onClick={() => bulk("approved")} title={q ? "Quita la búsqueda para aprobar todo el grupo" : undefined}>
                  <Icon name="check" className="h-3.5 w-3.5" />Aprobar {kind === "all" ? `las ${s.proposed}` : `${(KIND[kind]?.plural ?? kind).toLowerCase()} (${s.kinds[kind]})`}
                </button>
              )}
              {data.ai && textSel && (
                <button className="btn" disabled={improving} onClick={() => improve()} title="Reescribe títulos y descripciones con el contenido de cada página y las búsquedas reales de Google. Hasta 30 por vez.">
                  {improving ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="sparkle" className="h-3.5 w-3.5" />}{sel.size ? "Reescribir seleccionadas con IA" : "Reescribir títulos y descripciones con IA"}
                </button>
              )}
              <button className="btn-g ml-auto" onClick={() => setSel(sel.size === data.rows.length ? new Set() : new Set(data.rows.map((r) => r.id)))}>{sel.size === data.rows.length ? "Quitar selección" : "Seleccionar esta página"}</button>
            </div>
          )}
          {!data.rows.length ? (
            <div className="card p-6">
              {tab === "proposed" ? (
                <Empty icon="check" title={q || kind !== "all" ? "Nada con ese filtro" : "No hay correcciones pendientes"}>{q || kind !== "all" ? "Prueba con otro filtro." : s.approved ? "Ya revisaste todo. Publica las aprobadas en la pestaña Publicar." : "El último análisis no encontró cambios concretos que proponer."}</Empty>
              ) : tab === "approved" ? (
                <Empty icon="inbox" title="Aún no apruebas correcciones">Apruébalas en «Por revisar» y aparecerán aquí, listas para publicar.</Empty>
              ) : tab === "verified" ? (
                <Empty icon="inbox" title="Todavía nada confirmado">Aquí quedan las correcciones que el sitio ya trae en su propio HTML, confirmadas por el análisis.</Empty>
              ) : (
                <Empty icon="inbox" title="Sin descartadas" />
              )}
            </div>
          ) : (
            <div className={cx("space-y-3", isLoading && "opacity-60")}>
              {data.rows.map((f) => (
                <FixCard key={f.id} f={f} tab={tab} onChange={refresh} selected={sel.has(f.id)} onSelect={(v) => { const n = new Set(sel); if (v) n.add(f.id); else n.delete(f.id); setSel(n); }} />
              ))}
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button className="btn-g" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="chevl" />Anterior</button>
              <span className="tabular-nums text-ink-500">{page + 1} de {pages}</span>
              <button className="btn-g" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Siguiente<Icon name="chevr" /></button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
