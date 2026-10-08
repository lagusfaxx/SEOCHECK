"use client";
import { useState } from "react";
import { api, cx, Icon, useApi } from "./ui";

type Member = { id: string; email: string; name: string | null; role: string; lastLoginAt: string | null };
const ROLE: Record<string, string> = { owner: "Dueño", admin: "Admin", member: "Miembro" };

/** Equipo del workspace: ver, invitar y quitar personas. */
export function TeamCard() {
  const { data: me } = useApi<{ user: { id: string } | null; workspaces?: { id: string; role: string }[] }>("/api/auth/me");
  const ws = me?.workspaces?.[0];
  const { data: members, mutate } = useApi<Member[]>(ws ? `/api/workspace/members?workspace=${ws.id}` : null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; link?: string | null } | null>(null);
  const canManage = ws?.role === "owner" || ws?.role === "admin";
  return (
    <div className="card space-y-3 p-4">
      <div>
        <div className="font-semibold">Equipo</div>
        <p className="text-sm text-ink-500">Quién puede ver y trabajar en los proyectos de este workspace. Los dueños y admins pueden invitar y borrar proyectos.</p>
      </div>
      <div className="divide-y divide-ink-100 dark:divide-ink-800">
        {(members ?? []).map((m) => (
          <div key={m.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{m.email}</span>
            <span className="chip">{ROLE[m.role] ?? m.role}</span>
            <span className="w-28 text-right text-xs text-ink-400">{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString("es-CL") : "sin entrar aún"}</span>
            {canManage && m.id !== me?.user?.id && (
              <button className="btn-g px-1" title="quitar del equipo" onClick={async () => { if (!confirm(`¿Quitar a ${m.email}?`)) return; await api(`/api/workspace/members?workspace=${ws!.id}`, "DELETE", { userId: m.id }).catch((e) => alert(e.message)); mutate(); }}>
                <Icon name="trash" />
              </button>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setMsg(null);
            try {
              const r = await api(`/api/workspace/members?workspace=${ws!.id}`, "POST", { email, role });
              setMsg({ ok: true, text: r.link ? "Invitación creada. No hay correo configurado: envíale tú este link (vence en 7 días):" : `Listo: ${email} ya tiene acceso.`, link: r.link });
              setEmail("");
              mutate();
            } catch (err) {
              setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
            }
          }}
        >
          <input className="input min-w-[220px] flex-1" type="email" required placeholder="email de la persona" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">Miembro</option>
            <option value="admin">Admin</option>
            {ws?.role === "owner" && <option value="owner">Dueño</option>}
          </select>
          <button className="btn-p"><Icon name="plus" />Invitar</button>
        </form>
      )}
      {msg && (
        <div className={cx("rounded-lg px-3 py-2 text-sm", msg.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300")}>
          {msg.text}
          {msg.link && <code className="mt-1 block break-all text-xs">{msg.link}</code>}
        </div>
      )}
    </div>
  );
}

/** Cambiar contraseña y cerrar sesión. */
export function AccountCard() {
  const { data: me } = useApi<{ user: { email: string } | null }>("/api/auth/me");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center">
        <div>
          <div className="font-semibold">Tu cuenta</div>
          <p className="text-sm text-ink-500">{me?.user?.email}</p>
        </div>
        <button className="btn ml-auto" onClick={async () => { await api("/api/auth/logout", "POST"); window.location.href = "/login"; }}>Cerrar sesión</button>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/auth/password", "POST", { current: cur, password: next });
            setMsg({ ok: true, text: "Contraseña cambiada. Se cerraron tus sesiones en otros dispositivos." });
            setCur("");
            setNext("");
          } catch (err) {
            setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
          }
        }}
      >
        <input className="input min-w-[180px] flex-1" type="password" autoComplete="current-password" placeholder="contraseña actual" required value={cur} onChange={(e) => setCur(e.target.value)} />
        <input className="input min-w-[180px] flex-1" type="password" autoComplete="new-password" placeholder="nueva (mín. 10 caracteres)" required value={next} onChange={(e) => setNext(e.target.value)} />
        <button className="btn">Cambiar contraseña</button>
      </form>
      {msg && <div className={cx("rounded-lg px-3 py-2 text-sm", msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700")}>{msg.text}</div>}
    </div>
  );
}
