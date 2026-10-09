"use client";
import Link from "next/link";
import { useApi } from "./ui";
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
  const missing = mods.filter((m) => m.state !== "ok").length;
  return (
    <details className={compact ? "text-[11px]" : "text-xs"}>
      <summary className="cursor-pointer text-ink-500">
        {missing
          ? `Datos incompletos · ${missing} fuentes por completar`
          : "Datos del informe completos"}
      </summary>
      <ul className="mt-2 divide-y divide-ink-100 dark:divide-ink-800">
        {mods.map((m) => (
          <li key={m.key} className="flex flex-wrap items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <span className="font-medium">{m.label}</span>
              <p className="mt-1 text-ink-500">{m.detail}</p>
            </div>
            <Link
              className="underline underline-offset-4"
              href={`/p/${projectId}${m.state === "missing" && m.key !== "gsc" ? "/settings#providers" : (ACTION[m.key]?.[1] ?? "/settings")}`}
            >
              {m.state === "ok"
                ? "Ver datos"
                : m.state === "missing" && m.key !== "gsc"
                  ? "Revisar configuración"
                  : (ACTION[m.key]?.[0] ?? "Revisar ajustes")}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
