"use client";
import { ContentTools } from "@/components/ContentTools";
import { commonSchema, improvements, LEVEL_DOT, LEVEL_LABEL } from "@/lib/content/improvements";
import { statusLabel } from "@/lib/status";
import { useSWRConfig } from "swr";
import { useEffect, useRef, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useProject } from "@/components/Shell";
import { api, contentScoreLabel, CopyBtn, cx, Drawer, Empty, fmt, Hint, Icon, Score, Tabs, useAction, useApi, useLocal, Spinner } from "@/components/ui";

type Block = { id: string; tag: "h2" | "h3"; text: string; notes?: string; state?: "optional" | "required" | "removed" };
type Brief = {
  kind?: "article" | "listing" | "landing" | "product";
  provenance?: "ai" | "rules";
  titles: string[];
  metas: string[];
  outline: Block[];
  intro?: string;
  filters?: string[];
  links?: { anchor: string; to: string }[];
  faq: { q: string; a: string }[];
  notes?: string[];
  title?: string;
  meta?: string;
};
const TYPE_LABEL: Record<string, string> = { listing: "listado", detail: "ficha", article: "artículo", home: "página de inicio" };
const TYPE_PLURAL: Record<string, string> = { listing: "listados", detail: "fichas de producto", article: "artículos", home: "páginas de inicio" };

const nid = () => `u${Math.random().toString(36).slice(2, 9)}`;
const faqLd = (faq: Brief["faq"]) =>
  JSON.stringify(
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.filter((f) => f.q && f.a).map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    null,
    2
  );

function OutlineItem({ b, onChange, onDelete }: { b: Block; onChange: (b: Block) => void; onDelete: () => void }) {
  const s = useSortable({ id: b.id });
  return (
    <div
      ref={s.setNodeRef}
      style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
      className={cx("group flex items-start gap-2 rounded-lg border border-ink-200 bg-white p-2 dark:border-ink-700 dark:bg-ink-900", b.tag === "h3" && "ml-6", s.isDragging && "z-10 shadow-xl")}
    >
      <button {...s.attributes} {...s.listeners} className="mt-1 cursor-grab text-ink-300 hover:text-ink-600"><Icon name="grip" /></button>
      <button onClick={() => onChange({ ...b, tag: b.tag === "h2" ? "h3" : "h2" })} className={cx("mt-0.5 rounded px-1.5 text-[11px] font-bold", b.tag === "h2" ? "bg-acc text-white" : "bg-ink-200 text-ink-700 dark:bg-ink-700 dark:text-ink-200")}>
        {b.tag.toUpperCase()}
      </button>
      <div className="min-w-0 flex-1">
        <input value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} className="w-full bg-transparent text-sm font-medium outline-none" />
        {b.notes != null && <input value={b.notes} onChange={(e) => onChange({ ...b, notes: e.target.value })} className="w-full bg-transparent text-xs text-ink-400 outline-none" placeholder="notas" />}
      </div>
      <select aria-label="Estado del encabezado" className="input w-auto text-xs" value={b.state??"optional"} onChange={e=>onChange({...b,state:e.target.value as Block["state"]})}><option value="optional">Opcional</option><option value="required">Obligatorio</option><option value="removed">Eliminado</option></select>
      <button onClick={onDelete} className="btn-g p-0.5 opacity-0 group-hover:opacity-100"><Icon name="x" className="h-3.5 w-3.5" /></button>
    </div>
  );
}

const TYPE_ONE: Record<string, string> = { listing: "un listado o categoría", detail: "una ficha de producto", article: "un artículo", home: "una página de inicio" };
const KIND_FOR: Record<string, string> = { listing: "listing", detail: "product", article: "article", home: "landing" };

