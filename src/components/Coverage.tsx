"use client";
import Link from "next/link";
import { cx, Hint, Icon, useApi } from "./ui";

type Mod = { key: string; label: string; state: "ok" | "partial" | "failed" | "missing" | "never"; detail: string; short: string; percent?: number };

const STYLE: Record<Mod["state"], { icon: string; cls: string }> = {
  ok: { icon: "check", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-900" },
  partial: { icon: "info", cls: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900" },
  failed: { icon: "alert", cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:ring-rose-900" },
  missing: { icon: "lock", cls: "bg-ink-50 text-ink-500 ring-ink-200 dark:bg-ink-800 dark:text-ink-400 dark:ring-ink-700" },
  never: { icon: "clock", cls: "bg-ink-50 text-ink-500 ring-ink-200 dark:bg-ink-800 dark:text-ink-400 dark:ring-ink-700" },
};
/** a dónde ir para completar cada módulo */
const HREF: Record<string, string> = { crawl: "/audit", gsc: "/settings#gsc", psi: "/audit", inspect: "/audit", keywords: "/keywords", rank: "/rank" };

/**
 * Qué datos respaldan los números: el puntaje es de salud TÉCNICA y vale según lo que se pudo leer.
 * "Crawl 100% · GSC conectado · PageSpeed disponible · Indexación no configurada".
 */
export function Coverage({ projectId, only, compact }: { projectId: string; only?: string[]; compact?: boolean }) {
  const { data } = useApi<Mod[]>(`/api/p/${projectId}/coverage`);
  if (!data) return null;
  const mods = only ? data.filter((m) => only.includes(m.key)) : data;
  return (
    <div className={cx("flex flex-wrap items-center gap-1.5", compact ? "text-[11px]" : "text-xs")}>
      {!compact && (
        <span className="lbl mr-1 flex items-center gap-1">
          Cobertura
          <Hint text="Qué datos hay detrás de los números. Si algo falta o falló, los resultados de ese módulo pueden estar incompletos." />
        </span>
      )}
      {mods.map((m) => (
        <Link key={m.key} href={`/p/${projectId}${HREF[m.key] ?? ""}`} title={m.detail} className={cx("anim-in inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 transition hover:brightness-95", STYLE[m.state].cls)}>
          <Icon name={STYLE[m.state].icon} className="h-3 w-3" anim={m.state === "ok" ? "pop" : undefined} />
          {m.short}
        </Link>
      ))}
    </div>
  );
}
