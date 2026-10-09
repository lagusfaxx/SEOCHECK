import Link from "next/link";
import { Header } from "@/components/site/Header";
import { CONTACT_HREF, CtaAndFooter } from "@/components/site/Footer";
import { CentinelaLogo } from "@/components/site/Brands";
import { CaseRow, Kicker, findBusiness } from "@/components/site/Sections";
import { CAPABILITIES, FEATURED, OWN_BUSINESSES, CLIENT_WORK, PROOF } from "@/lib/site-content";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Proof />
        <Capabilities />
        <Search />
        <Work />
        <Ventures />
      </main>
      <CtaAndFooter />
    </>
  );
}

function Hero() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-14 md:px-6 md:pb-24 md:pt-28">
        <h1 className="max-w-5xl font-display text-[2.7rem] font-semibold leading-[0.98] tracking-[-0.04em] md:text-[5.6rem]">
          Construimos tecnología.
          <br />
          <span className="text-fsv-muted">La operamos. Y la hacemos crecer.</span>
        </h1>
        <div className="mt-10 grid gap-10 md:mt-14 md:grid-cols-12">
          <div className="md:col-span-6">
            <p className="text-lg leading-relaxed text-fsv-ink/80 md:text-xl">Desarrollamos software, auditamos sistemas y construimos productos digitales propios desde Chile.</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href="/work" className="inline-flex items-center gap-2 rounded-sm bg-fsv-ink px-5 py-3 font-medium text-white transition hover:bg-black">
                Ver nuestro trabajo <span aria-hidden>→</span>
              </Link>
              <a href={CONTACT_HREF} className="font-medium underline decoration-fsv-violet decoration-2 underline-offset-[6px] transition hover:text-fsv-violet">
                Hablar con nosotros
              </a>
            </div>
          </div>
        </div>
        <div className="mt-16 border-t border-fsv-line pt-5 font-mono text-xs uppercase tracking-[0.2em] text-fsv-muted md:mt-24">Software · Security · Growth · Ventures</div>
      </div>
    </section>
  );
}

