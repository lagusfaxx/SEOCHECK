import Link from "next/link";

/** Correo de contacto del sitio. Confirmar que la casilla existe antes de publicar. */
export const CONTACT_EMAIL = "contacto@fsvc.cl";
export const CONTACT_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Hablemos — Fullstack Ventures")}`;


/** CTA final sobre grafito + footer. Se usa en la home y en las páginas de producto. */
export function CtaAndFooter({ title = "¿Tienes algo que construir, proteger o hacer crecer?", cta = "Hablemos" }: { title?: string; cta?: string }) {
  return (
    <>
      <section id="contacto" className="scroll-mt-16 bg-fsv-ink text-white">
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6 md:py-32">
          <h2 className="max-w-3xl font-display text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">{title}</h2>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
            <a href={CONTACT_HREF} className="inline-flex items-center gap-2 rounded-sm bg-fsv-violet px-6 py-3.5 font-medium text-white transition hover:brightness-110">
              {cta} <span aria-hidden>→</span>
            </a>
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-mono text-sm text-white/50 transition hover:text-white">
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </section>
      <footer className="border-t border-fsv-line bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)] md:px-6">
          <div>
            <img src="/brand/fsv-mark.png" alt="Fullstack Ventures" className="h-7 w-auto" />
            <p className="mt-6 text-sm text-fsv-muted">
              © {new Date().getFullYear()} Full Stack Ventures SpA
              <br />
              Santiago, Chile
            </p>
          </div>
          <FooterCol title="Capacidades" links={[["Software", "/capacidades#software"], ["Security", "/capacidades#security"], ["Growth", "/capacidades#growth"]]} />
          <FooterCol title="Productos" links={[["FSV Search", "/search"]]} />
          <FooterCol title="Empresa" links={[["Nosotros", "/empresa"], ["Proyectos", "/work"], ["Ventures", "/ventures"], ["Cuéntanos tu idea", "/ventures#postular"], ["Contacto", "/#contacto"]]} />
        </div>
      </footer>
    </>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fsv-muted">{title}</div>
      <ul className="mt-4 space-y-2 text-sm">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="text-fsv-ink transition hover:text-fsv-violet">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
