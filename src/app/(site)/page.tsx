import Link from "next/link";
import { Header } from "@/components/site/Header";
import { CONTACT_HREF, CtaAndFooter } from "@/components/site/Footer";
import { BusinessLogo } from "@/components/site/Brands";
import { BusinessCard, Kicker } from "@/components/site/Sections";
import { CLIENT_WORK, FEATURED, OWN_BUSINESSES, STATS } from "@/lib/site-content";

const MODULES = ["Auditoría", "Keywords", "Rankings", "Contenido"];

const CAPS = [
  { id: "software", n: "01 / Software", title: "Construimos productos digitales.", text: "Plataformas, SaaS, sistemas e integraciones a medida.", cta: "Desarrollo" },
  { id: "security", n: "02 / Security", title: "Encontramos vulnerabilidades.", text: "Pentesting de aplicaciones, APIs y evaluación técnica.", cta: "Seguridad" },
  { id: "growth", n: "03 / Growth", title: "Convertimos datos en crecimiento.", text: "SEO, automatización y análisis.", cta: "Growth" },
];

const STEPS = ["Entender", "Construir", "Probar", "Mejorar"];

/** Logos de la franja: 6 en la home, el resto en /work. */
const TRUST = ["Barzuo", "Uzeed", "Nomadbrew", "Starseeker", "TAUPOC", "ANDES Technologies"];

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Trust />
        <Capabilities />
        <Products />
        <Proof />
        <Work />
        <Ventures />
        <HowWeWork />
      </main>
      <CtaAndFooter />
    </>
  );
}

function Hero() {
  return (
    <section className="border-b border-fsv-line bg-fsv-bg">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 md:grid-cols-[1.15fr_1fr] md:px-6 md:pb-28 md:pt-24">
        <div>
          <Kicker>Fullstack Ventures</Kicker>
          <h1 className="mt-6 font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[4.2rem]">
            Construimos, protegemos y hacemos crecer productos digitales.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-fsv-muted">
            Software, ciberseguridad y productos tecnológicos desarrollados para resolver problemas reales de negocio.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a href="#capacidades" className="rounded-lg border border-fsv-ink/15 bg-white px-5 py-3 font-medium transition hover:border-fsv-ink/40">
              Conocer capacidades
            </a>
            <a href={CONTACT_HREF} className="inline-flex items-center gap-2 rounded-lg bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
              Hablar con nosotros <span aria-hidden>→</span>
            </a>
          </div>
          <div className="mt-14 font-mono text-xs uppercase tracking-[0.2em] text-fsv-muted">Software · Security · Growth · Ventures</div>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

/** Composición abstracta con la identidad FSV: grilla técnica, marca y las tres divisiones como nodos. */
function HeroVisual() {
  const nodes = [
    { label: "01 / Software", x: "8%", y: "12%" },
    { label: "02 / Security", x: "58%", y: "6%" },
    { label: "03 / Growth", x: "54%", y: "84%" },
  ];
  return (
    <div
      aria-hidden
      className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-fsv-line bg-white md:aspect-square"
      style={{
        backgroundImage: "linear-gradient(#E5E7EB 1px, transparent 1px), linear-gradient(90deg, #E5E7EB 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        backgroundPosition: "-1px -1px",
      }}
    >
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" fill="none">
        <path d="M60 64 L200 200 L272 40 M200 200 L250 344" stroke="#111318" strokeOpacity="0.25" strokeDasharray="3 5" />
        <circle cx="200" cy="200" r="118" stroke="#111318" strokeOpacity="0.12" />
        <circle cx="200" cy="200" r="168" stroke="#111318" strokeOpacity="0.07" />
        {[
          [60, 64],
          [272, 40],
          [250, 344],
        ].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x - 4} y={y - 4} width="8" height="8" fill="#4B39FC" />
        ))}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="rounded-xl bg-white/90 px-6 py-5 ring-1 ring-fsv-line backdrop-blur-[1px]">
          <img src="/brand/fsv-mark.png" alt="" className="h-16 w-auto md:h-20" />
        </div>
      </div>
      {nodes.map((n) => (
        <div key={n.label} className="absolute rounded-md border border-fsv-line bg-white px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-fsv-ink" style={{ left: n.x, top: n.y }}>
          {n.label}
        </div>
      ))}
    </div>
  );
}

