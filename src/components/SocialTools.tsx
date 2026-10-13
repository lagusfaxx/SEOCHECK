"use client";
import { useState, useEffect } from "react";
import { useProject } from "./Shell";
import { api, cx, Empty, fmtDate, Icon, Spinner, Tabs, toast, useAction, useApi } from "./ui";

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
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft: { label: "Borrador", color: "text-ink-400" },
  scheduled: { label: "Programado", color: "text-amber-600" },
  published: { label: "Publicado", color: "text-emerald-600" },
  failed: { label: "Error", color: "text-rose-600" },
};

// ---------- Panel de conexión ----------

function ConnectionPanel({ conn, onConnected }: { conn: Connection; onConnected: () => void }) {
  const { id } = useProject();
  const [connecting, setConnecting] = useState(false);
  const [disconnect, disconnecting] = useAction(async () => {
    await api(`/api/p/${id}/social/connection`, "DELETE", {});
    onConnected();
    toast("Cuenta de Meta desconectada", "ok");
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
            <p className="font-medium">Meta no está configurado</p>
            <p className="mt-1 text-sm text-ink-500">Agrega las variables <code className="text-xs font-mono bg-ink-100 px-1 rounded">META_APP_ID</code> y <code className="text-xs font-mono bg-ink-100 px-1 rounded">META_APP_SECRET</code> en el servidor para habilitar la publicación en Instagram.</p>
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
            <p className="mt-1 text-sm text-ink-500">Requiere una cuenta de Instagram Business vinculada a una Página de Facebook.</p>
          </div>
          <button onClick={handleConnect} disabled={connecting} className="btn btn-acc shrink-0 flex items-center gap-2">
            {connecting ? <Spinner /> : <Icon name="social" />}
            Conectar Meta
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

function PostComposer({ onCreated }: { onCreated: () => void }) {
  const { id } = useProject();
  const [imageTab, setImageTab] = useState<"dalle" | "url">("dalle");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [generatedImageUrl, setGeneratedImageUrl] = useState("");
  const [revisedPrompt, setRevisedPrompt] = useState("");
  const [caption, setCaption] = useState("");
  const [captionContext, setCaptionContext] = useState("");
  const [tone, setTone] = useState<"cercano" | "profesional" | "inspirador">("cercano");
  const [scheduledAt, setScheduledAt] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);

  const activeImageUrl = imageTab === "dalle" ? generatedImageUrl : imageUrl;

  const [generateImg, generatingImg] = useAction(async () => {
    if (!imagePrompt.trim()) { toast("Escribe un prompt para la imagen"); return; }
    const result = await api<{ url: string; revisedPrompt: string }>(`/api/p/${id}/social/generate-image`, "POST", { prompt: imagePrompt });
    setGeneratedImageUrl(result.url);
    setRevisedPrompt(result.revisedPrompt);
    toast("Imagen generada — válida ~1 hora", "ok");
  });

  const [generateCaption, generatingCaption] = useAction(async () => {
    const result = await api<{ caption: string }>(`/api/p/${id}/social/generate-caption`, "POST", { context: captionContext, tone });
    setCaption(result.caption);
  });

  const [saveDraft, savingDraft] = useAction(async () => {
    if (!caption.trim()) { toast("Escribe o genera un caption"); return; }
    await api(`/api/p/${id}/social/posts`, "POST", { caption, imageUrl: activeImageUrl || null, imagePrompt: imageTab === "dalle" ? imagePrompt : null });
    toast("Borrador guardado", "ok");
    onCreated();
    setCaption("");
    setGeneratedImageUrl("");
    setImagePrompt("");
    setImageUrl("");
  });

  const charCount = caption.length;
  const charOk = charCount <= 2200;

  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-5 space-y-5">
      <h3 className="font-semibold flex items-center gap-2"><Icon name="photo" />Nuevo post</h3>

      {/* Imagen */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Tabs value={imageTab} onChange={setImageTab} items={[{ id: "dalle", label: "Generar con IA", icon: "sparkle" }, { id: "url", label: "URL de imagen", icon: "link2" }]} />
        </div>
        {imageTab === "dalle" ? (
          <div className="space-y-2">
            <textarea
              className="input w-full text-sm resize-none"
              rows={2}
              placeholder="Describe la imagen (ej: producto de belleza natural sobre fondo blanco minimalista, luz suave, fotografía profesional)"
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              maxLength={1000}
            />
            <button onClick={() => generateImg()} disabled={generatingImg || !imagePrompt.trim()} className="btn btn-sm btn-acc flex items-center gap-1.5">
              {generatingImg ? <Spinner /> : <Icon name="sparkle" />}
              Generar imagen
            </button>
            {generatedImageUrl && (
              <div className="mt-2 space-y-1">
                <div className="relative w-full max-w-xs overflow-hidden rounded-lg border border-ink-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={generatedImageUrl} alt="Imagen generada" className="w-full object-cover aspect-square" />
                </div>
                {revisedPrompt && revisedPrompt !== imagePrompt && (
                  <p className="text-xs text-ink-400 max-w-xs">Prompt revisado: <span className="italic">{revisedPrompt}</span></p>
                )}
                <p className="text-xs text-amber-600 flex items-center gap-1"><Icon name="clock" className="h-3 w-3" />Esta URL expira en ~1 hora. Publica pronto o guarda la imagen.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <input
              className="input w-full text-sm"
              type="url"
              placeholder="https://tusitio.com/imagen-producto.jpg (debe ser pública)"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
            />
            {imageUrl && (
              <div className="relative w-full max-w-xs overflow-hidden rounded-lg border border-ink-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Vista previa" className="w-full object-cover aspect-square" onError={(e) => (e.currentTarget.style.display = "none")} />
              </div>
            )}
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
      toast("Post programado en Instagram", "ok");
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
                <p className="text-xs text-amber-600 flex items-center gap-1"><Icon name="clock" className="h-3 w-3" />Programado: {fmtDate(post.scheduledAt, "datetime")}</p>
              )}
              {post.status === "published" && post.publishedAt && (
                <p className="text-xs text-emerald-600 flex items-center gap-1"><Icon name="check" className="h-3 w-3" />Publicado: {fmtDate(post.publishedAt, "datetime")}</p>
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
                      min={new Date(Date.now() + 11 * 60_000).toISOString().slice(0, 16)}
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
                <p className="text-xs text-amber-600">Sin imagen — edita el borrador para agregar una URL de imagen</p>
              )}
            </div>

            {/* Eliminar */}
            {isReady && (
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

// ---------- Página principal ----------

export default function SocialTools() {
  const { id } = useProject();
  const [connKey, setConnKey] = useState(0);
  const [postsKey, setPostsKey] = useState(0);
  const [tab, setTab] = useState<"all" | "draft" | "scheduled" | "published">("all");

  const { data: conn, isLoading: connLoading } = useApi<Connection>(`/api/p/${id}/social/connection?_k=${connKey}`);
  const { data: posts, isLoading: postsLoading } = useApi<Post[]>(`/api/p/${id}/social/posts${tab !== "all" ? `?status=${tab}` : ""}`, { keepPreviousData: true });

  // Leer errores de callback de OAuth desde la URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get("meta_error");
    const ok = params.get("meta");
    if (err) { toast(decodeURIComponent(err)); window.history.replaceState({}, "", window.location.pathname); }
    if (ok === "ok") { toast("Cuenta de Meta conectada correctamente", "ok"); setConnKey((k) => k + 1); window.history.replaceState({}, "", window.location.pathname); }
  }, []);

  if (connLoading) return <div className="flex items-center gap-2 p-6 text-ink-500"><Spinner />Cargando...</div>;

  return (
    <div className="max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2"><Icon name="social" className="h-5 w-5" />Social</h2>
        <p className="text-sm text-ink-500 mt-1">Genera contenido con IA y publica o programa posts en Instagram</p>
      </div>

      {conn && <ConnectionPanel conn={conn} onConnected={() => setConnKey((k) => k + 1)} />}

      {conn?.connected && (
        <PostComposer onCreated={() => setPostsKey((k) => k + 1)} />
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
          <PostsList posts={posts ?? []} onRefresh={() => setPostsKey((k) => k + 1)} key={postsKey} />
        )}
      </div>
    </div>
  );
}