/** Diagnóstico arriba: ¿es la página correcta para esta búsqueda? Domina la pantalla mientras haya problema. */
function Diagnosis({ cid, keyword, googleType, mineType, onBrief, onContinue }: { cid: string; keyword: string; googleType: string; mineType: string; onBrief: () => void; onContinue: () => void }) {
  const { id, refreshJobs } = useProject();
  const { data: fit, isLoading } = useApi<{ match: { url: string; title: string | null } | null; checked: number } | null>(`/api/p/${id}/content/fit?cid=${cid}`);
  const [busy, setBusy] = useState(false);
  const mine = mineType === "home" ? "tu página de inicio" : TYPE_ONE[mineType] ?? "otro tipo de página";
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        <Icon name="alert" className="h-4 w-4" />Página posiblemente incorrecta
      </div>
      <h2 className="mt-2 text-xl font-semibold">Esta no parece ser la mejor página para esta búsqueda</h2>
      <p className="mt-1 max-w-3xl text-sm">
        Para «{keyword}», Google muestra principalmente <b>{TYPE_PLURAL[googleType]}</b>. Estás analizando {mine}.
      </p>
      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm"><Spinner className="h-4 w-4" />Buscando en tu sitio una página que encaje mejor…</div>
      ) : fit?.match ? (
        <div className="mt-4">
          <div className="text-xs text-amber-800 dark:text-amber-300">Encontramos una página de tu sitio que encaja mejor:</div>
          <div className="mt-1 font-semibold">{fit.match.title?.split(" | ")[0] ?? pathOf(fit.match.url)}</div>
          <div className="break-all font-mono text-xs opacity-80">{pathOf(fit.match.url)}</div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a className="btn-p" href={`/p/${id}/content?keyword=${encodeURIComponent(keyword)}&url=${encodeURIComponent(fit.match.url)}`}>Analizar esta página →</a>
            <button className="btn-g text-amber-900 underline dark:text-amber-200" onClick={onContinue}>Continuar con esta página</button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <div className="text-sm">
            No encontramos {TYPE_ONE[googleType]} relacionada en tu sitio{fit?.checked ? ` (revisamos ${fit.checked} candidatas)` : ""}. Recomendación: crear {TYPE_ONE[googleType]} específica para esta búsqueda.
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="btn-p"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/api/p/${id}/content/rebrief`, "POST", { cid, kind: KIND_FOR[googleType] });
                  onBrief();
                  refreshJobs();
                  onContinue();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="doc" />}Generar brief para la página nueva
            </button>
            <button className="btn-g text-amber-900 underline dark:text-amber-200" onClick={onContinue}>Continuar con esta página</button>
          </div>
        </div>
      )}
    </section>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** «Qué está funcionando en Google»: la tabla de competidores interpretada en 4-5 frases. */
function GoogleSummary({ r }: { r: any }) {
  const comps = r.competitors ?? [];
  if (!comps.length) return null;
  const types = new Map<string, number>();
  for (const c of comps) if (c.type) types.set(c.type, (types.get(c.type) ?? 0) + 1);
  const [topType, topN] = [...types.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  const words = median(comps.map((c: any) => c.editorial ?? c.words ?? 0));
  const h2 = comps.map((c: any) => c.h2 ?? 0).sort((a: number, b: number) => a - b);
  const lo = h2[Math.floor(h2.length * 0.2)] ?? 0, hi = h2[Math.floor(h2.length * 0.8)] ?? 0;
  const common = commonSchema(r).map((s) => s.type);
  const mineSchema: string[] = r.mine?.schema ?? [];
  const lines = [
    topType ? `${topN} de ${comps.length} resultados analizados son ${TYPE_PLURAL[topType] ?? topType}.` : null,
    `Extensión habitual: ~${fmt(words)} palabras.`,
    common.length ? `Schema frecuente: ${common.join(", ")}.` : "Sin un schema predominante.",
    hi ? `Las páginas suelen usar ${lo === hi ? hi : `${lo}–${hi}`} secciones (H2).` : null,
  ].filter(Boolean) as string[];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <div className="lbl">Qué está funcionando en Google</div>
        <ul className="mt-2 space-y-1 text-sm">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
      </div>
      <div>
        <div className="lbl">Tu página</div>
        <p className="mt-2 text-sm">
          {TYPE_LABEL[r.mine?.type] ?? "Página"} · {fmt(r.mine?.editorial ?? r.mine?.words)} palabras ·{" "}
          {common.length ? (common.every((t: string) => mineSchema.includes(t)) ? `con ${common.join(" y ")}` : `sin ${common.filter((t: string) => !mineSchema.includes(t)).join(" ni ")}`) : mineSchema.length ? `schema: ${mineSchema.join(", ")}` : "sin schema"}
        </p>
      </div>
    </div>
  );
}

const pathOf = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";

/** Antes de descargar: qué cambios incluye el archivo de instrucciones y a dónde va. */
function ImplementationSummary({ brief, url, onDownload }: { brief: Brief; url: string; onDownload: () => Promise<void> }) {
  const [download, busy] = useAction(onDownload);
  const heads = (brief.outline ?? []).filter((b) => b.state !== "removed");
  const removed = (brief.outline ?? []).filter((b) => b.state === "removed").length;
  const required = heads.filter((b) => b.state === "required").length;
  const faq = (brief.faq ?? []).filter((f) => f.q && f.a).length;
  const listing = brief.kind === "listing";
  const rows: [string, string][] = [
    ["Título", brief.title ?? brief.titles?.[0] ?? "—"],
    ["Meta description", brief.meta ?? brief.metas?.[0] ?? "—"],
    ...(listing
      ? ([
          ["Intro del listado", brief.intro ? plural(brief.intro.trim().split(/\s+/).length, "palabra", "palabras") : "—"],
          ["Filtros", plural((brief.filters ?? []).length, "filtro", "filtros")],
          ["Enlaces internos", plural((brief.links ?? []).length, "enlace", "enlaces")],
        ] as [string, string][])
      : ([["Estructura", `${plural(heads.length, "encabezado", "encabezados")} (${required} ${required === 1 ? "obligatorio" : "obligatorios"})${removed ? ` · ${removed} marcado${removed === 1 ? "" : "s"} para eliminar` : ""}`]] as [string, string][])),
    ["Preguntas frecuentes", faq ? `${plural(faq, "pregunta", "preguntas")} con respuesta y su JSON-LD` : "—"],
    ...((brief.notes ?? []).length ? ([["Notas", plural(brief.notes!.length, "indicación", "indicaciones")]] as [string, string][]) : []),
  ];
  return (
    <div className="mt-8 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Preparar implementación</h2>
        <p className="mt-1 text-sm text-ink-500">Estos cambios irán en el archivo para la página <span className="break-all">{url.replace(/^https?:\/\//, "")}</span>.</p>
      </div>
      <dl className="divide-y divide-ink-100 rounded-lg border border-ink-200 text-sm dark:divide-ink-800 dark:border-ink-800">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[150px_1fr]">
            <dt className="text-ink-500">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-lg bg-ink-50 px-3 py-2.5 text-sm dark:bg-ink-800/50">
        <div className="font-medium">Instrucciones de implementación (.md)</div>
        <p className="text-ink-500">Un archivo Markdown con los cambios y cómo validarlos. Sirve para tu equipo o para cualquier asistente de programación.</p>
      </div>
      <button className="btn-p" disabled={busy} onClick={() => download()}>
        {busy ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="doc" />}Descargar instrucciones (.md)
      </button>
    </div>
  );
}

export default function ContentDetail({ params }: { params: { cid: string } }) {
  const { id, refreshJobs } = useProject();
  const {mutate:invalidate}=useSWRConfig();
  const [saveError,setSaveError]=useState("");
  const { data, mutate } = useApi<any>(`/api/p/${id}/content/one?cid=${params.cid}`, { refreshInterval: (d?: any) => (d && !["done", "error"].includes(d.status) ? 2500 : 0) });
  const [brief, setBrief] = useState<Brief | null>(null);
  const [tab, setTab] = useState<"terms" | "sections" | "paa" | "comp">("terms");
  const [termFilter, setTermFilter] = useState<"missing" | "all">("missing");
  const [saving, setSaving] = useState(false);
  // «Continuar con esta página»: el usuario ya vio el diagnóstico y decidió seguir (se recuerda por análisis)
  const [continued, setContinued] = useLocal<boolean>(`content:continue:${params.cid}`, false);
  const [prep, setPrep] = useState(false);
  const loaded = useRef<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (data?.status === "done" && data.brief?.outline && loaded.current !== data.id + JSON.stringify(data.brief).length) {
      loaded.current = data.id + JSON.stringify(data.brief).length;
      setBrief({ title: data.brief.titles?.[0], meta: data.brief.metas?.[0], ...data.brief });
    }
  }, [data]);

  // guardado automático
  useEffect(() => {
    if (!brief || !data) return;
    const t = setTimeout(async () => {
      setSaving(true);
      try { await api(`/api/p/${id}/content`, "PATCH", { cid: data.id, brief }); setSaveError(""); await invalidate(`/api/p/${id}/content/versions?cid=${data.id}`); } catch(e) { setSaveError((e as Error).message); } finally { setSaving(false); }
    }, 800);
    return () => clearTimeout(t);
  }, [brief, data, id]);

  if (!data) return null;
  const r = data.result ?? {};
  if (data.status !== "done" && !r.terms) {
    return (
      <div className="p-6">
        {data.status === "error" ? (
          <Empty icon="alert" tone="bad" title="El análisis falló">{data.result?.error ?? "Sin detalle"}</Empty>
        ) : (
          <Empty icon="content" title={<span className="inline-flex items-center gap-2"><Spinner className="h-4 w-4 text-acc" />{statusLabel(data.status)}…</span>}>Estamos leyendo tu página y las que rankean en Google. Tarda 1 a 2 minutos.</Empty>
        )}
      </div>
    );
  }

  const setOutline = (o: Block[]) => brief && setBrief({ ...brief, outline: o });
  const addBlock = (text: string, tag: "h2" | "h3" = "h2", notes?: string) => brief && setBrief({ ...brief, outline: [...brief.outline, { id: nid(), tag, text, notes }] });
  const onDragEnd = (e: DragEndEvent) => {
    if (!brief || !e.over || e.active.id === e.over.id) return;
    const a = brief.outline.findIndex((b) => b.id === e.active.id), b = brief.outline.findIndex((b) => b.id === e.over!.id);
    setOutline(arrayMove(brief.outline, a, b));
  };
  const terms = (r.terms ?? []).filter((t: any) => termFilter === "all" || t.missing);
  const listing = brief?.kind === "listing";
  const md = brief
    ? [
        `# ${brief.title ?? ""}`,
        "",
        `> ${brief.meta ?? ""}`,
        "",
        ...(listing
          ? [brief.intro ?? "", "", "## Filtros", ...(brief.filters ?? []).map((f) => `- ${f}`), "", "## Links internos", ...(brief.links ?? []).map((l) => `- ${l.anchor} → ${l.to}`)]
          : brief.outline.filter(b=>b.state!=="removed").map((b) => `${b.tag === "h2" ? "##" : "###"} ${b.text}${b.notes ? `\n${b.notes}` : ""}`)),
        "",
        "## FAQ",
        ...brief.faq.map((f) => `**${f.q}**\n${f.a}`),
      ].join("\n")
    : "";

  const fixType = r.pageType && r.mine?.type && r.mine.type !== r.pageType;
  const problem = fixType && !continued;
  const items = improvements(r, { ready: !!r.breakdown });
  const counts = {
    terms: (r.terms ?? []).filter((t: any) => t.missing).length,
    sections: (r.sections ?? []).filter((x: any) => !x.covered).length,
    paa: (r.paa ?? []).filter((x: any) => !x.answered).length,
    comps: (r.competitors ?? []).length,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      {/* 1. ¿Estoy optimizando la página correcta? */}
      <header className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold first-letter:uppercase">{data.keyword}</h1>
          <a href={data.url} target="_blank" rel="noreferrer" className="block truncate text-sm text-ink-500 hover:text-acc">{data.url.replace(/^https?:\/\//, "")}</a>
        </div>
        {problem && (
          <div className="text-sm text-ink-500" title="Puntaje de 0 a 100 frente al top 10 de Google. Con la página equivocada, subirlo no garantiza posicionar.">
            Puntaje de esta página: <b className="tabular-nums text-ink-800 dark:text-ink-100">{r.score}/100</b> · {contentScoreLabel(r.score)}
          </div>
        )}
      </header>

      {problem && (
        <Diagnosis cid={data.id} keyword={data.keyword} googleType={r.pageType} mineType={r.mine.type} onBrief={() => { loaded.current = null; mutate(); }} onContinue={() => setContinued(true)} />
      )}

      {!problem && (
        <section className="card flex flex-wrap items-center gap-5 p-4">
          <div className="flex flex-col items-center gap-1">
            <Score value={r.score} size={84} />
            <span className="flex items-center gap-1 text-[11px] text-ink-500">
              {contentScoreLabel(r.score)}
              <Hint text="Puntaje de 0 a 100 que compara tu página con las 10 primeras de Google para esta keyword. Es la suma de 5 partes medidas, no una opinión de IA. Abajo está traducido a qué mejorar." />
            </span>
          </div>
          <div className="min-w-0 flex-1 text-sm">
            {r.pageType && (
              <p>
                Google muestra <b>{TYPE_PLURAL[r.pageType]}</b>
                {fixType ? (
                  <span className="text-amber-700 dark:text-amber-300"> y estás analizando {r.mine.type === "home" ? "tu página de inicio" : TYPE_ONE[r.mine.type]} (elegiste continuar con esta página).</span>
                ) : (
                  <span className="text-emerald-700 dark:text-emerald-400"> y tu página es del mismo tipo. ✓</span>
                )}
              </p>
            )}
            <p className="mt-1 text-ink-500">{fmt(r.mine?.editorial ?? r.mine?.words)} palabras · el top 10 usa ~{fmt(r.targetWords)}</p>
          </div>
        </section>
      )}

      {r.target?.gscUrl && (
        <div className={cx("rounded-lg px-3 py-2 text-sm", r.target.mismatch ? "bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200" : "bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200")}>
          {r.target.mismatch ? (
            <>
              <b>Ojo, canibalización:</b> para «{data.keyword}» Google ya muestra{" "}
              <a className="underline" href={r.target.gscUrl} target="_blank" rel="noreferrer">{r.target.gscUrl}</a> ({fmt(r.target.impressions)} impresiones · posición {fmt(r.target.position, 1)}). Optimiza esa URL o diferencia bien esta.
            </>
          ) : (
            <>Esta es la URL que ya rankea para «{data.keyword}» en Search Console ({fmt(r.target.impressions)} impresiones · posición {fmt(r.target.position, 1)}).</>
          )}
          {r.target.others?.length > 0 && <div className="mt-1 text-xs opacity-80">También aparecen: {r.target.others.map((o: any) => o.url).join(" · ")}</div>}
        </div>
      )}

      {/* 2. ¿Qué le falta frente a Google? */}
      <section>
        <h2 className="lbl">Qué debes mejorar</h2>
        <ul className="mt-2 divide-y divide-ink-100 rounded-xl border border-ink-200 bg-white dark:divide-ink-800 dark:border-ink-800 dark:bg-ink-900">
          {items.map((it) => (
            <li key={it.area} className="grid gap-1 px-4 py-3 sm:grid-cols-[130px_1fr_auto] sm:items-baseline sm:gap-4">
              <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-500">
                <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", LEVEL_DOT[it.level])} aria-label={LEVEL_LABEL[it.level]} />
                {it.area}
              </span>
              <div>
                <div className="font-medium">{it.title}</div>
                <div className="text-sm text-ink-500">{it.detail}</div>
              </div>
              <span className="text-xs tabular-nums text-ink-400">{it.points == null ? "—" : `${it.points} de ${it.max} pts`}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 3. ¿Qué debería cambiar? */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Propuesta de optimización</h2>
            <p className="text-xs text-ink-500">
              {brief?.provenance === "ai" ? "Generada con IA a partir del análisis de Google." : "Generada a partir del análisis de Google."} Puedes editarla: se guarda sola{saving ? " (guardando…)" : ""}.
            </p>
          </div>
          <CopyBtn text={md} />
          <button className="btn" onClick={async () => { loaded.current = null; await api(`/api/p/${id}/content/rebrief`, "POST", { cid: data.id }); mutate(); refreshJobs(); }}><Icon name="refresh" />Regenerar</button>
          <button className="btn-p" disabled={!brief} onClick={() => setPrep(true)}>
            Preparar implementación
          </button>
        </div>
        {saveError && <p role="alert" className="text-rose-700">No se pudo guardar: {saveError}</p>}
        {!brief ? (
          <Empty icon="content" title={<span className="inline-flex items-center gap-2"><Spinner className="h-4 w-4 text-acc" />Generando propuesta…</span>} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-4">
            <div className="card space-y-3 p-3">
              <div>
                <div className="flex items-center justify-between"><span className="lbl">Title</span><span className={cx("text-xs tabular-nums", (brief.title?.length ?? 0) > 60 ? "text-rose-600" : "text-ink-400")}>{brief.title?.length ?? 0}/60</span></div>
                <input className="input mt-1 font-medium" value={brief.title ?? ""} onChange={(e) => setBrief({ ...brief, title: e.target.value })} />
                <div className="mt-1 flex flex-wrap gap-1">
                  {brief.titles.map((t) => (
                    <button key={t} onClick={() => setBrief({ ...brief, title: t })} className={cx("rounded-md border px-2 py-0.5 text-left text-xs transition hover:border-acc", t === brief.title ? "border-acc text-acc" : "border-ink-200 text-ink-500 dark:border-ink-700")}>{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between"><span className="lbl">Meta</span><span className={cx("text-xs tabular-nums", (brief.meta?.length ?? 0) > 160 ? "text-rose-600" : "text-ink-400")}>{brief.meta?.length ?? 0}/155</span></div>
                <textarea className="input mt-1" rows={2} value={brief.meta ?? ""} onChange={(e) => setBrief({ ...brief, meta: e.target.value })} />
                <div className="mt-1 space-y-1">
                  {brief.metas.map((t) => (
                    <button key={t} onClick={() => setBrief({ ...brief, meta: t })} className={cx("block w-full rounded-md border px-2 py-1 text-left text-xs transition hover:border-acc", t === brief.meta ? "border-acc text-acc" : "border-ink-200 text-ink-500 dark:border-ink-700")}>{t}</button>
                  ))}
                </div>
              </div>
              {/* vista previa SERP */}
              <div className="rounded-lg bg-ink-50 p-3 dark:bg-ink-800/50">
                <div className="truncate text-xs text-ink-500">{data.url.replace(/^https?:\/\//, "")}</div>
                <div className="truncate text-[17px] text-[#1a0dab] dark:text-[#8ab4f8]">{brief.title}</div>
                <div className="line-clamp-2 text-xs text-ink-600 dark:text-ink-300">{brief.meta}</div>
              </div>
            </div>
              {brief.notes && brief.notes.length > 0 && (
                <div className="card p-3">
                  <span className="lbl">Notas</span>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-600 dark:text-ink-300">
                    {brief.notes.map((n) => <li key={n}>{n}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="space-y-4">
            {listing ? (
              <div className="card space-y-3 p-3">
                <div>
                  <div className="flex items-center gap-1"><span className="lbl">Intro del listado</span><Hint text="Google muestra listados para esta keyword: no hace falta un artículo largo. Intro corta arriba de las tarjetas, filtros útiles y links a listados vecinos." /></div>
                  <textarea className="input mt-1" rows={4} value={brief.intro ?? ""} onChange={(e) => setBrief({ ...brief, intro: e.target.value })} placeholder="60–120 palabras sobre el listado" />
                  <div className="mt-0.5 text-right text-[11px] tabular-nums text-ink-400">{(brief.intro ?? "").trim().split(/\s+/).filter(Boolean).length} palabras</div>
                </div>
                <div>
                  <span className="lbl">Filtros</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(brief.filters ?? []).map((f, i) => (
                      <span key={i} className="chip">{f}<button onClick={() => setBrief({ ...brief, filters: (brief.filters ?? []).filter((_, j) => j !== i) })}><Icon name="x" className="h-3 w-3" /></button></span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="lbl">Links internos</span>
                  <ul className="mt-1 space-y-1 text-sm">
                    {(brief.links ?? []).map((l, i) => (
                      <li key={i} className="flex gap-2"><span className="font-medium">{l.anchor}</span><span className="text-ink-400">→ {l.to}</span></li>
                    ))}
                    {!brief.links?.length && <li className="text-ink-400">—</li>}
                  </ul>
                </div>
              </div>
            ) : (
            <div className="card p-3">
              <div className="mb-2 flex items-center">
                <span className="lbl">Outline</span>
                <button className="btn-g ml-auto" onClick={() => addBlock("nueva sección")}><Icon name="plus" />H2</button>
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={brief.outline.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1.5">
                    {brief.outline.map((b) => (
                      <OutlineItem key={b.id} b={b} onChange={(nb) => setOutline(brief.outline.map((x) => (x.id === b.id ? nb : x)))} onDelete={() => setOutline(brief.outline.filter((x) => x.id !== b.id))} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
            )}

            <div className="card p-3">
              <div className="mb-2 flex items-center">
                <span className="lbl">FAQ</span>
                <button className="btn-g ml-auto" onClick={() => setBrief({ ...brief, faq: [...brief.faq, { q: "", a: "" }] })}><Icon name="plus" /></button>
              </div>
              <div className="space-y-2">
                {brief.faq.map((f, i) => (
                  <div key={i} className="group rounded-lg border border-ink-200 p-2 dark:border-ink-700">
                    <div className="flex gap-2">
                      <input className="w-full bg-transparent text-sm font-medium outline-none" placeholder="pregunta" value={f.q} onChange={(e) => setBrief({ ...brief, faq: brief.faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
                      <button className="btn-g p-0.5 opacity-0 group-hover:opacity-100" onClick={() => setBrief({ ...brief, faq: brief.faq.filter((_, j) => j !== i) })}><Icon name="x" className="h-3.5 w-3.5" /></button>
                    </div>
                    <textarea className="mt-1 w-full resize-none bg-transparent text-sm text-ink-600 outline-none dark:text-ink-300" rows={2} placeholder="respuesta" value={f.a} onChange={(e) => setBrief({ ...brief, faq: brief.faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} />
                  </div>
                ))}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-ink-500">JSON-LD FAQPage</summary>
                <div className="relative mt-2">
                  <div className="absolute right-1 top-1"><CopyBtn text={`<script type="application/ld+json">\n${faqLd(brief.faq)}\n</script>`} /></div>
                  <pre className="max-h-64 overflow-auto rounded-lg bg-ink-900 p-3 text-[11px] text-ink-100">{faqLd(brief.faq)}</pre>
                </div>
              </details>
            </div>
            </div>
          </div>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-500">Más herramientas: regenerar una sección, comparar con lo publicado, historial de versiones</summary>
          <div className="mt-3"><ContentTools cid={params.cid} brief={brief} onChange={setBrief} /></div>
        </details>
      </section>

      {/* Evidencia: todo lo técnico, plegado */}
      <details className="group rounded-xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="font-semibold">Datos del análisis</span>
          <span className="text-sm text-ink-500">Términos {counts.terms} · Secciones {counts.sections} · Preguntas {counts.paa} · Competidores {counts.comps}</span>
          <span className="ml-auto text-sm text-acc">
            <span className="group-open:hidden">Ver análisis técnico ↓</span>
            <span className="hidden group-open:inline">Ocultar ↑</span>
          </span>
        </summary>
        <div className="space-y-4 border-t border-ink-100 p-4 dark:border-ink-800">
          <GoogleSummary r={r} />
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: "terms", label: `Términos · ${counts.terms}`, title: "Palabras que usan las páginas del top 10 de Google" },
              { id: "sections", label: `Secciones · ${counts.sections}`, title: "Secciones (H2/H3) que se repiten en el top 10" },
              { id: "paa", label: `Preguntas · ${counts.paa}`, title: "«Otras preguntas de los usuarios» (People Also Ask)" },
              { id: "comp", label: `Competidores · ${counts.comps}`, title: "Las páginas del top 10 que se usaron para comparar" },
            ]}
          />
          <div>
          {tab === "terms" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{plural(counts.terms, "término por cubrir", "términos por cubrir")}</div>
                  <p className="text-sm text-ink-500">Cada término muestra cuántas veces lo usas tú frente a cuántas veces aparece, aproximadamente, en las páginas mejor posicionadas. Clic para copiarlo.</p>
                </div>
                <Tabs value={termFilter} onChange={setTermFilter} items={[{ id: "missing", label: "Por cubrir" }, { id: "all", label: "Todos" }]} />
              </div>
              {([
                ["En casi todos los resultados", (t: any) => t.coverage >= 0.7],
                ["En la mayoría", (t: any) => t.coverage >= 0.4 && t.coverage < 0.7],
                ["En algunos", (t: any) => t.coverage < 0.4],
              ] as [string, (t: any) => boolean][]).map(([label, f]) => {
                const group = terms.filter(f);
                if (!group.length) return null;
                return (
                  <div key={label}>
                    <div className="lbl mb-1.5">{label} · {group.length}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.map((t: any) => (
                        <button
                          key={t.term}
                          title={`Aparece en el ${Math.round(t.coverage * 100)}% de los competidores. Clic para copiar.`}
                          onClick={() => navigator.clipboard.writeText(t.term)}
                          className={cx("rounded-md border px-2 py-1 text-xs transition hover:border-acc", t.missing ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" : t.mine >= t.target ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300")}
                        >
                          {t.term} <span className="opacity-60">· tú {t.mine} · top ~{t.target}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {!terms.length && <p className="text-sm text-ink-500">No hay términos por cubrir.</p>}
            </div>
          )}
          {tab === "sections" && (
            <div className="space-y-1">
              {(r.sections ?? []).map((s: any) => (
                <div key={s.label} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-ink-50 dark:hover:bg-ink-800/50">
                  <span className={cx("h-4 w-4 shrink-0 rounded-full text-center text-[10px] leading-4", s.covered ? "bg-emerald-500 text-white" : "border border-ink-300")}>{s.covered ? "✓" : ""}</span>
                  <span className="min-w-0 flex-1 truncate text-sm" title={s.variants.join("\n")}>{s.label}</span>
                  <span className="text-xs tabular-nums text-ink-400" title={`${s.count} de las páginas del top 10 tienen esta sección`}>{s.count} págs.</span>
                  <button className="btn-g p-0.5 opacity-0 group-hover:opacity-100" onClick={() => addBlock(s.label)}><Icon name="plus" className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {!(r.sections ?? []).length && <div className="text-sm text-ink-300">—</div>}
            </div>
          )}
          {tab === "paa" && (
            <div className="space-y-1">
              {(r.paa ?? []).map((p: any) => (
                <div key={p.q} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-ink-50 dark:hover:bg-ink-800/50">
                  <span className={cx("h-4 w-4 shrink-0 rounded-full text-center text-[10px] leading-4", p.answered ? "bg-emerald-500 text-white" : "border border-ink-300")}>{p.answered ? "✓" : ""}</span>
                  <span className="flex-1 text-sm">{p.q}</span>
                  <button className="btn-g p-0.5 opacity-0 group-hover:opacity-100" onClick={() => addBlock(p.q, "h3")}><Icon name="plus" className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {(r.questions ?? []).length > 0 && <div className="lbl mt-3 px-2">Preguntas en competidores</div>}
              {(r.questions ?? []).map((q: string) => (
                <div key={q} className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800/50">
                  <span className="flex-1">{q}</span>
                  <button className="btn-g p-0.5 opacity-0 group-hover:opacity-100" onClick={() => addBlock(q, "h3")}><Icon name="plus" className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          )}
          {tab === "comp" && (
            <div className="overflow-auto">
              <table className="tbl">
                <thead><tr><th>#</th><th>Dominio</th><th>Tipo</th><th className="num" title="Palabras editoriales: sin menús, footer ni tarjetas">Palabras</th><th className="num">H2</th><th className="num">H3</th><th>Schema</th></tr></thead>
                <tbody>
                  {(r.competitors ?? []).map((c: any) => (
                    <tr key={c.url}>
                      <td>{c.position}</td>
                      <td><a href={c.url} target="_blank" rel="noreferrer" className="hover:text-acc" title={c.title}>{c.domain}</a></td>
                      <td className="text-xs text-ink-500">{c.type ? TYPE_LABEL[c.type] : "–"}</td>
                      <td className="num" title={`${fmt(c.words)} palabras en total`}>{fmt(c.editorial ?? c.words)}</td>
                      <td className="num">{c.h2}</td>
                      <td className="num">{c.h3}</td>
                      <td className="max-w-[200px] truncate text-xs text-ink-400">{c.schema.join(", ")}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td>★</td><td>tu página</td><td className="text-xs">{r.mine?.type ? TYPE_LABEL[r.mine.type] : "–"}</td><td className="num">{fmt(r.mine?.editorial ?? r.mine?.words)}</td>
                    <td className="num">{(r.mine?.headings ?? []).filter((h: any) => h.tag === "h2").length}</td>
                    <td className="num">{(r.mine?.headings ?? []).filter((h: any) => h.tag === "h3").length}</td>
                    <td className="text-xs">{(r.mine?.schema ?? []).join(", ")}</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(r.schema ?? []).map((s: any) => (
                  <span key={s.type} className={cx("chip", s.mine && "!bg-emerald-100 !text-emerald-700")}>{s.type} · {s.count}</span>
                ))}
              </div>
            </div>
          )}
          </div>
        </div>
      </details>

      <Drawer open={prep && !!brief} onClose={() => setPrep(false)}>
        {brief && <ImplementationSummary brief={brief} url={data.url} onDownload={async () => {
          await api(`/api/p/${id}/content`, "PATCH", { cid: data.id, brief });
          window.location.href = `/api/p/${id}/content/implementation?cid=${params.cid}`;
          setPrep(false);
        }} />}
      </Drawer>
    </div>
  );
}
