"use client";
import { useState, useEffect } from "react";
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

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft: { label: "Borrador", color: "text-ink-400" },
  scheduled: { label: "Programado", color: "text-amber-600" },
  publishing: { label: "Publicando…", color: "text-sky-600" },
  published: { label: "Publicado", color: "text-emerald-600" },
  failed: { label: "Error", color: "text-rose-600" },
};

// ---------- Panel de conexión ----------

function ConnectionPanel({ conn, onConnected }: { conn: Connection; onConnected: () => void }) {
  const { id, project } = useProject();
  const admin = Boolean(project?.admin);
  const [connecting, setConnecting] = useState(false);
  const [disconnect, disconnecting] = useAction(async () => {
    await api(`/api/p/${id}/social/connection`, "DELETE", {});
    onConnected();
    toast("Instagram desconectado", "ok");
  });

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { url } = await api<{ url: string }>(`/api/p/${id}/social/connect`, "POST", {});
      window.location.href = url;
    } catch (e) {
      setConnecting(false);
      toast(e instanceof Error ? e.message : "Error al iniciar conexión");
    }
  };

  if (!conn.configured) {
    return (
      <div className="rounded-xl border border-ink-200 bg-surface p-5">
        <div className="flex items-start gap-3">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">Instagram no está configurado</p>
            <p className="mt-1 text-sm text-ink-500">
              {admin ? (
                <>Agrega las variables <code className="text-xs font-mono bg-ink-100 px-1 rounded">META_APP_ID</code> y <code className="text-xs font-mono bg-ink-100 px-1 rounded">META_APP_SECRET</code> en el servidor para habilitar la publicación en Instagram.</>
              ) : (
                "La publicación en Instagram todavía no está habilitada. Escríbenos a contacto@fsvc.cl y te avisamos cuando esté lista."
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!conn.connected) {
    return (
      <div className="rounded-xl border border-ink-200 bg-surface p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Conecta tu cuenta de Instagram</p>
            <p className="mt-1 text-sm text-ink-500">Requiere una cuenta profesional de Instagram (Empresa o Creador).</p>
          </div>
          <button onClick={handleConnect} disabled={connecting} className="btn btn-acc shrink-0 flex items-center gap-2">
            {connecting ? <Spinner /> : <Icon name="social" />}
            Conectar Instagram
          </button>
        </div>
      </div>
    );
  }

  const expiresAt = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt) : null;
  const expiresSoon = expiresAt && expiresAt < new Date(Date.now() + 7 * 864e5);

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-medium text-sm">@{conn.igAccountName}</span>
          {conn.connectedAt && <span className="text-xs text-ink-400">conectado el {fmtDate(conn.connectedAt)}</span>}
        </div>
        <div className="flex items-center gap-2">
          {expiresSoon && <span className="text-xs text-amber-600">Token expira pronto — vuelve a conectar</span>}
          {conn.lastError && <span className="text-xs text-rose-600 max-w-xs truncate" title={conn.lastError}>{conn.lastError}</span>}
          <button onClick={() => disconnect()} disabled={disconnecting} className="btn btn-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950">
            {disconnecting ? <Spinner /> : "Desconectar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Compositor de posts ----------

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

function PhotoPicker({ label, value, onChange }: { label: string; value: string; onChange: (dataUrl: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="btn btn-sm border border-ink-300 flex items-center gap-1.5 cursor-pointer">
        <Icon name="photo" />
        {value ? "Cambiar foto" : label}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try { onChange(await toJpeg(f)); } catch (err) { toast(err instanceof Error ? err.message : "No se pudo leer la foto"); }
          }}
        />
      </label>
      {value && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="h-12 w-12 rounded object-cover border border-ink-200" />
          <button onClick={() => onChange("")} className="text-xs text-ink-400 hover:text-rose-500">Quitar</button>
        </>
      )}
    </div>
  );
}

function PostComposer({ onCreated }: { onCreated: () => void }) {
  const { id } = useProject();
  const [imageTab, setImageTab] = useState<"ia" | "upload">("ia");
  const [imagePrompt, setImagePrompt] = useState("");
  const [reference, setReference] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [captionContext, setCaptionContext] = useState("");
  const [tone, setTone] = useState<"cercano" | "profesional" | "inspirador">("cercano");

  const [generateImg, generatingImg] = useAction(async () => {
    if (!imagePrompt.trim()) { toast("Escribe un prompt para la imagen"); return; }
    const r = await api<{ url: string }>(`/api/p/${id}/social/generate-image`, "POST", { prompt: imagePrompt, reference: reference || undefined });
    setImageUrl(r.url);
  });

  const [uploadImg, uploadingImg] = useAction(async (dataUrl: string) => {
    if (!dataUrl) { setImageUrl(""); return; }
    const r = await api<{ url: string }>(`/api/p/${id}/social/upload-image`, "POST", { image: dataUrl });
    setImageUrl(r.url);
  });

  const [generateCaption, generatingCaption] = useAction(async () => {
    const result = await api<{ caption: string }>(`/api/p/${id}/social/generate-caption`, "POST", { context: captionContext, tone });
    setCaption(result.caption);
  });

  const [saveDraft, savingDraft] = useAction(async () => {
    if (!caption.trim()) { toast("Escribe o genera un caption"); return; }
    await api(`/api/p/${id}/social/posts`, "POST", { caption, imageUrl: imageUrl || null, imagePrompt: imageTab === "ia" ? imagePrompt : null });
    toast("Borrador guardado", "ok");
    onCreated();
    setCaption("");
    setImageUrl("");
    setImagePrompt("");
    setReference("");
  });

  const charCount = caption.length;
  const charOk = charCount <= 2200;

  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-5 space-y-5">
      <h3 className="font-semibold flex items-center gap-2"><Icon name="photo" />Nuevo post</h3>

      {/* Imagen */}
      <div className="space-y-3">
        <Tabs value={imageTab} onChange={setImageTab} items={[{ id: "ia", label: "Generar con IA", icon: "sparkle" }, { id: "upload", label: "Subir foto", icon: "photo" }]} />
        {imageTab === "ia" ? (
          <div className="space-y-2">
            <textarea
              className="input w-full text-sm resize-none"
              rows={2}
              placeholder="Describe la imagen (ej: el producto sobre una mesa de madera, luz natural de mañana, estilo fotografía profesional)"
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              maxLength={2000}
            />
            <PhotoPicker label="Foto de referencia del producto (opcional)" value={reference} onChange={setReference} />
            <button onClick={() => generateImg()} disabled={generatingImg || !imagePrompt.trim()} className="btn btn-sm btn-acc flex items-center gap-1.5">
              {generatingImg ? <Spinner /> : <Icon name="sparkle" />}
              {generatingImg ? "Generando (puede tardar 1 min)…" : imageUrl ? "Generar otra" : "Generar imagen"}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <PhotoPicker label="Elegir foto" value="" onChange={(d) => uploadImg(d)} />
            {uploadingImg && <Spinner />}
          </div>
        )}
        {imageUrl && (
          <div className="w-full max-w-xs overflow-hidden rounded-lg border border-ink-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Imagen del post" className="w-full object-cover" />
          </div>
        )}
      </div>

      {/* Caption */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-1.5"><Icon name="content" />Caption</label>
        <div className="space-y-2">
          <input
            className="input w-full text-sm"
            placeholder="Contexto del producto (ej: masajes relajantes en Santiago)"
            value={captionContext}
            onChange={(e) => setCaptionContext(e.target.value)}
            maxLength={500}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Tabs value={tone} onChange={(t) => setTone(t as typeof tone)} items={[{ id: "cercano", label: "Cercano" }, { id: "profesional", label: "Profesional" }, { id: "inspirador", label: "Inspirador" }]} />
            <button onClick={() => generateCaption()} disabled={generatingCaption} className="btn btn-sm btn-acc flex items-center gap-1.5">
              {generatingCaption ? <Spinner /> : <Icon name="sparkle" />}
              Generar con IA
            </button>
          </div>
        </div>
        <div className="relative">
          <textarea
            className={cx("input w-full text-sm resize-none", !charOk && "border-rose-500")}
            rows={5}
            placeholder="Caption de Instagram (incluye hashtags al final)..."
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={2200}
          />
          <span className={cx("absolute bottom-2 right-2 text-xs", charOk ? "text-ink-400" : "text-rose-500")}>{charCount}/2200</span>
        </div>
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button onClick={() => saveDraft()} disabled={savingDraft || !caption.trim()} className="btn btn-sm border border-ink-300 flex items-center gap-1.5">
          {savingDraft ? <Spinner /> : <Icon name="doc" />}
          Guardar borrador
        </button>
        <span className="text-ink-300">|</span>
        <span className="text-sm text-ink-500">Para publicar, ve a Borradores ↓</span>
      </div>
    </div>
  );
}

// ---------- Lista de posts ----------

function PostsList({ posts, onRefresh }: { posts: Post[]; onRefresh: () => void }) {
  const { id } = useProject();
  const [publishing, setPublishing] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState<Record<string, string>>({});

  const publish = async (postId: string) => {
    setPublishing(postId);
    try {
      await api(`/api/p/${id}/social/publish`, "POST", { postId });
      toast("¡Publicado en Instagram!", "ok");
      onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error al publicar");
    } finally {
      setPublishing(null);
    }
  };

  const schedule = async (postId: string) => {
    const dateStr = scheduleDate[postId];
    if (!dateStr) { toast("Elige una fecha de publicación"); return; }
    setScheduling(postId);
    try {
      await api(`/api/p/${id}/social/schedule`, "POST", { postId, scheduledAt: new Date(dateStr).toISOString() });
      toast("Programado: se publicará solo a esa hora", "ok");
      onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error al programar");
    } finally {
      setScheduling(null);
    }
  };

  const [deletePost] = useAction(async (postId: string) => {
    await api(`/api/p/${id}/social/posts`, "DELETE", { postId });
    onRefresh();
  });

  const [unschedule] = useAction(async (postId: string) => {
    await api(`/api/p/${id}/social/unschedule`, "POST", { postId });
    toast("Programación cancelada: quedó como borrador", "ok");
    onRefresh();
  });

  const localMin = (() => {
    const d = new Date(Date.now() + 5 * 60_000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  })();

  if (!posts.length) return <Empty icon="social" title="Aún no hay posts">Crea tu primer post con el compositor de arriba.</Empty>;

  return (
    <div className="space-y-3">
      {posts.map((post) => {
        const st = STATUS_LABEL[post.status] ?? { label: post.status, color: "text-ink-400" };
        const isReady = post.status === "draft" || post.status === "failed";
        return (
          <div key={post.id} className="rounded-xl border border-ink-200 bg-surface p-4 flex gap-4">
            {/* Imagen */}
            {post.imageUrl ? (
              <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-ink-100 bg-ink-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={post.imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
              </div>
            ) : (
              <div className="w-16 h-16 shrink-0 rounded-lg border border-ink-200 bg-ink-50 flex items-center justify-center">
                <Icon name="photo" className="h-6 w-6 text-ink-300" />
              </div>
            )}

            {/* Contenido */}
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <p className="text-sm line-clamp-2 flex-1">{post.caption}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cx("text-xs font-medium", st.color)}>{st.label}</span>
                  <span className="text-xs text-ink-400">{fmtDate(post.createdAt)}</span>
                </div>
              </div>

              {post.errorMsg && <p className="text-xs text-rose-600">{post.errorMsg}</p>}
              {post.status === "scheduled" && post.scheduledAt && (
                <div className="flex items-center gap-3">
                  <p className="text-xs text-amber-600 flex items-center gap-1"><Icon name="clock" className="h-3 w-3" />Se publica: {fmtDate(post.scheduledAt, "datetime")}</p>
                  <button onClick={() => unschedule(post.id)} className="text-xs text-ink-500 underline hover:text-ink-700">Cancelar programación</button>
                </div>
              )}
              {post.status === "published" && post.publishedAt && (
                <p className="text-xs text-emerald-600 flex items-center gap-1 flex-wrap">
                  <Icon name="check" className="h-3 w-3" />Publicado: {fmtDate(post.publishedAt, "datetime")}
                  {post.stats && (
                    <span className="text-ink-500">
                      · {post.stats.reach != null && <>alcance {fmt(post.stats.reach)} · </>}{fmt(post.stats.likes)} likes · {fmt(post.stats.comments)} coment.
                    </span>
                  )}
                  {post.stats?.permalink && <a href={post.stats.permalink} target="_blank" rel="noreferrer" className="underline text-ink-500">ver</a>}
                </p>
              )}

              {/* Acciones para borradores y fallidos */}
              {isReady && post.imageUrl && (
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button
                    onClick={() => publish(post.id)}
                    disabled={publishing === post.id}
                    className="btn btn-sm btn-acc flex items-center gap-1"
                  >
                    {publishing === post.id ? <Spinner /> : <Icon name="bolt" />}
                    Publicar ahora
                  </button>
                  <div className="flex items-center gap-1">
                    <input
                      type="datetime-local"
                      className="input text-xs py-1 px-2"
                      value={scheduleDate[post.id] ?? ""}
                      onChange={(e) => setScheduleDate((d) => ({ ...d, [post.id]: e.target.value }))}
                      min={localMin}
                    />
                    <button
                      onClick={() => schedule(post.id)}
                      disabled={scheduling === post.id || !scheduleDate[post.id]}
                      className="btn btn-sm flex items-center gap-1 border border-ink-300"
                    >
                      {scheduling === post.id ? <Spinner /> : <Icon name="clock" />}
                      Programar
                    </button>
                  </div>
                </div>
              )}

              {!post.imageUrl && isReady && (
                <p className="text-xs text-amber-600">Sin imagen: Instagram exige una. Crea el post de nuevo con imagen.</p>
              )}
            </div>

            {/* Eliminar */}
            {(isReady || post.status === "scheduled") && (
              <button onClick={() => deletePost(post.id)} className="text-ink-400 hover:text-rose-500 shrink-0" title="Eliminar">
                <Icon name="trash" className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      })}
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
    toast(r.media ? `${r.media} posts actualizados${r.insights ? "" : " (sin alcance: reconecta Instagram para ver estadísticas completas)"}` : "La cuenta aún no tiene posts", r.insights || !r.media ? "ok" : "error");
  });
  const top = data ? [...data.posts].sort((a, b) => b.engagement - a.engagement).slice(0, 5) : [];

  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Icon name="chart" />Rendimiento en Instagram</h3>
          <p className="text-xs text-ink-500 mt-0.5">
            La IA usa tus posts con más interacciones como referencia al escribir captions.
            {data?.syncedAt && <> Actualizado {fmtDate(data.syncedAt, "datetime")}.</>}
          </p>
        </div>
        <button onClick={() => sync()} disabled={syncing} className="btn btn-sm border border-ink-300 flex items-center gap-1.5">
          {syncing ? <Spinner /> : <Icon name="refresh" />}
          Actualizar estadísticas
        </button>
      </div>
      {!data ? (
        <div className="flex items-center gap-2 text-sm text-ink-500"><Spinner />Cargando…</div>
      ) : !data.count ? (
        <p className="text-sm text-ink-500">Todavía no hay datos: pulsa “Actualizar estadísticas” para leer tus últimos posts.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Posts analizados" value={fmt(data.count)} />
            <Stat label="Alcance promedio" value={fmt(data.avgReach)} />
            <Stat label="Interacciones promedio" value={fmt(data.avgEngagement)} />
          </div>
          {data.bestSlots.length > 0 && (
            <div>
              <p className="text-sm font-medium">Mejores horarios para publicar</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.bestSlots.map((s) => (
                  <span key={s.label} className="rounded-full border border-ink-200 px-3 py-1 text-xs" title={`${s.posts} posts en esa franja`}>
                    {s.label} · {fmt(s.avg)} interacciones prom.
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-sm font-medium">Posts con más interacciones</p>
            <div className="mt-2 divide-y divide-ink-100">
              {top.map((m) => (
                <div key={m.mediaId} className="flex items-center gap-3 py-2 text-sm">
                  <p className="flex-1 min-w-0 truncate">{m.caption || <span className="text-ink-400">(sin texto)</span>}</p>
                  <span className="shrink-0 text-xs text-ink-500 tabular-nums">
                    {m.reach != null && <>alcance {fmt(m.reach)} · </>}{fmt(m.likes)} likes · {fmt(m.comments)} coment.{m.saved != null && <> · guardados {fmt(m.saved)}</>}
                  </span>
                  <span className="shrink-0 text-xs text-ink-400">{fmtDate(m.postedAt, "dm")}</span>
                  {m.permalink && (
                    <a href={m.permalink} target="_blank" rel="noreferrer" className="shrink-0 text-ink-400 hover:text-ink-700" title="Ver en Instagram"><Icon name="link2" className="h-3.5 w-3.5" /></a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Página principal ----------

export default function SocialTools() {
  const { id } = useProject();
  const [connKey, setConnKey] = useState(0);
  const [tab, setTab] = useState<"all" | "draft" | "scheduled" | "published">("all");

  const { data: conn, isLoading: connLoading } = useApi<Connection>(`/api/p/${id}/social/connection?_k=${connKey}`);
  const { data: posts, isLoading: postsLoading, mutate: refreshPosts } = useApi<Post[]>(`/api/p/${id}/social/posts${tab !== "all" ? `?status=${tab}` : ""}`, { keepPreviousData: true });

  // resultado de la vuelta desde Instagram: queda fijo en pantalla (un aviso flotante se perdía al cargar)
  const [oauth, setOauth] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("meta_error");
    if (err) setOauth({ ok: false, text: err });
    else if (params.get("meta") === "ok") {
      setOauth({ ok: true, text: "Instagram conectado. Ya puedes crear y publicar posts." });
      setConnKey((k) => k + 1);
    }
    if (err || params.get("meta")) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  if (connLoading) return <div className="flex items-center gap-2 p-6 text-ink-500"><Spinner />Cargando...</div>;

  return (
    <div className="max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2"><Icon name="social" className="h-5 w-5" />Social</h2>
        <p className="text-sm text-ink-500 mt-1">Genera imágenes y textos con las keywords del proyecto y publica o programa posts en Instagram</p>
      </div>

      {oauth && (
        <div role={oauth.ok ? "status" : "alert"} className={cx("flex items-start gap-2 rounded-xl px-4 py-3 text-sm", oauth.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300")}>
          <Icon name={oauth.ok ? "check" : "alert"} className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            {!oauth.ok && <div className="font-medium">No se pudo conectar Instagram</div>}
            <div className="break-words">{oauth.text}</div>
          </div>
          <button onClick={() => setOauth(null)} className="text-xs opacity-70 hover:opacity-100">Cerrar</button>
        </div>
      )}

      {conn && <ConnectionPanel conn={conn} onConnected={() => setConnKey((k) => k + 1)} />}

      {conn?.connected && (
        <>
          <PostComposer onCreated={() => refreshPosts()} />
          <StatsPanel />
        </>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Posts</h3>
          <Tabs value={tab} onChange={setTab} items={[
            { id: "all", label: "Todos" },
            { id: "draft", label: "Borradores" },
            { id: "scheduled", label: "Programados" },
            { id: "published", label: "Publicados" },
          ]} />
        </div>
        {postsLoading ? (
          <div className="flex items-center gap-2 p-4 text-ink-500"><Spinner />Cargando posts...</div>
        ) : (
          <PostsList posts={posts ?? []} onRefresh={() => refreshPosts()} />
        )}
      </div>
    </div>
  );
}
