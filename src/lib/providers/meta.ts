/**
 * Instagram API con Instagram Login (caso de uso "Instagram API" en Meta for Developers).
 * El usuario autoriza su cuenta profesional de Instagram (no requiere Página de Facebook) y SEOCHECK guarda el
 * token de larga duración cifrado. La API no programa publicaciones: eso lo hace el worker (cola social.due).
 */
import { db } from "../db";
import { env } from "../env";
import { newToken, tokenHash } from "../auth";
import { encrypt, decrypt } from "../gsc-oauth";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appBaseUrl, fetchT } from "../util";

const GRAPH = "https://graph.instagram.com/v21.0";
const SCOPES = "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights";

export const metaConfigured = () => Boolean(env.metaAppId && env.metaAppSecret && process.env.TOKEN_ENC_KEY);

const appUrl = appBaseUrl;

export const metaRedirectUri = (origin: string) => `${appUrl(origin)}/api/oauth/meta/callback`;

export class MetaNotConnected extends Error {
  constructor(msg = "Instagram no está conectado: conéctalo en Social del proyecto") {
    super(msg);
    this.name = "MetaNotConnected";
  }
}

/** Mensaje de Meta con su código (sirve para buscarlo en la documentación). */
function metaError(data: any, status: number) {
  const e = data?.error;
  const msg = e?.message ?? data?.error_message ?? `HTTP ${status}`;
  const code = e?.code ?? data?.code;
  return code ? `${msg} (código ${code}${e?.error_subcode ? `/${e.error_subcode}` : ""})` : msg;
}

/** Tipo de token sin revelarlo: IG = Instagram Login; EAA = token de Facebook (no sirve en graph.instagram.com). */
const tokenKind = (t: string) => (t.startsWith("IG") ? "Instagram" : t.startsWith("EAA") ? "Facebook" : "desconocido");

async function readJson(res: Response, what: string) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(`${what}: ${metaError(data, res.status)}`);
  }
  return data;
}

// ---------- OAuth ----------

