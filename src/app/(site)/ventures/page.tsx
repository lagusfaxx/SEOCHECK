import type { Metadata } from "next";
import { Header } from "@/components/site/Header";
import { CtaAndFooter } from "@/components/site/Footer";
import { IdeaForm } from "@/components/site/IdeaForm";
import { STATS } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "Ventures — Construimos tu idea contigo",
  description: "Llegas con una idea y la construimos contigo como socios, con $0 de entrada, o por servicio a precio cerrado. Diagnóstico gratis en dos semanas.",
};

const STEPS: [string, string][] = [
  ["Nos cuentas tu idea", "Llenas el formulario en unos cinco minutos. No necesitas pitch, prototipo ni empresa formada."],
  ["Te respondemos en la semana", "Siempre, aunque sea para decirte que no. Si nos interesa, nos juntamos (en Santiago o por videollamada) y nos muestras lo que tienes."],
  ["Recibes un diagnóstico gratis en dos semanas", "Un informe escrito con lo que vemos bien, lo que vemos mal y lo que haríamos. Es tuyo, trabajemos juntos o no."],
  ["Te proponemos una de dos formas de trabajar", "Como socios, con $0 de entrada, o por servicio, con precio fijo."],
];

const PARTNER: string[] = [
  "Firmamos un acuerdo con nuestro porcentaje, los hitos y qué pasa en cada escenario. Tú sigues siendo el fundador y el socio mayoritario.",
  "Antes de programar, salimos a validar con clientes reales.",
  "Si hay interés, construimos todo lo que falta: el producto (o lo fabricamos o importamos), la SpA, los contratos, la contabilidad, la seguridad y los canales de venta.",
  "Tú lideras el negocio y le dedicas el tiempo. Nos juntamos una vez al mes a revisar números.",
];

const GIVES: [string[], string[]] = [
  ["La idea y el conocimiento del problema", "Tu tiempo y tu compromiso", "El liderazgo del negocio"],
  ["Desarrollo, diseño, fabricación e importación", "Abogados y contadores", "Infraestructura y ciberseguridad", "Experiencia vendiendo y red de contactos"],
];

const FAQ: [string, string][] = [
  ["¿Me van a robar la idea?", "No. Lo que nos cuentas es confidencial, y si no trabajamos juntos no desarrollamos lo mismo por nuestra cuenta."],
  ["¿Cuánto porcentaje se quedan?", "Depende de lo que traigas: más si llegas solo con la idea, menos si ya tienes clientes. Queda firmado antes de empezar."],
  ["¿Pierdo el control de mi empresa?", "No. Sigues siendo el socio mayoritario y el que decide el día a día."],
  ["¿Y si me quiero salir?", "Los porcentajes se van ganando con el tiempo, de ambos lados. Si alguien se va antes, pierde la parte que todavía no ganó."],
  ["¿Necesito plata para partir?", "No. Como socios, no se cobra por construir."],
];

function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`font-mono text-xs uppercase tracking-[0.2em] text-fsv-muted ${className}`}>{children}</div>;
}

