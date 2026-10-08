"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { useProject } from "@/components/Shell";
import { api, cx, Icon, useApi, fmtDate, Spinner, Skeleton } from "@/components/ui";

type Step = { step: string; status: "ok" | "skipped" | "error"; detail?: string };
type Job = { id: string; status: string; progress: number; message: string | null; createdAt: string; updatedAt: string; log: { msg: string; data?: unknown }[] };

const STEP: Record<string, string> = { crawl: "Crawl", gsc: "Search Console", inspect: "Indexación", psi: "PageSpeed", keywords: "Keywords", rank: "Rankings", alerts: "Alertas" };

export default function ReportPage() {
  const { id, refreshJobs, project } = useProject();
  const { data: last, mutate: refreshLast } = useApi<Job | null>(`/api/p/${id}/report/last`, {
    refreshInterval: (j?: Job | null) => (j && (j.status === "queued" || j.status === "running") ? 2000 : 0),
  });
  const running = !!last && (last.status === "queued" || last.status === "running");
  const { data: md, mutate: refreshMd, isLoading } = useSWR(`/api/p/${id}/report`, (u: string) => fetch(u).then((r) => r.text()), { revalidateOnFocus: false });
  const { data: kw } = useApi<{ runs?: { seeds: string[] }[] }>(`/api/p/${id}/keywords`);

  const [maxPages, setMaxPages] = useState(1000);
  const [conc, setConc] = useState(3);
  const [seeds, setSeeds] = useState<string | null>(null);
  const [opt, setOpt] = useState({ gsc: true, inspect: true, psi: true, rank: true, keywords: false });
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const seedText = seeds ?? kw?.runs?.[0]?.seeds?.join("\n") ?? "";

  // al terminar el job, recargar el informe
  useEffect(() => {
    if (last?.status === "done") refreshMd();
  }, [last?.status, last?.id, refreshMd]);

  const start = async () => {
    setErr("");
    try {
      await api(`/api/p/${id}/report`, "POST", {
        maxPages,
        concurrency: conc,
        seeds: opt.keywords ? seedText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) : [],
        gsc: opt.gsc,
        inspect: opt.inspect,
        psi: opt.psi,
        rank: opt.rank,
      });
      refreshJobs();
      refreshLast();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const steps = (last?.log ?? []).find((l) => l.msg === "informe completo")?.data as Step[] | undefined;
  const copy = async () => {
    if (!md) return;
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const toggle = (k: keyof typeof opt) => setOpt((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="card space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink-500">https://{project?.domain}</span>
          <label className="flex items-center gap-1.5 text-ink-500">máx <input className="input w-24" type="number" value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} /></label>
          <label className="flex items-center gap-1.5 text-ink-500">conc. <input className="input w-16" type="number" value={conc} onChange={(e) => setConc(Number(e.target.value))} /></label>
          {(["gsc", "inspect", "psi", "rank", "keywords"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={opt[k]} onChange={() => toggle(k)} />
              {STEP[k]}
            </label>
          ))}
          <button className="btn-p ml-auto" disabled={running} onClick={start}>
            {running ? <Spinner className="h-4 w-4" /> : <Icon name="rocket" />}
            {running ? `${last?.progress ?? 0}% · ${last?.message ?? "en cola"}` : "Correr todo"}
          </button>
        </div>
        {opt.keywords && (
          <textarea className="input w-full" rows={3} placeholder="semillas (una por línea)" value={seedText} onChange={(e) => setSeeds(e.target.value)} />
        )}
        {err && <div className="text-sm text-rose-600">{err}</div>}
        {steps && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {steps.map((s) => (
              <span
                key={s.step}
                title={s.detail}
                className={cx("chip", s.status === "ok" && "!bg-emerald-100 !text-emerald-700", s.status === "error" && "!bg-rose-100 !text-rose-700", s.status === "skipped" && "!text-ink-400")}
              >
                {STEP[s.step] ?? s.step}
                {s.detail ? ` · ${s.detail}` : ""}
              </span>
            ))}
          </div>
        )}
        {last?.status === "error" && <div className="text-sm text-rose-600">{last.message}</div>}
      </div>

      <div className="card">
        <div className="flex items-center gap-2 border-b border-ink-100 p-3 dark:border-ink-800">
          <span className="lbl">Informe</span>
          {last && <span className="text-xs text-ink-400">{fmtDate(last.updatedAt, "datetime")}</span>}
          <button className="btn hov-spin ml-auto" onClick={() => refreshMd()}><Icon name="refresh" /></button>
          <button className="btn" onClick={copy} disabled={!md}><Icon name={copied ? "check" : "copy"} anim={copied ? "pop" : undefined} />{copied ? "Copiado" : "Copiar"}</button>
          <a className="btn" href={`/api/p/${id}/report?download=1`}><Icon name="down" />.md</a>
        </div>
        {isLoading ? (
          <div className="space-y-2 p-4">{[90, 70, 80, 50, 75, 60].map((w, i) => <div key={i} style={{ width: `${w}%` }}><Skeleton className="h-3" /></div>)}</div>
        ) : (
          <pre className="anim-in max-h-[calc(100vh-280px)] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed">{md}</pre>
        )}
      </div>
    </div>
  );
}
