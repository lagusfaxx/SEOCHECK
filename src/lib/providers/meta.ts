/**
 * Instagram API con Instagram Login (caso de uso "Instagram API" en Meta for Developers).
 * El usuario autoriza su cuenta profesional de Instagram (no requiere Página de Facebook) y SEOCHECK guarda el
 * token de larga duración cifrado. La API no programa publicaciones: eso lo hace el worker (cola social.due).
 */
import { db } from "../db";
import { env } from "../env";
import { newToken, tokenHash } from "../auth";
import { encrypt, decrypt } from "../gsc-oauth";
import { fetchT } from "../util";

const GRAPH = "https://graph.instagram.com/v21.0";
const SCOPES = "instagram_business_basic,instagram_business_content_publish";

export const metaConfigured = () => Boolean(env.metaAppId && env.metaAppSecret && process.env.TOKEN_ENC_KEY);

const appUrl = (origin?: string) => (process.env.APP_URL || origin || "").replace(/\/$/, "");

export const metaRedirectUri = (origin: string) => `${appUrl(origin)}/api/oauth/meta/callback`;

export class MetaNotConnected extends Error {
  constructor(msg = "Instagram no está conectado: conéctalo en Social del proyecto") {
    super(msg);
    this.name = "MetaNotConnected";
  }
}

async function readJson(res: Response, what: string) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message ?? data.error_message ?? `HTTP ${res.status}`;
    throw new Error(`${what}: ${msg}`);
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

  const long = await readJson(
    await fetchT(`https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: env.metaAppSecret, access_token: shortToken })}`),
    "No se pudo obtener el token de larga duración",
  );
  const token: string = long.access_token;
  const expiresIn: number = long.expires_in ?? 60 * 86400;

  const me = await readJson(await fetchT(`${GRAPH}/me?${new URLSearchParams({ fields: "user_id,username", access_token: token })}`), "No se pudo leer la cuenta de Instagram");
  const igAccountId = String(me.user_id ?? me.id ?? "");
  if (!igAccountId) throw new Error("Instagram no devolvió el ID de la cuenta");
  const igAccountName: string = me.username ?? igAccountId;

  const data = {
    igAccountId,
    igAccountName,
    accessTokenEnc: encrypt(token),
    tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
    connectedBy: userId,
    lastError: null,
  };
  await db.metaConnection.upsert({ where: { projectId: st.projectId }, create: { projectId: st.projectId, ...data }, update: data });
  return st.projectId;
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
      const r = await readJson(await fetchT(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`), "Renovación del token");
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
  await db.metaConnection.deleteMany({ where: { projectId } });
}

export async function markConnectionError(projectId: string, msg: string | null) {
  await db.metaConnection.updateMany({ where: { projectId }, data: { lastError: msg } });
}
