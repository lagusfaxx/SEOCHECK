import type { Metadata } from "next";
import { Header } from "@/components/site/Header";
import { CtaAndFooter } from "@/components/site/Footer";
import { BusinessCard, Kicker } from "@/components/site/Sections";
import { CLIENT_WORK, OWN_BUSINESSES, STATS } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "Proyectos — Negocios que construimos y operamos",
  description: "Nomadbrew, Starseeker, TAUPOC, Uzeed, La Frida, ANDES Technologies, Centinela, Rent A Hacker y Barzuo.",
};

export default function WorkPage() {
  return (
    <>
      <Header />
      <main>
        <section className="border-b border-fsv-line bg-fsv-bg">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-14 md:px-6 md:pb-20 md:pt-20">
            <Kicker>Selected work</Kicker>
            <h1 className="mt-6 max-w-4xl font-display text-[2.4rem] font-semibold leading-[1.04] tracking-[-0.035em] md:text-6xl">Negocios que construimos y operamos.</h1>
            <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-fsv-line bg-fsv-line md:mt-12 lg:grid-cols-4">
              {STATS.map((st) => (
                <div key={st.short} className="bg-white p-5 md:p-6">
                  <dt className="sr-only">{st.long}</dt>
                  <dd className="font-display text-3xl font-semibold tracking-[-0.03em] md:text-4xl">{st.value}</dd>
                  <dd className="mt-1 text-sm text-fsv-muted md:mt-2">
                    <span className="md:hidden">{st.short}</span>
                    <span className="hidden md:inline">{st.long}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Construidos y operados por nuestro equipo</h2>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {OWN_BUSINESSES.map((b) => (
                <li key={b.name}>
                  <BusinessCard b={b} />
                </li>
              ))}
            </ul>
            <h2 className="mt-16 font-display text-2xl font-semibold tracking-tight md:mt-20 md:text-3xl">Construidos para clientes</h2>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CLIENT_WORK.map((b) => (
                <li key={b.name}>
                  <BusinessCard b={b} client />
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <CtaAndFooter />
    </>
  );
}
