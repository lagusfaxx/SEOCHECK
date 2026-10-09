"use client";
import { createPortal } from "react-dom";
import { metricHelp } from "@/lib/presentation";
import { useId, useEffect, useMemo, useState, type ReactNode } from "react";
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
        <div key={t.id} role="alert" className={cx("anim-slide flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm shadow-xl", t.kind === "error" ? "bg-rose-600 text-white" : "bg-emerald-600 text-white")}>
          <Icon name={t.kind === "error" ? "alert" : "check"} anim={t.kind === "error" ? "wiggle" : "draw"} className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{t.text}</span>
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
  alert: "M12 4 2.5 20h19zM12 10v4M12 17h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  chart: "M3 3v18h18M7 15l4-4 3 3 5-6",
  trend: "M3 17l6-6 4 4 8-8M14 7h7v7",
  inbox: "M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.8 2.5 15.2 0 18M12 3c-2.5 2.8-2.5 15.2 0 18",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  rocket: "M5 15c-1 1-1.5 4-1.5 4.5S6 19 7 18M9 12l3 3M14.5 4.5C18 3 21 3 21 3s0 3-1.5 6.5L13 16l-5-5zM8 11l-3-.5 2.5-3H11M13 16l.5 3 3-2.5V13",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2m0 8v2",
  wand: "M4 20 15 9M14 4v2M19 9h2M17.5 5.5l1.5-1.5M10 4l.5 1.5M19 14l1.5.5",
  layers: "M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5",
};

type Anim = "spin" | "float" | "pop" | "draw" | "wiggle" | "twinkle";

/** Ícono SVG. `anim` le da movimiento: girar (cargando), flotar, aparecer, dibujarse, sacudirse (alertas) o titilar. */
export function Icon({ name, className = "h-4 w-4", anim }: { name: keyof typeof PATHS | string; className?: string; anim?: Anim }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={cx(className, anim && `ic-${anim}`)} style={anim === "draw" ? ({ "--sc-len": 80 } as React.CSSProperties) : undefined} aria-hidden>
      <path d={PATHS[name] ?? ""} pathLength={anim === "draw" ? 80 : undefined} />
    </svg>
  );
}

/** Rueda de carga. */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("ic-spin", className)} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2.5} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}

const TONE: Record<string, string> = {
  acc: "bg-acc-soft text-acc dark:bg-acc/20",
  good: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
  bad: "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400",
  warn: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
  info: "bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400",
  mute: "bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400",
};

/** Ícono dentro de un cuadrito de color; `pulse` le agrega una onda (algo está vivo o pide atención). */
export function IconBadge({ name, tone = "acc", size = "md", anim, pulse }: { name: string; tone?: keyof typeof TONE; size?: "sm" | "md" | "lg"; anim?: Anim; pulse?: boolean }) {
  const box = size === "lg" ? "h-14 w-14 rounded-2xl" : size === "sm" ? "h-7 w-7 rounded-lg" : "h-9 w-9 rounded-xl";
  const ic = size === "lg" ? "h-7 w-7" : size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]";
  return (
    <span className={cx("relative inline-grid shrink-0 place-items-center", box, TONE[tone])}>
      <span className="relative"><Icon name={name} className={ic} /></span>
    </span>
  );
}