export async function startUrl(projectId: string, userId: string, origin: string): Promise<string> {
  if (!metaConfigured()) throw new Error("Falta configurar META_APP_ID, META_APP_SECRET y TOKEN_ENC_KEY");
  const state = newToken();
  await db.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.oAuthState.create({
    data: { id: tokenHash(state), userId, projectId, codeVerifier: "", provider: "meta", expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  const params = new URLSearchParams({
    client_id: env.metaAppId,
    redirect_uri: metaRedirectUri(origin),
    response_type: "code",
    scope: SCOPES,
    state,
    // sin "Continuar con Facebook": ese camino entrega un token que graph.instagram.com no acepta
    enable_fb_login: "0",
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

export async function finish(stateRaw: string, code: string, userId: string, origin: string): Promise<string> {
  const st = await db.oAuthState.findUnique({ where: { id: tokenHash(stateRaw) } });
  if (st) await db.oAuthState.delete({ where: { id: st.id } }).catch(() => {});
  if (!st || st.expiresAt < new Date() || st.provider !== "meta") throw new Error("La autorización venció o no es válida");
  if (st.userId !== userId) throw new Error("La autorización la empezó otro usuario");

  // Instagram a veces agrega "#_" al final del code
  const cleanCode = code.replace(/#_$/, "");
  const short = await readJson(
    await fetchT("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.metaAppId,
        client_secret: env.metaAppSecret,
        grant_type: "authorization_code",
        redirect_uri: metaRedirectUri(origin),
        code: cleanCode,
      }).toString(),
    }),
    "Instagram rechazó el código",
  );
  const shortToken: string | undefined = short.access_token ?? short.data?.[0]?.access_token;
  if (!shortToken) throw new Error("Instagram no devolvió un token");

  const long = await tokenCall("access_token", { grant_type: "ig_exchange_token", client_secret: env.metaAppSecret, access_token: shortToken });
  // sin canje igual queda conectada (sirve para probar); el aviso queda visible en el panel
  const token: string = long.ok ? long.data.access_token : shortToken;
  const expiresIn: number | null = long.ok ? (long.data.expires_in ?? 60 * 86400) : null;

  const perms = Array.isArray(short.permissions) ? short.permissions.join(",") : String(short.permissions ?? short.data?.[0]?.permissions ?? "");
  const me = await readMe(token);
  if (!me.ok) {
    const diag = `token ${tokenKind(token)}${long.ok ? " de 60 días" : " corto"}, permisos: ${perms || "ninguno"}`;
    console.error("[meta] /me falló", diag, me.errors);
    throw new Error(
      `No se pudo leer la cuenta de Instagram: ${me.errors[0]} [${diag}]. Revisa que la cuenta sea profesional (Empresa o Creador) y que al autorizar no hayas usado "Continuar con Facebook".`,
    );
  }
  const igAccountId = String(me.data.user_id ?? me.data.id ?? "");
  if (!igAccountId) throw new Error("Instagram no devolvió el ID de la cuenta");
  const igAccountName: string = me.data.username ?? igAccountId;

  const data = {
    igAccountId,
    igScopedId: me.data.id ? String(me.data.id) : null,
    igAccountName,
    accessTokenEnc: encrypt(token),
    tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    connectedBy: userId,
    lastError: long.ok ? null : `Conexión temporal: Instagram no entregó el acceso de 60 días (${long.error}). Si publicar falla, vuelve a conectar.`,
  };
  await db.metaConnection.upsert({ where: { projectId: st.projectId }, create: { projectId: st.projectId, ...data }, update: data });
  return st.projectId;
}

/**
 * Canje/renovación de token en graph.instagram.com. Meta ha cambiado qué método acepta este endpoint
 * ("Unsupported request - method type: get"): se prueba GET con versión, POST y GET sin versión.
 */
export async function tokenCall(path: "access_token" | "refresh_access_token", params: Record<string, string>): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const qs = new URLSearchParams(params);
  const attempts: [string, RequestInit][] = [
    [`${GRAPH}/${path}?${qs}`, {}],
    [`https://graph.instagram.com/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: qs.toString() }],
    [`https://graph.instagram.com/${path}?${qs}`, {}],
  ];
  const errors: string[] = [];
  for (const [url, init] of attempts) {
    const res = await fetchT(url, init).catch((e) => e as Error);
    if (res instanceof Error) { errors.push(res.message); continue; }
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.access_token) return { ok: true, data };
    errors.push(metaError(data, res.status));
  }
  console.error(`[meta] ${path}: ningún método funcionó`, errors);
  return { ok: false, error: errors[0] ?? "sin respuesta" };
}

/** Datos de la cuenta: con versión, sin versión y con menos campos (cada variante falla distinto según la cuenta). */
async function readMe(token: string): Promise<{ ok: true; data: any } | { ok: false; errors: string[] }> {
  const attempts = [
    `${GRAPH}/me?${new URLSearchParams({ fields: "id,user_id,username", access_token: token })}`,
    `https://graph.instagram.com/me?${new URLSearchParams({ fields: "user_id,username", access_token: token })}`,
    `https://graph.instagram.com/me?${new URLSearchParams({ fields: "id,username", access_token: token })}`,
  ];
  const errors: string[] = [];
  for (const url of attempts) {
    const res = await fetchT(url).catch((e) => e as Error);
    if (res instanceof Error) { errors.push(res.message); continue; }
    const data = await res.json().catch(() => ({}));
    if (res.ok && (data.user_id || data.id)) return { ok: true, data };
    errors.push(metaError(data, res.status));
  }
  return { ok: false, errors };
}

/** Token vigente; lo renueva solo cuando quedan menos de 15 días (Instagram exige que tenga al menos 24 h). */
async function getToken(projectId: string): Promise<{ token: string; igAccountId: string }> {
  const c = await db.metaConnection.findUnique({ where: { projectId } });
  if (!c) throw new MetaNotConnected();
  let token = decrypt(c.accessTokenEnc);
  if (c.tokenExpiresAt && c.tokenExpiresAt < new Date()) throw new MetaNotConnected("El acceso a Instagram venció: vuelve a conectar la cuenta");
  const renewDue = c.tokenExpiresAt && c.tokenExpiresAt < new Date(Date.now() + 15 * 864e5) && c.updatedAt < new Date(Date.now() - 864e5);
  if (renewDue) {
    try {
      const rr = await tokenCall("refresh_access_token", { grant_type: "ig_refresh_token", access_token: token });
      if (!rr.ok) throw new Error(`No se pudo renovar el acceso a Instagram: ${rr.error}`);
      const r = rr.data;
      token = r.access_token;
      await db.metaConnection.update({
        where: { projectId },
        data: { accessTokenEnc: encrypt(token), tokenExpiresAt: new Date(Date.now() + (r.expires_in ?? 60 * 86400) * 1000), lastError: null },
      });
    } catch (e) {
      await markConnectionError(projectId, e instanceof Error ? e.message : String(e));
    }
  }
  return { token, igAccountId: c.igAccountId };
}

// ---------- Publicación ----------

/** Instagram descarga la imagen desde una URL pública: las imágenes propias necesitan APP_URL. */
export function publicImageUrl(imageUrl: string): string {
  if (!imageUrl.startsWith("/")) return imageUrl;
  const base = appUrl();
  if (!base) throw new Error("Falta APP_URL: Instagram necesita una URL pública para descargar la imagen");
  return `${base}${imageUrl}`;
}

export async function publishNow(projectId: string, imageUrl: string, caption: string): Promise<{ postId: string }> {
  const { token, igAccountId } = await getToken(projectId);

  const container = await readJson(
    await fetchT(`${GRAPH}/${igAccountId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ image_url: publicImageUrl(imageUrl), caption, access_token: token }).toString(),
      timeoutMs: 60_000,
    }),
    "Instagram no aceptó la imagen",
  );
  await waitForContainer(container.id, token);

  const published = await readJson(
    await fetchT(`${GRAPH}/${igAccountId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ creation_id: container.id, access_token: token }).toString(),
      timeoutMs: 60_000,
    }),
    "Instagram no publicó el post",
  );
  return { postId: String(published.id) };
}

async function waitForContainer(containerId: string, token: string) {
  for (let i = 0; i < 12; i++) {
    const data = await readJson(await fetchT(`${GRAPH}/${containerId}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`), "Estado del contenedor");
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR" || data.status_code === "EXPIRED") throw new Error(`Instagram rechazó la imagen: ${data.status ?? data.status_code}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Instagram tardó demasiado en procesar la imagen: intenta de nuevo");
}

export async function disconnect(projectId: string) {
  await db.$transaction([db.igMedia.deleteMany({ where: { projectId } }), db.metaConnection.deleteMany({ where: { projectId } })]);
}

export async function markConnectionError(projectId: string, msg: string | null) {
  await db.metaConnection.updateMany({ where: { projectId }, data: { lastError: msg } });
}

// ---------- Perfil ----------

export type IgProfile = { username: string; name: string | null; picture: string | null; followers: number | null; posts: number | null };

/** Datos públicos del perfil conectado (se leen en vivo: la URL de la foto de Instagram vence). */
export async function igProfile(projectId: string): Promise<IgProfile | null> {
  const { token } = await getToken(projectId);
  const res = await fetchT(`${GRAPH}/me?${new URLSearchParams({ fields: "username,name,profile_picture_url,followers_count,media_count", access_token: token })}`, { timeoutMs: 8000 });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.username) return null;
  return { username: d.username, name: d.name ?? null, picture: d.profile_picture_url ?? null, followers: d.followers_count ?? null, posts: d.media_count ?? null };
}

