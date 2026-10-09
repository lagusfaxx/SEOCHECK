"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useProject } from "@/components/Shell";
import { GscConnect } from "@/components/GscConnect";
import { api, cx, Icon, jobBusy, Score, Spinner, useAction, useApi } from "@/components/ui";

type St = "done" | "running" | "todo" | "skipped" | "failed";
type Ob = {
  domain: string;
  status: Record<"site" | "audit" | "gsc" | "keywords" | "rank", St>;
  finished: boolean;
  crawl: { status: string; reason: string | null; health: number | null; healthNote: string | null; pages: number; critical: number } | null;
  gsc: { connected: boolean; property: string | null };
  tracked: number;
  suggestions: { seeds: string[]; rank: string[]; fromGsc: boolean };
};

const STEPS = [
  { key: "site", title: "Agregar sitio", icon: "globe", why: "El dominio que vamos a revisar." },
  { key: "audit", title: "Ejecutar auditoría", icon: "audit", why: "Recorremos tu sitio como Google y buscamos errores técnicos. Tarda de 1 a 10 minutos según el tamaño." },
  { key: "gsc", title: "Conectar Search Console", icon: "gsc", why: "Con qué búsquedas te encuentran, qué páginas pierden tráfico y dónde están las oportunidades. Datos reales de Google." },
  { key: "keywords", title: "Seleccionar keywords", icon: "key", why: "Qué busca tu cliente ideal. Agrupamos las búsquedas en temas para saber qué páginas crear u optimizar." },
  { key: "rank", title: "Activar rankings", icon: "rank", why: "Seguimos cada semana tu posición en Google para las búsquedas que más te importan." },
] as const;

