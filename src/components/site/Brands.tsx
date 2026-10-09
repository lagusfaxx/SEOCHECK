import type { Business } from "@/lib/site-content";

/** Logo de Centinela (en el original es SVG, no imagen). */
export function CentinelaLogo({ className = "h-10" }: { className?: string }) {
  return (
    <span role="img" aria-label="Centinela" className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 64 64" className="h-full w-auto" aria-hidden>
        <path d="M50.38 47.43 A24 24 0 1 1 50.38 16.57" fill="none" stroke="#16A34A" strokeWidth="6" strokeLinecap="square" />
        <path d="M32 32 L60 32" stroke="#16A34A" strokeWidth="4" strokeLinecap="round" />
        <rect x="27" y="27" width="10" height="10" fill="#111318" />
      </svg>
      <span className="font-mono text-[0.95em] font-medium uppercase tracking-[0.14em] text-fsv-ink">centinela</span>
    </span>
  );
}

export function BusinessLogo({ b, className }: { b: Business; className: string }) {
  if (!b.logo) return <CentinelaLogo className={className} />;
  return <img src={`/brand/clients/${b.logo}`} alt={b.name} className={`${className} w-auto object-contain`} loading="lazy" />;
}