// ---------- Estadísticas ----------

const INSIGHT_METRICS = "reach,likes,comments,saved,shares,total_interactions";

/** Lee los últimos posts de la cuenta con sus estadísticas y los guarda en IgMedia. */
export async function syncInsights(projectId: string): Promise<{ media: number; insights: boolean }> {
  const { token, igAccountId } = await getToken(projectId);
  const list = await readJson(
    await fetchT(`${GRAPH}/${igAccountId}/media?${new URLSearchParams({ fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count", limit: "30", access_token: token })}`),
    "No se pudieron leer los posts de Instagram",
  );
  const items: Array<{ id: string; caption?: string; media_type?: string; permalink?: string; timestamp: string; like_count?: number; comments_count?: number }> = list.data ?? [];
  let insightsOk = true;
  for (const m of items) {
    const stats: Record<string, number> = {};
    if (insightsOk) {
      const res = await fetchT(`${GRAPH}/${m.id}/insights?${new URLSearchParams({ metric: INSIGHT_METRICS, access_token: token })}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        for (const x of data.data ?? []) stats[x.name] = Number(x.total_value?.value ?? x.values?.[0]?.value ?? 0);
      } else if (data.error?.code === 10 || /permission/i.test(data.error?.message ?? "")) {
        insightsOk = false;
        await markConnectionError(projectId, "Falta el permiso de estadísticas: desconecta y vuelve a conectar Instagram");
      }
      // otros errores (p. ej. posts anteriores a la cuenta profesional): quedan solo likes y comentarios
    }
    const row = {
      caption: m.caption?.slice(0, 2200) ?? null,
      mediaType: m.media_type ?? null,
      permalink: m.permalink ?? null,
      postedAt: new Date(m.timestamp),
      reach: stats.reach ?? null,
      likes: stats.likes ?? m.like_count ?? null,
      comments: stats.comments ?? m.comments_count ?? null,
      saved: stats.saved ?? null,
      shares: stats.shares ?? null,
      interactions: stats.total_interactions ?? null,
    };
    await db.igMedia.upsert({ where: { projectId_mediaId: { projectId, mediaId: m.id } }, create: { projectId, mediaId: m.id, ...row }, update: row });
  }
  if (insightsOk) await db.metaConnection.updateMany({ where: { projectId, lastError: { startsWith: "Falta el permiso" } }, data: { lastError: null } });
  return { media: items.length, insights: insightsOk && items.length > 0 };
}

// ---------- Notificaciones de Meta (desautorización y eliminación de datos) ----------

/** Valida el signed_request (HMAC-SHA256 con el app secret) y devuelve el user_id de Instagram. */
export function parseSignedRequest(signed: string): string {
  const [sig, payload] = signed.split(".");
  if (!sig || !payload || !env.metaAppSecret) throw new Error("signed_request inválido");
  const expected = createHmac("sha256", env.metaAppSecret).update(payload).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new Error("Firma inválida");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!data.user_id) throw new Error("signed_request sin user_id");
  return String(data.user_id);
}

/** Borra todo lo obtenido de Instagram para esa cuenta: conexión (token) y estadísticas. */
export async function deleteInstagramUser(igUserId: string): Promise<number> {
  const conns = await db.metaConnection.findMany({ where: { OR: [{ igAccountId: igUserId }, { igScopedId: igUserId }] }, select: { projectId: true } });
  const projectIds = conns.map((c) => c.projectId);
  if (!projectIds.length) return 0;
  await db.$transaction([db.igMedia.deleteMany({ where: { projectId: { in: projectIds } } }), db.metaConnection.deleteMany({ where: { projectId: { in: projectIds } } })]);
  return projectIds.length;
}