export default function VenturesPage() {
  return (
    <>
      <Header />
      <main>
        <section className="border-b border-fsv-line bg-fsv-bg">
          <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 md:px-6 md:pb-28 md:pt-24">
            <Kicker>FSV / Ventures</Kicker>
            <h1 className="mt-6 max-w-4xl font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[4.2rem]">¿Tienes una idea? La construimos contigo.</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-fsv-muted">Como socios, con $0 de entrada y tú como socio mayoritario. O por servicio, con precio cerrado antes de empezar.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href="#postular" className="inline-flex items-center gap-2 rounded-sm bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
                Cuéntanos tu idea <span aria-hidden>→</span>
              </a>
              <a href="#como-funciona" className="rounded-sm border border-fsv-ink/15 bg-white px-5 py-3 font-medium transition hover:border-fsv-ink/40">
                Cómo funciona
              </a>
            </div>
            <dl className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-fsv-line bg-fsv-line md:mt-16 lg:grid-cols-4">
              {STATS.map((st) => (
                <div key={st.short} className="bg-white p-5 md:p-6">
                  <dt className="sr-only">{st.long}</dt>
                  <dd className="font-display text-3xl font-semibold tracking-[-0.03em] md:text-4xl">{st.value}</dd>
                  <dd className="mt-2 text-sm text-fsv-muted"><span className="md:hidden">{st.short}</span><span className="hidden md:inline">{st.long}</span></dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="como-funciona" className="scroll-mt-16 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-24 md:px-6 md:py-32">
            <Kicker>Así funciona</Kicker>
            <h2 className="mt-6 font-display text-4xl font-semibold tracking-[-0.03em] md:text-6xl">De la idea a una propuesta, en tres semanas.</h2>
            <ol className="mt-14 grid gap-px overflow-hidden rounded-sm border border-fsv-line bg-fsv-line sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="bg-white p-8">
                  <div className="font-mono text-sm text-fsv-violet">0{i + 1}</div>
                  <div className="mt-8 font-display text-xl font-semibold leading-snug tracking-tight">{t}</div>
                  <p className="mt-3 leading-relaxed text-fsv-muted">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-fsv-line bg-fsv-bg">
          <div className="mx-auto max-w-6xl px-4 py-24 md:px-6 md:py-32">
            <Kicker>Dos formas de trabajar</Kicker>
            <div className="mt-10 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <article className="rounded-sm border border-fsv-ink bg-white p-8 md:p-10">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-display text-3xl font-semibold tracking-tight">Como socios</h3>
                  <span className="rounded-full bg-fsv-violet px-3 py-1 font-mono text-xs uppercase tracking-wider text-white">$0 de entrada</span>
                </div>
                <ul className="mt-8 space-y-4">
                  {PARTNER.map((t) => (
                    <li key={t} className="flex gap-3 leading-relaxed">
                      <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-fsv-violet" />
                      {t}
                    </li>
                  ))}
                </ul>
                <div className="mt-8 grid gap-4 md:grid-cols-2">
                  <div className="rounded-sm bg-emerald-50 p-5">
                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-700">Si funciona</div>
                    <p className="mt-2 text-sm leading-relaxed">La empresa crece, la tecnología pasa a ser de tu empresa al cumplir los hitos (siempre antes de que entre un inversionista) y ambos ganamos con nuestra parte.</p>
                  </div>
                  <div className="rounded-sm bg-fsv-bg p-5">
                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fsv-muted">Si no funciona en el plazo acordado</div>
                    <p className="mt-2 text-sm leading-relaxed">Se cierra, lo que construimos vuelve a nosotros y no nos debes nada. Perdimos los dos el tiempo, pero no quedas endeudado.</p>
                  </div>
                </div>
              </article>
              <article className="rounded-sm border border-fsv-line bg-white p-8 md:p-10">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-display text-3xl font-semibold tracking-tight">Por servicio</h3>
                  <span className="rounded-full bg-fsv-bg px-3 py-1 font-mono text-xs uppercase tracking-wider text-fsv-muted">Precio fijo</span>
                </div>
                <p className="mt-8 leading-relaxed">Si solo necesitas una parte (subir tu app a producción, constituir la SpA, ponerte al día con el SII, un pentest), te cotizamos un precio cerrado antes de empezar.</p>
                <p className="mt-4 leading-relaxed text-fsv-muted">Si es infraestructura, se suma una mensualidad por servidores, seguridad y respaldos.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="border-t border-fsv-line bg-white">
          <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
            <h2 className="font-display text-4xl font-semibold tracking-[-0.03em] md:text-5xl">Lo que pone cada uno</h2>
            <div className="mt-12 grid overflow-hidden rounded-sm border border-fsv-line md:grid-cols-2">
              {(["Tú, el fundador", "Nosotros"] as const).map((who, i) => (
                <div key={who} className={i ? "border-t border-fsv-line bg-fsv-bg md:border-l md:border-t-0" : "bg-white"}>
                  <div className="border-b border-fsv-line px-8 py-4 font-mono text-xs uppercase tracking-[0.18em] text-fsv-muted">{who}</div>
                  <ul className="divide-y divide-fsv-line">
                    {GIVES[i].map((g) => (
                      <li key={g} className="px-8 py-4 font-display text-lg tracking-tight">
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-fsv-line bg-fsv-bg">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 md:grid-cols-[1fr_1.5fr] md:px-6">
            <h2 className="font-display text-4xl font-semibold tracking-[-0.03em] md:text-5xl">Lo que suelen preguntar</h2>
            <div className="divide-y divide-fsv-line border-y border-fsv-line">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-display text-lg font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
                    {q}
                    <span className="font-mono text-xl text-fsv-violet transition group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-xl leading-relaxed text-fsv-muted">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="postular" className="scroll-mt-16 border-t border-fsv-line bg-white">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 md:grid-cols-[1fr_1.3fr] md:px-6 md:py-32">
            <div>
              <h2 className="font-display text-4xl font-semibold tracking-[-0.03em] md:text-6xl">Cuéntanos tu idea</h2>
              <p className="mt-5 max-w-sm text-lg text-fsv-muted">No necesitas un pitch ni una presentación. Escríbelo como se lo contarías a un amigo.</p>
              <ul className="mt-8 space-y-3 font-mono text-sm">
                {["Respondemos todo, incluso para decir que no", "El diagnóstico no se cobra", "Tu idea no sale de acá"].map((t) => (
                  <li key={t} className="flex gap-3">
                    <span className="text-fsv-violet">+</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <IdeaForm />
          </div>
        </section>
      </main>
      <CtaAndFooter />
    </>
  );
}
