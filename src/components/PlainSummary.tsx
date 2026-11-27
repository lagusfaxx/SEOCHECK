"use client";
import Link from "next/link";
import { useProject } from "./Shell";
import { cx, fmtDate, Icon, Skeleton, useApi } from "./ui";

type Line = { tone: "good" | "warn" | "bad" | "info"; title: string; text: string; href?: string; cta?: string };
type Plain = { verdict: Line["tone"]; headline: string; sub: string; next: { label: string; href: string }; lines: Line[]; good: string[]; at: string | null };

const TONE = {
  good: { dot: "bg-emerald-500", icon: "check", ring: "border-emerald-200 dark:border-emerald-900", badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400", word: "Bien" },
  warn: { dot: "bg-amber-500", icon: "alert", ring: "border-amber-200 dark:border-amber-900", badge: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400", word: "Atención" },
  bad: { dot: "bg-rose-500", icon: "alert", ring: "border-rose-200 dark:border-rose-900", badge: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400", word: "Urgente" },
  info: { dot: "bg-sky-500", icon: "info", ring: "border-ink-200 dark:border-ink-800", badge: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400", word: "Pendiente" },
} as const;

/** El estado del sitio en palabras simples: veredicto, qué importa, qué está bien y un solo siguiente paso. */
export function PlainSummary() {
  const { id } = useProject();
  const { data } = useApi<Plain>(`/api/p/${id}/plain`, { refreshInterval: 60_000 });
  if (!data) return <div className="card space-y-3 p-5"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-16 w-full" /></div>;
  const t = TONE[data.verdict];
  return (
    <section className={cx("card overflow-hidden", t.ring)} aria-label="Estado del sitio">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <span className={cx("mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full", t.badge)}><Icon name={t.icon} className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <h2 className="text-lg font-semibold leading-snug text-ink-900 dark:text-ink-50">{data.headline}</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{data.sub}</p>
          {data.at && <p className="mt-1 text-xs text-ink-400">Última revisión: {fmtDate(data.at, "datetime")}</p>}
        </div>
        <Link href={data.next.href} className="btn-p shrink-0">{data.next.label}<Icon name="chevr" className="h-3.5 w-3.5" /></Link>
      </div>
      {(data.lines.length > 0 || data.good.length > 0) && (
        <div className="grid border-t border-ink-100 dark:border-ink-800 md:grid-cols-2">
          {data.lines.length > 0 && (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {data.lines.map((l) => (
                <li key={l.title} className="flex gap-3 px-5 py-3">
                  <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE[l.tone].dot)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink-900 dark:text-ink-100">{l.title}</div>
                    <div className="text-sm text-ink-500">{l.text}</div>
                  </div>
                  {l.href && <Link href={l.href} className="shrink-0 self-center text-sm font-medium text-acc hover:underline">{l.cta ?? "Ver"}</Link>}
                </li>
              ))}
            </ul>
          )}
          {data.good.length > 0 && (
            <div className="border-ink-100 px-5 py-3 dark:border-ink-800 md:border-l">
              <div className="lbl mb-2">Lo que está bien</div>
              <ul className="space-y-1.5">
                {data.good.map((g) => (
                  <li key={g} className="flex gap-2 text-sm text-ink-700 dark:text-ink-200"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{g}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
