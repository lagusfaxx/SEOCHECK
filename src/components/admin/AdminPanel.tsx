"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { api, cx, Empty, fmt, fmtDate, Icon, Spinner, Stat, Tabs, Toaster, toast, useApi } from "../ui";
import { Spend } from "./Spend";

type Tab = "overview" | "users" | "workspaces" | "instagram" | "spend" | "config";
const TABS: Tab[] = ["overview", "users", "workspaces", "instagram", "spend", "config"];

type Overview = {
  users: number; verified: number; new7: number; new30: number; active7: number; disabled: number; workspaces: number; projects: number;
  jobs24: number; jobsErr24: number; spendMonth: number; postsPublished: number; pendingIg: number; workerAlive: boolean; signups: { d: string; n: number }[];
};
type UserRow = {
  id: string; email: string; name: string | null; createdAt: string; lastLoginAt: string | null; verified: boolean; google: boolean; disabledAt: string | null;
  memberships: { role: string; workspace: { id: string; name: string; trusted: boolean; projects: number; planLabel: string } }[];
};
type WsRow = { id: string; name: string; plan: string; effectivePlan: string; planLabel: string; trusted: boolean; expired: boolean; seats: number; mpStatus: string | null; planValidUntil: string | null; trialEndsAt: string; createdAt: string; spendMonth: number; _count: { projects: number; members: number } };
type CheckRow = { key: string; label: string; level: "ok" | "warn" | "error" | "info"; detail: string };

const LEVEL: Record<CheckRow["level"], [string, string]> = {
  ok: ["check", "text-emerald-600"],
  warn: ["alert", "text-amber-500"],
  error: ["alert", "text-rose-600"],
  info: ["info", "text-ink-400"],
};

