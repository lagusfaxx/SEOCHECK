import type { ReactNode } from "react";
import { Header } from "./Header";
import { CtaAndFooter } from "./Footer";
import { Kicker } from "./Sections";

/** Página legal del sitio público: título, fecha de actualización y secciones numeradas por bordes. */
export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: { title: string; body: ReactNode }[] }) {
  return (
    <>
      <Header />
      <main className="bg-white">
        <div className="mx-auto max-w-3xl px-4 pb-20 pt-14 md:px-6 md:pt-24">
          <Kicker>Legal</Kicker>
          <h1 className="mt-6 font-display text-[2.2rem] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[3.2rem]">{title}</h1>
          <p className="mt-4 font-mono text-sm text-fsv-muted">Última actualización: {updated}</p>
          <div className="mt-12 space-y-10">
            {sections.map((s) => (
              <section key={s.title} className="border-t border-fsv-line pt-6">
                <h2 className="font-display text-xl font-semibold tracking-tight">{s.title}</h2>
                <div className="mt-3 space-y-3 leading-relaxed text-fsv-ink/80 [&_a]:text-fsv-violet [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2">{s.body}</div>
              </section>
            ))}
          </div>
        </div>
      </main>
      <CtaAndFooter />
    </>
  );
}
