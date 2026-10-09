"use client";
import { ContentTools } from "@/components/ContentTools";
import { statusLabel } from "@/lib/status";
import { useSWRConfig } from "swr";
import { useEffect, useRef, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useProject } from "@/components/Shell";
import { api, Bar, contentScoreLabel, CopyBtn, cx, Empty, fmt, Hint, Icon, Score, Tabs, useApi, Spinner } from "@/components/ui";

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
const TYPE_LABEL: Record<string, string> = { listing: "listado", detail: "ficha", article: "artículo", home: "home" };

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

export default function ContentDetail({ params }: { params: { cid: string } }) {
  const { id, refreshJobs } = useProject();
  const {mutate:invalidate}=useSWRConfig();
  const [saveError,setSaveError]=useState("");
  const { data, mutate } = useApi<any>(`/api/p/${id}/content/one?cid=${params.cid}`, { refreshInterval: (d?: any) => (d && !["done", "error"].includes(d.status) ? 2500 : 0) });
  const [brief, setBrief] = useState<Brief | null>(null);
  const [tab, setTab] = useState<"terms" | "sections" | "paa" | "comp">("terms");
  const [termFilter, setTermFilter] = useState<"missing" | "all">("missing");
  const [saving, setSaving] = useState(false);
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

  return (
    <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="xl:col-span-2"><ContentTools cid={params.cid} brief={brief} onChange={setBrief}/></div>
      {/* Análisis */}
      <div className="space-y-4">
        <div className="card flex flex-wrap items-center gap-5 p-4">
          <div className="flex flex-col items-center gap-1">
            <Score value={r.score} size={92} />
            <span className="flex items-center gap-1 text-[11px] text-ink-500">
              {contentScoreLabel(r.score)}
              <Hint text="Puntaje de 0 a 100 que compara tu página con las 10 primeras de Google para esta keyword. Es la suma de 5 partes medidas, no una opinión de IA: términos que usan los que rankean, largo del texto, secciones comunes, preguntas de Google respondidas y datos estructurados (schema). Pasa el mouse sobre cada parte para ver cómo se calcula." />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold">{data.keyword}</div>
            <a href={data.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-ink-400 hover:text-acc">{data.url}</a>
            {r.pageType && (
              <div className="mt-0.5 text-[11px] text-ink-500">
                Google muestra <b>{TYPE_LABEL[r.pageType]}s</b>
                {r.mine?.type && r.mine.type !== r.pageType && <span className="text-amber-600"> · la tuya es {TYPE_LABEL[r.mine.type]}</span>}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right text-sm">
            <div className="tabular-nums"><b>{fmt(r.mine?.editorial ?? r.mine?.words)}</b> palabras</div>
            <div className="flex items-center justify-end gap-1 text-[11px] text-ink-500">
              objetivo ~{fmt(r.targetWords)}
              <Hint text="Solo cuenta texto editorial: sin menús, footer, tarjetas de listado ni bloques que se repiten en todo el sitio. El objetivo es la mediana de palabras del top 10 de Google con el mismo tipo de página." />
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-3 border-t border-ink-100 pt-3 text-[11px] text-ink-500 sm:grid-cols-5 dark:border-ink-800">
            {([
              ["Términos clave", r.breakdown?.terms, r.pageType === "listing" ? 50 : 40, "Cuántos de los términos que usan las páginas del top 10 aparecen en tu página, y con qué frecuencia. Los más comunes pesan más."],
              ["Largo del texto", r.breakdown?.length, 15, `Tus palabras editoriales comparadas con el objetivo (~${fmt(r.targetWords)}, la mediana del top 10). Puntaje completo al llegar al 90% del objetivo.`],
              ["Secciones", r.breakdown?.sections, r.pageType === "listing" ? 10 : 20, "Cuántas de las secciones (H2/H3) que se repiten en el top 10 cubre tu página."],
              ["Preguntas (PAA)", r.breakdown?.paa, 15, "Cuántas de las preguntas de «Otras preguntas de los usuarios» de Google respondes en tu página."],
              ["Schema", r.breakdown?.schema, 10, "Si tu página tiene los datos estructurados (schema) que usa al menos un 30% del top 10."],
            ] as [string, number, number, string][]).map(([l, v, m, help]) => (
              <div key={l} className="cursor-help" title={help}>
                <div className="flex items-start gap-1 leading-tight">{l} <Hint text={help} /></div>
                <div className="tabular-nums text-ink-800 dark:text-ink-200">{v ?? 0}<span className="text-ink-400"> de {m} pts</span></div>
                <Bar value={((v ?? 0) / m) * 100} className="mt-0.5" />
              </div>
            ))}
          </div>
        </div>

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

        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: "terms", label: `Términos · faltan ${(r.terms ?? []).filter((t: any) => t.missing).length}`, title: "Palabras que usan las páginas del top 10 de Google" },
            { id: "sections", label: `Secciones · faltan ${(r.sections ?? []).filter((s: any) => !s.covered).length}`, title: "Secciones (H2/H3) que se repiten en el top 10" },
            { id: "paa", label: `Preguntas (PAA) · sin responder ${(r.paa ?? []).filter((p: any) => !p.answered).length}`, title: "«Otras preguntas de los usuarios» (People Also Ask): preguntas que Google muestra para esta keyword" },
            { id: "comp", label: "Competencia", title: "Las páginas del top 10 que se usaron para comparar" },
          ]}
        />

        <div className="card p-3">
          {tab === "terms" && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Tabs value={termFilter} onChange={setTermFilter} items={[{ id: "missing", label: "Faltan" }, { id: "all", label: "Todos" }]} />
                <span className="flex items-center gap-1 text-xs text-ink-500">
                  {terms[0] ? <>«{terms[0].term} {terms[0].mine}/{terms[0].target}» = lo usas {terms[0].mine} {terms[0].mine === 1 ? "vez" : "veces"}; el top 10, ~{terms[0].target}</> : "Veces que lo usas / veces que lo usa el top 10"}
                  <Hint text="El primer número es cuántas veces aparece el término en tu página; el segundo, la cantidad típica (mediana) en las páginas del top 10 que lo usan. Rojo: no lo usas. Amarillo: lo usas menos. Verde: llegas al objetivo. Clic para copiarlo." />
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {terms.map((t: any) => (
                  <button
                    key={t.term}
                    title={`Lo usas ${t.mine} ${t.mine === 1 ? "vez" : "veces"} · el top 10 lo usa ~${t.target} ${t.target === 1 ? "vez" : "veces"} · aparece en el ${Math.round(t.coverage * 100)}% de los competidores. Clic para copiar.`}
                    onClick={() => navigator.clipboard.writeText(t.term)}
                    className={cx("rounded-md border px-2 py-1 text-xs transition hover:border-acc", t.missing ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" : t.mine >= t.target ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300")}
                    style={{ fontSize: `${11 + Math.min(4, t.coverage * 4)}px` }}
                  >
                    {t.term} <span className="opacity-60">{t.mine}/{t.target}</span>
                  </button>
                ))}
              </div>
            </>
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

      {saveError&&<p role="alert" className="text-rose-700">No se pudo guardar: {saveError}</p>}
      {/* Brief */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="lbl">Brief</span>{brief?.provenance === "ai" && <span className="text-xs text-ink-500">Generado con IA</span>}
          <span className="text-xs text-ink-400">{saving ? "guardando…" : data.status !== "done" ? data.status : ""}</span>
          <div className="ml-auto flex gap-1">
            <CopyBtn text={md} />
            <button className="btn" onClick={async () => { loaded.current = null; await api(`/api/p/${id}/content/rebrief`, "POST", { cid: data.id }); mutate(); refreshJobs(); }}><Icon name="refresh" />Regenerar</button>
          </div>
        </div>
        {!brief ? (
          <Empty icon="content" title={<span className="inline-flex items-center gap-2"><Spinner className="h-4 w-4 text-acc" />Generando brief…</span>} />
        ) : (
          <>
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

            {brief.notes && brief.notes.length > 0 && (
              <div className="card p-3">
                <span className="lbl">Notas</span>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-600 dark:text-ink-300">
                  {brief.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
