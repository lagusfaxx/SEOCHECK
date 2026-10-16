"use client";
import { useSWRConfig } from "swr";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useProject } from "../Shell";
import { useSeoView, type SeoView } from "../useSeoView";
import { columnLabel, visibleColumns, displayValue, MODULE_HELP } from "@/lib/advice/presentation";
import { api, useApi, fmtDate } from "../ui";
import type { Analysis } from "@/lib/pro/analysis";
export type Field = {
  name: string;
  label: string;
  type?: "text" | "url" | "date" | "number" | "textarea" | "select";
  options?: string[];
  parse?: "json" | "lines" | "number";
  required?: boolean;
  placeholder?: string;
};
export type Form = {
  title: string;
  path: string;
  method?: "POST" | "PATCH" | "DELETE";
  fields: Field[];
  hint?: string;
};
const cell = (v: unknown) =>
  v == null ? "—" : v === true ? "Sí" : v === false ? "No" : String(v);
export default function ExpertPanel({
  kind,
  actions = [],
  forms = [],
  links = [],
}: {
  kind: string;
  actions?: { title: string; path: string; body?: object }[];
  forms?: Form[];
  links?: { title: string; path: string }[];
}) {
  const [view,setView]=useSeoView();
  const help=MODULE_HELP[kind];
  const { mutate: globalMutate } = useSWRConfig();
  const { id, refreshJobs } = useProject(),
    base = `/api/p/${id}/pro/${kind}`;
  const { data, error, isLoading, mutate } = useApi<Analysis & { at?: string }>(
    id ? base : null,
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [details, setDetails] = useState<unknown>();
  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter((r) =>
        Object.values(r).some((v) =>
          cell(v).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        ),
      ),
    [data, query],
  );
  const allKeys = [...new Set(rows.flatMap(Object.keys))].filter(k => k !== "clusterId" && k !== "id");
  const keys = visibleColumns(kind,allKeys,view);
  const lastPage=Math.max(0,Math.ceil(rows.length/50)-1),currentPage=Math.min(page,lastPage);
  async function call(path: string, body: object = {}, method = "POST") {
    setBusy(true);
    setMessage("");
    try {
      const result: any = await api(`${base}/${path}`, method, body);
      setMessage(
        result?.status === "queued"
          ? "Trabajo en cola; revisa su progreso en la barra de trabajos."
          : "Guardado.",
      );
      if (result?.id || result?.token || result?.signingSecret)
        setDetails(result);
      await mutate();
      await Promise.all(
        ["webhooks", "access", "tokens"].map((k) =>
          globalMutate(`${base}/${k}`),
        ),
      );
      refreshJobs();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo completar");
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>, f: Form) {
    e.preventDefault();
    const entries = new FormData(e.currentTarget),
      body: Record<string, unknown> = {};
    try {
      for (const field of f.fields) {
        const raw = String(entries.get(field.name) ?? "");
        body[field.name] =
          field.parse === "json"
            ? JSON.parse(raw)
            : field.parse === "lines"
              ? raw
                  .split(/\r?\n/)
                  .map((s) => s.trim())
                  .filter(Boolean)
              : field.parse === "number"
                ? Number(raw)
                : raw;
      }
      await call(f.path, body, f.method ?? "POST");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Formulario inválido");
    }
  }
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">
          {data?.title ?? "Herramientas expertas"}
        </h2>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            kind === "advanced" || kind === "ops" ? mutate() : call("refresh")
          }
        >
          Actualizar análisis
        </button>
        <label className="ml-auto text-sm">Vista <select aria-label="Vista" className="input ml-2 w-auto" value={view} onChange={e=>setView(e.target.value as SeoView)}><option value="guided">Guiada</option><option value="technical">Técnica</option></select></label>
        {actions.map((a) => (
          <button
            key={a.path}
            className="btn"
            disabled={busy}
            onClick={() => call(a.path, a.body)}
          >
            {a.title}
          </button>
        ))}
      </div>
      {help && <p className="text-sm text-ink-500">{help.purpose}</p>}
      {links.length > 0 && (
        <nav className="flex flex-wrap gap-4">
          {links.map((l) => (
            <Link
              className="text-blue-600 underline"
              key={l.path}
              href={`/p/${id}/${l.path}`}
            >
              {l.title}
            </Link>
          ))}
        </nav>
      )}
      {isLoading && <p role="status">Cargando datos…</p>}
      {error && (
        <p role="alert" className="text-red-600">
          {error.message}
        </p>
      )}
      {message && (
        <p role="status" className="rounded border p-3">
          {message}
        </p>
      )}
      {data && (
        <>
          <p className="text-sm text-slate-500">
            {data.source}
            {data.at ? ` · Calculado: ${fmtDate(data.at, "datetime")}` : ""}
          </p>
          <details className="text-sm"><summary className="cursor-pointer">Alcance y límites de este análisis</summary>{data.notes.map((n,i)=><p className="mt-2 text-ink-500" key={i}>{n}</p>)}</details>
          <label className="block">
            Filtrar resultados
            <input
              aria-label="Filtrar resultados"
              className="ml-3 rounded border p-2"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {!rows.length ? (
            <div className="rounded border p-4 text-sm"><p>{query ? "Ningún resultado coincide con este filtro." : help?.empty ?? "No hay datos disponibles para este análisis."}</p>{query?<button className="btn mt-2" onClick={()=>{setQuery("");setPage(0);}}>Limpiar filtro</button>:help&&<Link className="btn mt-2" href={`/p/${id}/${help.href}`}>Obtener o revisar datos</Link>}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {keys.map((k) => (
                      <th className="border-b px-3 py-2 text-left" key={k}>
                        {columnLabel(k)}
                      </th>
                    ))}
                    <th className="border-b px-3 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(currentPage * 50, currentPage * 50 + 50).map((r, i) => (
                    <tr key={i}>
                      {keys.map((k) => (
                        <td
                          className="max-w-sm break-words border-b px-3 py-2 align-top"
                          key={k}
                        >
                          {displayValue(k,r[k])}
                        </td>
                      ))}
                      <td className="border-b px-3 py-2">
                        {view==="guided"&&allKeys.some(k=>!keys.includes(k)&&r[k]!=null)&&<details className="mb-2 text-xs"><summary className="cursor-pointer">Ver detalle</summary><dl className="mt-2 space-y-2">{allKeys.filter(k=>r[k]!=null).map(k=><div key={k}><dt className="font-medium">{columnLabel(k)}</dt><dd className="break-words">{displayValue(k,r[k])}</dd></div>)}</dl></details>}
                        {kind === "crawl" && r.url && (
                          <button
                            className="underline"
                            onClick={async () => {
                              try {
                                setDetails(
                                  await api(
                                    `${base}/evidence?url=${encodeURIComponent(String(r.url))}`,
                                  ),
                                );
                              } catch (e) {
                                setMessage(String(e));
                              }
                            }}
                          >
                            Ver respuesta técnica
                          </button>
                        )}
                        {kind === "content" && r.clusterId && (
                          <button
                            className="underline"
                            disabled={busy}
                            onClick={() =>
                              call("brief", { clusterId: r.clusterId })
                            }
                          >
                            Generar brief
                          </button>
                        )}
                        {kind === "ops" && r.tipo === "Plantilla de tarea" && (
                          <button
                            className="underline"
                            disabled={busy}
                            onClick={() => call("template/apply", { id: r.id })}
                          >
                            Crear tarea
                          </button>
                        )}
                        {kind === "ops" && r.tipo === "Qué hago hoy" && (
                          <Link className="underline" href={`/p/${id}/tasks`}>
                            Gestionar tarea
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 50 && (
            <div className="flex gap-4">
              <button
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Anterior
              </button>
              <span>
                {currentPage + 1} / {Math.ceil(rows.length / 50)} ({rows.length}{" "}
                resultados)
              </span>
              <button
                disabled={currentPage === lastPage}
                onClick={() => setPage(currentPage + 1)}
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
      {forms.length>0&&<details><summary className="cursor-pointer text-sm font-medium">Opciones de configuración y herramientas avanzadas</summary><div className="mt-3 space-y-3">{forms.map((f) => (
        <details key={f.title} className="rounded border p-4">
          <summary className="cursor-pointer font-medium">{f.title}</summary>
          {f.hint && <p className="my-2 text-sm">{f.hint}</p>}
          <form
            className="mt-3 grid max-w-2xl gap-3"
            onSubmit={(e) => submit(e, f)}
          >
            {f.fields.map((field) => (
              <label className="grid gap-1 text-sm" key={field.name}>
                {field.label}
                {field.type === "textarea" ? (
                  <textarea
                    className="min-h-28 rounded border p-2"
                    name={field.name}
                    required={field.required}
                    placeholder={field.placeholder}
                  />
                ) : field.type === "select" ? (
                  <select name={field.name} className="rounded border p-2">
                    {field.options?.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="rounded border p-2"
                    name={field.name}
                    type={field.type ?? "text"}
                    required={field.required}
                    placeholder={field.placeholder}
                  />
                )}
              </label>
            ))}
            <button className="btn" disabled={busy} type="submit">
              {busy ? "Procesando…" : "Guardar"}
            </button>
          </form>
        </details>
      ))}</div></details>}
      {details !== undefined && (
        <div className="rounded border p-4">
          <div className="flex justify-between">
            <h3>Detalle</h3>
            <button onClick={() => setDetails(undefined)}>Cerrar</button>
          </div>
          <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(details, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