export default function StartPage() {
  const { id, jobs, refreshJobs } = useProject();
  const router = useRouter();
  const anyRunning = jobBusy(jobs, "audit.crawl", "keywords.run", "rank.check", "gsc.sync");
  const { data, mutate } = useApi<Ob>(`/api/p/${id}/onboarding`, { refreshInterval: anyRunning ? 3000 : 0 });
  const [open, setOpen] = useState<string | null>(null);

  // al terminar un job, refrescar el estado
  useEffect(() => {
    if (!anyRunning) mutate();
  }, [anyRunning, mutate]);

  if (!data) return <div className="grid flex-1 place-items-center"><Spinner className="h-6 w-6 text-acc" /></div>;
  const current = STEPS.find((s) => data.status[s.key] === "todo" || data.status[s.key] === "failed" || data.status[s.key] === "running")?.key ?? null;
  const active = open ?? current;
  const doneCount = STEPS.filter((s) => data.status[s.key] === "done" || data.status[s.key] === "skipped").length;

  const skip = async (key: string) => {
    const cur = STEPS.filter((s) => data.status[s.key] === "skipped").map((s) => s.key);
    await api(`/api/p/${id}`, "PATCH", { settings: { onboarding: { skipped: [...new Set([...cur, key])] } } });
    setOpen(null);
    mutate();
  };
  const finish = async () => {
    await api(`/api/p/${id}`, "PATCH", { settings: { onboarding: { done: true } } });
    router.push(`/p/${id}`);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
      <div className="anim-in">
        <h1 className="text-xl font-semibold">Primeros pasos con {data.domain}</h1>
        <p className="mt-1 text-sm text-ink-500">Cinco pasos y SEOCHECK te dice qué arreglar primero. Puedes saltar los que no apliquen y volver cuando quieras.</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
            <div className="h-full rounded-full bg-acc transition-all duration-700" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
          </div>
          <span className="text-sm tabular-nums text-ink-500">{doneCount}/{STEPS.length}</span>
        </div>
      </div>

      <ol className="stagger space-y-2">
        {STEPS.map((s, i) => {
          const st = data.status[s.key];
          const isOpen = active === s.key;
          return (
            <li key={s.key} className={cx("card overflow-hidden transition", isOpen && "ring-2 ring-acc/40")}>
              <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen(isOpen ? "__none" : s.key)}>
                <StepDot n={i + 1} st={st} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.title}</div>
                  <div className="text-xs text-ink-500">{stepLine(s.key, st, data)}</div>
                </div>
                <Icon name={s.icon} className="h-5 w-5 text-ink-300" />
              </button>
              {isOpen && (
                <div className="anim-in space-y-3 border-t border-ink-100 p-4 dark:border-ink-800">
                  <p className="text-sm text-ink-600 dark:text-ink-300">{s.why}</p>
                  {s.key === "site" && <SiteStep data={data} />}
                  {s.key === "audit" && <AuditStep data={data} onStarted={() => { refreshJobs(); mutate(); }} />}
                  {s.key === "gsc" && <GscStep data={data} onSkip={() => skip("gsc")} />}
                  {s.key === "keywords" && <KeywordsStep data={data} onStarted={() => { refreshJobs(); mutate(); }} onSkip={() => skip("keywords")} />}
                  {s.key === "rank" && <RankStep data={data} onDone={() => { refreshJobs(); mutate(); }} onSkip={() => skip("rank")} />}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center justify-between gap-3">
        <Link href={`/p/${id}`} className="btn-g text-sm">Ir al resumen sin terminar</Link>
        <button className={cx("btn-p", data.finished && "hov-nudge")} disabled={!data.finished} onClick={finish} title={data.finished ? "" : "Completa o salta los pasos pendientes"}>
          <Icon name={data.finished ? "rocket" : "lock"} />Listo, ver qué hago ahora
        </button>
      </div>
    </div>
  );
}

function StepDot({ n, st }: { n: number; st: St }) {
  if (st === "done") return <span className="ic-pop grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500 text-white"><Icon name="check" anim="draw" className="h-4 w-4" /></span>;
  if (st === "running") return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-acc-soft text-acc dark:bg-acc/20"><Spinner className="h-4 w-4" /></span>;
  if (st === "failed") return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-rose-100 text-rose-600"><Icon name="alert" anim="wiggle" className="h-4 w-4" /></span>;
  if (st === "skipped") return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-100 text-xs text-ink-400 dark:bg-ink-800">—</span>;
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-acc text-sm font-semibold text-acc">{n}</span>;
}

function stepLine(key: string, st: St, d: Ob): string {
  if (st === "skipped") return "Saltado: puedes volver cuando quieras";
  switch (key) {
    case "site": return d.domain;
    case "audit":
      if (st === "running") return "Recorriendo el sitio…";
      if (st === "failed") return d.crawl?.reason ?? "No se pudo completar";
      return d.crawl ? `${d.crawl.pages} ${d.crawl.pages === 1 ? "URL revisada" : "URLs revisadas"} · salud técnica ${d.crawl.health ?? "sin puntaje"}` : "Pendiente";
    case "gsc": return d.gsc.connected && d.gsc.property ? `Conectado · ${d.gsc.property}` : d.gsc.connected ? "Conectado: falta elegir la propiedad" : "Pendiente";
    case "keywords": return st === "running" ? "Investigando keywords…" : st === "done" ? "Investigación lista" : st === "failed" ? "La investigación falló: vuelve a intentarlo" : "Pendiente";
    case "rank": return d.tracked ? `${d.tracked} keywords monitoreadas` : "Pendiente";
  }
  return "";
}

function SiteStep({ data }: { data: Ob }) {
  const { id } = useProject();
  return <p className="text-sm">Revisaremos <b>https://{data.domain}</b>. ¿Está mal? <Link className="text-acc" href={`/p/${id}/settings`}>Cámbialo en Ajustes</Link>.</p>;
}

function AuditStep({ data, onStarted }: { data: Ob; onStarted: () => void }) {
  const { id, jobs } = useProject();
  const job = jobs.find((j) => j.kind === "audit.crawl" && (j.status === "queued" || j.status === "running"));
  const [start, busy] = useAction(async () => { await api(`/api/p/${id}/audit`, "POST", { maxPages: 500 }); onStarted(); });
  if (job || data.status.audit === "running")
    return (
      <div className="flex items-center gap-3 rounded-lg bg-acc-soft/60 p-3 text-sm dark:bg-acc/10">
        <Spinner className="h-5 w-5 text-acc" />
        <div className="flex-1">
          <div className="font-medium">Auditando… {job ? `${job.progress}%` : ""}</div>
          <div className="text-xs text-ink-500">{job?.message ?? "en cola"} · puedes seguir con el siguiente paso mientras tanto</div>
        </div>
      </div>
    );
  if (data.crawl && data.status.audit === "done")
    return (
      <div className="flex items-center gap-4">
        <Score value={data.crawl.health} size={64} />
        <div className="text-sm">
          <div className="font-medium">Salud técnica {data.crawl.health ?? "—"}{data.crawl.health != null ? "/100" : ""}</div>
          <div className="text-ink-500">{data.crawl.healthNote ?? `${data.crawl.pages} ${data.crawl.pages === 1 ? "URL revisada" : "URLs revisadas"} · ${data.crawl.critical} errores`}</div>
          <Link className="text-acc" href={`/p/${id}/audit`}>Ver prioridades →</Link>
        </div>
      </div>
    );
  return (
    <div className="space-y-2">
      {data.status.audit === "failed" && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{data.crawl?.reason ?? "El último intento falló."}</p>}
      <button className="btn-p hov-nudge" disabled={busy} onClick={() => start()}>{busy ? <Spinner className="h-4 w-4" /> : <Icon name="play" />}{data.status.audit === "failed" ? "Reintentar auditoría" : "Auditar ahora"}</button>
    </div>
  );
}

function GscStep({ data, onSkip }: { data: Ob; onSkip: () => void }) {
  const { id } = useProject();
  return (
    <div className="space-y-3">
      <GscConnect returnTo={`/p/${id}/start`} />
      {data.status.gsc !== "done" && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-500">¿No tienes Search Console todavía?</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-600 dark:text-ink-300">
            <li>Entra a <a className="text-acc" href="https://search.google.com/search-console" target="_blank" rel="noreferrer">search.google.com/search-console</a> con la cuenta de Google de la empresa.</li>
            <li>Elige <b>Dominio</b> y escribe <b>{data.domain}</b> (cubre www, http y https).</li>
            <li>Google te da un registro <b>TXT</b>: agrégalo en el DNS de tu dominio. En NIC Chile: <i>Mis dominios → Administrar DNS</i> (o en tu proveedor de DNS si lo delegaste). En Cloudflare: <i>DNS → Records → Add record → TXT</i>.</li>
            <li>Vuelve a Search Console y presiona <b>Verificar</b> (puede tardar unos minutos). Los datos empiezan a aparecer en 2–3 días.</li>
            <li>Vuelve aquí y presiona <b>Conectar con Google</b>.</li>
          </ol>
        </details>
      )}
      {data.status.gsc !== "done" && (
        <button className="btn-g text-sm" onClick={() => { if (confirm("Sin Search Console no verás clics, impresiones ni posiciones reales, y la prioridad de las tareas se estimará sin tráfico real. ¿Continuar igual?")) onSkip(); }}>
          Continuar sin Search Console
        </button>
      )}
    </div>
  );
}

function Chips({ items, sel, toggle }: { items: string[]; sel: Set<string>; toggle: (s: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((k) => (
        <button key={k} onClick={() => toggle(k)} className={cx("ic-pop inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm transition", sel.has(k) ? "border-acc bg-acc text-white" : "border-ink-200 hover:border-acc dark:border-ink-700")}>
          {sel.has(k) && <Icon name="check" className="h-3 w-3" />}{k}
        </button>
      ))}
    </div>
  );
}

function KeywordsStep({ data, onStarted, onSkip }: { data: Ob; onStarted: () => void; onSkip: () => void }) {
  const { id } = useProject();
  const [sel, setSel] = useState<Set<string>>(() => new Set(data.suggestions.seeds.slice(0, 3)));
  const [extra, setExtra] = useState("");
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const seeds = [...sel, ...extra.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)];
  const [run, busy] = useAction(async () => { await api(`/api/p/${id}/keywords/run`, "POST", { seeds }); onStarted(); });
  if (data.status.keywords === "running") return <Running text="Investigando keywords: buscamos en Google, agrupamos y calculamos volúmenes. Puedes seguir mientras tanto." />;
  if (data.status.keywords === "done") return <p className="text-sm">Listo. <Link className="text-acc" href={`/p/${id}/keywords`}>Ver los clusters →</Link></p>;
  return (
    <div className="space-y-3">
      {data.suggestions.seeds.length > 0 && (
        <div>
          <div className="lbl mb-1.5">{data.suggestions.fromGsc ? "Búsquedas con las que ya te encuentran" : "Sacadas de tu página de inicio"}</div>
          <Chips items={data.suggestions.seeds} sel={sel} toggle={toggle} />
        </div>
      )}
      <input className="input" placeholder="Agrega otras (lo que vendes o haces), separadas por coma" value={extra} onChange={(e) => setExtra(e.target.value)} />
      <div className="flex items-center gap-2">
        <button className="btn-p" disabled={busy || !seeds.length} onClick={() => run()}>{busy ? <Spinner className="h-4 w-4" /> : <Icon name="search" />}Investigar {seeds.length || ""}</button>
        <button className="btn-g text-sm" onClick={onSkip}>Saltar por ahora</button>
      </div>
    </div>
  );
}

function RankStep({ data, onDone, onSkip }: { data: Ob; onDone: () => void; onSkip: () => void }) {
  const { id } = useProject();
  const [sel, setSel] = useState<Set<string>>(() => new Set(data.suggestions.rank.slice(0, 5)));
  const [extra, setExtra] = useState("");
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const kws = [...sel, ...extra.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)];
  const [go, busy] = useAction(async () => { await api(`/api/p/${id}/rank`, "POST", { keywords: kws }); onDone(); });
  if (data.status.rank === "done") return <p className="text-sm">Monitoreando {data.tracked} keywords. <Link className="text-acc" href={`/p/${id}/rank`}>Ver posiciones →</Link></p>;
  return (
    <div className="space-y-3">
      {data.suggestions.rank.length > 0 ? (
        <div>
          <div className="lbl mb-1.5">{data.suggestions.fromGsc ? "Ya rankean cerca de la primera página (mejor oportunidad)" : "Sugeridas"}</div>
          <Chips items={data.suggestions.rank} sel={sel} toggle={toggle} />
        </div>
      ) : (
        <p className="text-sm text-ink-500">Escribe las búsquedas por las que quieres aparecer en Google.</p>
      )}
      <input className="input" placeholder="Otras keywords, separadas por coma" value={extra} onChange={(e) => setExtra(e.target.value)} />
      <div className="flex items-center gap-2">
        <button className="btn-p" disabled={busy || !kws.length} onClick={() => go()}>{busy ? <Spinner className="h-4 w-4" /> : <Icon name="target" />}Monitorear {kws.length || ""}</button>
        <button className="btn-g text-sm" onClick={onSkip}>Saltar por ahora</button>
      </div>
    </div>
  );
}

function Running({ text }: { text: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-acc-soft/60 p-3 text-sm dark:bg-acc/10">
      <Spinner className="h-5 w-5 text-acc" />
      <span>{text}</span>
    </div>
  );
}
