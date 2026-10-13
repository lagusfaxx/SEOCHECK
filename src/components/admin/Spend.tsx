"use client";
import { useState } from "react";
import { api, cx, fmt, fmtDate, Hint, Spinner, useApi } from "../ui";

const PROV: Record<string, string> = { serpent: "Serpent", dataforseo: "DataForSEO", apify: "Apify", llm: "LLM" };

const HEALTH_CHIP: Record<string, [string, string]> = {
  ok: ["Operativo", "!bg-emerald-100 !text-emerald-800"],
  down: ["Caído", "!bg-rose-100 !text-rose-800"],
  timeout: ["No responde", "!bg-rose-100 !text-rose-800"],
  no_balance: ["Sin saldo", "!bg-amber-100 !text-amber-800"],
  rate_limit: ["Límite de ritmo", "!bg-amber-100 !text-amber-800"],
  auth: ["Credenciales", "!bg-amber-100 !text-amber-800"],
  bad_request: ["Error", "!bg-amber-100 !text-amber-800"],
};

/** Estado en vivo de las APIs (endpoints de cuenta: no gastan saldo). */
function ApiHealth({ rows, canRefresh, onRefresh }: { rows: any[]; canRefresh: boolean; onRefresh: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const live = rows.filter((h) => h.status !== "not_configured");
  if (!live.length) return null;
  return (
    <div className="mt-3 border-t border-ink-100 pt-3 dark:border-ink-800">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="lbl">Estado de APIs</span>
        <Hint text="Se consulta el estado de cuenta de cada proveedor, sin lanzar búsquedas: no gasta saldo. Se actualiza cada minuto." />
        {canRefresh && (
          <button className="btn-g ml-auto px-1.5 py-0 text-xs" disabled={busy} onClick={async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } }}>
            {busy ? <Spinner /> : "Verificar ahora"}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {live.map((h) => {
          const [label, tone] = HEALTH_CHIP[h.status] ?? [h.status, ""];
          return (
            <div key={h.provider} className="flex items-baseline gap-2" title={`${h.role}${h.status !== "ok" ? ` — ${h.message}` : ""}`}>
              <span>{h.label}</span>
              <span className={cx("chip", tone)}>{label}</span>
              <span className="ml-auto truncate text-[11px] text-ink-400 tabular-nums">{h.balance ?? (h.latencyMs != null ? `${h.latencyMs} ms` : "")}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 text-[11px] text-ink-400">Verificado {fmtDate(live[0].checkedAt, "datetime")}</div>
    </div>
  );
}

export function Spend() {
  const { data, mutate } = useApi<any>("/api/usage", { refreshInterval: 30000 });
  if (!data) return null;
  return (
    <div className="space-y-2.5 text-sm">
      {data.providers.map((p: any) => {
        const off = p.limitUsd === 0;
        const pct = p.limitUsd > 0 ? (p.spentUsd / p.limitUsd) * 100 : 0;
        const state = data.states.find((s: any) => s.provider === p.provider);
        return (
          <div key={p.provider} className={cx(off && "text-ink-400")}>
            <div className="flex items-baseline gap-2">
              <span>{PROV[p.provider] ?? p.provider}</span>
              {state && <span className="chip !bg-amber-100 !text-amber-800">{state.status === "no_balance" ? "sin saldo" : "credenciales"}</span>}
              <span className="ml-auto tabular-nums">
                ${p.spentUsd.toFixed(p.spentUsd < 1 ? 3 : 2)}
                {off ? <span className="ml-1 chip" title="Este proveedor tiene presupuesto $0: está apagado a propósito y no se usa. Se cambia en Ajustes.">Desactivado</span> : <span className="text-ink-400"> / {p.limitUsd < 0 ? "sin límite" : `$${p.limitUsd.toFixed(2)}`}</span>}
              </span>
            </div>
            {!off && <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
              <div className={cx("h-full rounded-full", pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-400" : "bg-acc")} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>}
            {!off && <div className="mt-0.5 text-[11px] text-ink-400">
              {fmt(p.calls)} {p.calls === 1 ? "llamada" : "llamadas"}{p.provider === "llm" && p.inputTokens ? ` · ${fmt(p.inputTokens)} tokens de entrada / ${fmt(p.outputTokens)} de salida` : ""}
            </div>}
          </div>
        );
      })}
      {data.health && <ApiHealth rows={data.health} canRefresh={data.scope === "instance"} onRefresh={async () => mutate(await api("/api/usage?fresh=1"), { revalidate: false })} />}
    </div>
  );
}

