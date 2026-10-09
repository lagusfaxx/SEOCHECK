import Link from "next/link";
import { Header } from "@/components/site/Header";
import { CONTACT_HREF, CtaAndFooter } from "@/components/site/Footer";

/** Marcas reales con las que se ha trabajado (logos normalizados para fondo claro en /public/brand/clients). */
const CLIENTS = [
  { name: "Barzuo", file: "barzuo.png", h: "h-9" },
  { name: "Uzeed", file: "uzeed.png", h: "h-12" },
  { name: "ANDES Technologies", file: "andes-technologies.png", h: "h-12" },
  { name: "Rent A Hacker", file: "rent-a-hacker.png", h: "h-10" },
  { name: "Starseeker", file: "starseeker.png", h: "h-6" },
  { name: "Nomadbrew", file: "nomadbrew.png", h: "h-12" },
  { name: "TAUPOC", file: "taupoc.png", h: "h-11" },
  { name: "sintornillo.cl", file: "sintornillo.png", h: "h-11" },
  { name: "La Frida", file: "la-frida.png", h: "h-12" },
];

const MODULES = ["Auditoría", "Search Console", "Keywords", "Rankings", "Contenido", "Reporting"];

const WORK = [
  {
    n: "01",
    client: "Barzuo",
    kind: "Plataforma operacional",
    text: "Sistema de comandas, clientes, QR y administración para un bar, lounge y club en Santiago.",
    tags: "Software / Web application",
    logo: "barzuo.png",
  },
  {
    n: "02",
    client: "Uzeed",
    kind: "Marketplace",
    text: "Desarrollo e infraestructura de una plataforma con mensajería, pagos, suscripciones y panel de administración.",
    tags: "Software / Infraestructura",
    logo: "uzeed.png",
    href: "https://uzeed.cl",
  },
];

const STEPS = [
  ["Entender", "Partimos por el problema, no por la tecnología."],
  ["Construir", "Diseñamos y desarrollamos la solución con objetivos medibles."],
  ["Probar", "Validamos funcionalidad, seguridad y comportamiento real."],
  ["Mejorar", "Medimos resultados y seguimos iterando."],
];

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Trust />
        <Capabilities />
        <Products />
        <Work />
        <Ventures />
        <HowWeWork />
      </main>
      <CtaAndFooter />
    </>
  );
}

