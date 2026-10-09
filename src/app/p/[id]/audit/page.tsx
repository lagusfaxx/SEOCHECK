"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useProject } from "@/components/Shell";
import { api, cx, Metric, DataTable, Drawer, Empty, fmt, Hint, Icon, Score, SEV, Stat, Tabs, useApi, type Col, fmtDate, Spinner, IconBadge } from "@/components/ui";
import { ISSUE_FIX, ISSUE_WHY } from "@/lib/audit/fixes";
import { CRAWL_STATUS } from "@/lib/status";
import { HEALTH_HELP, healthLabel, SEVERITY_LABEL, SEVERITY_TEXT } from "@/lib/presentation";
import { Coverage } from "@/components/Coverage";

const SEV_HINT: Record<string, string> = {
  critical: "Problemas que impiden que Google vea o indexe páginas. Arreglar primero.",
  warning: "Problemas que bajan el rendimiento SEO. Arreglar después de los errores.",
  info: "Mejoras recomendadas. No penalizan por sí solas; revisa si aplican a tu sitio.",
};

type PageRow = { id: string; url: string; status: number; titleLen: number; metaLen: number; wordCount: number; depth: number; inlinks: number; outlinks: number; responseMs: number; canonicalType: string; noindex: boolean; inSitemap: boolean; orphan: boolean; jsonldTypes: string[]; imgNoAlt: number; title: string | null; issues: number };
type IssueAgg = { code: string; label: string; severity: string; count: number };

/** Sin el "Sin H1: " inicial, que repite el nombre del issue. */
const short = (t: string) => {
  const r = t.replace(/^[^:.]{1,32}:\s*/, "");
  return r.charAt(0).toUpperCase() + r.slice(1);
};
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const statusCls = (s: number) => (s === 200 ? "text-emerald-600" : s >= 300 && s < 400 ? "text-amber-600" : "text-rose-600");

function cwv(metric: string, v: number | null | undefined) {
  if (v == null) return "";
  const th: Record<string, [number, number]> = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], fcp: [1800, 3000], tbt: [200, 600], ttfb: [800, 1800] };
  const [g, b] = th[metric] ?? [Infinity, Infinity];
  return v <= g ? "text-emerald-600" : v <= b ? "text-amber-600" : "text-rose-600";
}
const ms = (v: number | null | undefined) => (v == null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)} ms`);

/** Una URL por plantilla: home + primer segmento distinto + profundidades. */
function templates(pages: PageRow[]) {
  const ok = pages.filter((p) => p.status === 200 && !p.noindex);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...ok].sort((a, b) => b.inlinks - a.inlinks)) {
    const segs = path(p.url).split("/").filter(Boolean);
    const sig = segs.length === 0 ? "home" : `${segs[0]}:${Math.min(segs.length, 3)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(p.url);
    if (out.length >= 6) break;
  }
  return out;
}

