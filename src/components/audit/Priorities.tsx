"use client";
import { useState } from "react";
import { cx, Empty, fmt, Hint, Icon, IconBadge, Skeleton, Tabs, useApi } from "@/components/ui";
import { KIND_HINT, KIND_LABEL, PAGE_KIND_LABEL, type Finding, type Intentional, type Kind, type Pattern, type Priority } from "@/lib/audit/insights";

type Resp = {
  findings: (Finding & { total: number })[];
  intentional: Intentional[];
  patterns: Pattern[];
  summary: { alta: number; media: number; baja: number; confirmed: number; possible: number; opportunity: number; templates: number };
  hasGsc: boolean;
  cms: string | null;
};

const PRIO: Record<Priority, { label: string; dot: string; cls: string }> = {
  alta: { label: "Alta", dot: "bg-rose-500", cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:ring-rose-900" },
  media: { label: "Media", dot: "bg-amber-400", cls: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900" },
  baja: { label: "Baja", dot: "bg-ink-300", cls: "bg-ink-50 text-ink-600 ring-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:ring-ink-700" },
};
const KIND_STYLE: Record<Kind, { icon: string; tone: "bad" | "warn" | "info" }> = {
  confirmed: { icon: "alert", tone: "bad" },
  possible: { icon: "search", tone: "warn" },
  opportunity: { icon: "sparkle", tone: "info" },
};
const PATTERN_ICON: Record<Pattern["kind"], string> = { template: "layers", pageKind: "doc", cms: "gear", together: "map" };
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";

export function Priorities({ projectId, crawlId, onIssue }: { projectId: string; crawlId: string; onIssue: (code: string) => void }) {
  const { data, isLoading } = useApi<Resp>(`/api/p/${projectId}/audit/insights?crawl=${crawlId}`);
  const [kind, setKind] = useState<"all" | Kind>("all");
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading || !data)
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
      </div>
    );
  const s = data.summary;
  const list = data.findings.filter((f) => kind === "all" || f.kind === kind);
  if (!data.findings.length) return <Empty icon="check" tone="good" title="Sin problemas que priorizar">El crawl no encontró problemas reales (lo que parece intencional no cuenta).</Empty>;

  return (
    <div className="space-y-4">
      {/* resumen */}
      <div className="stagger grid gap-3 md:grid-cols-4">
        {(["alta", "media", "baja"] as const).map((p) => (
          <div key={p} className={cx("rounded-xl p-3 ring-1", PRIO[p].cls)}>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
              <span className={cx("h-2 w-2 rounded-full", PRIO[p].dot, p === "alta" && s.alta > 0 && "animate-pulse")} />Prioridad {PRIO[p].label.toLowerCase()}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{s[p]}</div>
          </div>
        ))}
        <div className="card p-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-500">
            <Icon name="layers" className="h-3.5 w-3.5" />Problemas de plantilla
            <Hint text="Problemas que se repiten en casi todas las URLs de una sección: se corrigen una vez en la plantilla y se arreglan todas." />
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{s.templates}</div>
        </div>
      </div>

      {!data.hasGsc && (
        <div className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-900/20 dark:text-sky-200">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
          Sin Search Console la prioridad se estima por estructura del sitio. Conéctalo para que suba lo que tiene tráfico real y baje lo que nadie ve.
        </div>
      )}

      {data.patterns.length > 0 && (
        <div className="card p-3">
          <div className="lbl mb-2 flex items-center gap-1.5"><Icon name="refresh" className="h-3.5 w-3.5 text-acc" anim="twinkle" />Patrones detectados</div>
          <ul className="space-y-1.5 text-sm">
            {data.patterns.map((p, i) => (
              <li key={i} className="flex gap-2"><Icon name={PATTERN_ICON[p.kind]} className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />{p.text}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={kind}
          onChange={setKind}
          items={[
            { id: "all", label: `Todo (${data.findings.length})` },
            { id: "confirmed", label: `Confirmados (${s.confirmed})`, icon: "alert" },
            { id: "possible", label: `Posibles (${s.possible})`, icon: "search" },
            { id: "opportunity", label: `Oportunidades (${s.opportunity})`, icon: "sparkle" },
          ]}
        />
        {kind !== "all" && <span className="text-xs text-ink-500">{KIND_HINT[kind]}</span>}
      </div>

      <div className="stagger space-y-2">
        {list.map((f) => (
          <div key={f.id} className="card overflow-hidden">
            <button className="flex w-full items-start gap-3 p-3 text-left hover:bg-ink-50 dark:hover:bg-ink-800/40" onClick={() => setOpen(open === f.id ? null : f.id)}>
              <IconBadge name={KIND_STYLE[f.kind].icon} tone={KIND_STYLE[f.kind].tone} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1", PRIO[f.priority].cls)}>
                    <span className={cx("h-1.5 w-1.5 rounded-full", PRIO[f.priority].dot)} />{PRIO[f.priority].label}
                  </span>
                  <span className="font-medium">{f.label}</span>
                  <span className="chip font-mono">{f.template}</span>
                  {f.pageKind && f.pageKind !== "page" && <span className="chip">{PAGE_KIND_LABEL[f.pageKind]}</span>}
                  <span className="chip" title={KIND_HINT[f.kind]}>{KIND_LABEL[f.kind]}</span>
                </div>
                <p className={cx("mt-1 text-sm", f.rootCause ? "font-medium text-ink-900 dark:text-ink-100" : "text-ink-600 dark:text-ink-300")}>{f.summary}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {f.reasons.map((r, i) => <span key={i} className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-600 dark:bg-ink-800 dark:text-ink-300">{r}</span>)}
                </div>
              </div>
              <Icon name={open === f.id ? "up" : "down"} className="mt-1 h-4 w-4 shrink-0 text-ink-400" />
            </button>
            {open === f.id && (
              <div className="anim-in space-y-3 border-t border-ink-100 p-3 text-sm dark:border-ink-800">
                {f.fix && (
                  <div className="flex gap-2 rounded-lg bg-emerald-50 p-2.5 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">
                    <Icon name="content" className="mt-0.5 h-4 w-4 shrink-0" /><span><b>Cómo arreglarlo:</b> {f.fix}</span>
                  </div>
                )}
                <div>
                  <div className="lbl mb-1">URLs afectadas ({fmt(f.total)})</div>
                  <ul className="max-h-48 space-y-0.5 overflow-auto font-mono text-xs text-ink-600 dark:text-ink-300">
                    {f.urls.map((u) => <li key={u} className="truncate" title={u}>{path(u)}</li>)}
                    {f.total > f.urls.length && <li className="text-ink-400">… y {fmt(f.total - f.urls.length)} más</li>}
                  </ul>
                </div>
                <button className="btn text-xs" onClick={() => onIssue(f.code)}><Icon name="table" />Ver todas en Issues</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {data.intentional.length > 0 && (
        <details className="card p-3 text-sm">
          <summary className="cursor-pointer text-ink-500">Revisado, parece intencional ({data.intentional.reduce((a, b) => a + b.count, 0)}): no se cuenta como problema</summary>
          <ul className="mt-2 space-y-1">
            {data.intentional.map((i) => <li key={i.code}>• {i.text}. <span className="text-xs text-ink-400">Ej.: {i.examples.map(path).join(" · ")}</span></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