function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`font-mono text-xs uppercase tracking-[0.2em] text-fsv-muted ${className}`}>{children}</div>;
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
      className="relative aspect-square w-full overflow-hidden rounded-2xl border border-fsv-line bg-white"
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
  return (
    <section className="border-b border-fsv-line bg-white">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
        <Kicker className="text-center">Empresas con las que hemos trabajado</Kicker>
        <ul className="mt-10 grid grid-cols-2 items-center gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-9">
          {CLIENTS.map((c) => (
            <li key={c.name} className="flex justify-center">
              <img src={`/brand/clients/${c.file}`} alt={c.name} title={c.name} className={`${c.h} w-auto max-w-[130px] object-contain opacity-75 grayscale transition hover:opacity-100 hover:grayscale-0`} loading="lazy" />
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
      <div className="mx-auto max-w-6xl px-4 pt-24 md:px-6 md:pt-32">
        <h2 className="font-display text-4xl font-semibold tracking-[-0.03em] md:text-6xl">Tecnología de punta a punta.</h2>
        <p className="mt-4 max-w-xl text-lg text-fsv-muted">Desde la construcción de una plataforma hasta su seguridad y crecimiento.</p>
      </div>
      <div className="mx-auto mt-14 max-w-6xl space-y-4 px-4 pb-24 md:px-6 md:pb-32">
        <Capability
          id="software"
          n="01 / Software"
          title="Construimos productos digitales."
          text="Aplicaciones web, plataformas SaaS, sistemas internos, APIs, integraciones y soluciones desarrolladas a medida."
          cta="Desarrollo de software"
          visual={<SoftwareVisual />}
        />
        <Capability
          id="security"
          n="02 / Security"
          title="Encontramos vulnerabilidades antes de que se conviertan en problemas."
          text="Pentesting de aplicaciones web y APIs, revisión de seguridad y evaluación técnica."
          cta="Ciberseguridad"
          visual={<SecurityVisual />}
        />
        <Capability
          id="growth"
          n="03 / Growth"
          title="Convertimos datos en crecimiento."
          text="Herramientas, automatización y análisis para mejorar adquisición, búsqueda y rendimiento digital. Aquí nace FSV Search."
          cta="Growth & Search"
          href="#productos"
          visual={<GrowthVisual />}
        />
      </div>
    </section>
  );
}

function Capability({ id, n, title, text, cta, href = CONTACT_HREF, visual }: { id: string; n: string; title: string; text: string; cta: string; href?: string; visual: React.ReactNode }) {
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
      <div className="border-t border-fsv-line bg-white p-6 md:border-l md:border-t-0 md:p-10">{visual}</div>
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

function SoftwareVisual() {
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

function SecurityVisual() {
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

function GrowthVisual() {
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

function Products() {
  return (
    <section id="productos" className="scroll-mt-16 border-y border-fsv-line bg-fsv-bg">
      <div className="mx-auto max-w-6xl px-4 py-24 md:px-6 md:py-32">
        <Kicker>FSV Products</Kicker>
        <h2 className="mt-6 max-w-3xl font-display text-4xl font-semibold tracking-[-0.03em] md:text-6xl">También construimos nuestra propia tecnología.</h2>
        <p className="mt-4 max-w-xl text-lg text-fsv-muted">Desarrollamos productos internos cuando creemos que un problema merece una solución mejor.</p>

        <div id="fsv-search" className="mt-14 overflow-hidden rounded-2xl border border-fsv-line bg-white">
          <div className="grid gap-10 p-8 md:p-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <img src="/brand/fsv-search.png" alt="FSV Search" className="h-9 w-auto md:h-10" />
              <h3 className="mt-8 font-display text-3xl font-semibold leading-tight tracking-[-0.025em] md:text-4xl">Search intelligence para convertir datos SEO en decisiones.</h3>
              <p className="mt-4 leading-relaxed text-fsv-muted">
                Auditoría técnica, datos reales de Search Console, investigación de keywords, rankings, análisis competitivo y optimización de contenido desde una sola plataforma.
              </p>
              <Link href="/search" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
                Conocer FSV Search <span aria-hidden>→</span>
              </Link>
            </div>
            <Link href="/search" className="group block overflow-hidden rounded-xl border border-fsv-line bg-fsv-bg shadow-[0_24px_48px_-24px_rgba(17,19,24,0.25)]">
              <img src="/brand/fsv-search-dashboard.png" alt="Dashboard de FSV Search: estado del proyecto, salud técnica, Search Console y tareas priorizadas" className="w-full transition duration-500 group-hover:scale-[1.01]" loading="lazy" />
            </Link>
          </div>
          <ul className="grid grid-cols-2 border-t border-fsv-line font-mono text-xs uppercase tracking-[0.18em] text-fsv-muted sm:grid-cols-3 lg:grid-cols-6">
            {MODULES.map((m) => (
              <li key={m} className="border-b border-r border-fsv-line px-6 py-4 last:border-r-0 lg:border-b-0">
                {m}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Work() {
  return (
    <section id="trabajo" className="scroll-mt-16 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-24 md:px-6 md:py-32">
        <Kicker>Selected work</Kicker>
        <h2 className="mt-6 font-display text-4xl font-semibold tracking-[-0.03em] md:text-6xl">Construimos lo que usamos.</h2>
        <div className="mt-14 border-t border-fsv-line">
          {WORK.map((w) => (
            <article key={w.n} className="grid gap-6 border-b border-fsv-line py-10 md:grid-cols-[64px_1fr_1.4fr_150px] md:items-start md:gap-10">
              <div className="font-mono text-sm text-fsv-muted">{w.n}</div>
              <div>
                <h3 className="font-display text-2xl font-semibold uppercase tracking-tight md:text-3xl">{w.client}</h3>
                <div className="mt-1 text-fsv-muted">{w.kind}</div>
              </div>
              <div>
                <p className="max-w-md leading-relaxed">{w.text}</p>
                <div className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-fsv-muted">{w.tags}</div>
              </div>
              <div className="flex items-center gap-6 md:flex-col md:items-end">
                <img src={`/brand/clients/${w.logo}`} alt="" className="h-12 w-auto opacity-80" loading="lazy" />
                {w.href && (
                  <a href={w.href} target="_blank" rel="noreferrer" className="whitespace-nowrap text-sm font-medium transition hover:text-fsv-violet">
                    Ver proyecto <span aria-hidden>→</span>
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Ventures() {
  const items = [
    { name: "FSV Search", status: "Activo", text: "SEO Intelligence Platform", href: "/search", live: true },
    { name: "Centinela", status: "Plataforma propia", text: "Plataforma de pruebas de seguridad ofensiva", live: false },
    { name: "Próximo venture", status: "En exploración", text: "Investigamos oportunidades y validamos ideas antes de construir.", live: false, dashed: true },
  ];
  return (
    <section id="ventures" className="scroll-mt-16 border-t border-fsv-line bg-fsv-bg">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 md:grid-cols-[1fr_1.2fr] md:px-6 md:py-32">
        <div>
          <Kicker>FSV / Ventures</Kicker>
          <h2 className="mt-6 font-display text-4xl font-semibold leading-[1.05] tracking-[-0.03em] md:text-5xl">No solo trabajamos para empresas. También construimos las nuestras.</h2>
          <p className="mt-5 max-w-md text-lg text-fsv-muted">Investigamos oportunidades, validamos ideas y desarrollamos productos digitales propios desde cero.</p>
        </div>
        <ul className="space-y-3">
          {items.map((v) => {
            const body = (
              <>
                <div className="flex items-center gap-3">
                  <span className="font-display text-xl font-semibold tracking-tight">{v.name}</span>
                  <span className={`ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ${v.live ? "bg-emerald-50 text-emerald-700" : "bg-fsv-bg text-fsv-muted"}`}>
                    {v.live && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                    {v.status}
                  </span>
                </div>
                <p className="mt-2 text-fsv-muted">{v.text}</p>
              </>
            );
            return (
              <li key={v.name}>
                {v.href ? (
                  <Link href={v.href} className="block rounded-xl border border-fsv-line bg-white p-6 transition hover:border-fsv-ink/30">
                    {body}
                  </Link>
                ) : (
                  <div className={`rounded-xl border bg-white p-6 ${v.dashed ? "border-dashed border-fsv-ink/20 bg-transparent" : "border-fsv-line"}`}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function HowWeWork() {
  return (
    <section id="empresa" className="scroll-mt-16 border-t border-fsv-line bg-white">
      <div className="mx-auto max-w-6xl px-4 py-24 md:px-6 md:py-32">
        <Kicker>Empresa</Kicker>
        <h2 className="mt-6 font-display text-4xl font-semibold tracking-[-0.03em] md:text-6xl">Cómo trabajamos</h2>
        <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-fsv-line bg-fsv-line sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="bg-white p-8">
              <div className="font-mono text-sm text-fsv-violet">0{i + 1}</div>
              <div className="mt-8 font-display text-2xl font-semibold tracking-tight">{t}</div>
              <p className="mt-2 leading-relaxed text-fsv-muted">{d}</p>
            </li>
          ))}
        </ol>

        <div className="mt-6 grid gap-8 rounded-2xl border border-fsv-line bg-fsv-bg p-8 md:grid-cols-[auto_1fr] md:items-center md:p-12">
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
      </div>
    </section>
  );
}
