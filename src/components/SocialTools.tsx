"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import { useProject } from "./Shell";
import { api, cx, Empty, fmt, fmtDate, Icon, Spinner, Stat, Tabs, toast, useAction, useApi } from "./ui";

type Connection = {
  configured: boolean;
  connected: boolean;
  igAccountName: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  connectedAt: string | null;
};

type Post = {
  id: string;
  caption: string;
  imageUrl: string | null;
  imagePrompt: string | null;
  keywords: string[];
  status: string;
  metaPostId: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  errorMsg: string | null;
  createdAt: string;
  stats: { reach: number | null; likes: number | null; comments: number | null; saved: number | null; shares: number | null; permalink: string | null } | null;
};

type Stats = {
  count: number;
  syncedAt: string | null;
  avgReach: number | null;
  avgEngagement: number | null;
  bestSlots: { label: string; avg: number; posts: number }[];
  posts: { mediaId: string; caption: string | null; permalink: string | null; postedAt: string; reach: number | null; likes: number | null; comments: number | null; saved: number | null; shares: number | null; engagement: number }[];
};

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Borrador", cls: "!bg-ink-100 !text-ink-700 dark:!bg-ink-800 dark:!text-ink-300" },
  scheduled: { label: "Programado", cls: "!bg-amber-100 !text-amber-800" },
  publishing: { label: "Publicando…", cls: "!bg-sky-100 !text-sky-800" },
  published: { label: "Publicado", cls: "!bg-emerald-100 !text-emerald-800" },
  failed: { label: "Error", cls: "!bg-rose-100 !text-rose-800" },
};

/** datetime-local mínimo (hora local, 5 minutos adelante). */
const minLocal = () => {
  const d = new Date(Date.now() + 5 * 60_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const IgGlyph = () => (
  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white">
    <Icon name="social" className="h-[18px] w-[18px]" />
  </span>
);

function Section({ n, title, children, aside }: { n: number; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-acc-soft text-xs font-semibold text-acc">{n}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

// ---------- Conexión ----------

function ConnectionBar({ conn, onChange }: { conn: Connection; onChange: () => void }) {
  const { id, project } = useProject();
  const admin = Boolean(project?.admin);
  const [connecting, setConnecting] = useState(false);
  const [disconnect, disconnecting] = useAction(async () => {
    if (!confirm("¿Desconectar Instagram? Los posts programados no se publicarán hasta que vuelvas a conectar.")) return;
    await api(`/api/p/${id}/social/connection`, "DELETE", {});
    onChange();
    toast("Instagram desconectado", "ok");
  });
  const connect = async () => {
    setConnecting(true);
    try {
      const { url } = await api<{ url: string }>(`/api/p/${id}/social/connect`, "POST", {});
      window.location.href = url;
    } catch (e) {
      setConnecting(false);
      toast(e instanceof Error ? e.message : "No se pudo iniciar la conexión");
    }
  };

  if (!conn.configured)
    return (
      <div className="card flex items-start gap-3 p-4">
        <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="text-sm">
          <div className="font-medium">Instagram no está habilitado</div>
          <p className="mt-0.5 text-ink-500">
            {admin ? (
              <>Agrega <code className="chip">META_APP_ID</code> y <code className="chip">META_APP_SECRET</code> en el servidor.</>
            ) : (
              "La publicación en Instagram todavía no está habilitada. Escríbenos a contacto@fsvc.cl y te avisamos cuando esté lista."
            )}
          </p>
        </div>
      </div>
    );

  if (!conn.connected)
    return (
      <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <IgGlyph />
        <div className="flex-1">
          <div className="font-semibold">Conecta tu cuenta de Instagram</div>
          <p className="mt-0.5 text-sm text-ink-500">Necesitas una cuenta profesional (Empresa o Creador). FSV Search solo publica lo que tú apruebes.</p>
        </div>
        <button onClick={connect} disabled={connecting} className="btn-p shrink-0 justify-center">
          {connecting ? <Spinner /> : <Icon name="link2" />}Conectar Instagram
        </button>
      </div>
    );

  const expiresSoon = conn.tokenExpiresAt && new Date(conn.tokenExpiresAt) < new Date(Date.now() + 7 * 864e5);
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <IgGlyph />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">@{conn.igAccountName}</span>
            <span className="chip !bg-emerald-100 !text-emerald-800">Conectado</span>
          </div>
          {conn.connectedAt && <div className="text-xs text-ink-500">desde el {fmtDate(conn.connectedAt)}</div>}
        </div>
        <button onClick={() => disconnect()} disabled={disconnecting} className="btn-g text-rose-600 hover:!bg-rose-50 hover:!text-rose-700 dark:hover:!bg-rose-950/40">
          {disconnecting ? <Spinner /> : "Desconectar"}
        </button>
      </div>
      {(conn.lastError || expiresSoon) && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          {conn.lastError ?? "El acceso a Instagram vence pronto: vuelve a conectar la cuenta."}
        </div>
      )}
    </div>
  );
}

// ---------- Imágenes ----------

/** Convierte cualquier foto a JPEG (único formato que acepta Instagram), máx. 1440 px y recortada al rango 4:5–1.91:1. */
async function toJpeg(file: File, max = 1440): Promise<string> {
  if (file.size > 25 * 1024 * 1024) throw new Error("La foto supera 25 MB");
  const bmp = await createImageBitmap(file);
  let sw = bmp.width, sh = bmp.height;
  if (sw / sh < 0.8) sh = Math.round(sw / 0.8);
  else if (sw / sh > 1.91) sw = Math.round(sh * 1.91);
  const scale = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

function PhotoPicker({ label, value, onChange, busy }: { label: string; value?: string; onChange: (dataUrl: string) => void; busy?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <label className={cx("btn cursor-pointer", busy && "pointer-events-none opacity-50")}>
        {busy ? <Spinner /> : <Icon name="photo" />}
        {value ? "Cambiar foto" : label}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              onChange(await toJpeg(f));
            } catch (err) {
              toast(err instanceof Error ? err.message : "No se pudo leer la foto");
            }
          }}
        />
      </label>
      {value && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="h-10 w-10 rounded-md border border-ink-200 object-cover dark:border-ink-700" />
          <button onClick={() => onChange("")} className="btn-g text-xs">Quitar</button>
        </>
      )}
    </div>
  );
}

