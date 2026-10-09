import type { Metadata } from "next";
import { Header } from "@/components/site/Header";
import { CtaAndFooter } from "@/components/site/Footer";
import { Capability, GrowthVisual, Kicker, Platforms, SecurityBlock, SecurityVisual, SoftwareVisual } from "@/components/site/Sections";

export const metadata: Metadata = {
  title: "Capacidades — Software, Security y Growth",
  description: "Desarrollo de software a medida, pentesting y seguridad de aplicaciones, y crecimiento orgánico con datos. Las plataformas que operamos todos los días.",
};

export default function CapacidadesPage() {
  return (
    <>
      <Header />
      <main>
        <section className="border-b border-fsv-line bg-fsv-bg">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-14 md:px-6 md:pb-20 md:pt-20">
            <Kicker>Capacidades</Kicker>
            <h1 className="mt-6 max-w-4xl font-display text-[2.4rem] font-semibold leading-[1.04] tracking-[-0.035em] md:text-6xl">Tecnología de punta a punta.</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-fsv-muted">Desde la construcción de una plataforma hasta su seguridad y crecimiento.</p>
          </div>
        </section>
        <section className="bg-white">
          <div className="mx-auto max-w-6xl space-y-4 px-4 py-16 md:px-6 md:py-24">
            <Capability
              id="software"
              n="01 / Software"
              title="Construimos productos digitales."
              text="Aplicaciones web, plataformas SaaS, sistemas internos, APIs, integraciones y soluciones desarrolladas a medida."
              cta="Hablemos de tu proyecto"
              visual={<SoftwareVisual />}
            />
            <Capability
              id="security"
              n="02 / Security"
              title="Encontramos vulnerabilidades antes de que se conviertan en problemas."
              text="Pentesting de aplicaciones web y APIs, revisión de seguridad y evaluación técnica, siempre con autorización firmada."
              cta="Pedir una evaluación"
              visual={<SecurityVisual />}
            />
            <Capability
              id="growth"
              n="03 / Growth"
              title="Convertimos datos en crecimiento."
              text="Herramientas, automatización y análisis para mejorar adquisición, búsqueda y rendimiento digital. Aquí nace FSV Search."
              cta="Conocer FSV Search"
              href="/search"
              visual={<GrowthVisual />}
            />
            <div className="pt-8">
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
