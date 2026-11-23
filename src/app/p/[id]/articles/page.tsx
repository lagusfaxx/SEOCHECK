"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useProject } from "@/components/Shell";
import { api, CopyBtn, cx, Empty, fmt, fmtDate, Icon, plural, Spinner, toast, useAction, useApi } from "@/components/ui";

type Row = { id: string; keyword: string; status: string; title: string; words: number; warnings: string[]; error: string | null; published: any; contentId: string | null; createdAt: string };
type Full = Row & { meta: string; slug: string; html: string; edited: boolean; updatedAt?: string };
const STATUS: Record<string, string> = { queued: "En cola", writing: "Escribiendo…", done: "Listo", error: "Falló" };

function WriteFrom({ onCreated }: { onCreated: (id: string) => void }) {
  const { id, refreshJobs } = useProject();
  const { data } = useApi<any[]>(`/api/p/${id}/content`);
  const [write, busy] = useAction(async (cid: string) => {
    const a = await api<{ id: string }>(`/api/p/${id}/articles`, "POST", { cid });
    refreshJobs();
    onCreated(a.id);
  });
  const done = (data ?? []).filter((c) => c.status === "done");
  if (!data) return <Spinner />;
  if (!done.length)
    return (
      <Empty icon="content" title="Primero analiza una búsqueda">
        El artículo se escribe a partir de lo que Google muestra arriba para esa búsqueda: preguntas, temas y largo.
        <Link className="btn-p mt-3" href={`/p/${id}/content`}>Analizar una búsqueda</Link>
      </Empty>
    );
  return (
    <div className="space-y-2">
      <div className="text-sm text-ink-500">Elige la búsqueda para la que quieres el artículo:</div>
      <div className="divide-y divide-ink-100 rounded-lg border border-ink-200 dark:divide-ink-800 dark:border-ink-800">
        {done.slice(0, 20).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1 basis-full sm:basis-0">
              <div className="font-medium">{c.keyword}</div>
              <div className="truncate text-xs text-ink-500">{c.url}</div>
            </div>
            <button className="btn" disabled={busy} onClick={() => write(c.id)}><Icon name="sparkle" className="h-3.5 w-3.5" />Escribir artículo</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Editor({ aid, cms, onChange }: { aid: string; cms: any; onChange: () => void }) {
  const { id } = useProject();
  const { data: a, mutate } = useApi<Full>(`/api/p/${id}/articles/one?aid=${aid}`, { refreshInterval: (d?: Full) => (d && ["queued", "writing"].includes(d.status) ? 3000 : 0) });
  const [title, setTitle] = useState("");
  const [meta, setMeta] = useState("");
  const [slug, setSlug] = useState("");
  const [source, setSource] = useState(false);
  const [html, setHtml] = useState("");
  const [dirty, setDirty] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (!a || a.status !== "done") return;
    const key = `${a.id}:${a.updatedAt ?? ""}`;
    if (loaded.current === key && dirty) return;
    loaded.current = key;
    setTitle(a.title);
    setMeta(a.meta);
    setSlug(a.slug);
    setHtml(a.html);
    if (body.current) body.current.innerHTML = a.html;
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id, a?.status, a?.updatedAt]);
  const current = () => (source ? html : body.current?.innerHTML ?? html);
  const [save, saving] = useAction(async () => {
    await api(`/api/p/${id}/articles`, "PATCH", { aid, title, meta, slug, html: current() });
    setDirty(false);
    await mutate();
    onChange();
    toast("Guardado", "ok");
  });
  const [publish, publishing] = useAction(async () => {
    if (dirty) await api(`/api/p/${id}/articles`, "PATCH", { aid, title, meta, slug, html: current() });
    const r = await api<Full>(`/api/p/${id}/articles/publish`, "POST", { aid });
    setDirty(false);
    await mutate();
    onChange();
    toast(`Borrador enviado a ${r.published?.kind === "shopify" ? "Shopify" : "WordPress"}`, "ok");
  });
  const [remove, removing] = useAction(async () => {
    if (!confirm("¿Eliminar este artículo?")) return;
    await api(`/api/p/${id}/articles`, "DELETE", { aid });
    onChange();
  });
  if (!a) return <div className="p-6"><Spinner /></div>;
  if (a.status === "queued" || a.status === "writing")
    return (
      <div className="card flex items-center gap-3 p-6">
        <Spinner />
        <div>
          <div className="font-medium">Escribiendo «{a.keyword}»</div>
          <div className="text-sm text-ink-500">Suele tardar uno o dos minutos. Puedes seguir trabajando: el artículo queda guardado aquí.</div>
        </div>
      </div>
    );
  if (a.status === "error")
    return (
      <div className="card p-6">
        <Empty icon="alert" tone="bad" title="No se pudo escribir el artículo">{a.error}</Empty>
        <button className="btn-g mt-2" disabled={removing} onClick={() => remove()}>Eliminar</button>
      </div>
    );
  const pub = a.published as { kind: string; url: string; at: string } | null;
  const cmsOk = cms?.status === "connected";
  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip">Generado con IA{a.edited ? " · editado" : ""}</span>
          <span className="text-sm text-ink-500">{fmt(a.words)} palabras · {a.keyword}</span>
          <div className="ml-auto flex flex-wrap gap-1">
            <button className="btn-p" disabled={saving || !dirty} onClick={() => save()}>{saving ? <Spinner className="h-3.5 w-3.5" /> : null}Guardar</button>
            <button className="btn" disabled={publishing || !cmsOk} title={cmsOk ? undefined : "Conecta WordPress o Shopify en Correcciones → Publicar"} onClick={() => publish()}>
              {publishing ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="send" className="h-3.5 w-3.5" />}{pub ? "Actualizar borrador" : `Enviar como borrador${cms ? ` a ${cms.kind === "shopify" ? "Shopify" : "WordPress"}` : ""}`}
            </button>
          </div>
        </div>
        {pub && <p className="text-sm text-emerald-700 dark:text-emerald-400"><Icon name="check" className="mr-1 inline h-3.5 w-3.5" />Borrador en {pub.kind === "shopify" ? "Shopify" : "WordPress"} desde el {fmtDate(pub.at, "datetime")}. <a className="underline" href={pub.url} target="_blank" rel="noreferrer">Abrir para revisar y publicar</a></p>}
        {!cms && <p className="text-sm text-ink-500">Para enviarlo como borrador, <Link className="text-acc hover:underline" href={`/p/${id}/fixes?status=publish`}>conecta tu WordPress o Shopify</Link>. También puedes descargarlo o copiarlo.</p>}
        <label className="block text-sm">
          <span className="lbl flex justify-between"><span>Título</span><span className={cx("normal-case tabular-nums", title.length > 60 ? "text-amber-600" : "")}>{title.length}/60</span></span>
          <input className="input mt-1" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
        </label>
        <label className="block text-sm">
          <span className="lbl flex justify-between"><span>Descripción para Google</span><span className={cx("normal-case tabular-nums", meta.length > 155 ? "text-amber-600" : "")}>{meta.length}/155</span></span>
          <textarea className="input mt-1" rows={2} value={meta} onChange={(e) => { setMeta(e.target.value); setDirty(true); }} />
        </label>
        <label className="block text-sm">
          <span className="lbl">URL (slug)</span>
          <input className="input mt-1 font-mono text-xs" value={slug} onChange={(e) => { setSlug(e.target.value); setDirty(true); }} />
        </label>
      </div>

      {a.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <div className="mb-1 font-medium">Revisado antes de entregártelo</div>
          <ul className="list-disc space-y-1 pl-5 text-ink-700 dark:text-ink-200">{a.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-semibold">Artículo</span>
          <span className="text-xs text-ink-500">{source ? "Editando el HTML" : "Haz clic en el texto para editarlo"}</span>
          <button className="btn-g ml-auto text-xs" onClick={() => {
            if (source) {
              if (body.current) body.current.innerHTML = html;
            } else setHtml(body.current?.innerHTML ?? html);
            setSource(!source);
          }}>{source ? "Ver como texto" : "Ver HTML"}</button>
        </div>
        <textarea className={cx("input min-h-[480px] font-mono text-xs", !source && "hidden")} value={html} onChange={(e) => { setHtml(e.target.value); setDirty(true); }} />
        <div
          ref={body}
          contentEditable
          suppressContentEditableWarning
          onInput={() => setDirty(true)}
          className={cx("prose-article min-h-[300px] outline-none", source && "hidden")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <a className="btn" href={`/api/p/${id}/articles/download?aid=${aid}&format=html`}><Icon name="down" className="h-3.5 w-3.5" />HTML</a>
        <a className="btn" href={`/api/p/${id}/articles/download?aid=${aid}&format=md`}><Icon name="down" className="h-3.5 w-3.5" />Markdown</a>
        <span className="inline-flex items-center text-ink-500"><CopyBtn text={a.html} />Copiar HTML</span>
        <button className="btn-g ml-auto text-rose-600" disabled={removing} onClick={() => remove()}><Icon name="trash" className="h-3.5 w-3.5" />Eliminar</button>
      </div>
    </div>
  );
}

export default function Articles() {
  const { id } = useProject();
  const { data, mutate } = useApi<{ rows: Row[]; ai: boolean; cms: any }>(`/api/p/${id}/articles`, { refreshInterval: (d?: any) => (d?.rows?.some((r: Row) => ["queued", "writing"].includes(r.status)) ? 3000 : 0) });
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const aid = new URLSearchParams(window.location.search).get("aid");
    if (aid) setSel(aid);
  }, []);
  useEffect(() => {
    if (!sel && data?.rows.length && !creating) setSel(data.rows[0].id);
  }, [data, sel, creating]);
  if (!data) return <div className="p-6"><Spinner /></div>;
  if (!data.ai)
    return (
      <div className="p-4 md:p-6">
        <div className="card p-6"><Empty icon="sparkle" title="La redacción con IA no está habilitada">Configura el proveedor de IA del servidor (LLM_PROVIDER y su clave) para escribir artículos.</Empty></div>
      </div>
    );
  const choosing = creating || !data.rows.length;
  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[280px_minmax(0,1fr)] md:p-6">
      <aside className="min-w-0 space-y-2">
        <button className="btn-p w-full justify-center" onClick={() => { setCreating(true); setSel(null); }}><Icon name="plus" className="h-3.5 w-3.5" />Nuevo artículo</button>
        <div className="space-y-1">
          {data.rows.map((r) => (
            <button key={r.id} onClick={() => { setCreating(false); setSel(r.id); }} className={cx("w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-ink-100 dark:hover:bg-ink-800", sel === r.id && !creating && "bg-ink-100 dark:bg-ink-800")}>
              <div className="truncate font-medium">{r.status === "done" ? r.title : r.keyword}</div>
              <div className="flex items-center gap-1.5 text-xs text-ink-500">
                {["queued", "writing"].includes(r.status) && <Spinner className="h-3 w-3" />}
                {r.status === "done" ? `${fmt(r.words)} palabras` : STATUS[r.status]}
                {r.published && <span className="text-emerald-600">· en borrador</span>}
              </div>
            </button>
          ))}
        </div>
      </aside>
      <main className="min-w-0">
        {choosing ? (
          <div className="card p-4">
            <h2 className="mb-1 font-semibold">Escribe un artículo completo</h2>
            <p className="mb-4 text-sm text-ink-500">Listo para publicar: estructura, preguntas que hace la gente, links a tus páginas y descripción para Google. Revisado para que no invente precios, descuentos ni promesas.</p>
            <WriteFrom onCreated={async (aid) => { setCreating(false); setSel(aid); await mutate(); }} />
          </div>
        ) : sel ? (
          <Editor key={sel} aid={sel} cms={data.cms} onChange={() => { mutate(); }} />
        ) : null}
        {!choosing && !sel && <p className="text-sm text-ink-500">{plural(data.rows.length, "artículo", "artículos")}</p>}
      </main>
    </div>
  );
}
