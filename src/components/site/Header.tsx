"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Item = { title: string; text: string; href: string; group?: string };
type Menu = { label: string; items: Item[]; note?: string };

/** Ítems agrupados por `group` (los productos: FSV Search, SistemaW), en orden de aparición. */
const grouped = (items: Item[]) => {
  const out: { group?: string; items: Item[] }[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.group === it.group) last.items.push(it);
    else out.push({ group: it.group, items: [it] });
  }
  return out;
};

const Chevron = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const MENUS: Menu[] = [
  {
    label: "Capacidades",
    items: [
      { title: "Software", text: "Desarrollo web, plataformas y sistemas a medida", href: "/capacidades#software" },
      { title: "Security", text: "Pentesting y seguridad de aplicaciones", href: "/capacidades#security" },
      { title: "Growth", text: "SEO, búsqueda y crecimiento orgánico", href: "/capacidades#growth" },
    ],
  },
  {
    label: "Productos",
    items: [
      { group: "FSV Search", title: "FSV Search", text: "Herramienta SEO con datos reales de Google", href: "/search" },
      { group: "FSV Search", title: "Auditoría SEO gratis", text: "Analiza una página en segundos, sin registro", href: "/search/auditoria-gratis" },
      { group: "FSV Search", title: "Guías de SEO", text: "Auditoría, keywords, Search Console y más", href: "/search/guias" },
      { group: "SistemaW", title: "SistemaW", text: "Pentest y evaluaciones de seguridad web", href: "/pentest" },
      { group: "SistemaW", title: "Revisión de seguridad gratis", text: "Cabeceras, HTTPS y cookies de tu web", href: "/pentest/revision-gratis" },
      { group: "SistemaW", title: "Guías de ciberseguridad", text: "Pentest, cabeceras y Ley 21.663", href: "/pentest/guias" },
    ],
    note: "Más productos próximamente",
  },
];

const LINKS = [
  { label: "Proyectos", href: "/work" },
  { label: "Ventures", href: "/ventures" },
  { label: "Empresa", href: "/empresa" },
];

export function Logo({ white }: { white?: boolean }) {
  return (
    <Link href="/" className="flex shrink-0 items-center" aria-label="FSV, inicio">
      <img src={white ? "/brand/fsv-mark-white.png" : "/brand/fsv-mark.png"} alt="FSV" className="h-6 w-auto md:h-7" />
    </Link>
  );
}

function Dropdown({ menu }: { menu: Menu }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="flex items-center gap-1 py-2 text-sm text-fsv-muted transition hover:text-fsv-ink" aria-expanded={open} onClick={() => setOpen(!open)}>
        {menu.label}
        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className={`absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2 ${menu.items.some((i) => i.group) ? "w-[36rem]" : "w-80"}`}>
          <div className="rounded-sm border border-fsv-line bg-white p-2 shadow-[0_12px_32px_-12px_rgba(17,19,24,0.18)]">
            <div className={menu.items.some((i) => i.group) ? "grid grid-cols-2 gap-1" : ""}>
              {grouped(menu.items).map((g) => (
                <div key={g.group ?? "items"}>
                  {g.group && <div className="px-3 pb-1 pt-2 font-mono text-[11px] uppercase tracking-wider text-fsv-violet">{g.group}</div>}
                  {g.items.map((it) => (
                    <Link key={it.title} href={it.href} onClick={() => setOpen(false)} className="block rounded-sm px-3 py-2.5 transition hover:bg-fsv-bg">
                      <div className="font-display text-sm font-semibold tracking-tight">{it.title}</div>
                      <div className="text-[13px] leading-snug text-fsv-muted">{it.text}</div>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
            {menu.note && <div className="px-3 pb-2 pt-1 font-mono text-[11px] uppercase tracking-wider text-fsv-muted">{menu.note}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // menú del teléfono abierto: la página de atrás no se desplaza y Escape lo cierra
  useEffect(() => {
    if (!mobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMobile(false);
    document.addEventListener("keydown", esc);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", esc);
    };
  }, [mobile]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`sticky top-0 z-40 border-b transition-colors ${mobile ? "border-fsv-line bg-white" : `bg-white/90 backdrop-blur ${scrolled ? "border-fsv-line" : "border-transparent"}`}`}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 md:px-6">
        <Logo />
        <nav className="hidden flex-1 items-center gap-7 md:flex" aria-label="Principal">
          {MENUS.map((m) => (
            <Dropdown key={m.label} menu={m} />
          ))}
          {LINKS.map((l) => (
            <Link key={l.label} href={l.href} className="py-2 text-sm text-fsv-muted transition hover:text-fsv-ink">
              {l.label}
            </Link>
          ))}
          <Link href="/login" className="ml-auto py-2 text-sm text-fsv-muted transition hover:text-fsv-ink">
            Entrar a FSV Search
          </Link>
          <Link href="/#contacto" className="rounded-sm bg-fsv-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-black">
            Contacto
          </Link>
        </nav>
        <button className="ml-auto rounded-sm p-2 md:hidden" aria-label={mobile ? "Cerrar menú" : "Abrir menú"} aria-expanded={mobile} onClick={() => setMobile(!mobile)}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <path d={mobile ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} />
          </svg>
        </button>
      </div>
      {mobile && (
        // panel de pantalla completa bajo el header (backdrop-blur se apaga al abrir: si no, encierra este fixed)
        <nav className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto overscroll-contain bg-fsv-bg px-4 pb-10 pt-5 md:hidden" aria-label="Principal móvil">
          {MENUS.map((m) => (
            <section key={m.label} className="mb-7">
              <h2 className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.18em] text-fsv-muted">{m.label}</h2>
              <div className="space-y-3">
                {grouped(m.items).map((g) => (
                  <div key={g.group ?? "items"}>
                    {g.group && <div className="mb-1.5 px-1 text-xs font-semibold text-fsv-violet">{g.group}</div>}
                    <ul className="divide-y divide-fsv-line overflow-hidden rounded-md border border-fsv-line bg-white">
                      {g.items.map((it) => (
                        <li key={it.title}>
                          <Link href={it.href} onClick={() => setMobile(false)} className="flex items-center gap-3 px-4 py-3.5 active:bg-fsv-bg">
                            <span className="min-w-0 flex-1">
                              <span className="block font-display font-semibold tracking-tight">{it.title}</span>
                              <span className="mt-0.5 block text-sm leading-snug text-fsv-muted">{it.text}</span>
                            </span>
                            <Chevron className="h-4 w-4 shrink-0 text-fsv-muted" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <section className="mb-7">
            <h2 className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.18em] text-fsv-muted">FSV</h2>
            <ul className="divide-y divide-fsv-line overflow-hidden rounded-md border border-fsv-line bg-white">
              {LINKS.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} onClick={() => setMobile(false)} className="flex items-center justify-between px-4 py-3.5 font-display font-semibold tracking-tight active:bg-fsv-bg">
                    {l.label}
                    <Chevron className="h-4 w-4 text-fsv-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/login" onClick={() => setMobile(false)} className="rounded-md border border-fsv-ink bg-white px-4 py-3 text-center font-medium">
              Entrar
            </Link>
            <Link href="/#contacto" onClick={() => setMobile(false)} className="rounded-md bg-fsv-ink px-4 py-3 text-center font-medium text-white">
              Contacto
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
