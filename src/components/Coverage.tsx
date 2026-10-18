"use client";
import Link from "next/link";
import { useApi } from "./ui";
import { UNAVAILABLE } from "@/lib/presentation";
type Mod = {
  key: string;
  label: string;
  state: string;
  detail: string;
  short: string;
};
const ACTION: Record<string, [string, string]> = {
  crawl: ["Analizar sitio", "/audit"],
  gsc: ["Conectar o sincronizar", "/gsc"],
  psi: ["Medir velocidad", "/audit#speed"],
  inspect: ["Revisar indexación", "/audit#index"],
  keywords: ["Investigar keywords", "/keywords"],
  rank: ["Seleccionar keywords", "/rank"],
};
export function Coverage({
  projectId,
  only,
  compact,
}: {
  projectId: string;
  only?: string[];
  compact?: boolean;
}) {
  const { data } = useApi<Mod[]>(`/api/p/${projectId}/coverage`);
  if (!data) return null;
  const mods = only ? data.filter((m) => only.includes(m.key)) : data;
  if (!mods.length) return null;
  // lo que la instalación no ofrece no es algo «por completar»: se lista aparte, sin acción
  const unavailable = mods.filter((m) => m.detail === UNAVAILABLE);
  const usable = mods.filter((m) => m.detail !== UNAVAILABLE);
  const missing = usable.filter((m) => m.state !== "ok").length;
  return (
    <details className={compact ? "text-[11px]" : "text-xs"}>
      <summary className="cursor-pointer text-ink-500">
        {missing
          ? `Datos incompletos · ${missing} ${missing === 1 ? "fuente" : "fuentes"} por completar`
          : "Fuentes de datos al día"}
      </summary>
      <ul className="mt-2 divide-y divide-ink-100 dark:divide-ink-800">
        {usable.map((m) => (
          <li key={m.key} className="flex flex-wrap items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <span className="font-medium">{m.label}</span>
              <p className="mt-1 text-ink-500">{m.detail}</p>
            </div>
            <Link
              className="underline underline-offset-4"
              href={`/p/${projectId}${m.state === "ok" ? (ACTION[m.key]?.[1] ?? "") : m.key === "inspect" && m.state === "missing" ? "/gsc" : m.key === "ga4" ? "/results" : (ACTION[m.key]?.[1] ?? "/settings")}`}
            >
              {m.state === "ok"
                ? "Ver datos"
                : m.key === "inspect" && m.state === "missing"
                  ? "Conectar Search Console"
                  : m.key === "ga4"
                    ? "Conectar Analytics"
                    : (ACTION[m.key]?.[0] ?? "Revisar")}
            </Link>
          </li>
        ))}
        {unavailable.length > 0 && (
          <li className="py-2 text-ink-500">
            {UNAVAILABLE}: {unavailable.map((m) => m.label).join(", ")}.
          </li>
        )}
      </ul>
    </details>
  );
}
