"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import useSWR, { type SWRConfiguration } from "swr";

export async function api<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? (res.status === 401 ? "Tu sesión venció: vuelve a iniciar sesión" : res.status >= 500 ? "Error del servidor: intenta de nuevo en un momento" : res.statusText || `Error ${res.status}`));
  return json as T;
}

export function useApi<T = any>(path: string | null, cfg?: SWRConfiguration) {
  return useSWR<T>(path, (p: string) => api<T>(p), { revalidateOnFocus: false, ...cfg });
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Fecha segura: nunca "Invalid Date" (vacía o inválida → "–"). */
export function fmtDate(v: string | number | Date | null | undefined, mode: "date" | "datetime" | "dm" = "date"): string {
  if (v == null || v === "") return "–";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "–";
  if (mode === "dm") return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" });
  return mode === "datetime" ? d.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : d.toLocaleDateString("es-CL");
}

/** Aviso flotante (errores que de otro modo no verían): lo muestra el Toaster del Shell. */
export function toast(text: string, kind: "error" | "ok" = "error") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("sc-toast", { detail: { text, kind } }));
}

/** Muestra los avisos y atrapa errores de acciones que nadie manejó (botones que llaman a la API). */
export function Toaster() {
  const [items, setItems] = useState<{ id: number; text: string; kind: "error" | "ok" }[]>([]);
  useEffect(() => {
    let n = 0;
    const push = (text: string, kind: "error" | "ok") => {
      const id = ++n;
      setItems((xs) => [...xs.slice(-3), { id, text, kind }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "error" ? 9000 : 4000);
    };
    const onToast = (e: Event) => push((e as CustomEvent).detail.text, (e as CustomEvent).detail.kind);
    const onReject = (e: PromiseRejectionEvent) => {
      const msg = e.reason instanceof Error ? e.reason.message : typeof e.reason === "string" ? e.reason : "";
      push(msg || "Algo falló. Intenta de nuevo.", "error");
    };
    window.addEventListener("sc-toast", onToast);
    window.addEventListener("unhandledrejection", onReject);
    return () => {
      window.removeEventListener("sc-toast", onToast);
      window.removeEventListener("unhandledrejection", onReject);
    };
  }, []);
  if (!items.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} role="alert" className={cx("rounded-lg px-4 py-3 text-sm shadow-xl", t.kind === "error" ? "bg-rose-600 text-white" : "bg-emerald-600 text-white")}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/**
 * Acción de un botón: mientras corre queda `busy` (para deshabilitarlo y que no se mande dos veces)
 * y si falla muestra el error en un aviso en vez de quedar en silencio.
 */
export function useAction<A extends unknown[]>(fn: (...a: A) => Promise<unknown>): [(...a: A) => Promise<void>, boolean] {
  const [busy, setBusy] = useState(false);
  const run = async (...a: A) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn(...a);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return [run, busy];
}

/** ¿Hay un job de estos tipos en cola o corriendo? */
export const jobBusy = (jobs: { kind: string; status: string }[], ...kinds: string[]) => jobs.some((j) => kinds.includes(j.kind) && (j.status === "queued" || j.status === "running"));

export const fmt = (n: number | null | undefined, d = 0) =>
  n == null || Number.isNaN(n) ? "–" : n.toLocaleString("es-CL", { maximumFractionDigits: d, minimumFractionDigits: 0 });

export const pct = (n: number | null | undefined, d = 1) => (n == null ? "–" : `${(n * 100).toFixed(d)}%`);

const PATHS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  key: "M15 7a4 4 0 1 1-3.9 4.9L4 19v2h3v-2h2v-2h2l1.1-1.1A4 4 0 0 1 15 7zm1 3a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  audit: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  rank: "M4 20V10m6 10V4m6 16v-7m6 7H2",
  gsc: "M3 12h4l3-8 4 16 3-8h4",
  content: "M4 5h16M4 10h16M4 15h10M4 20h7",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  play: "M7 4v16l13-8z",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6 6 18",
  grip: "M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  map: "M12 3v6m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 6v0M5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm14 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.5 17.5 10 14m7.5 3.5L14 14",
  table: "M3 5h18v14H3zM3 10h18M3 15h18M9 5v14",
  board: "M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v13h-4z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  ext: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4",
  copy: "M8 8h12v12H8zM4 16V4h12",
  trash: "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  down: "M6 9l6 6 6-6",
  up: "M6 15l6-6 6 6",
  check: "M5 12l5 5L20 7",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm10 3-5-5",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  doc: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7",
  menu: "M4 6h16M4 12h16M4 18h16",
  chevl: "M15 6l-6 6 6 6",
  chevr: "M9 6l6 6-6 6",
};

export function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

/** Ícono "?" con explicación al pasar el mouse (o tocar en móvil). */
export function Hint({ text, className }: { text: string; className?: string }) {
  return (
    <span tabIndex={0} className={cx("group/hint relative inline-grid h-3.5 w-3.5 cursor-help place-items-center rounded-full border border-ink-300 text-[9px] font-semibold normal-case leading-none tracking-normal text-ink-400 outline-none dark:border-ink-600", className)}>
      ?
      <span className="pointer-events-none absolute left-1/2 top-5 z-50 w-64 -translate-x-1/2 rounded-lg bg-ink-900 px-3 py-2 text-left text-xs font-normal leading-snug text-white opacity-0 shadow-xl transition group-hover/hint:opacity-100 group-focus/hint:opacity-100 dark:bg-ink-700">
        {text}
      </span>
    </span>
  );
}

export function Stat({ label, value, sub, tone, hint }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad"; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="lbl flex items-center gap-1">{label}{hint && <Hint text={hint} />}</div>
      <div className={cx("mt-0.5 truncate text-2xl font-semibold tabular-nums", tone === "good" && "text-emerald-600", tone === "bad" && "text-rose-600")}>{value}</div>
      {sub != null && <div className="text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

export function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800", className)}>
      <div className="h-full rounded-full bg-acc transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Score({ value, size = 64 }: { value: number | null | undefined; size?: number }) {
  const v = value ?? 0;
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const color = v >= 70 ? "#10b981" : v >= 45 ? "#f59e0b" : "#f43f5e";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" className="text-ink-100 dark:text-ink-800" strokeWidth={5} fill="none" />
      {value != null && <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={5} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-current text-sm font-semibold" style={{ fontSize: size / 3.6 }}>
        {value == null ? "–" : v}
      </text>
    </svg>
  );
}

export function Spark({ data, invert, w = 80, h = 22 }: { data: (number | null)[]; invert?: boolean; w?: number; h?: number }) {
  const pts = data.map((v, i) => [i, v] as const).filter(([, v]) => v != null) as [number, number][];
  if (pts.length < 2) return <span className="text-ink-300">—</span>;
  const ys = pts.map((p) => p[1]);
  const min = Math.min(...ys), max = Math.max(...ys);
  const sx = (i: number) => (i / (data.length - 1)) * (w - 2) + 1;
  const sy = (v: number) => {
    const t = max === min ? 0.5 : (v - min) / (max - min);
    return (invert ? t : 1 - t) * (h - 4) + 2;
  };
  return (
    <svg width={w} height={h}>
      <polyline fill="none" stroke="#5b5bf6" strokeWidth={1.5} points={pts.map(([i, v]) => `${sx(i)},${sy(v)}`).join(" ")} />
    </svg>
  );
}

export function Delta({ from, to, lowerIsBetter }: { from: number | null | undefined; to: number | null | undefined; lowerIsBetter?: boolean }) {
  if (from == null || to == null) return null;
  const d = lowerIsBetter ? from - to : to - from;
  if (Math.abs(d) < 0.05) return <span className="text-xs text-ink-400">=</span>;
  return <span className={cx("text-xs tabular-nums", d > 0 ? "text-emerald-600" : "text-rose-600")}>{d > 0 ? "▲" : "▼"}{fmt(Math.abs(d), Math.abs(d) < 10 ? 1 : 0)}</span>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; icon?: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5 dark:border-ink-800 dark:bg-ink-900">
      {items.map((it) => (
        <button key={it.id} onClick={() => onChange(it.id)} className={cx("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition", value === it.id ? "bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900" : "text-ink-500 hover:text-ink-900 dark:hover:text-ink-100")}>
          {it.icon && <Icon name={it.icon} className="h-3.5 w-3.5" />}
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Drawer({ open, onClose, children, wide }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/30 backdrop-blur-[1px]" onClick={onClose}>
      <div className={cx("h-full overflow-y-auto border-l border-ink-200 bg-white p-5 shadow-2xl dark:border-ink-800 dark:bg-ink-900", wide ? "w-full max-w-3xl" : "w-full max-w-xl")} onClick={(e) => e.stopPropagation()}>
        <button className="btn-g float-right" onClick={onClose}>
          <Icon name="x" />
        </button>
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid place-items-center rounded-xl border border-dashed border-ink-200 p-10 text-sm text-ink-400 dark:border-ink-800">{children}</div>;
}

export const INTENT: Record<string, { label: string; cls: string }> = {
  informational: { label: "info", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
  commercial: { label: "comercial", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  transactional: { label: "transacc.", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  navigational: { label: "naveg.", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
};

export function IntentChip({ intent }: { intent?: string | null }) {
  if (!intent) return null;
  const i = INTENT[intent] ?? { label: intent, cls: "" };
  return <span className={cx("rounded px-1.5 py-0.5 text-[11px] font-medium", i.cls)}>{i.label}</span>;
}

export const SEV: Record<string, string> = {
  critical: "bg-rose-500",
  warning: "bg-amber-400",
  info: "bg-sky-400",
};

export type Col<T> = { key: string; label: ReactNode; get: (r: T) => any; render?: (r: T) => ReactNode; num?: boolean; className?: string };

/** Tabla ordenable por cualquier columna. */
export function DataTable<T>({ rows, cols, initial, onRow, rowKey, max = 500, selected }: { rows: T[]; cols: Col<T>[]; initial?: { key: string; dir: 1 | -1 }; onRow?: (r: T) => void; rowKey: (r: T) => string; max?: number; selected?: string | null }) {
  const [sort, setSort] = useState(initial ?? { key: cols[0].key, dir: 1 as 1 | -1 });
  const [limit, setLimit] = useState(max);
  const sorted = useMemo(() => {
    const c = cols.find((c) => c.key === sort.key);
    if (!c) return rows;
    return [...rows].sort((a, b) => {
      const x = c.get(a), y = c.get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }, [rows, cols, sort]);
  return (
    <div>
      <table className="tbl">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={cx(c.num && "num", c.className)} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((-s.dir) as 1 | -1) : c.num ? -1 : 1 }))}>
                {c.label}
                {sort.key === c.key && <span className="ml-0.5 text-acc">{sort.dir === 1 ? "↑" : "↓"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, limit).map((r) => (
            <tr key={rowKey(r)} onClick={() => onRow?.(r)} className={cx(onRow && "cursor-pointer", selected === rowKey(r) && "[&>td]:bg-acc-soft dark:[&>td]:bg-acc/20")}>
              {cols.map((c) => (
                <td key={c.key} className={cx(c.num && "num", c.className)}>
                  {c.render ? c.render(r) : c.get(r) ?? "–"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > limit && (
        <button className="btn-g m-2" onClick={() => setLimit((l) => l + max)}>
          +{fmt(sorted.length - limit)}
        </button>
      )}
    </div>
  );
}

export function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    if (typeof window === "undefined") return init;
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : init;
    } catch {
      return init;
    }
  });
  return [
    v,
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, JSON.stringify(nv));
      } catch {}
    },
  ];
}

export function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="btn-g"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
    >
      <Icon name={ok ? "check" : "copy"} className="h-3.5 w-3.5" />
    </button>
  );
}
