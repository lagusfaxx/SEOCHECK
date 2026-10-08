"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import NewProject from "./NewProject";
import { Bar, cx, Drawer, Hint, Icon, useApi, useLocal } from "./ui";

type Project = { id: string; name: string; domain: string; country: string; language: string; gscProperty: string | null; settings: any; providers: Record<string, any> };
type Job = { id: string; kind: string; status: string; progress: number; message: string | null };

const Ctx = createContext<{ id: string; project?: Project; jobs: Job[]; refreshJobs: () => void }>({ id: "", jobs: [], refreshJobs: () => {} });
export const useProject = () => useContext(Ctx);

type NavItem = { href: string; icon: string; label: string; desc: string; jobs?: string[]; intro: string; steps?: string[] };

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "General",
    items: [
      {
        href: "", icon: "home", label: "Resumen", desc: "Estado del proyecto",
        intro: "Vista general: keywords, salud técnica, rankings, Search Console y gasto del mes. Arrastra los bloques para ordenarlos; el botón 1/3 de cada bloque cambia su ancho.",
      },
      {
        href: "/report", icon: "doc", label: "Informe", desc: "Todo de una + informe", jobs: ["report.full"],
        intro: "Corre todos los módulos de una vez y arma un informe con las tareas ordenadas por prioridad. Está escrito para pasárselo a tu agente de código (Claude Code) y que aplique las correcciones en el sitio.",
        steps: ["Elige qué módulos correr. Keywords viene apagado porque gasta créditos de Serpent.", "Aprieta Correr todo. Tarda unos minutos; abajo del botón ves cada paso en verde, gris (saltado) o rojo.", "Copia el informe o descárgalo en .md y pégaselo a Claude Code."],
      },
    ],
  },
  {
    group: "Investigar",
    items: [
      {
        href: "/keywords", icon: "key", label: "Keywords", desc: "Qué busca la gente", jobs: ["keywords.run"],
        intro: "Descubre qué busca la gente sobre tu negocio. Partes de pocas semillas; se expanden con el autocompletado de Google, las preguntas frecuentes y tu Search Console, se les agrega volumen y se agrupan en clusters. Un cluster son keywords a las que Google responde con las mismas páginas: van juntas en una sola URL. Los clusters se agrupan en topics.",
        steps: ["Escribe 3 a 5 semillas (ej. \"masajes santiago\") y aprieta Correr.", "Revisa el tablero o el mapa: cada cluster es una página a crear u optimizar; el score ordena por oportunidad.", "Arrastra keywords entre clusters o renombra: los cambios manuales quedan con candado y se respetan al volver a correr."],
      },
      {
        href: "/explore", icon: "map", label: "Explorar", desc: "Mapa de relaciones",
        intro: "Mapa interactivo de cómo se conecta todo: tu sitio, sus páginas, keywords, clusters, competidores y problemas. Cada nodo se puede expandir para ver lo que tiene relacionado (quién rankea para una keyword, quién enlaza a una página, dónde aparece un competidor). Usa solo datos ya guardados: no gasta créditos.",
        steps: ["Haz clic en un nodo y elige qué expandir en el panel de la derecha (doble clic expande lo siguiente).", "Busca arriba una keyword, página, cluster o dominio para agregarlo al mapa.", "Arrastra nodos para ordenarlos o usa Ordenar. El mapa queda guardado en este navegador."],
      },
      {
        href: "/content", icon: "content", label: "Contenido", desc: "Optimizar una página", jobs: ["content.analyze"],
        intro: "Compara una página tuya con el top 10 de Google para una keyword: qué términos, secciones y preguntas tienen los que rankean y a ti te faltan. Genera un brief con títulos, estructura H2/H3 y FAQ.",
        steps: ["Pega la URL de tu página y la keyword que quieres rankear.", "Mira el score y los términos marcados como faltantes.", "Usa el brief (títulos, outline, FAQ) para reescribir la página."],
      },
    ],
  },
  {
    group: "Monitorear",
    items: [
      {
        href: "/audit", icon: "audit", label: "Auditoría", desc: "Salud técnica del sitio", jobs: ["audit.crawl", "audit.psi", "audit.inspect"],
        intro: "Recorre tu sitio como lo haría Google y detecta problemas técnicos: errores, redirects, títulos y metas, contenido duplicado, páginas huérfanas, velocidad (PageSpeed) e indexación (Search Console).",
        steps: ["Aprieta Crawlear con un máximo mayor que la cantidad de páginas del sitio (si no, aparecen huérfanas falsas).", "Corrige primero los Críticos, después los Warnings. Los Info son mejoras opcionales.", "Haz clic en un issue para ver qué significa, cómo se arregla y qué URLs lo tienen."],
      },
      {
        href: "/rank", icon: "rank", label: "Rankings", desc: "Posiciones en Google", jobs: ["rank.check"],
        intro: "Sigue la posición de tus keywords en Google (top 100) cada semana. Avisa cuando una keyword cae más de 3 posiciones, cuando dos páginas tuyas compiten por la misma keyword (canibalización) y cuando el CTR es bajo para la posición.",
        steps: ["Agrega las keywords que te importan (una por línea).", "Se revisan solas cada semana; Revisar las actualiza ahora (gasta Serpent).", "Haz clic en una keyword para ver su historial y el top 10 actual."],
      },
      {
        href: "/gsc", icon: "gsc", label: "Search Console", desc: "Datos reales de Google", jobs: ["gsc.sync"],
        intro: "Clics, impresiones, CTR y posición reales por consulta y página, sacados de Google Search Console. Requiere la propiedad configurada en Ajustes y la cuenta de servicio con acceso.",
      },
    ],
  },
  {
    group: "Configurar",
    items: [
      {
        href: "/settings", icon: "gear", label: "Ajustes", desc: "Proyecto y crawler",
        intro: "Configuración del proyecto: propiedad de Search Console, opciones del crawler (User-Agent, límites, parámetros a ignorar), expansión de keywords y frecuencia de rankings.",
      },
    ],
  },
];
const ALL_NAV = NAV.flatMap((g) => g.items);