export default function AuditPage() {
  const { id, project, refreshJobs, jobs } = useProject();
  const [crawl, setCrawl] = useState("");
  const { data, mutate } = useApi<any>(`/api/p/${id}/audit${crawl ? `?crawl=${crawl}` : ""}`);
  const [tab, setTab] = useState<"summary" | "issues" | "urls" | "speed" | "index">("summary");
  const [opt, setOpt] = useState({ maxPages: 500, concurrency: 5, render: false });
  const [issue, setIssue] = useState<IssueAgg | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [summaryLimit,setSummaryLimit]=useState(25);
  const [expanded, setExpanded] = useState<string|null>(null);
  useEffect(()=>{setPageUrl(new URLSearchParams(window.location.search).get("url"));const key=window.location.hash.slice(1);if(key==="speed"||key==="index")setTab(key);},[]);
  const running = jobs.some((j) => j.kind === "audit.crawl" && (j.status === "running" || j.status === "queued"));

  const cur = data?.crawls?.find((c: any) => c.id === data.crawlId);
  const st = cur?.stats ?? {};
  const pages: PageRow[] = data?.pages ?? [];
  const issues: IssueAgg[] = data?.issues ?? [];
  const run = async (p: string, body: object) => {
    await api(`/api/p/${id}/${p}`, "POST", body);
    refreshJobs();
  };

  const pageCols: Col<PageRow>[] = [
    { key: "url", label: "URL", get: (p) => p.url, render: (p) => <span className="block max-w-[420px] truncate" title={p.url}>{path(p.url)}</span> },
    { key: "status", label: "Estado", get: (p) => p.status, render: (p) => <span className={statusCls(p.status)}>{p.status || "—"}</span>, num: true },
    { key: "issues", label: "Errores", get: (p) => p.issues, num: true },
    { key: "depth", label: "Profundidad", get: (p) => p.depth, render: (p) => (p.depth < 0 ? "–" : p.depth), num: true },
    { key: "in", label: "Entrantes", get: (p) => p.inlinks, num: true },
    { key: "out", label: "Salientes", get: (p) => p.outlinks, num: true },
    { key: "words", label: "Palabras", get: (p) => p.wordCount, render: (p) => `${fmt(p.wordCount)} palabras`, num: true },
    { key: "title", label: "Título", get: (p) => p.titleLen, render: (p) => <span className={cx(p.titleLen > 60 || !p.titleLen ? "text-amber-600" : "")}>{p.titleLen} caracteres</span>, num: true },
    { key: "meta", label: "Meta", get: (p) => p.metaLen, render: (p) => <span className={cx(p.metaLen > 155 || !p.metaLen ? "text-amber-600" : "")}>{p.metaLen} caracteres</span>, num: true },
    { key: "ms", label: "Respuesta", get: (p) => p.responseMs, render: (p) => `${p.responseMs} ms`, num: true },
    { key: "flags", label: "", get: (p) => (p.noindex ? 1 : 0) + (p.orphan ? 2 : 0), render: (p) => (
      <span className="flex gap-1">
        {p.noindex && <span className="chip"><Metric label="noindex"/></span>}
        {p.orphan && <span className="chip"><Metric label="Huérfana"/></span>}
        {p.canonicalType === "other" && <span className="chip"><Metric label="Canonical"/></span>}
        {p.inSitemap && <span className="chip"><Metric label="Sitemap"/></span>}
      </span>
    ) },
  ];

  const filtered = useMemo(() => pages.filter((p) => !q || p.url.includes(q)), [pages, q]);
  const sevOrder = ["critical", "warning", "info"];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <span className="text-sm text-ink-500">https://{project?.domain}</span>
        <details className="text-sm"><summary className="cursor-pointer">Opciones avanzadas</summary><div className="mt-3 flex flex-wrap gap-3">
        <label className="flex items-center gap-1 text-xs text-ink-500">Máximo de URLs<input className="input w-20" type="number" value={opt.maxPages} onChange={(e) => setOpt({ ...opt, maxPages: Number(e.target.value) })} /></label>
        <label className="flex items-center gap-1 text-xs text-ink-500">Concurrencia<input className="input w-14" type="number" min={1} max={20} value={opt.concurrency} onChange={(e) => setOpt({ ...opt, concurrency: Number(e.target.value) })} /></label>
        <label className={cx("flex items-center gap-1 text-xs", project?.providers?.render ? "text-ink-500" : "text-ink-300")} title={project?.providers?.render ? "" : "requiere BROWSER_WS_ENDPOINT"}>
          <input type="checkbox" disabled={!project?.providers?.render} checked={opt.render} onChange={(e) => setOpt({ ...opt, render: e.target.checked })} />Renderizar JavaScript
        </label>
        </div></details>
        <button className="btn-p hov-nudge" disabled={running} onClick={() => run("audit", opt)}>{running ? <><Spinner className="h-4 w-4" />Analizando…</> : <><Icon name="play" />Analizar sitio</>}</button>
        {data?.crawls?.length > 0 && (
          <select className="input ml-auto w-auto" value={data.crawlId} onChange={(e) => setCrawl(e.target.value)}>
            {data.crawls.map((c: any) => (
              <option key={c.id} value={c.id}>{fmtDate(c.startedAt, "datetime")} · {CRAWL_STATUS[c.status]?.label ?? c.status}{c.stats?.pages != null ? ` · ${fmt(c.stats.pages)} URL${c.stats.pages === 1 ? "" : "s"}` : ""}</option>
            ))}
          </select>
        )}
      </div>

      <Coverage projectId={id} />

      {cur && cur.status !== "completed" && (
        <div className={cx("anim-in flex items-start gap-3 rounded-xl px-4 py-3 text-sm", CRAWL_STATUS[cur.status]?.cls)}>
          {cur.status === "running" || cur.status === "queued" ? <Spinner className="mt-0.5 h-4 w-4 shrink-0" /> : <Icon name={cur.status === "partial" ? "info" : "alert"} anim={cur.status === "failed" ? "wiggle" : "pop"} className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="font-semibold">Análisis {CRAWL_STATUS[cur.status]?.label ?? cur.status}</span>
          <span className="flex-1">
            {cur.reason ??
              (cur.status === "running" || cur.status === "queued" ? "Los resultados aparecen al terminar." : "")}
            {cur.status === "partial" && " Los resultados son incompletos: el puntaje y los problemas solo cubren lo que se pudo leer."}
            {cur.status === "failed" && " No hay puntaje ni problemas que mostrar: revisa la dirección del sitio, el firewall (Cloudflare) o vuelve a intentar."}
          </span>
        </div>
      )}

      {!data?.crawlId ? (
        <Empty icon="audit" tone="good" title="Todavía no auditas este sitio">Selecciona Analizar sitio para revisar sus páginas.</Empty>
      ) : cur && !["completed", "partial"].includes(cur.status) ? null : (
        <>
          <div className="card grid grid-cols-2 items-center gap-6 p-4 md:grid-cols-8">
            <div className="row-span-2 flex flex-col items-center gap-1 md:row-span-1" title={st.healthNote ?? undefined}>
              <div className="flex items-start gap-1"><Score value={st.health} size={72} /><Hint text={HEALTH_HELP} /></div>
              <span className="lbl">Salud técnica</span><span className="text-sm">{healthLabel(st.health)}</span>
              {st.health == null && st.healthNote && <span className="max-w-[140px] text-center text-[11px] leading-tight text-ink-500">{st.healthNote}</span>}
            </div>
            <Stat label="URLs" value={fmt(st.pages)} hint="Páginas revisadas: las que el crawler encontró siguiendo links, más las del sitemap que no alcanzó por links." />
            <Stat label="Errores HTTP" value={fmt(st.errors)} tone={st.errors ? "bad" : undefined} hint="Páginas que respondieron con error (404, 500) o no respondieron." />
            <Stat label="Redirecciones" value={fmt(st.redirects)} hint="URLs que redirigen a otra. Normal en pocas; los links internos deberían apuntar directo a la URL final." />
            <Stat label="Huérfanas" value={fmt(st.orphans)} hint="Están en el sitemap pero ninguna página revisada las enlaza. Si el crawl llegó al máximo, muchas pueden ser falsas: sube el máximo." />
            <Stat label="Sitemap" value={fmt(st.sitemap)} hint="URLs listadas en tu sitemap.xml." />
            <Stat label="Respuesta" value={ms(st.avgMs)} hint="Tiempo promedio del servidor en responder el HTML. Bajo 500 ms está bien; sobre 1,5 s es lento." />
            <Stat label="Externos" value={fmt(st.external)} hint="Dominios externos distintos a los que enlaza tu sitio." />
          </div>

          <p className="text-sm"><span className="text-rose-700">{fmt(st.critical)} errores</span> · <span className="text-amber-700">{fmt(st.warning)} advertencias</span> · {fmt(st.info)} observaciones <Hint text="Las observaciones son recomendaciones y no descuentan puntos de salud técnica. Revisa su relevancia antes de cambiarlas."/></p>
          <Tabs value={tab} onChange={setTab} items={[{ id: "summary", label: "Páginas", icon: "table" }, { id: "issues", label: "Problemas", icon: "alert" }, { id: "urls", label: "URLs · vista técnica", icon: "table" }, { id: "speed", label: "Velocidad", icon: "bolt" }, { id: "index", label: "Indexación", icon: "search" }]} />

          {tab === "summary" && <div className="card overflow-hidden">
            <div className="p-3"><input aria-label="Filtrar páginas" className="input w-full md:w-80" placeholder="Buscar URL" value={q} onChange={e=>setQ(e.target.value)}/></div>
            <div className="overflow-auto"><table className="tbl min-w-[680px] table-fixed"><colgroup><col style={{width:"40%"}}/><col style={{width:"14%"}}/><col style={{width:"14%"}}/><col style={{width:"16%"}}/><col style={{width:"16%"}}/></colgroup><thead><tr>{['URL','Estado','Problemas','Palabras','Respuesta'].map(label=><th key={label}><Metric label={label}/></th>)}</tr></thead><tbody>
              {filtered.slice(0,summaryLimit).map(p=><Fragment key={p.id}><tr><td><button className="max-w-full truncate text-left underline-offset-4 hover:underline" aria-expanded={expanded===p.url} onClick={()=>setExpanded(expanded===p.url?null:p.url)}>{expanded===p.url?'−':'+'} {path(p.url)}</button></td><td>{p.status || 'Sin respuesta'}</td><td>{p.issues}</td><td>{fmt(p.wordCount)} palabras</td><td>{p.responseMs} ms</td></tr>{expanded===p.url&&<tr><td colSpan={5} className="!whitespace-normal"><PageDrawer inline crawlId={data.crawlId} url={p.url} onClose={()=>setExpanded(null)} onUrl={setPageUrl} run={run}/></td></tr>}</Fragment>)}
            </tbody></table></div>{filtered.length>summaryLimit&&<button className="btn-g m-3" onClick={()=>setSummaryLimit(n=>n+25)}>Mostrar 25 páginas más</button>}
          </div>}

          {tab === "issues" && (
            <div className="stagger grid gap-4 md:grid-cols-3">
              {sevOrder.map((sev) => (
                <div key={sev} className="card p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <IconBadge name={sev === "info" ? "info" : "alert"} tone={sev === "critical" ? "bad" : sev === "warning" ? "warn" : "info"} size="sm" anim="pop" pulse={sev === "critical" && issues.some((i) => i.severity === "critical")} />
                    <span className="lbl">{SEVERITY_LABEL[sev]}</span>
                    <Hint text={SEV_HINT[sev]} />
                    <span className="ml-auto text-sm font-semibold tabular-nums">{fmt(issues.filter((i) => i.severity === sev).reduce((s, i) => s + i.count, 0))}</span>
                  </div>
                  <div className="space-y-0.5">
                    {issues.filter((i) => i.severity === sev).sort((a, b) => b.count - a.count).map((i) => (
                      <button key={i.code} onClick={() => setIssue(i)} className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-800">
                        <span className="min-w-0 flex-1">
                          <span className="block">{i.label}</span>
                        </span>
                        <span className="ml-3 tabular-nums text-ink-500">{fmt(i.count)}</span>
                      </button>
                    ))}
                    {!issues.some((i) => i.severity === sev) && <div className="px-2 py-1.5 text-sm text-ink-300">—</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "urls" && (
            <div className="card overflow-hidden">
              <div className="border-b border-ink-200 p-3 dark:border-ink-800">
                <input className="input w-72" placeholder="filtrar url" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="max-h-[calc(100vh-380px)] overflow-auto">
                <DataTable rows={filtered} cols={pageCols} rowKey={(p) => p.id} initial={{ key: "issues", dir: -1 }} onRow={(p) => setPageUrl(p.url)} />
              </div>
            </div>
          )}

          {tab === "speed" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <button className="btn" onClick={() => run("audit/psi", { urls: templates(pages) })}><Icon name="bolt" />Plantillas clave</button>
                <span className="self-center text-xs text-ink-400">{templates(pages).map(path).join("  ")}</span>
              </div>
              <PsiTable rows={data.psi ?? []} />
            </div>
          )}

          {tab === "index" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <button className="btn" disabled={!project?.gscProperty || !project?.providers?.gsc} onClick={() => run("audit/inspect", { urls: templates(pages) })}><Icon name="eye" />Inspeccionar plantillas</button>
                <button className="btn" disabled={!project?.gscProperty || !project?.providers?.gsc} onClick={() => run("audit/inspect", { urls: pages.filter((p) => p.inSitemap && p.status === 200).slice(0, 100).map((p) => p.url) })}>Sitemap (100)</button>
                {(!project?.gscProperty || !project?.providers?.gsc) && <a href={`/p/${id}/settings#gsc`} className="self-center text-xs text-acc">conecta Search Console para inspeccionar</a>}
              </div>
              <div className="card overflow-auto">
                <DataTable
                  rows={data.inspections ?? []}
                  rowKey={(r: any) => r.id}
                  cols={[
                    { key: "url", label: "URL", get: (r: any) => r.url, render: (r: any) => <span className="block max-w-[360px] truncate">{path(r.url)}</span> },
                    { key: "verdict", label: "Veredicto", get: (r: any) => r.verdict, render: (r: any) => <span className={r.verdict === "PASS" ? "text-emerald-600" : "text-rose-600"}>{r.verdict}</span> },
                    { key: "cov", label: "Cobertura", get: (r: any) => r.coverageState },
                    { key: "gc", label: "Canonical Google", get: (r: any) => r.googleCanonical, render: (r: any) => <span className={cx("block max-w-[260px] truncate", r.googleCanonical && r.userCanonical && r.googleCanonical !== r.userCanonical && "text-amber-600")}>{r.googleCanonical ? path(r.googleCanonical) : "–"}</span> },
                    { key: "lc", label: "Último análisis", get: (r: any) => r.lastCrawl, render: (r: any) => fmtDate(r.lastCrawl) },
                  ]}
                />
              </div>
            </div>
          )}
        </>
      )}

      <IssueDrawer crawlId={data?.crawlId} issue={issue} onClose={() => setIssue(null)} onUrl={(u) => { setIssue(null); setPageUrl(u); }} />
      <PageDrawer crawlId={data?.crawlId} url={pageUrl} onClose={() => setPageUrl(null)} onUrl={setPageUrl} run={run} />
    </div>
  );
}

function PsiTable({ rows }: { rows: any[] }) {
  const latest = new Map<string, any>();
  for (const r of rows) if (!latest.has(`${r.url}|${r.strategy}`)) latest.set(`${r.url}|${r.strategy}`, r);
  const list = [...latest.values()];
  if (!list.length) return <Empty icon="bolt" tone="warn" title="Sin mediciones de velocidad">Mide con PageSpeed las páginas principales para ver Core Web Vitals.</Empty>;
  return (
    <div className="card overflow-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>URL</th><th></th><th className="num">Score</th>
            <th className="num"><Metric label="LCP lab"/></th><th className="num"><Metric label="CLS lab"/></th><th className="num"><Metric label="TBT"/></th>
            <th className="num"><Metric label="LCP campo"/></th><th className="num"><Metric label="INP campo"/></th><th className="num"><Metric label="CLS campo"/></th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td className="max-w-[300px] truncate">{path(r.url)}</td>
              <td><span className="chip">{r.strategy === "mobile" ? "móvil" : "desktop"}</span></td>
              <td className="num font-semibold">{r.score ?? "–"}</td>
              <td className={cx("num", cwv("lcp", r.lab.lcp))}>{ms(r.lab.lcp)}</td>
              <td className={cx("num", cwv("cls", r.lab.cls))}>{r.lab.cls?.toFixed(3) ?? "–"}</td>
              <td className={cx("num", cwv("tbt", r.lab.tbt))}>{ms(r.lab.tbt)}</td>
              {r.field?.lcp || r.field?.inp || r.field?.cls ? (
                <>
                  <td className={cx("num", cwv("lcp", r.field.lcp?.p75))}>{r.field.lcp ? ms(r.field.lcp.p75) : "sin datos"}{r.field.source === "origin" && <span className="ml-1 text-[10px] text-ink-400" title="CrUX a nivel de origen: la URL no tiene datos propios">origen</span>}</td>
                  <td className={cx("num", cwv("inp", r.field.inp?.p75))}>{r.field.inp ? ms(r.field.inp.p75) : "sin datos"}</td>
                  <td className={cx("num", cwv("cls", r.field.cls ? r.field.cls.p75 / 100 : null))}>{r.field.cls ? (r.field.cls.p75 / 100).toFixed(2) : "sin datos"}</td>
                </>
              ) : (
                <td colSpan={3} className="text-center text-xs text-ink-400" title="CrUX no tiene datos de campo para esta URL ni su origen">sin datos de campo</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IssueDrawer({ crawlId, issue, onClose, onUrl }: { crawlId?: string; issue: IssueAgg | null; onClose: () => void; onUrl: (u: string) => void }) {
  const { id } = useProject();
  const { data } = useApi<any[]>(issue && crawlId ? `/api/p/${id}/audit/issue?crawl=${crawlId}&code=${issue.code}` : null);
  return (
    <Drawer open={!!issue} onClose={onClose}>
      <div className="flex items-center gap-2">
        <span className={cx("h-2.5 w-2.5 rounded-full", SEV[issue?.severity ?? "info"])} />
        <h2 className="text-lg font-semibold">{issue?.label}</h2>
        <span className="text-ink-400">{fmt(issue?.count)}</span>
      </div>
      {issue && (ISSUE_WHY[issue.code] || ISSUE_FIX[issue.code]) && (
        <div className="mt-3 space-y-2 rounded-lg bg-ink-50 p-3 text-sm dark:bg-ink-800/50">
          {ISSUE_WHY[issue.code] && <p><b className="font-medium">Qué es: </b><span className="text-ink-600 dark:text-ink-300">{ISSUE_WHY[issue.code]}</span></p>}
          {ISSUE_FIX[issue.code] && <p><b className="font-medium">Cómo arreglarlo: </b><span className="text-ink-600 dark:text-ink-300">{ISSUE_FIX[issue.code]}</span></p>}
        </div>
      )}
      <div className="mt-4 divide-y divide-ink-100 dark:divide-ink-800">
        {data?.map((r) => (
          <button key={r.id} className="block w-full py-2 text-left hover:text-acc" onClick={() => onUrl(r.url)}>
            <div className="truncate text-sm">{r.url}</div>
            {r.detail && <div className="truncate text-xs text-ink-400">{r.detail}</div>}
          </button>
        ))}
      </div>
    </Drawer>
  );
}

function PageDrawer({ crawlId, url, onClose, onUrl, run, inline = false }: { inline?: boolean; crawlId?: string; url: string | null; onClose: () => void; onUrl: (u: string) => void; run: (p: string, b: object) => Promise<void> }) {
  const { id, project } = useProject();
  const { data } = useApi<any>(url && crawlId ? `/api/p/${id}/audit/page?crawl=${crawlId}&url=${encodeURIComponent(url)}` : null);
  const p = data?.page;
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="w-36 shrink-0 text-ink-500"><Metric label={k}/></span>
      <span className="min-w-0 break-words">{v ?? "–"}</span>
    </div>
  );
  const Wrapper = ({children}:{children:React.ReactNode}) => inline ? <div className="p-3">{children}</div> : <Drawer open={!!url} onClose={onClose} wide>{children}</Drawer>;
  return (
    <Wrapper>
      <a href={p?.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 pr-10 text-sm text-acc hover:underline">
        <span className="truncate">{url}</span>
        <Icon name="ext" className="h-3.5 w-3.5 shrink-0" />
      </a>
      {p && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn" onClick={() => run("audit/psi", { urls: [p.url] })}><Icon name="bolt" />PageSpeed</button>
            <button className="btn" disabled={!project?.gscProperty || !project?.providers?.gsc} onClick={() => run("audit/inspect", { urls: [p.url] })}><Icon name="eye" />Inspección GSC</button>
            <button className="btn" disabled={!project?.providers?.indexnow} onClick={() => api(`/api/p/${id}/indexnow`, "POST", { urls: [p.url] })}>IndexNow</button>
          </div>
          <div className="mt-4 space-y-2">
            {data.issues.length ? data.issues.map((i:any)=><div key={i.id} className="border-b border-ink-100 pb-2 text-sm"><span className={SEVERITY_TEXT[i.severity]}>{SEVERITY_LABEL[i.severity]}</span> · <b>{i.label}</b>{i.code==='meta_long'?` · ${p.metaLen} caracteres · recomendado ≤155`:i.code==='title_long'?` · ${p.titleLen} caracteres · recomendado ≤60`:i.detail?` · ${i.detail}`:''}<details className="mt-1 text-xs"><summary>Cómo corregirlo</summary><p>{ISSUE_WHY[i.code]} {ISSUE_FIX[i.code]}</p></details></div>):<p className="text-sm">Sin incidencias detectadas en esta página.</p>}
          </div>
          <div className="mt-4 divide-y divide-ink-100 dark:divide-ink-800">
            {row("Estado", <span className={statusCls(p.status)}>{p.status || "Sin respuesta"} · {p.responseMs} ms</span>)}
            {(p.redirects as any[]).length > 0 && row("Redirecciones", (p.redirects as any[]).map((r) => `${r.status} ${r.url}`).concat(p.finalUrl).join(" → "))}
            {row("Título", <>{p.title} <span className="text-ink-400">({p.titleLen} caracteres)</span></>)}
            {row("Meta", <>{p.metaDesc} <span className="text-ink-400">({p.metaLen} caracteres)</span></>)}
            {row("H1", p.h1.join(" | "))}
            {row("Canonical", p.canonical ? <>{p.canonical} <span className="chip">{p.canonicalType}</span></> : "–")}
            {row("Indexación", p.noindex ? <span className="text-rose-600">noindex</span> : "sí")}
            {row("hreflang", (p.hreflang as any[]).map((h) => `${h.lang}`).join(", ") || "–")}
            {row("JSON-LD", p.jsonldTypes.join(", ") + (p.jsonldErrors ? ` · ${p.jsonldErrors} con error` : ""))}
            {row("Palabras", `${fmt(p.wordCount)} palabras`)}
            {row("Img sin alt", p.imgNoAlt)}
            {row("Profundidad", p.depth)}
            {row("Entrantes", p.inlinks)}
            {row("Salientes", p.outlinks)}
            {row("Sitemap", p.inSitemap ? "sí" : "no")}
          </div>
          {data.inbound.length > 0 && (
            <div className="mt-4">
              <div className="lbl mb-1">Enlazada desde</div>
              {data.inbound.map((u: string) => (
                <button key={u} className="block max-w-full truncate text-left text-sm text-ink-500 hover:text-acc" onClick={() => onUrl(u)}>{u}</button>
              ))}
            </div>
          )}
        </>
      )}
    </Wrapper>
  );
}
