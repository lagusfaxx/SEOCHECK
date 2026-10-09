import { CONTACT_HREF } from "./Footer";
import { BusinessLogo } from "./Brands";
import { PLATFORMS, type Business } from "@/lib/site-content";

/** Piezas compartidas del sitio público (home, /capacidades, /work). */

export function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`font-mono text-xs uppercase tracking-[0.2em] text-fsv-muted ${className}`}>{children}</div>;
}

export function Capability({ id, n, title, text, cta, href = CONTACT_HREF, visual }: { id: string; n: string; title: string; text: string; cta: string; href?: string; visual: React.ReactNode }) {
  return (
    <article id={id} className="grid scroll-mt-20 overflow-hidden rounded-2xl border border-fsv-line bg-fsv-bg md:grid-cols-2">
      <div className="flex flex-col p-8 md:p-12">
        <Kicker>{n}</Kicker>
        <h3 className="mt-6 font-display text-3xl font-semibold leading-tight tracking-[-0.025em] md:text-4xl">{title}</h3>
        <p className="mt-4 max-w-md leading-relaxed text-fsv-muted">{text}</p>
        <a href={href} className="mt-8 inline-flex w-fit items-center gap-2 font-medium text-fsv-ink underline decoration-fsv-violet decoration-2 underline-offset-[6px] transition hover:text-fsv-violet md:mt-auto md:pt-8">
          {cta} <span aria-hidden>→</span>
        </a>
      </div>
      <div className="border-t border-fsv-line bg-white p-5 md:border-l md:border-t-0 md:p-10">{visual}</div>
    </article>
  );
}

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div aria-hidden className="flex h-full min-h-[240px] flex-col rounded-xl border border-fsv-line bg-white">
      <div className="flex items-center gap-1.5 border-b border-fsv-line px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-fsv-line" />
        <span className="h-2 w-2 rounded-full bg-fsv-line" />
        <span className="h-2 w-2 rounded-full bg-fsv-line" />
        <span className="ml-3 font-mono text-[11px] text-fsv-muted">{label}</span>
      </div>
      <div className="flex-1 p-4 font-mono text-[12.5px] leading-7">{children}</div>
    </div>
  );
}

export function SoftwareVisual() {
  const rows: [string, string, string, string][] = [
    ["POST", "/api/orders", "201", "48ms"],
    ["GET", "/api/tables/12", "200", "12ms"],
    ["PATCH", "/api/orders/884", "200", "31ms"],
    ["POST", "/api/payments", "201", "96ms"],
    ["GET", "/api/reports/day", "200", "54ms"],
  ];
  return (
    <Panel label="api · producción">
      {rows.map(([m, p, s, t]) => (
        <div key={p} className="grid grid-cols-[56px_1fr_40px_44px] gap-2">
          <span className="text-fsv-violet">{m}</span>
          <span className="truncate">{p}</span>
          <span className="text-emerald-600">{s}</span>
          <span className="text-right text-fsv-muted">{t}</span>
        </div>
      ))}
    </Panel>
  );
}

export function SecurityVisual() {
  const rows: [string, string, string][] = [
    ["Alta", "IDOR en /api/orders/{id}", "bg-rose-500"],
    ["Media", "Cookies de sesión sin SameSite", "bg-amber-400"],
    ["Media", "Rate limit ausente en /login", "bg-amber-400"],
    ["Baja", "Cabeceras CSP incompletas", "bg-fsv-muted/40"],
  ];
  return (
    <Panel label="informe · ejemplo de hallazgos">
      {rows.map(([sev, txt, dot]) => (
        <div key={txt} className="flex items-center gap-3 border-b border-fsv-line/70 py-1 last:border-0">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
          <span className="w-12 shrink-0 text-fsv-muted">{sev}</span>
          <span className="truncate">{txt}</span>
        </div>
      ))}
    </Panel>
  );
}

