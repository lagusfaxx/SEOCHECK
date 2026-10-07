"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import NewProject from "./NewProject";
import { Bar, cx, Drawer, Icon, useApi } from "./ui";

type Project = { id: string; name: string; domain: string; country: string; language: string; gscProperty: string | null; settings: any; providers: Record<string, any> };
type Job = { id: string; kind: string; status: string; progress: number; message: string | null };

const Ctx = createContext<{ id: string; project?: Project; jobs: Job[]; refreshJobs: () => void }>({ id: "", jobs: [], refreshJobs: () => {} });
export const useProject = () => useContext(Ctx);

const NAV = [
  { href: "", icon: "home", label: "Resumen" },
  { href: "/keywords", icon: "key", label: "Keywords" },
  { href: "/audit", icon: "audit", label: "Auditoría" },
  { href: "/rank", icon: "rank", label: "Rankings" },
  { href: "/gsc", icon: "gsc", label: "Search Console" },
  { href: "/content", icon: "content", label: "Contenido" },
  { href: "/settings", icon: "gear", label: "Ajustes" },
];

const JOB_LABEL: Record<string, string> = {
  "keywords.run": "keywords", "audit.crawl": "crawl", "audit.psi": "pagespeed", "audit.inspect": "inspección",
  "rank.check": "rankings", "gsc.sync": "gsc", "alerts.compute": "alertas", "content.analyze": "contenido",
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
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "error");

  return (
    <Ctx.Provider value={{ id, project, jobs, refreshJobs: () => refreshJobs() }}>
      <div className="flex h-screen">
        <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-ink-200 bg-white py-3 dark:border-ink-800 dark:bg-ink-900">
          {NAV.map((n) => {
            const href = base + n.href;
            const on = n.href === "" ? path === base : path.startsWith(href);
            return (
              <Link key={n.href} href={href} title={n.label} className={cx("group relative grid h-10 w-10 place-items-center rounded-lg transition", on ? "bg-acc-soft text-acc dark:bg-acc/20" : "text-ink-400 hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800")}>
                <Icon name={n.icon} className="h-[18px] w-[18px]" />
                <span className="pointer-events-none absolute left-12 z-50 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100">{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-200 bg-white px-4 dark:border-ink-800 dark:bg-ink-900">
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
              {active.map((j) => (
                <div key={j.id} className={cx("flex w-40 shrink-0 flex-col gap-1 rounded-lg border px-2 py-1", j.status === "error" ? "border-rose-300 text-rose-600" : "border-ink-200 dark:border-ink-700")} title={j.message ?? ""}>
                  <div className="flex justify-between text-[11px]">
                    <span>{JOB_LABEL[j.kind] ?? j.kind}</span>
                    <span className="truncate pl-2 text-ink-400">{j.status === "error" ? "error" : j.message ?? (j.status === "queued" ? "en cola" : `${j.progress}%`)}</span>
                  </div>
                  {j.status !== "error" && <Bar value={j.status === "queued" ? 2 : j.progress} className="h-1" />}
                </div>
              ))}
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
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
