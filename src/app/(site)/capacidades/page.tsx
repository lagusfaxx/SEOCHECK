import type { Metadata } from "next";
import { Header } from "@/components/site/Header";
import { CtaAndFooter } from "@/components/site/Footer";
import { Capability, GrowthVisual, Kicker, Platforms, SecurityBlock, SecurityVisual, SoftwareVisual } from "@/components/site/Sections";
import { CAPABILITIES } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "Capacidades — Software, Security y Growth",
  description: "Desarrollo de plataformas y SaaS, pentesting y seguridad de aplicaciones, y SEO técnico con search intelligence. Con proyectos reales como prueba.",
};

const cap = (id: string) => CAPABILITIES.find((c) => c.id === id)!;

export default function CapacidadesPage() {
  return (
    <>
      <Header />
      <main>
        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 pb-10 pt-14 md:px-6 md:pb-14 md:pt-24">
            <Kicker>Capacidades</Kicker>
            <h1 className="mt-6 max-w-4xl font-display text-[2.4rem] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[4.2rem]">Software, Security y Growth.</h1>
            <ul className="mt-8 space-y-1 text-lg text-fsv-ink/80">
              {CAPABILITIES.map((c) => (
                <li key={c.id}>
                  <a href={`#${c.id}`} className="transition hover:text-fsv-violet">
                    <span className="mr-3 font-mono text-sm text-fsv-muted">{c.n}</span>
                    {c.fact}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 pb-16 md:px-6 md:pb-24">
            <Capability
              id="software"
              n="01 / Software"
              title={cap("software").fact}
              text="Aplicaciones web, plataformas SaaS, sistemas internos, APIs e integraciones, desarrolladas a medida y operadas en producción."
              cta="Hablemos de tu proyecto"
              visual={<SoftwareVisual />}
              proof={cap("software").proof}
            />
            <Capability
              id="security"
              n="02 / Security"
              title={cap("security").fact}
              text="Pentesting de aplicaciones web y APIs, revisión de seguridad y evaluación técnica, siempre con autorización firmada."
              cta="Pedir una evaluación"
              visual={<SecurityVisual />}
              proof={cap("security").proof}
            />
            <Capability
              id="growth"
              n="03 / Growth"
              title={cap("growth").fact}
              text="Auditoría técnica, datos reales de Search Console, investigación de keywords, rankings y optimización de contenido."
              cta="Conocer FSV Search"
              href="/search"
              visual={<GrowthVisual />}
              proof={cap("growth").proof}
            />
            <div className="border-t border-fsv-ink pt-12 md:pt-16">
              <SecurityBlock />
            </div>
          </div>
        </section>
        <Platforms />
      </main>
      <CtaAndFooter />
    </>
  );
}