export function GrowthVisual() {
  const pts = [18, 22, 20, 27, 31, 29, 36, 41, 39, 48, 55, 61];
  const max = 64;
  const path = pts.map((v, i) => `${i ? "L" : "M"}${(i / (pts.length - 1)) * 300} ${100 - (v / max) * 100}`).join(" ");
  return (
    <Panel label="search · clics orgánicos (ejemplo)">
      <svg viewBox="0 0 300 100" className="h-40 w-full overflow-visible" preserveAspectRatio="none">
        {[25, 50, 75].map((y) => (
          <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="#E5E7EB" />
        ))}
        <path d={`${path} L300 100 L0 100 Z`} fill="#4B39FC" fillOpacity="0.08" />
        <path d={path} stroke="#4B39FC" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-fsv-muted">
        <span>ene</span>
        <span>jun</span>
        <span>dic</span>
      </div>
    </Panel>
  );
}

export function BusinessCard({ b, client }: { b: Business; client?: boolean }) {
  const body = (
    <>
      <div className="flex items-center gap-4">
        <div className="grid h-14 w-20 shrink-0 place-items-center">
          <BusinessLogo b={b} className={b.name === "Starseeker" ? "h-4 max-w-[80px]" : b.name === "Centinela" ? "h-10" : b.name === "Barzuo" ? "h-8 max-w-[80px]" : "h-12 max-w-[80px]"} iconOnly />
        </div>
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold leading-tight tracking-tight">
            {b.name}
            {client && <span className="rounded-full bg-fsv-bg px-2 py-0.5 font-mono text-[10px] font-normal uppercase tracking-wider text-fsv-muted">Cliente</span>}
          </h3>
          <div className="text-sm text-fsv-muted">{b.kind}</div>
        </div>
        {b.href && (
          <span className="ml-auto self-start text-fsv-muted transition group-hover:text-fsv-violet" aria-hidden>
            ↗
          </span>
        )}
      </div>
      <p className="mt-4 text-[15px] leading-relaxed text-fsv-ink/80">{b.text}</p>
      <div className="mt-auto hidden pt-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-fsv-muted sm:block">{b.tags}</div>
    </>
  );
  const cls = "group flex h-full flex-col rounded-2xl border border-fsv-line bg-white p-5 transition md:p-6";
  return b.href ? (
    <a href={b.href} target="_blank" rel="noreferrer" className={`${cls} hover:border-fsv-ink/30`} aria-label={`${b.name} (abre su sitio)`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Platforms() {
  return (
    <section className="border-t border-fsv-line bg-white">
      <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
        <div className="grid gap-6 md:grid-cols-2 md:items-end">
          <h2 className="font-display text-4xl font-semibold tracking-[-0.03em] md:text-5xl">Plataformas que manejamos</h2>
          <p className="hidden max-w-md text-lg text-fsv-muted md:block">Vendemos, postulamos, integramos, desplegamos y registramos marcas en ellas todos los días.</p>
        </div>
        <ul className="mt-10 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-fsv-line bg-fsv-line md:mt-12">
          {PLATFORMS.map((p) => (
            <li key={p.name} className="flex min-h-[88px] flex-col items-center justify-center gap-5 bg-white px-3 py-5 md:min-h-[150px] md:justify-between md:px-5 md:pb-6 md:pt-9">
              <div className="flex h-12 items-center">
                <img src={`/brand/platforms/${p.file}`} alt={p.name} title={`${p.name} · ${p.use}`} className={`${p.h} w-auto max-w-full scale-75 md:scale-100`} loading="lazy" />
              </div>
              <div className="hidden font-mono text-[11px] uppercase tracking-[0.16em] text-fsv-muted md:block">{p.use}</div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function SecurityBlock() {
  return (
    <div className="grid gap-8 rounded-2xl border border-fsv-line bg-fsv-bg p-8 md:grid-cols-[auto_1fr] md:items-center md:p-12">
      <svg viewBox="0 0 48 48" className="h-12 w-12 text-fsv-ink" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
        <path d="M24 5 8 11v11c0 10 7 17.5 16 21 9-3.5 16-11 16-21V11z" />
        <path d="m17 24 5 5 9-10" stroke="#4B39FC" strokeWidth={2.2} />
      </svg>
      <div>
        <h3 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Software y seguridad no deberían vivir separados.</h3>
        <p className="mt-3 max-w-2xl leading-relaxed text-fsv-muted">
          Aplicamos una mirada de seguridad tanto a los productos que construimos como a las evaluaciones que realizamos.
        </p>
      </div>
    </div>
  );
}
