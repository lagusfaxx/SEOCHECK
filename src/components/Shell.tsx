"use client";
import Link from "next/link";
import { AccountNotice } from "./auth/AccountNotice";
import { PlanNotice } from "./PlanNotice";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import NewProject from "./NewProject";
import { GLOSSARY } from "@/lib/glossary";
import { api, Bar, cx, Drawer, Icon, Spinner, Toaster, useApi, useLocal } from "./ui";

type Project = { id: string; name: string; domain: string; country: string; language: string; gscProperty: string | null; settings: any; providers: Record<string, any>; admin?: boolean };
type Job = { id: string; kind: string; status: string; progress: number; message: string | null };

const Ctx = createContext<{ id: string; project?: Project; jobs: Job[]; refreshJobs: () => void }>({ id: "", jobs: [], refreshJobs: () => {} });
export const useProject = () => useContext(Ctx);

type NavItem = { href: string; icon: string; label: string; desc: string; jobs?: string[]; intro: string };

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "",
    items: [
      { href: "", icon: "home", label: "Resumen", desc: "Estado del proyecto y qué hacer ahora", intro: "Lo más importante del sitio y qué hacer ahora. Puedes arrastrar los bloques para ordenarlos." },
      {
        href: "/tasks", icon: "check", label: "Tareas", desc: "Qué arreglar primero",
        intro: "Las correcciones ordenadas por impacto. Márcalas al resolverlas: la próxima auditoría confirma si quedaron bien.",
      },
      {
        href: "/report", icon: "doc", label: "Informe", desc: "Análisis completo y PDF", jobs: ["report.full"],
        intro: "Corre todos los análisis de una vez y descarga el informe en PDF para el cliente o en texto para el equipo técnico.",
      },
    ],
  },
  {
    group: "Diagnóstico",
    items: [
      {
        href: "/audit", icon: "audit", label: "Auditoría", desc: "Salud técnica del sitio", jobs: ["audit.crawl", "audit.psi", "audit.inspect"],
        intro: "Recorre el sitio como Google y lista los problemas técnicos. Abre un problema para ver qué URLs lo tienen y cómo se arregla.",
      },
      {
        href: "/gsc", icon: "gsc", label: "Search Console", desc: "Clics e impresiones reales de Google", jobs: ["gsc.sync"],
        intro: "Clics, impresiones, CTR y posición reales de Google por consulta y página. Requiere conectar tu cuenta de Google.",
      },
      {
        href: "/rank", icon: "rank", label: "Rankings", desc: "Posiciones en Google", jobs: ["rank.check"],
        intro: "La posición de tus keywords en Google, revisada cada semana. Haz clic en una keyword para ver su historial.",
      },
      {
        href: "/results", icon: "trend", label: "Resultados", desc: "¿El SEO mueve las métricas?",
        intro: "Si el SEO está moviendo los clics: objetivo del mes, efecto de cada cambio publicado y dónde está el crecimiento.",
      },
    ],
  },
  {
    group: "Herramientas",
    items: [
      {
        href: "/keywords", icon: "key", label: "Keywords", desc: "Qué busca la gente", jobs: ["keywords.run"],
        intro: "Escribe 3 a 5 semillas y descubre qué busca la gente, agrupado en las páginas que conviene crear u optimizar.",
      },
      {
        href: "/content", icon: "content", label: "Contenido", desc: "Optimizar una página", jobs: ["content.analyze"],
        intro: "Compara una página con el top 10 de Google para una keyword y obtén qué le falta y un brief para reescribirla.",
      },
      { href: "/explore", icon: "map", label: "Explorar", desc: "Mapa de relaciones", intro: "Mapa de cómo se conectan páginas, keywords, clusters y competidores. Usa datos guardados: no gasta créditos." },
      { href: "/pro", icon: "layers", label: "Experto", desc: "Análisis técnicos detallados", intro: "Análisis técnicos detallados para especialistas: rastreo, indexación, arquitectura, rendimiento y más." },
      { href: "/social", icon: "social", label: "Social", desc: "Posts de Instagram", intro: "Crea y programa posts de Instagram con las keywords del proyecto." },
    ],
  },
];
/** Ajustes va aparte, al pie del menú. */
const SETTINGS: NavItem = { href: "/settings", icon: "gear", label: "Ajustes", desc: "Proyecto, cuenta y equipo", intro: "Configuración del proyecto, del rastreo, de la cuenta y del equipo." };
const ALL_NAV = [...NAV.flatMap((g) => g.items), SETTINGS];