function OverviewTab() {
  const { data } = useApi<Overview>("/api/admin/overview", { refreshInterval: 60000 });
  if (!data) return <div className="flex items-center gap-2 text-ink-500"><Spinner />Cargando…</div>;
  const byDay = new Map(data.signups.map((s) => [s.d.slice(0, 10), s.n]));
  const series = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10);
    return { d, n: byDay.get(d) ?? 0 };
  });
  const max = Math.max(1, ...series.map((s) => s.n));
  return (
    <div className="space-y-6">
      {!data.workerAlive && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">El worker no responde: los trabajos y las publicaciones programadas están detenidos.</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Usuarios" value={fmt(data.users)} sub={`${fmt(data.verified)} verificados · ${fmt(data.disabled)} suspendidos`} />
        <Stat label="Registros" value={fmt(data.new7)} sub={`últimos 7 días · ${fmt(data.new30)} en 30 días`} />
        <Stat label="Activos" value={fmt(data.active7)} sub="usaron la app en 7 días" />
        <Stat label="Proyectos" value={fmt(data.projects)} sub={`${fmt(data.workspaces)} workspaces`} />
        <Stat label="Trabajos 24 h" value={fmt(data.jobs24)} sub={`${fmt(data.jobsErr24)} con error`} tone={data.jobsErr24 > data.jobs24 / 4 && data.jobs24 > 3 ? "bad" : undefined} />
        <Stat label="Gasto en APIs (mes)" value={`$${data.spendMonth.toFixed(2)}`} sub="USD, todos los proveedores" />
        <Stat label="Posts en Instagram" value={fmt(data.postsPublished)} sub="publicados desde la app" />
        <Stat label="Solicitudes de Instagram" value={fmt(data.pendingIg)} sub="cuentas esperando habilitación" tone={data.pendingIg ? "bad" : undefined} />
      </div>
      <div className="card p-4">
        <div className="lbl mb-3">Registros por día (30 días)</div>
        {data.signups.length ? (
          <div className="flex h-24 items-end gap-1">
            {series.map((s) => (
              <div key={s.d} className={cx("flex-1 rounded-t", s.n ? "bg-acc/70" : "bg-ink-100 dark:bg-ink-800")} style={{ height: s.n ? `${(s.n / max) * 100}%` : "2px" }} title={`${fmtDate(s.d)}: ${s.n}`} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-500">Sin registros en los últimos 30 días.</p>
        )}
      </div>
    </div>
  );
}

function UsersTab({ me }: { me: string }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, mutate } = useApi<UserRow[]>(`/api/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  const act = async (path: string, body: unknown, ok: string) => {
    try {
      await api(`/api/admin/${path}`, "POST", body);
      toast(ok, "ok");
      mutate();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="flex gap-2">
        <input className="input max-w-sm" placeholder="Buscar por correo o nombre" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">Buscar</button>
      </form>
      {!data ? (
        <div className="flex items-center gap-2 text-ink-500"><Spinner />Cargando…</div>
      ) : !data.length ? (
        <Empty icon="users" title="Sin resultados" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl min-w-[760px]">
            <thead>
              <tr><th>Usuario</th><th>Workspace / plan</th><th>Alta</th><th>Último acceso</th><th>Estado</th><th /></tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className={cx(u.disabledAt && "opacity-60")}>
                  <td>
                    <div className="font-medium">{u.email}</div>
                    <div className="text-xs text-ink-500">{u.name ?? "—"}{u.google && " · Google"}</div>
                  </td>
                  <td className="text-xs">
                    {u.memberships.map((m) => (
                      <div key={m.workspace.id}>{m.workspace.name} <span className="text-ink-400">({m.workspace.trusted ? "instancia" : m.workspace.planLabel}, {m.role}, {m.workspace.projects} proy.)</span></div>
                    ))}
                  </td>
                  <td className="text-xs">{fmtDate(u.createdAt)}</td>
                  <td className="text-xs">{u.lastLoginAt ? fmtDate(u.lastLoginAt, "datetime") : "—"}</td>
                  <td>
                    {u.disabledAt ? <span className="chip !bg-rose-100 !text-rose-800">Suspendido</span> : u.verified ? <span className="chip !bg-emerald-100 !text-emerald-800">Verificado</span> : <span className="chip !bg-amber-100 !text-amber-800">Sin verificar</span>}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {!u.verified && <button className="btn-g px-2 py-1 text-xs" onClick={() => act("users/verify", { userId: u.id }, "Correo marcado como verificado")}>Verificar</button>}
                    {u.id !== me && (
                      u.disabledAt ? (
                        <button className="btn-g px-2 py-1 text-xs" onClick={() => act("users/status", { userId: u.id, disabled: false }, "Cuenta reactivada")}>Reactivar</button>
                      ) : (
                        <button className="btn-g px-2 py-1 text-xs text-rose-600" onClick={() => confirm(`¿Suspender a ${u.email}? Se cierran sus sesiones y no podrá entrar.`) && act("users/status", { userId: u.id, disabled: true }, "Cuenta suspendida")}>Suspender</button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const MP_STATUS: Record<string, string> = { authorized: "activa", pending: "pendiente", paused: "pausada", cancelled: "cancelada" };
const PLAN_OPTIONS = [["beta", "Beta gratuita"], ["trial", "Prueba 7 días"], ["pro", "FSV Search (pagado)"], ["seo", "SEO (antiguo)"], ["agency", "Agencia (antiguo)"]] as const;

function WorkspacesTab() {
  const { data, mutate } = useApi<WsRow[]>("/api/admin/workspaces");
  if (!data) return <div className="flex items-center gap-2 text-ink-500"><Spinner />Cargando…</div>;
  return (
    <div className="card overflow-x-auto">
      <table className="tbl min-w-[680px]">
        <thead>
          <tr><th>Workspace</th><th>Plan</th><th>Proyectos</th><th>Miembros</th><th>Gasto del mes</th><th>Alta</th></tr>
        </thead>
        <tbody>
          {data.map((w) => (
            <tr key={w.id}>
              <td className="font-medium">{w.name}{w.trusted && <span className="chip ml-2">instancia</span>}</td>
              <td>
                {w.trusted ? (
                  <span className="text-xs text-ink-500">Interno (sin límites)</span>
                ) : (
                  <select
                    className="input w-auto py-1 text-xs"
                    value={w.effectivePlan}
                    onChange={async (e) => {
                      try {
                        await api("/api/admin/workspaces/plan", "POST", { workspaceId: w.id, plan: e.target.value });
                        toast("Plan actualizado", "ok");
                        mutate();
                      } catch (err) {
                        toast(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    {PLAN_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                )}
                {!w.trusted && (
                  <div className="mt-0.5 text-[11px] text-ink-500">
                    {w.expired && <span className="text-rose-600">vencido · </span>}
                    {w.effectivePlan === "trial" && `prueba hasta ${fmtDate(w.trialEndsAt)}`}
                    {w.effectivePlan === "pro" && `${w.seats} ${w.seats === 1 ? "perfil" : "perfiles"}${w.mpStatus ? ` · Mercado Pago: ${MP_STATUS[w.mpStatus] ?? w.mpStatus}` : " · asignado a mano"}${w.planValidUntil ? ` · hasta ${fmtDate(w.planValidUntil)}` : ""}`}
                  </div>
                )}
              </td>
              <td className="tabular-nums">{w._count.projects}</td>
              <td className="tabular-nums">{w._count.members}</td>
              <td className="tabular-nums">${w.spendMonth.toFixed(3)}</td>
              <td className="text-xs">{fmtDate(w.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type IgReq = { id: string; username: string; status: "pending" | "invited" | "connected" | "rejected"; createdAt: string; updatedAt: string; email: string | null; project: { id: string; domain: string } };
const IG_STATUS: Record<IgReq["status"], [string, string]> = {
  pending: ["Pendiente", "!bg-amber-100 !text-amber-800"],
  invited: ["Invitado", "!bg-sky-100 !text-sky-800"],
  connected: ["Conectado", "!bg-emerald-100 !text-emerald-800"],
  rejected: ["Rechazado", "!bg-rose-100 !text-rose-800"],
};

function InstagramTab() {
  const { data, mutate } = useApi<IgReq[]>("/api/admin/ig-requests");
  const { mutate: refreshAll } = useSWRConfig();
  const set = async (r: IgReq, status: IgReq["status"], ok: string) => {
    try {
      await api("/api/admin/ig-requests/status", "POST", { id: r.id, status });
      toast(ok, "ok");
      mutate();
      refreshAll("/api/admin/overview");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-ink-600 dark:text-ink-300">
        <div className="font-semibold text-ink-900 dark:text-ink-100">Cómo habilitar una cuenta</div>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Copia el usuario y agrégalo en Meta for Developers → tu app → <b>App roles → Roles → Add People → Instagram Tester</b>.</li>
          <li>Pulsa <b>Marcar invitado</b>: al cliente le llega un correo con los pasos para aceptar la invitación en Instagram.</li>
          <li>Cuando el cliente conecta la cuenta, la solicitud pasa sola a <b>Conectado</b>.</li>
        </ol>
      </div>
      {!data ? (
        <div className="flex items-center gap-2 text-ink-500"><Spinner />Cargando…</div>
      ) : !data.length ? (
        <Empty icon="social" title="Sin solicitudes">Cuando un cliente deje su @ en Social aparecerá aquí y te llegará un correo.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl min-w-[720px]">
            <thead>
              <tr><th>Instagram</th><th>Cliente</th><th>Proyecto</th><th>Fecha</th><th>Estado</th><th /></tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <a href={`https://www.instagram.com/${r.username}/`} target="_blank" rel="noreferrer" className="font-medium text-acc hover:underline">@{r.username}</a>
                      <button className="btn-g px-1 py-0 text-xs" title="Copiar usuario" onClick={() => { navigator.clipboard?.writeText(r.username); toast("Usuario copiado", "ok"); }}>
                        <Icon name="copy" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="text-xs">{r.email ?? "—"}</td>
                  <td className="text-xs">{r.project.domain}</td>
                  <td className="text-xs">{fmtDate(r.createdAt, "datetime")}</td>
                  <td><span className={cx("chip", IG_STATUS[r.status][1])}>{IG_STATUS[r.status][0]}</span></td>
                  <td className="whitespace-nowrap text-right">
                    {r.status === "pending" && (
                      <>
                        <button className="btn-p px-2 py-1 text-xs" onClick={() => set(r, "invited", "Marcado como invitado: se envió el correo al cliente")}>Marcar invitado</button>
                        <button className="btn-g ml-1 px-2 py-1 text-xs text-rose-600" onClick={() => confirm(`¿Rechazar @${r.username}? Se le avisará por correo.`) && set(r, "rejected", "Solicitud rechazada")}>Rechazar</button>
                      </>
                    )}
                    {r.status === "invited" && <button className="btn-g px-2 py-1 text-xs" onClick={() => set(r, "invited", "Correo reenviado")}>Reenviar correo</button>}
                    {r.status === "rejected" && <button className="btn-g px-2 py-1 text-xs" onClick={() => set(r, "pending", "Solicitud reabierta")}>Reabrir</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConfigTab() {
  const { data } = useApi<CheckRow[]>("/api/admin/checks");
  if (!data) return <div className="flex items-center gap-2 text-ink-500"><Spinner />Cargando…</div>;
  const order = { error: 0, warn: 1, info: 2, ok: 3 };
  return (
    <div className="card divide-y divide-ink-100 dark:divide-ink-800">
      {[...data].sort((a, b) => order[a.level] - order[b.level]).map((c) => (
        <div key={c.key} className="flex items-start gap-3 p-3">
          <Icon name={LEVEL[c.level][0]} className={cx("mt-0.5 h-4 w-4 shrink-0", LEVEL[c.level][1])} />
          <div className="min-w-0">
            <div className="text-sm font-medium">{c.label}</div>
            <div className="break-words text-xs text-ink-500">{c.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminPanel({ me }: { me: string }) {
  const [tab, setTabState] = useState<Tab>("overview");
  const { data: ov } = useApi<Overview>("/api/admin/overview", { refreshInterval: 60000 });
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t && TABS.includes(t)) setTabState(t);
  }, []);
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, "", t === "overview" ? "/admin" : `/admin?tab=${t}`);
  };
  return (
    <div className="min-h-screen bg-ink-50 dark:bg-ink-950">
      <header className="border-b border-ink-200 bg-white px-4 py-3 dark:border-ink-800 dark:bg-ink-900 md:px-6">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Icon name="shield" className="h-5 w-5 text-acc" />
          <h1 className="font-semibold">Administración</h1>
          <Link href="/app" className="btn-g ml-auto text-sm">Volver a la app</Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        <div className="overflow-x-auto">
          <Tabs value={tab} onChange={setTab} items={[
            { id: "overview", label: "Resumen", icon: "chart" },
            { id: "users", label: "Usuarios", icon: "users" },
            { id: "workspaces", label: "Workspaces", icon: "layers" },
            { id: "instagram", label: ov?.pendingIg ? `Instagram (${ov.pendingIg})` : "Instagram", icon: "social" },
            { id: "spend", label: "Gasto y APIs", icon: "coin" },
            { id: "config", label: "Configuración", icon: "gear" },
          ]} />
        </div>
        {tab === "overview" && <OverviewTab />}
        {tab === "users" && <UsersTab me={me} />}
        {tab === "workspaces" && <WorkspacesTab />}
        {tab === "instagram" && <InstagramTab />}
        {tab === "spend" && <div className="card max-w-xl p-4"><Spend /></div>}
        {tab === "config" && <ConfigTab />}
      </main>
      <Toaster />
    </div>
  );
}
