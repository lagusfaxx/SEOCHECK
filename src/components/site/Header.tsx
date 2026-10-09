"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Item = { title: string; text: string; href: string };
type Menu = { label: string; items: Item[]; note?: string };

const MENUS: Menu[] = [
  {
    label: "Capacidades",
    items: [
      { title: "Software", text: "Desarrollo web, plataformas y sistemas a medida", href: "/#software" },
      { title: "Security", text: "Pentesting y seguridad de aplicaciones", href: "/#security" },
      { title: "Growth", text: "SEO, búsqueda y crecimiento orgánico", href: "/#growth" },
    ],
  },
  {
    label: "Productos",
    items: [{ title: "FSV / SEARCH", text: "SEO Intelligence Platform", href: "/search" }],
    note: "Próximamente…",
  },
];

const LINKS = [
  { label: "Ventures", href: "/#ventures" },
  { label: "Empresa", href: "/#empresa" },
];

export function Logo({ white }: { white?: boolean }) {
  return (
    <Link href="/" className="flex shrink-0 items-center" aria-label="Fullstack Ventures, inicio">
      <img src={white ? "/brand/fsv-fullstack-ventures-white.png" : "/brand/fsv-fullstack-ventures.png"} alt="Fullstack Ventures" className="h-7 w-auto md:h-8" />
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
        <div className="absolute left-1/2 top-full z-50 w-80 -translate-x-1/2 pt-2">
          <div className="rounded-xl border border-fsv-line bg-white p-2 shadow-[0_12px_32px_-12px_rgba(17,19,24,0.18)]">
            {menu.items.map((it) => (
              <Link key={it.title} href={it.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 transition hover:bg-fsv-bg">
                <div className="font-display text-sm font-semibold tracking-tight">{it.title}</div>
                <div className="text-[13px] leading-snug text-fsv-muted">{it.text}</div>
              </Link>
            ))}
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
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`sticky top-0 z-40 border-b bg-white/90 backdrop-blur transition-colors ${scrolled ? "border-fsv-line" : "border-transparent"}`}>
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
          <Link href="/#contacto" className="ml-auto rounded-lg bg-fsv-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-black">
            Contacto
          </Link>
        </nav>
        <button className="ml-auto rounded-lg p-2 md:hidden" aria-label={mobile ? "Cerrar menú" : "Abrir menú"} aria-expanded={mobile} onClick={() => setMobile(!mobile)}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <path d={mobile ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} />
          </svg>
        </button>
      </div>
      {mobile && (
        <nav className="border-t border-fsv-line bg-white px-4 pb-6 pt-2 md:hidden" aria-label="Principal móvil">
          {MENUS.map((m) => (
            <div key={m.label} className="border-b border-fsv-line py-3">
              <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-fsv-muted">{m.label}</div>
              {m.items.map((it) => (
                <Link key={it.title} href={it.href} onClick={() => setMobile(false)} className="block py-1.5">
                  <span className="font-display font-semibold">{it.title}</span> <span className="text-sm text-fsv-muted">· {it.text}</span>
                </Link>
              ))}
            </div>
          ))}
          {LINKS.map((l) => (
            <Link key={l.label} href={l.href} onClick={() => setMobile(false)} className="block border-b border-fsv-line py-3 font-display font-semibold">
              {l.label}
            </Link>
          ))}
          <Link href="/#contacto" onClick={() => setMobile(false)} className="mt-4 block rounded-lg bg-fsv-ink px-4 py-3 text-center font-medium text-white">
            Contacto
          </Link>
        </nav>
      )}
    </header>
  );
}
