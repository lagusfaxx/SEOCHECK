import type { Metadata } from "next";
import { Header } from "@/components/site/Header";
import { CtaAndFooter } from "@/components/site/Footer";
import { Kicker, SecurityBlock } from "@/components/site/Sections";

export const metadata: Metadata = {
  title: "Empresa — Cómo trabajamos",
  description: "Full Stack Ventures SpA, Santiago de Chile. Desarrollamos software, auditamos sistemas y construimos productos digitales propios.",
};

const STEPS: [string, string][] = [
  ["Entender", "Partimos por el problema, no por la tecnología."],
  ["Construir", "Diseñamos y desarrollamos la solución con objetivos medibles."],
  ["Probar", "Validamos funcionalidad, seguridad y comportamiento real."],
  ["Mejorar", "Medimos resultados y seguimos iterando."],
];

export default function EmpresaPage() {
  return (
    <>
      <Header />
      <main>
        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-14 md:px-6 md:pb-20 md:pt-24">
            <Kicker>Empresa</Kicker>
            <h1 className="mt-6 max-w-4xl font-display text-[2.4rem] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[4.2rem]">Full Stack Ventures SpA.</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-fsv-ink/80">Desarrollamos software, auditamos sistemas y construimos productos digitales propios desde Santiago de Chile.</p>
          </div>
        </section>
        <section id="como-trabajamos" className="scroll-mt-16 border-t border-fsv-line bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <Kicker>Cómo trabajamos</Kicker>
            <ol className="mt-6 grid border-t border-fsv-ink sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(([t, d], i) => (
                <li key={t} className={`border-b border-fsv-line py-6 sm:pr-6 ${i % 2 ? "sm:border-l sm:pl-6" : ""} ${i === 2 ? "lg:border-l lg:pl-6" : ""}`}>
                  <div className="font-mono text-sm text-fsv-violet">0{i + 1}</div>
                  <div className="mt-4 font-display text-2xl font-semibold tracking-tight">{t}</div>
                  <p className="mt-2 leading-relaxed text-fsv-muted">{d}</p>
                </li>
              ))}
            </ol>
            <div className="mt-16 border-t border-fsv-ink pt-10">
              <SecurityBlock />
            </div>
          </div>
        </section>
      </main>
      <CtaAndFooter />
    </>
  );
}