/** Evidencia antes de los servicios: productos y negocios construidos por FSV. */
function Proof() {
  return (
    <section className="border-y border-fsv-line bg-fsv-bg">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="flex items-baseline justify-between gap-4 border-b border-fsv-line py-4">
          <Kicker>Productos y negocios construidos por FSV</Kicker>
          <Link href="/work" className="shrink-0 text-sm font-medium transition hover:text-fsv-violet">
            Ver todos <span aria-hidden>→</span>
          </Link>
        </div>
        <ul className="grid grid-cols-2 md:grid-cols-4">
          {PROOF.map((p, i) => (
            <li key={p.name} className={`border-fsv-line ${i % 2 ? "border-l" : ""} ${i > 1 ? "border-t md:border-t-0" : ""} ${i === 2 ? "md:border-l" : ""}`}>
              <a href={p.href} {...(p.external ? { target: "_blank", rel: "noreferrer" } : {})} className="group flex h-full flex-col gap-4 px-4 py-6 transition hover:bg-white md:px-6 md:py-8">
                <div className="flex h-9 items-center">
                  {p.logo ? <img src={p.logo} alt="" className={`${p.name === "FSV Search" ? "h-5 md:h-6" : "h-9"} w-auto`} /> : <CentinelaLogo className="h-8" iconOnly />}
                </div>
                <div>
                  <div className="font-display text-lg font-semibold tracking-tight">{p.name}</div>
                  <p className="mt-1 text-sm leading-snug text-fsv-muted">{p.fact}</p>
                </div>
              </a>
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
        <div className="flex items-baseline justify-between gap-4">
          <Kicker>Capacidades</Kicker>
          <Link href="/capacidades" className="text-sm font-medium transition hover:text-fsv-violet">
            Ver capacidades <span aria-hidden>→</span>
          </Link>
        </div>
        <ul className="mt-6 border-t border-fsv-ink">
          {CAPABILITIES.map((c) => (
            <li key={c.id} className="border-b border-fsv-line">
              <Link href={`/capacidades#${c.id}`} className="group grid gap-3 py-7 md:grid-cols-12 md:items-baseline md:gap-6 md:py-9">
                <div className="font-mono text-xs uppercase tracking-[0.2em] text-fsv-muted md:col-span-2">
                  {c.n} / {c.area}
                </div>
                <div className="md:col-span-6">
                  <div className="font-display text-2xl font-semibold leading-tight tracking-[-0.02em] transition group-hover:text-fsv-violet md:text-3xl">{c.fact}</div>
                </div>
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-fsv-muted transition group-hover:text-fsv-violet md:col-span-4 md:text-right">
                  {c.proof.join(" · ")} <span aria-hidden>→</span>
                </div>
              </Link>
            </li>
          ))}
          <li className="border-b border-fsv-line">
            <Link href="/ventures" className="group grid gap-3 py-7 md:grid-cols-12 md:items-baseline md:gap-6 md:py-9">
              <div className="font-mono text-xs uppercase tracking-[0.2em] text-fsv-muted md:col-span-2">04 / Ventures</div>
              <div className="md:col-span-6">
                <div className="font-display text-2xl font-semibold leading-tight tracking-[-0.02em] transition group-hover:text-fsv-violet md:text-3xl">Productos y negocios propios.</div>
              </div>
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-fsv-muted transition group-hover:text-fsv-violet md:col-span-4 md:text-right">
                Nomadbrew · Starseeker · TAUPOC <span aria-hidden>→</span>
              </div>
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}

function Search() {
  return (
    <section id="productos" className="scroll-mt-16 border-t border-fsv-line bg-fsv-bg">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:px-6 md:py-24 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-5">
          <Kicker>Producto propio</Kicker>
          <img src="/brand/fsv-search.png" alt="FSV Search" className="mt-6 h-8 w-auto md:h-10" />
          <h2 className="mt-6 font-display text-[1.9rem] font-semibold leading-tight tracking-[-0.03em] md:text-[2.6rem]">Search intelligence para convertir datos SEO en decisiones.</h2>
          <p className="mt-4 text-fsv-muted">Auditoría técnica, Search Console, keywords, rankings y contenido en una sola plataforma.</p>
          <Link href="/search" className="mt-8 inline-flex items-center gap-2 rounded-sm bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
            Conocer FSV Search <span aria-hidden>→</span>
          </Link>
        </div>
        <Link href="/search" className="block overflow-hidden rounded-sm border border-fsv-line bg-white lg:col-span-7">
          <img src="/brand/fsv-search-dashboard.png" alt="Dashboard de FSV Search: tareas priorizadas, salud técnica y datos de Search Console" className="w-full" loading="lazy" />
        </Link>
      </div>
    </section>
  );
}

function Work() {
  const featured = FEATURED.map(findBusiness).filter((b): b is NonNullable<typeof b> => !!b);
  const total = OWN_BUSINESSES.length + CLIENT_WORK.length;
  return (
    <section id="trabajo" className="scroll-mt-16 border-t border-fsv-line bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
        <div className="flex items-baseline justify-between gap-4">
          <Kicker>Selected work</Kicker>
          <Link href="/work" className="text-sm font-medium transition hover:text-fsv-violet">
            Ver los {total} proyectos <span aria-hidden>→</span>
          </Link>
        </div>
        <ul className="mt-6 border-t border-fsv-ink">
          {featured.map((b) => (
            <li key={b.name}>
              <CaseRow b={b} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Ventures() {
  return (
    <section id="ventures" className="scroll-mt-16 border-t border-fsv-line bg-fsv-bg">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 md:grid-cols-12 md:px-6 md:py-24">
        <div className="md:col-span-7">
          <Kicker>FSV / Ventures</Kicker>
          <h2 className="mt-6 font-display text-[2rem] font-semibold leading-tight tracking-[-0.03em] md:text-5xl">No solo trabajamos para empresas. También construimos las nuestras.</h2>
        </div>
        <div className="md:col-span-4 md:col-start-9 md:self-end">
          <p className="font-display text-xl font-semibold tracking-tight">¿Tienes una idea? Podemos construirla contigo.</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/ventures#postular" className="inline-flex items-center gap-2 rounded-sm bg-fsv-ink px-5 py-3 font-medium text-white transition hover:bg-black">
              Cuéntanos tu idea <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