/** Qué hace la sección, en una frase: se muestra la primera vez; al cerrarlo no vuelve (queda en Ayuda). */
function Intro({ item, onClose }: { item: NavItem; onClose: () => void }) {
  return (
    <div className="anim-in mx-4 mt-4 flex items-center gap-3 rounded-lg border border-acc/20 bg-acc-soft/60 px-4 py-2.5 text-sm dark:border-acc/30 dark:bg-acc/10 md:mx-6">
      <Icon name="info" className="h-4 w-4 shrink-0 text-acc" />
      <p className="min-w-0 flex-1 text-ink-700 dark:text-ink-200">{item.intro}</p>
      <button onClick={onClose} className="btn-g shrink-0 px-1" title="Entendido (vuelve a verlo en Ayuda)" aria-label="Cerrar">
        <Icon name="x" className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Términos del glosario que se explican en cada sección. */
const termsFor = (path: string) =>
  path.includes("/audit") ? ["canonical", "H1", "LCP", "noindex", "huérfana"]
  : path.includes("/content") ? ["SERP", "H2", "PAA", "canibalización"]
  : path.includes("/keywords") ? ["cluster", "SERP", "PAA"]
  : path.includes("/rank") ? ["SERP", "canibalización", "CTR"]
  : ["CTR", "impresiones"];

/** Ayuda común de la sección: qué hace, pasos y glosario. Un solo lugar en vez de botones en cada pantalla. */
function UserMenu({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useApi<{ user: { email: string; name: string | null } | null; admin?: boolean }>("/api/auth/me");
  const u = data?.user;
  if (!u) return null;
  return (
    <div className="relative shrink-0">
      <button className="grid h-8 w-8 place-items-center rounded-full bg-acc-soft text-sm font-semibold uppercase text-acc" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menú de la cuenta" title={u.email}>
        {(u.name || u.email).slice(0, 1)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="card fixed right-4 top-14 z-50 w-64 p-2 text-sm shadow-xl">
            <div className="px-2 py-1.5">
              {u.name && <div className="font-medium">{u.name}</div>}
              <div className="truncate text-xs text-ink-500">{u.email}</div>
            </div>
            <div className="my-1 h-px bg-ink-100 dark:bg-ink-800" />
            <Link href={`/p/${projectId}/settings#account`} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"><Icon name="gear" />Cuenta y equipo</Link>
            {data?.admin && <Link href="/admin" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"><Icon name="shield" />Administración</Link>}
            <a href="mailto:contacto@fsvc.cl" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"><Icon name="mail" />Soporte</a>
            <div className="my-1 h-px bg-ink-100 dark:bg-ink-800" />
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              onClick={async () => {
                await api("/api/auth/logout", "POST");
                window.location.href = "/login";
              }}
            >
              <Icon name="logout" />Cerrar sesión
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function HelpMenu({ item, path, onShowIntro }: { item?: NavItem; path: string; onShowIntro: () => void }) {
  const [open, setOpen] = useState(false);
  const terms = termsFor(path);
  return (
    <div className="relative shrink-0">
      <button className="btn-g text-xs" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="grid h-4 w-4 place-items-center rounded-full border border-ink-300 text-[10px] font-semibold">?</span>
        Ayuda
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="card fixed right-4 top-14 z-50 max-h-[70vh] w-[min(420px,calc(100vw-32px))] overflow-y-auto p-4 text-sm shadow-xl">
            {item && (
              <>
                <div className="font-semibold text-ink-900 dark:text-ink-100">¿Para qué sirve {item.label}?</div>
                <p className="mt-1 leading-relaxed text-ink-600 dark:text-ink-300">{item.intro}</p>
                <button className="btn-g mt-1 px-0 text-xs text-acc" onClick={() => { setOpen(false); onShowIntro(); }}>Mostrar este aviso en la sección</button>
              </>
            )}
            <div className="lbl mt-4">Glosario</div>
            <dl className="mt-1 space-y-2">
              {terms.map((t) => (
                <div key={t}>
                  <dt className="font-medium text-ink-800 dark:text-ink-100">{t}</dt>
                  <dd className="text-xs leading-snug text-ink-500">{GLOSSARY[t]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
    </div>
  );
}

const countryName = (cc?: string) => {
  if (!cc) return "";
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(cc.toUpperCase()) ?? cc;
  } catch {
    return cc;
  }
};

const JOB_LABEL: Record<string, string> = {
  "keywords.run": "keywords", "audit.crawl": "crawl", "audit.psi": "pagespeed", "audit.inspect": "inspección",
  "content.section": "sección del brief", "content.rebrief": "regeneración del brief", "report.snapshot": "informe programado",
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
  const [dismissedAll, setDismissedAll] = useLocal<string[]>(`jobs:dismissed:${id}`, []);
  const dismissed = dismissedAll;
  const setDismissed = (v: string[]) => setDismissedAll(v.slice(-50));
  // la sección más específica que coincide con la ruta (/content/xyz → Contenido)
  const current = [...ALL_NAV].sort((a, b) => b.href.length - a.href.length).find((n) => (n.href === "" ? path === base : path.startsWith(base + n.href)));
  // tutorial: visible la primera vez que se entra a cada sección; al cerrarlo queda oculto para siempre
  const [seenIntro, setSeenIntro, seenLoaded] = useLocal<string[]>("help:v3:seen", []);
  const [forceIntro, setForceIntro] = useState<string | null>(null);
  const introKey = current ? current.href || "home" : "";
  const showIntro = !!current && (forceIntro === introKey || (seenLoaded && !seenIntro.includes(introKey)));
  const closeIntro = () => { setForceIntro(null); if (!seenIntro.includes(introKey)) setSeenIntro([...seenIntro, introKey]); };
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "error");

  // una función que la instalación no ofrece no ocupa lugar en el menú del cliente (la administración la sigue viendo)
  const visible = (n: NavItem) => n.href !== "/social" || !project || project.admin || project.providers?.social !== false;
  // función y no componente: definido dentro de Shell, un componente se volvería a montar en cada render
  const navLink = (n: NavItem) => {
    const on = n === current;
    const busy = n.jobs && jobs.some((j) => n.jobs!.includes(j.kind) && (j.status === "queued" || j.status === "running"));
    const gscOff = n.href === "/gsc" && project && (!project.gscProperty || !project.providers?.gsc);
    return (
      <Link
        key={n.href}
        href={base + n.href}
        onClick={() => setMenu(false)}
        title={`${n.label}: ${n.desc}`}
        aria-current={on ? "page" : undefined}
        className={cx(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
          slim && "md:justify-center md:px-0",
          on ? "bg-acc-soft font-semibold text-acc dark:bg-acc/20" : "font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800",
        )}
      >
        {on && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-acc" />}
        <Icon name={n.icon} className={cx("nav-ic h-[18px] w-[18px] shrink-0", on && "ic-pop")} />
        <span className={cx("min-w-0 flex-1 truncate", slim && "md:hidden")}>{n.label}</span>
        {busy && <Spinner className={cx("h-3.5 w-3.5 shrink-0 text-acc", slim && "md:absolute md:right-1 md:top-1")} />}
        {!busy && gscOff && <span className={cx("h-2 w-2 shrink-0 rounded-full bg-amber-400", slim && "md:absolute md:right-1.5 md:top-1.5")} title="Search Console no está conectado" />}
      </Link>
    );
  };

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
          <div className="flex-1 space-y-5 overflow-y-auto px-2 py-3">
            {NAV.map((g) => (
              <div key={g.group || "inicio"}>
                {g.group && <div className={cx("lbl mb-1 px-3", slim && "md:hidden")}>{g.group}</div>}
                <div className="space-y-0.5">
                  {g.items.filter(visible).map(navLink)}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-0.5 border-t border-ink-100 px-2 py-2 dark:border-ink-800">
            {navLink(SETTINGS)}
            <button onClick={() => setSlim(!slim)} className={cx("btn-g hidden w-full gap-3 px-3 text-ink-500 md:flex", slim && "md:justify-center md:px-0")} title={slim ? "Expandir menú" : "Achicar menú"}>
              <Icon name={slim ? "chevr" : "chevl"} className="h-[18px] w-[18px] shrink-0" />
              {!slim && <span className="text-sm">Achicar menú</span>}
            </button>
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-200 bg-white px-4 dark:border-ink-800 dark:bg-ink-900">
            <button className="btn-g px-1 md:hidden" onClick={() => setMenu(true)} aria-label="menú">
              <Icon name="menu" className="h-5 w-5" />
            </button>
            <div className="relative">
              <button className="btn-g font-medium text-ink-900 dark:text-ink-100" onClick={() => setSwitcher(!switcher)}>
                {project?.domain ?? "…"}
                <span className="chip" title={project ? `País de búsqueda: ${countryName(project.country)} · idioma ${project.language}. Define qué Google se consulta (resultados, volúmenes y rankings).` : undefined}>{project?.country.toUpperCase()}</span>
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
            <div className="ml-auto flex min-w-0 items-center gap-2 overflow-x-auto py-1.5 pr-1.5">
              {active.filter((j) => !dismissed.includes(j.id)).map((j) => (
                <div key={j.id} className="relative shrink-0">
                  <button
                    onClick={() => setOpenJob(openJob === j.id ? null : j.id)}
                    className={cx("anim-slide flex w-40 flex-col gap-1 rounded-lg border px-2 py-1 text-left", j.status === "error" ? "border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20" : "border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800")}
                  >
                    <div className="flex w-full items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1">
                        {j.status === "error" ? <Icon name="alert" anim="wiggle" className="h-3 w-3" /> : j.status === "queued" ? <Icon name="clock" className="h-3 w-3 text-ink-400" /> : <Spinner className="h-3 w-3 text-acc" />}
                        {JOB_LABEL[j.kind] ?? j.kind}
                      </span>
                      <span className="truncate pl-2 text-ink-400">{j.status === "error" ? "error · ver" : j.message ?? (j.status === "queued" ? "en cola" : `${j.progress}%`)}</span>
                    </div>
                    {j.status !== "error" && <Bar value={j.status === "queued" ? 2 : j.progress} className="h-1 w-full" />}
                  </button>
                  {j.status === "error" && (
                    <button
                      title="descartar"
                      onClick={() => setDismissed([...dismissed, j.id])}
                      className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-rose-500 text-white shadow hover:bg-rose-600"
                    >
                      <Icon name="x" className="h-2.5 w-2.5" />
                    </button>
                  )}
                  {openJob === j.id && (
                    <div className="card fixed right-4 top-14 z-50 w-[min(420px,calc(100vw-32px))] p-3 text-sm shadow-xl">
                      <div className="flex items-center gap-2">
                        <span className={cx("chip", j.status === "error" && "!bg-rose-100 !text-rose-700")}>{JOB_LABEL[j.kind] ?? j.kind}</span>
                        <span className="text-xs text-ink-400">{j.status === "error" ? "falló" : j.status === "queued" ? "en cola" : `${j.progress}%`}</span>
                        <button className="btn-g ml-auto px-1" onClick={() => setOpenJob(null)}><Icon name="x" className="h-4 w-4" /></button>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-ink-700 dark:text-ink-200">{j.message || "sin mensaje"}</p>
                      <div className="mt-3 flex gap-2">
                        {j.status === "error" ? (
                          <>
                            <button className="btn text-xs" onClick={() => navigator.clipboard?.writeText(j.message ?? "")}><Icon name="copy" />Copiar</button>
                            <button className="btn text-xs" onClick={() => { setDismissed([...dismissed, j.id]); setOpenJob(null); }}>Descartar</button>
                          </>
                        ) : (
                          <button
                            className="btn text-xs"
                            onClick={async () => {
                              if (!confirm("¿Cancelar este trabajo?")) return;
                              await api(`/api/p/${id}/jobs/cancel`, "POST", { jobId: j.id }).catch(() => {});
                              setOpenJob(null);
                              refreshJobs();
                            }}
                          >
                            <Icon name="x" />Cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <HelpMenu item={current} path={path} onShowIntro={() => setForceIntro(introKey)} />
            <UserMenu projectId={id} />
          </header>
          <main className="flex min-h-0 flex-1 flex-col overflow-auto">
            <AccountNotice className="mx-4 mt-3 md:mx-6" />
            <PlanNotice id={id} className="mx-4 mt-3 md:mx-6" />
            {current && showIntro && <Intro key={current.href} item={current} onClose={closeIntro} />}
            <div key={path} className="anim-in flex flex-1 flex-col">{children}</div>
          </main>
        </div>
      </div>
      <Toaster />
      <Drawer open={newOpen} onClose={() => setNewOpen(false)}>
        <div className="mt-8">
          <NewProject onDone={() => { setNewOpen(false); refreshProjects(); }} />
        </div>
      </Drawer>
    </Ctx.Provider>
  );
}