// ---------- Vista previa ----------

function Preview({ user, imageUrl, caption, busy }: { user: string; imageUrl: string; caption: string; busy: boolean }) {
  const [more, setMore] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white text-ink-900 shadow-sm dark:border-ink-700">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] p-[2px]">
          <span className="grid h-full w-full place-items-center rounded-full bg-white text-xs font-semibold uppercase">{user.slice(0, 1)}</span>
        </span>
        <span className="text-sm font-semibold">{user}</span>
        <span className="ml-auto text-ink-400">•••</span>
      </div>
      <div className="relative aspect-square bg-ink-100">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Imagen del post" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-center text-xs text-ink-400">
            <div>
              <Icon name="photo" className="mx-auto mb-2 h-8 w-8" />
              La imagen aparece aquí
            </div>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-white/70 text-sm text-ink-600">
            <span className="flex items-center gap-2"><Spinner />Generando…</span>
          </div>
        )}
      </div>
      <div className="flex gap-3 px-3 pt-2.5 text-ink-700">
        <Icon name="heart" className="h-5 w-5" />
        <Icon name="comment" className="h-5 w-5" />
        <Icon name="send" className="h-5 w-5" />
      </div>
      <div className="px-3 pb-3 pt-1.5 text-sm">
        {caption ? (
          <p className={cx("whitespace-pre-wrap break-words", !more && "line-clamp-3")}>
            <span className="mr-1 font-semibold">{user}</span>
            {caption}
          </p>
        ) : (
          <p className="text-ink-400">El caption aparece aquí.</p>
        )}
        {caption.length > 140 && (
          <button onClick={() => setMore(!more)} className="mt-0.5 text-xs text-ink-400">
            {more ? "menos" : "más"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Compositor ----------

function Composer({ user, onDone }: { user: string; onDone: () => void }) {
  const { id } = useProject();
  const { data: stats } = useApi<Stats>(`/api/p/${id}/social/stats`);
  const [imageTab, setImageTab] = useState<"ia" | "upload">("ia");
  const [imagePrompt, setImagePrompt] = useState("");
  const [reference, setReference] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [context, setContext] = useState("");
  const [tone, setTone] = useState<"cercano" | "profesional" | "inspirador">("cercano");
  const [when, setWhen] = useState("");

  const [generateImg, generatingImg] = useAction(async () => {
    if (!imagePrompt.trim()) return toast("Describe la imagen que quieres");
    const r = await api<{ url: string }>(`/api/p/${id}/social/generate-image`, "POST", { prompt: imagePrompt, reference: reference || undefined });
    setImageUrl(r.url);
  });
  const [uploadImg, uploadingImg] = useAction(async (dataUrl: string) => {
    if (!dataUrl) return setImageUrl("");
    setImageUrl((await api<{ url: string }>(`/api/p/${id}/social/upload-image`, "POST", { image: dataUrl })).url);
  });
  const [genCaption, generatingCaption] = useAction(async () => {
    setCaption((await api<{ caption: string }>(`/api/p/${id}/social/generate-caption`, "POST", { context, tone })).caption);
  });

  const reset = () => {
    setCaption("");
    setImageUrl("");
    setImagePrompt("");
    setReference("");
    setContext("");
    setWhen("");
    onDone();
  };
  const create = () => api<{ id: string }>(`/api/p/${id}/social/posts`, "POST", { caption, imageUrl: imageUrl || null, imagePrompt: imageTab === "ia" ? imagePrompt : null });
  const [saveDraft, saving] = useAction(async () => {
    await create();
    toast("Borrador guardado", "ok");
    reset();
  });
  const [publishNow, publishing] = useAction(async () => {
    if (!confirm(`¿Publicar ahora en @${user}?`)) return;
    const p = await create();
    try {
      await api(`/api/p/${id}/social/publish`, "POST", { postId: p.id });
      toast("Publicado en Instagram", "ok");
    } finally {
      reset();
    }
  });
  const [schedule, scheduling] = useAction(async () => {
    if (!when) return toast("Elige fecha y hora");
    const p = await create();
    await api(`/api/p/${id}/social/schedule`, "POST", { postId: p.id, scheduledAt: new Date(when).toISOString() });
    toast(`Programado para el ${fmtDate(new Date(when), "datetime")}`, "ok");
    reset();
  });

  const busy = saving || publishing || scheduling;
  const ready = Boolean(caption.trim()) && Boolean(imageUrl) && caption.length <= 2200;
  const best = stats?.bestSlots?.[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="card space-y-6 p-5">
        <div className="flex items-center gap-2">
          <Icon name="photo" className="h-4 w-4 text-acc" />
          <h2 className="font-semibold">Nuevo post</h2>
        </div>

        <Section n={1} title="Imagen" aside={<Tabs value={imageTab} onChange={setImageTab} items={[{ id: "ia", label: "Generar con IA", icon: "sparkle" }, { id: "upload", label: "Subir foto", icon: "photo" }]} />}>
          {imageTab === "ia" ? (
            <div className="space-y-3">
              <textarea
                className="input min-h-[84px] resize-y"
                placeholder="Describe la imagen: el producto sobre una mesa de madera, luz natural de mañana, estilo fotografía profesional…"
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                maxLength={2000}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <PhotoPicker label="Foto de referencia (opcional)" value={reference} onChange={setReference} />
                <button onClick={() => generateImg()} disabled={generatingImg || !imagePrompt.trim()} className="btn-p">
                  {generatingImg ? <Spinner /> : <Icon name="sparkle" />}
                  {generatingImg ? "Generando…" : imageUrl ? "Generar otra" : "Generar imagen"}
                </button>
              </div>
              <p className="text-xs text-ink-400">Con foto de referencia, la IA pone tu producto real en la escena. Tarda hasta un minuto.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <PhotoPicker label="Elegir foto" onChange={(d) => uploadImg(d)} busy={uploadingImg} />
              <p className="text-xs text-ink-400">Se ajusta sola al formato de Instagram (JPEG, entre 4:5 y 1.91:1).</p>
            </div>
          )}
        </Section>

        <Section n={2} title="Texto">
          <input className="input" placeholder="¿De qué trata el post? Ej: traje de competencia R-SKIN, homologado World Aquatics" value={context} onChange={(e) => setContext(e.target.value)} maxLength={500} />
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={tone} onChange={setTone} items={[{ id: "cercano", label: "Cercano" }, { id: "profesional", label: "Profesional" }, { id: "inspirador", label: "Inspirador" }]} />
            <button onClick={() => genCaption()} disabled={generatingCaption} className="btn ml-auto">
              {generatingCaption ? <Spinner /> : <Icon name="sparkle" />}
              {caption ? "Reescribir con IA" : "Escribir con IA"}
            </button>
          </div>
          <div className="relative">
            <textarea
              className={cx("input min-h-[150px] resize-y pb-6", caption.length > 2200 && "!border-rose-500")}
              placeholder="Caption de Instagram, con hashtags al final. Usa las keywords del proyecto y lo que mejor te ha funcionado."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <span className={cx("pointer-events-none absolute bottom-2 right-3 text-[11px] tabular-nums", caption.length > 2200 ? "text-rose-500" : "text-ink-400")}>{caption.length}/2200</span>
          </div>
        </Section>

        <Section n={3} title="Publicar">
          <div className="flex flex-col gap-3 rounded-xl border border-ink-100 bg-ink-50 p-3 dark:border-ink-800 dark:bg-ink-900/50 sm:flex-row sm:items-center">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <input type="datetime-local" className="input w-auto" value={when} min={minLocal()} onChange={(e) => setWhen(e.target.value)} aria-label="Fecha y hora de publicación" />
              <button onClick={() => schedule()} disabled={!ready || busy || !when} className="btn">
                {scheduling ? <Spinner /> : <Icon name="clock" />}Programar
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => saveDraft()} disabled={!caption.trim() || busy} className="btn-g">
                {saving ? <Spinner /> : "Guardar borrador"}
              </button>
              <button onClick={() => publishNow()} disabled={!ready || busy} className="btn-p">
                {publishing ? <Spinner /> : <Icon name="bolt" />}Publicar ahora
              </button>
            </div>
          </div>
          {!ready && <p className="text-xs text-ink-400">Para publicar o programar necesitas imagen y caption.</p>}
        </Section>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="lbl">Vista previa</div>
        <Preview user={user} imageUrl={imageUrl} caption={caption} busy={generatingImg || uploadingImg} />
        {best && (
          <div className="rounded-xl border border-ink-100 p-3 text-xs dark:border-ink-800">
            <div className="flex items-center gap-1.5 font-medium text-ink-700 dark:text-ink-200"><Icon name="clock" className="h-3.5 w-3.5" />Mejor horario según tus posts</div>
            <div className="mt-1 text-ink-500">{best.label} · {fmt(best.avg)} interacciones promedio</div>
          </div>
        )}
      </aside>
    </div>
  );
}

// ---------- Rendimiento ----------

function StatsPanel() {
  const { id } = useProject();
  const { data, mutate } = useApi<Stats>(`/api/p/${id}/social/stats`);
  const [sync, syncing] = useAction(async () => {
    const r = await api<{ media: number; insights: boolean }>(`/api/p/${id}/social/sync-stats`, "POST", {});
    await mutate();
    toast(r.media ? `${r.media} posts actualizados${r.insights ? "" : " (sin alcance: reconecta Instagram)"}` : "La cuenta aún no tiene posts", r.insights || !r.media ? "ok" : "error");
  });
  const top = data ? [...data.posts].sort((a, b) => b.engagement - a.engagement).slice(0, 5) : [];

  return (
    <div className="card space-y-5 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold"><Icon name="chart" className="h-4 w-4 text-acc" />Rendimiento en Instagram</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            La IA toma tus posts con más interacciones como referencia al escribir.{data?.syncedAt && <> Actualizado {fmtDate(data.syncedAt, "datetime")}.</>}
          </p>
        </div>
        <button onClick={() => sync()} disabled={syncing} className="btn hov-spin">
          {syncing ? <Spinner /> : <Icon name="refresh" />}Actualizar
        </button>
      </div>
      {!data ? (
        <div className="flex items-center gap-2 text-sm text-ink-500"><Spinner />Cargando…</div>
      ) : !data.count ? (
        <Empty icon="chart" compact title="Sin datos todavía">Pulsa Actualizar para leer tus últimos posts de Instagram.</Empty>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Posts analizados" value={fmt(data.count)} />
            <Stat label="Alcance promedio" value={fmt(data.avgReach)} />
            <Stat label="Interacciones promedio" value={fmt(data.avgEngagement)} />
          </div>
          {data.bestSlots.length > 0 && (
            <div>
              <div className="lbl mb-2">Mejores horarios para publicar</div>
              <div className="flex flex-wrap gap-2">
                {data.bestSlots.map((s, i) => (
                  <span key={s.label} className={cx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", i === 0 ? "border-acc/30 bg-acc-soft text-acc" : "border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300")} title={`${s.posts} posts en esa franja`}>
                    <Icon name="clock" className="h-3 w-3" />
                    {s.label}
                    <span className="opacity-70">· {fmt(s.avg)} interacciones</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="lbl mb-2">Posts con más interacciones</div>
            <div className="overflow-x-auto">
              <table className="tbl min-w-[620px]">
                <thead>
                  <tr>
                    <th>Post</th>
                    <th className="!text-right">Alcance</th>
                    <th className="!text-right">Likes</th>
                    <th className="!text-right">Coment.</th>
                    <th className="!text-right">Guardados</th>
                    <th className="!text-right">Fecha</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {top.map((m) => (
                    <tr key={m.mediaId}>
                      <td className="max-w-[320px]"><span className="block truncate" title={m.caption ?? ""}>{m.caption || <span className="text-ink-400">(sin texto)</span>}</span></td>
                      <td className="text-right tabular-nums">{fmt(m.reach)}</td>
                      <td className="text-right tabular-nums">{fmt(m.likes)}</td>
                      <td className="text-right tabular-nums">{fmt(m.comments)}</td>
                      <td className="text-right tabular-nums">{fmt(m.saved)}</td>
                      <td className="text-right text-ink-500">{fmtDate(m.postedAt, "dm")}</td>
                      <td className="text-right">
                        {m.permalink && <a href={m.permalink} target="_blank" rel="noreferrer" className="btn-g" title="Ver en Instagram"><Icon name="link2" className="h-3.5 w-3.5" /></a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Posts ----------

function PostRow({ post, onRefresh }: { post: Post; onRefresh: () => void }) {
  const { id } = useProject();
  const [when, setWhen] = useState("");
  const st = STATUS[post.status] ?? { label: post.status, cls: "" };
  const editable = post.status === "draft" || post.status === "failed";
  const call = async (path: string, body: unknown, ok: string, method: "POST" | "DELETE" = "POST") => {
    await api(`/api/p/${id}/social/${path}`, method, body);
    toast(ok, "ok");
    onRefresh();
  };
  const [publish, publishing] = useAction(() => call("publish", { postId: post.id }, "Publicado en Instagram"));
  const [schedule, scheduling] = useAction(() => call("schedule", { postId: post.id, scheduledAt: new Date(when).toISOString() }, "Post programado"));
  const [unschedule] = useAction(() => call("unschedule", { postId: post.id }, "Programación cancelada"));
  const [remove] = useAction(async () => {
    if (confirm("¿Eliminar este post?")) await call("posts", { postId: post.id }, "Post eliminado", "DELETE");
  });

  return (
    <div className="flex gap-4 p-4">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-ink-100 bg-ink-100 dark:border-ink-800 dark:bg-ink-800">
        {post.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center"><Icon name="photo" className="h-6 w-6 text-ink-300" /></div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start gap-3">
          <p className="line-clamp-2 flex-1 text-sm">{post.caption}</p>
          <span className={cx("chip shrink-0", st.cls)}>{st.label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
          {post.status === "scheduled" && post.scheduledAt && <span className="flex items-center gap-1 text-amber-700"><Icon name="clock" className="h-3.5 w-3.5" />Se publica el {fmtDate(post.scheduledAt, "datetime")}</span>}
          {post.status === "published" && post.publishedAt && <span className="flex items-center gap-1 text-emerald-700"><Icon name="check" className="h-3.5 w-3.5" />Publicado el {fmtDate(post.publishedAt, "datetime")}</span>}
          {post.stats && (
            <span className="tabular-nums">
              {post.stats.reach != null && <>alcance {fmt(post.stats.reach)} · </>}
              {fmt(post.stats.likes)} likes · {fmt(post.stats.comments)} coment.
            </span>
          )}
          {editable && <span>Creado el {fmtDate(post.createdAt)}</span>}
        </div>
        {post.errorMsg && <p className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{post.errorMsg}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {editable && post.imageUrl && (
            <>
              <button onClick={() => publish()} disabled={publishing} className="btn-p px-2.5 py-1 text-xs">{publishing ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="bolt" className="h-3.5 w-3.5" />}Publicar ahora</button>
              <input type="datetime-local" className="input w-auto px-2 py-1 text-xs" value={when} min={minLocal()} onChange={(e) => setWhen(e.target.value)} aria-label="Fecha y hora" />
              <button onClick={() => schedule()} disabled={scheduling || !when} className="btn px-2.5 py-1 text-xs">{scheduling ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="clock" className="h-3.5 w-3.5" />}Programar</button>
            </>
          )}
          {editable && !post.imageUrl && <span className="text-xs text-amber-700">Sin imagen: Instagram exige una. Crea el post de nuevo con imagen.</span>}
          {post.status === "scheduled" && <button onClick={() => unschedule()} className="btn px-2.5 py-1 text-xs">Cancelar programación</button>}
          {post.stats?.permalink && <a href={post.stats.permalink} target="_blank" rel="noreferrer" className="btn-g text-xs"><Icon name="link2" className="h-3.5 w-3.5" />Ver en Instagram</a>}
          {(editable || post.status === "scheduled") && (
            <button onClick={() => remove()} className="btn-g ml-auto text-xs hover:!text-rose-600" title="Eliminar"><Icon name="trash" className="h-3.5 w-3.5" /></button>
          )}
        </div>
      </div>
    </div>
  );
}

function PostsPanel() {
  const { id } = useProject();
  const [tab, setTab] = useState<"all" | "draft" | "scheduled" | "published">("all");
  const { data: posts, isLoading, mutate } = useApi<Post[]>(`/api/p/${id}/social/posts${tab !== "all" ? `?status=${tab}` : ""}`, { keepPreviousData: true, refreshInterval: (d?: Post[]) => (d?.some((p) => p.status === "publishing" || p.status === "scheduled") ? 30000 : 0) });
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-4 dark:border-ink-800">
        <h2 className="font-semibold">Posts</h2>
        <div className="ml-auto">
          <Tabs value={tab} onChange={setTab} items={[{ id: "all", label: "Todos" }, { id: "draft", label: "Borradores" }, { id: "scheduled", label: "Programados" }, { id: "published", label: "Publicados" }]} />
        </div>
      </div>
      {isLoading && !posts ? (
        <div className="flex items-center gap-2 p-5 text-sm text-ink-500"><Spinner />Cargando…</div>
      ) : !posts?.length ? (
        <div className="p-5"><Empty icon="social" compact title="No hay posts aquí">Crea uno con el editor de arriba.</Empty></div>
      ) : (
        <div className="divide-y divide-ink-100 dark:divide-ink-800">
          {posts.map((p) => <PostRow key={p.id} post={p} onRefresh={() => mutate()} />)}
        </div>
      )}
    </div>
  );
}

// ---------- Página ----------

export default function SocialTools() {
  const { id } = useProject();
  const { data: conn, isLoading, mutate: refreshConn } = useApi<Connection>(`/api/p/${id}/social/connection`);
  const { mutate } = useSWRConfig();
  const refreshPosts = () => mutate((k) => typeof k === "string" && k.startsWith(`/api/p/${id}/social/`));

  // resultado de la vuelta desde Instagram: queda fijo en pantalla (un aviso flotante se perdía al cargar)
  const [oauth, setOauth] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("meta_error");
    if (err) setOauth({ ok: false, text: err });
    else if (params.get("meta") === "ok") {
      setOauth({ ok: true, text: "Instagram conectado. Ya puedes crear y publicar posts." });
      refreshConn();
    }
    if (err || params.get("meta")) window.history.replaceState({}, "", window.location.pathname);
  }, [refreshConn]);

  if (isLoading) return <div className="flex items-center gap-2 p-6 text-ink-500"><Spinner />Cargando…</div>;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
      {oauth && (
        <div role={oauth.ok ? "status" : "alert"} className={cx("flex items-start gap-2 rounded-xl px-4 py-3 text-sm", oauth.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300")}>
          <Icon name={oauth.ok ? "check" : "alert"} className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            {!oauth.ok && <div className="font-medium">No se pudo conectar Instagram</div>}
            <div className="break-words">{oauth.text}</div>
          </div>
          <button onClick={() => setOauth(null)} className="btn-g text-xs">Cerrar</button>
        </div>
      )}

      {conn && <ConnectionBar conn={conn} onChange={() => refreshConn()} />}

      {conn?.connected && (
        <>
          <Composer user={conn.igAccountName ?? "tu_cuenta"} onDone={() => refreshPosts()} />
          <PostsPanel />
          <StatsPanel />
        </>
      )}
    </div>
  );
}