function Intro({ item }: { item: NavItem }) {
  const [open, setOpen] = useLocal<boolean>(`help:${item.href || "home"}`, true);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="btn-g mx-4 mt-3 text-xs md:mx-6">
        <Hint text={item.intro} /> ¿Para qué sirve {item.label}?
      </button>
    );
  return (
    <div className="mx-4 mt-4 rounded-xl border border-acc/20 bg-acc-soft/60 p-4 text-sm dark:border-acc/30 dark:bg-acc/10 md:mx-6">
      <div className="flex items-start gap-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-acc dark:bg-ink-900">
          <Icon name={item.icon} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink-900 dark:text-ink-100">{item.label}</div>
          <p className="mt-0.5 max-w-3xl leading-relaxed text-ink-600 dark:text-ink-300">{item.intro}</p>
          {item.steps && (
            <ol className="mt-2 grid gap-1.5 md:grid-cols-3">
              {item.steps.map((st, i) => (
                <li key={i} className="flex gap-2 text-ink-600 dark:text-ink-300">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-acc text-[11px] font-semibold text-white">{i + 1}</span>
                  <span className="leading-snug">{st}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <button onClick={() => setOpen(false)} className="btn-g shrink-0 px-1" title="ocultar">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

const JOB_LABEL: Record<string, string> = {
  "keywords.run": "keywords", "audit.crawl": "crawl", "audit.psi": "pagespeed", "audit.inspect": "inspección",
  "rank.check": "rankings", "gsc.sync": "gsc", "alerts.compute": "alertas", "content.analyze": "contenido", "report.full": "informe",
};

export default function Shell({ id, children }: { id: string; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { data: project } = useApi<Project>(`/api/p/${id}/_`);
  const { data: projects, mutate: refreshProjects } = useApi<Project[]>("/api/projects");
  const { data: jobs = [], mutate: refreshJobs } = useApi<Job[]>(`/api/p/${id}/jobs`, { refreshInterval: (d?: Job[]) => (d?.some((j: Job) => j.status === "queued" || j.status === "running") ? 1500 : 8000) });
  const [newOpen, setNewOpen] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const prev = useRef<Record<string, string>>({});

  useEffect(() => {
    let finished = false;
    for (const j of jobs) {
      if (prev.current[j.id] && prev.current[j.id] !== j.status && (j.status === "done" || j.status === "error")) finished = true;
      prev.current[j.id] = j.status;
    }
    if (finished) mutate((k) => typeof k === "string" && k.startsWith(`/api/p/${id}/`) && !k.endsWith("/jobs"));
  }, [jobs, id, mutate]);

  const base = `/p/${id}`;
  const [slim, setSlim] = useLocal<boolean>("nav:slim", false);
  const [menu, setMenu] = useState(false);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [dismissed, setDismissed] = useLocal<string[]>(`jobs:dismissed:${id}`, []);
  // la sección más específica que coincide con la ruta (/content/xyz → Contenido)
  const current = [...ALL_NAV].sort((a, b) => b.href.length - a.href.length).find((n) => (n.href === "" ? path === base : path.startsWith(base + n.href)));
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "error");

  return (
    <Ctx.Provider value={{ id, project, jobs, refreshJobs: () => refreshJobs() }}>
      <div className="flex h-screen">
        {menu && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMenu(false)} />}
        <nav
          className={cx(
            "fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-ink-200 bg-white transition-all dark:border-ink-800 dark:bg-ink-900 md:static md:translate-x-0",
            menu ? "translate-x-0" : "-translate-x-full",
            slim ? "w-64 md:w-16" : "w-64"
          )}
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
            {NAV.map((g) => (
              <div key={g.group}>
                <div className={cx("lbl mb-1 px-3", slim && "md:hidden")}>{g.group}</div>
                <div className="space-y-0.5">
                  {g.items.map((n) => {
                    const href = base + n.href;
                    const on = n === current;
                    const busy = n.jobs && jobs.some((j) => n.jobs!.includes(j.kind) && (j.status === "queued" || j.status === "running"));
                    return (
                      <Link
                        key={n.href}
                        href={href}
                        onClick={() => setMenu(false)}
                        title={slim ? `${n.label} · ${n.desc}` : undefined}
                        className={cx(
                          "group relative flex items-center gap-3 rounded-lg px-3 py-2 transition",
                          slim && "md:justify-center md:px-0",
                          on ? "bg-acc-soft text-acc dark:bg-acc/20" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800"
                        )}
                      >
                        {on && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-acc" />}
                        <Icon name={n.icon} className="h-[18px] w-[18px] shrink-0" />
                        <span className={cx("min-w-0 flex-1", slim && "md:hidden")}>
                          <span className="block text-sm font-medium leading-tight">{n.label}</span>
                          <span className={cx("block truncate text-[11px] leading-tight", on ? "text-acc/70" : "text-ink-400")}>{n.desc}</span>
                        </span>
                        {busy && <span className={cx("h-2 w-2 shrink-0 animate-pulse rounded-full bg-acc", slim && "md:absolute md:right-2 md:top-2")} />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setSlim(!slim)} className="btn-g m-2 hidden justify-center md:flex" title={slim ? "expandir menú" : "achicar menú"}>
            <Icon name={slim ? "chevr" : "chevl"} className="h-4 w-4" />
            {!slim && <span className="text-xs">achicar</span>}
          </button>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-200 bg-white px-4 dark:border-ink-800 dark:bg-ink-900">
            <button className="btn-g px-1 md:hidden" onClick={() => setMenu(true)} aria-label="menú">
              <Icon name="menu" className="h-5 w-5" />
            </button>
            <div className="relative">
              <button className="btn-g font-medium text-ink-900 dark:text-ink-100" onClick={() => setSwitcher(!switcher)}>
                {project?.domain ?? "…"}
                <span className="chip">{project?.country.toUpperCase()}</span>
                <Icon name="down" className="h-3.5 w-3.5" />
              </button>
              {switcher && (
                <div className="card absolute left-0 top-9 z-50 w-64 p-1 shadow-xl" onMouseLeave={() => setSwitcher(false)}>
                  {projects?.map((p) => (
                    <button key={p.id} className={cx("block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-800", p.id === id && "font-semibold")} onClick={() => { setSwitcher(false); router.push(`/p/${p.id}`); }}>
                      {p.domain}
                    </button>
                  ))}
                  <button className="btn-g w-full" onClick={() => { setSwitcher(false); setNewOpen(true); }}>
                    <Icon name="plus" /> proyecto
                  </button>
                </div>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2 overflow-x-auto">
              {active.filter((j) => !dismissed.includes(j.id)).map((j) => (
                <div key={j.id} className="relative shrink-0">
                  <button
                    onClick={() => setOpenJob(openJob === j.id ? null : j.id)}
                    className={cx("flex w-40 flex-col gap-1 rounded-lg border px-2 py-1 text-left", j.status === "error" ? "border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20" : "border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800")}
                  >
                    <div className="flex w-full justify-between text-[11px]">
                      <span>{JOB_LABEL[j.kind] ?? j.kind}</span>
                      <span className="truncate pl-2 text-ink-400">{j.status === "error" ? "error · ver" : j.message ?? (j.status === "queued" ? "en cola" : `${j.progress}%`)}</span>
                    </div>
                    {j.status !== "error" && <Bar value={j.status === "queued" ? 2 : j.progress} className="h-1 w-full" />}
                  </button>
                  {openJob === j.id && (
                    <div className="card fixed right-4 top-14 z-50 w-[min(420px,calc(100vw-32px))] p-3 text-sm shadow-xl">
                      <div className="flex items-center gap-2">
                        <span className={cx("chip", j.status === "error" && "!bg-rose-100 !text-rose-700")}>{JOB_LABEL[j.kind] ?? j.kind}</span>
                        <span className="text-xs text-ink-400">{j.status === "error" ? "falló" : j.status === "queued" ? "en cola" : `${j.progress}%`}</span>
                        <button className="btn-g ml-auto px-1" onClick={() => setOpenJob(null)}><Icon name="x" className="h-4 w-4" /></button>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-ink-700 dark:text-ink-200">{j.message || "sin mensaje"}</p>
                      {j.status === "error" && (
                        <div className="mt-3 flex gap-2">
                          <button className="btn text-xs" onClick={() => navigator.clipboard?.writeText(j.message ?? "")}><Icon name="copy" />Copiar</button>
                          <button className="btn text-xs" onClick={() => { setDismissed([...dismissed, j.id]); setOpenJob(null); }}>Descartar</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </header>
          <main className="flex min-h-0 flex-1 flex-col overflow-auto">
            {current && <Intro key={current.href} item={current} />}
            <div className="flex flex-1 flex-col">{children}</div>
          </main>
        </div>
      </div>
      <Drawer open={newOpen} onClose={() => setNewOpen(false)}>
        <div className="mt-8">
          <NewProject onDone={() => { setNewOpen(false); refreshProjects(); }} />
        </div>
      </Drawer>
    </Ctx.Provider>
  );
}