/** Bloque gris animado mientras carga. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={cx("skeleton rounded-md", className)} />;
}

/** Ícono "?" con explicación al pasar el mouse (o tocar en móvil). */
export function Hint({ text, className }: { text: string; className?: string }) {
  const id = useId();
  const [pos, setPos] = useState<{left:number;top:number}|null>(null);
  const show = (target: HTMLElement) => { const r=target.getBoundingClientRect(); setPos({left:Math.max(8,Math.min(window.innerWidth-272,r.left-120)),top:Math.max(8,Math.min(window.innerHeight-160,r.bottom+8))}); };
  return <span role="button" aria-label="Más información" aria-describedby={pos ? id : undefined} tabIndex={0} onMouseEnter={e=>show(e.currentTarget)} onMouseLeave={()=>setPos(null)} onFocus={e=>show(e.currentTarget)} onBlur={()=>setPos(null)} onClick={e=>{e.preventDefault();e.stopPropagation();show(e.currentTarget);}} onKeyDown={e=>{if(e.key==='Escape')setPos(null);if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();show(e.currentTarget);}}} className={cx("inline-grid h-3.5 w-3.5 cursor-help place-items-center rounded-full border border-ink-300 text-[9px] font-semibold normal-case leading-none tracking-normal text-ink-500",className)}>
    ?{pos && createPortal(<span id={id} role="tooltip" style={{left:pos.left,top:pos.top}} className="pointer-events-none fixed z-[100] w-64 rounded border border-ink-700 bg-ink-900 px-3 py-2 text-left text-xs font-normal leading-snug text-white">{text}</span>,document.body)}
  </span>;
}
export function Metric({label}:{label:string}) { const help=metricHelp(label);return <span className="inline-flex items-center gap-1">{label}{help&&<Hint text={help}/>}</span>; }

export function Stat({ label, value, sub, tone, hint, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad"; hint?: string; icon?: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      {icon && <IconBadge name={icon} tone={tone ?? "acc"} anim="pop" />}
      <div className="min-w-0">
        <div className="lbl flex items-center gap-1">{label}{(hint || metricHelp(label)) && <Hint text={hint || metricHelp(label)} />}</div>
        <div className={cx("mt-0.5 truncate text-2xl font-semibold tabular-nums anim-in", tone === "good" && "text-emerald-600", tone === "bad" && "text-rose-600")}>{value}</div>
        {sub != null && <div className="text-xs text-ink-500">{sub}</div>}
      </div>
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
      {value != null && <circle key={v} className="gauge" style={{ "--sc-c": c } as React.CSSProperties} cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={5} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-current text-sm font-semibold" style={{ fontSize: size / 3.6 }}>
        {value == null ? "–" : v}
      </text>
      {value != null && <text x="50%" y="76%" textAnchor="middle" className="fill-current text-ink-500" style={{fontSize: Math.max(8,size/9)}}>/100</text>}
    </svg>
  );
}

/** Lectura en palabras del puntaje de contenido (0–100), con los mismos cortes de color que <Score>. */
export const contentScoreLabel = (v: number | null | undefined) => (v == null ? "Sin datos" : v >= 70 ? "Bien optimizada" : v >= 45 ? "Necesita mejoras" : "Muy por debajo del top 10");

/** "1 URL" / "2 URLs". */
export const plural = (n: number | null | undefined, one: string, many: string) => `${fmt(n ?? 0)} ${n === 1 ? one : many}`;

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

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; icon?: string; title?: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5 dark:border-ink-800 dark:bg-ink-900">
      {items.map((it) => (
        <button key={it.id} title={it.title} onClick={() => onChange(it.id)} className={cx("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition", value === it.id ? "bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900" : "text-ink-500 hover:text-ink-900 dark:hover:text-ink-100")}>
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
        <button className="btn-g float-right" aria-label="Cerrar detalle" onClick={onClose}>
          <Icon name="x" />
        </button>
        {children}
      </div>
    </div>
  );
}

/** Estado vacío: ícono flotando + título + qué hacer. */
export function Empty({ children, icon = "inbox", title, tone = "acc", compact }: { children?: ReactNode; icon?: string; title?: ReactNode; tone?: keyof typeof TONE; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-start gap-2 text-sm text-ink-500", compact ? "py-2" : "p-4")}>
      <Icon name={icon} className="h-4 w-4 text-ink-400"/>
      {title && <div className="font-medium text-ink-800 dark:text-ink-100">{title}</div>}
      {children != null && <div className="max-w-sm text-ink-500">{children}</div>}
    </div>
  );
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
  info: "bg-ink-400",
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
                {typeof c.label === "string" ? <Metric label={c.label}/> : c.label}
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