function Trust() {
  const all = [...OWN_BUSINESSES, ...CLIENT_WORK];
  const logos = TRUST.map((n) => all.find((b) => b.name === n)!).filter(Boolean);
  return (
    <section className="border-b border-fsv-line bg-white">
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6 md:py-12">
        <div className="flex items-baseline justify-between gap-4">
          <Kicker>Empresas con las que hemos trabajado</Kicker>
          <Link href="/work" className="shrink-0 text-sm font-medium transition hover:text-fsv-violet">
            Ver todas <span aria-hidden>→</span>
          </Link>
        </div>
        <ul className="mt-6 grid grid-cols-3 items-center gap-x-6 gap-y-5 md:mt-8 md:grid-cols-6">
          {logos.map((c) => (
            <li key={c.name} className="flex h-10 justify-center opacity-75 grayscale transition hover:opacity-100 hover:grayscale-0 md:h-12" title={c.name}>
              <BusinessLogo b={c} className={c.name === "Starseeker" ? "h-4 self-center md:h-5" : c.name === "Barzuo" ? "h-7 self-center md:h-8" : "h-full max-w-[110px]"} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Capabilities() {
  return (
    <section id="capacidades" className="scroll-mt-16 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-[-0.03em] md:text-5xl">Tecnología de punta a punta.</h2>
            <p className="mt-3 max-w-xl text-fsv-muted md:text-lg">Desde la construcción de una plataforma hasta su seguridad y crecimiento.</p>
          </div>
          <Link href="/capacidades" className="hidden text-sm font-medium transition hover:text-fsv-violet md:block">
            Ver capacidades <span aria-hidden>→</span>
          </Link>
        </div>
        <ul className="mt-8 grid overflow-hidden rounded-2xl border border-fsv-line md:mt-12 md:grid-cols-3">
          {CAPS.map((c, i) => (
            <li key={c.id} className={i ? "border-t border-fsv-line md:border-l md:border-t-0" : ""}>
              <Link href={`/capacidades#${c.id}`} className="group flex h-full flex-col p-6 transition hover:bg-fsv-bg md:p-8">
                <Kicker>{c.n}</Kicker>
                <h3 className="mt-4 font-display text-xl font-semibold leading-snug tracking-tight md:mt-6 md:text-2xl">{c.title}</h3>
                <p className="mt-2 text-fsv-muted">{c.text}</p>
                <span className="mt-5 text-sm font-medium transition group-hover:text-fsv-violet md:mt-auto md:pt-8">
                  {c.cta} <span aria-hidden>→</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/capacidades" className="mt-5 inline-block text-sm font-medium md:hidden">
          Ver capacidades <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}

function Products() {
  return (
    <section id="productos" className="scroll-mt-16 border-y border-fsv-line bg-fsv-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-28">
        <Kicker>FSV Products</Kicker>
        <h2 className="mt-5 max-w-3xl font-display text-[2rem] font-semibold leading-tight tracking-[-0.03em] md:mt-6 md:text-5xl">También construimos nuestra propia tecnología.</h2>
        <div id="fsv-search" className="mt-8 overflow-hidden rounded-2xl border border-fsv-line bg-white md:mt-12">
          <div className="grid gap-8 p-6 md:p-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-10">
            <div>
              <img src="/brand/fsv-search.png" alt="FSV Search" className="h-8 w-auto md:h-10" />
              <h3 className="mt-6 font-display text-2xl font-semibold leading-tight tracking-[-0.025em] md:mt-8 md:text-4xl">Search intelligence para convertir datos SEO en decisiones.</h3>
              <p className="mt-4 hidden leading-relaxed text-fsv-muted md:block">
                Auditoría técnica, datos reales de Search Console, keywords, rankings y optimización de contenido desde una sola plataforma.
              </p>
              <div className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-fsv-muted">{MODULES.join(" · ")}</div>
              <Link href="/search" className="mt-7 inline-flex items-center gap-2 rounded-lg bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
                Conocer FSV Search <span aria-hidden>→</span>
              </Link>
            </div>
            <Link href="/search" className="group block overflow-hidden rounded-xl border border-fsv-line bg-fsv-bg shadow-[0_24px_48px_-24px_rgba(17,19,24,0.25)]">
              <img src="/brand/fsv-search-dashboard.png" alt="Dashboard de FSV Search: estado del proyecto, salud técnica, Search Console y tareas priorizadas" className="w-full transition duration-500 group-hover:scale-[1.01]" loading="lazy" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Proof() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
        <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-[-0.03em] md:text-5xl">Construimos lo que usamos.</h2>
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-fsv-line bg-fsv-line md:mt-12 lg:grid-cols-4">
          {STATS.map((st) => (
            <div key={st.short} className="bg-white p-5 md:p-8">
              <dt className="sr-only">{st.long}</dt>
              <dd className="font-display text-3xl font-semibold tracking-[-0.03em] text-fsv-ink md:text-5xl">{st.value}</dd>
              <dd className="mt-1 text-sm text-fsv-muted md:mt-3 md:text-base">
                <span className="md:hidden">{st.short}</span>
                <span className="hidden md:inline">{st.long}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-fsv-muted">Montos en pesos chilenos</p>
      </div>
    </section>
  );
}

function Work() {
  const featured = FEATURED.map((n) => OWN_BUSINESSES.find((b) => b.name === n)!).filter(Boolean);
  const total = OWN_BUSINESSES.length + CLIENT_WORK.length;
  return (
    <section id="trabajo" className="scroll-mt-16 border-t border-fsv-line bg-fsv-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
        <Kicker>Selected work</Kicker>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 md:mt-6">
          <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-[-0.03em] md:text-5xl">Negocios que construimos y operamos.</h2>
          <Link href="/work" className="hidden text-sm font-medium transition hover:text-fsv-violet md:block">
            Ver los {total} proyectos <span aria-hidden>→</span>
          </Link>
        </div>
        <ul className="mt-8 grid gap-3 md:mt-12 md:grid-cols-3">
          {featured.map((b) => (
            <li key={b.name}>
              <BusinessCard b={b} />
            </li>
          ))}
        </ul>
        <Link href="/work" className="mt-5 inline-block text-sm font-medium md:hidden">
          Ver los {total} proyectos <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}

function Ventures() {
  return (
    <section id="ventures" className="scroll-mt-16 border-t border-fsv-line bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
        <Kicker>FSV / Ventures</Kicker>
        <div className="mt-5 grid gap-8 md:mt-6 md:grid-cols-[1.2fr_1fr] md:items-end md:gap-12">
          <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-[-0.03em] md:text-5xl">No solo trabajamos para empresas. También construimos las nuestras.</h2>
          <div>
            <p className="font-display text-xl font-semibold tracking-tight">¿Tienes una idea? Podemos construirla contigo.</p>
            <p className="mt-2 text-fsv-muted">Evaluamos proyectos en los que podamos participar como socios.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/ventures#postular" className="inline-flex items-center gap-2 rounded-lg bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
                Cuéntanos tu idea <span aria-hidden>→</span>
              </Link>
              <Link href="/ventures" className="rounded-lg border border-fsv-ink/15 bg-white px-5 py-3 font-medium transition hover:border-fsv-ink/40">
                Cómo funciona
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowWeWork() {
  return (
    <section id="empresa" className="scroll-mt-16 border-t border-fsv-line bg-white">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
        <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Cómo trabajamos</h2>
        <ol className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-fsv-line bg-fsv-line md:mt-8 md:grid-cols-4">
          {STEPS.map((t, i) => (
            <li key={t} className="flex items-baseline gap-3 bg-white px-5 py-4 md:px-6 md:py-5">
              <span className="font-mono text-sm text-fsv-violet">0{i + 1}</span>
              <span className="font-display text-lg font-semibold tracking-tight">{t}</span>
              {i < STEPS.length - 1 && (
                <span className="ml-auto hidden text-fsv-muted md:inline" aria-hidden>
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
