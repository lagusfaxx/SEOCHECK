/**
 * Meta Business / Instagram Graph API.
 * Flujo OAuth: el usuario autoriza con Facebook → SEOCHECK guarda el long-lived access token cifrado.
 * Con ese token se puede publicar y programar fotos en el Instagram Business Account vinculado.
 */
import { db } from "../db";
import { env } from "../env";
import { newToken, tokenHash } from "../auth";
import { encrypt, decrypt } from "../gsc-oauth";
import { fetchT } from "../util";

const GRAPH = "https://graph.facebook.com/v21.0";

export const metaConfigured = () => Boolean(env.metaAppId && env.metaAppSecret && process.env.TOKEN_ENC_KEY);

export const metaRedirectUri = (origin: string) =>
  `${(process.env.APP_URL ?? origin).replace(/\/$/, "")}/api/oauth/meta/callback`;

export class MetaNotConnected extends Error {
  constructor(msg = "Meta no está conectado: conéctalo en Social del proyecto") {
    super(msg);
    this.name = "MetaNotConnected";
  }
}

// ---------- OAuth ----------

/** URL del diálogo de Facebook Login para conectar el proyecto. */
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
    scope: "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement",
    state,
    response_type: "code",
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

/** Callback: valida el state, canjea el code por token, obtiene la cuenta IG y guarda la conexión. */
export async function finish(stateRaw: string, code: string, userId: string, origin: string): Promise<string> {
  const st = await db.oAuthState.findUnique({ where: { id: tokenHash(stateRaw) } });
  if (st) await db.oAuthState.delete({ where: { id: st.id } }).catch(() => {});
  if (!st || st.expiresAt < new Date() || st.provider !== "meta") throw new Error("La autorización venció o no es válida");
  if (st.userId !== userId) throw new Error("La autorización la empezó otro usuario");

  // 1. Canjear code por short-lived user token
  const tokenRes = await fetchT(`${GRAPH}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.metaAppId, client_secret: env.metaAppSecret, redirect_uri: metaRedirectUri(origin), code }).toString(),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) throw new Error(`Meta token error: ${tokenData.error?.message ?? tokenRes.status}`);
  const shortToken: string = tokenData.access_token;

  // 2. Canjear por long-lived token (válido 60 días)
  const llRes = await fetchT(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${env.metaAppId}&client_secret=${env.metaAppSecret}&fb_exchange_token=${shortToken}`,
  );
  const llData = await llRes.json();
  if (!llRes.ok || !llData.access_token) throw new Error(`Meta long-lived token error: ${llData.error?.message ?? llRes.status}`);
  const longToken: string = llData.access_token;
  const expiresIn: number = llData.expires_in ?? 5184000; // 60 días en segundos

  // 3. Obtener páginas del usuario
  const pagesRes = await fetchT(`${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${longToken}`);
  const pagesData = await pagesRes.json();
  if (!pagesRes.ok) throw new Error(`Error obteniendo páginas de Facebook: ${pagesData.error?.message ?? pagesRes.status}`);
  const pages: Array<{ id: string; name: string; access_token: string }> = pagesData.data ?? [];
  if (!pages.length) throw new Error("No se encontraron Páginas de Facebook en esta cuenta. Necesitas una Página con una cuenta de Instagram Business vinculada.");

  // 4. Buscar la cuenta Instagram Business vinculada a la primera página que la tenga
  let igAccountId: string | null = null;
  let igAccountName = "";
  let pageId: string | null = null;

  for (const page of pages) {
    const igRes = await fetchT(`${GRAPH}/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
    const igData = await igRes.json();
    if (igData.instagram_business_account?.id) {
      igAccountId = igData.instagram_business_account.id;
      pageId = page.id;
      // Obtener nombre de la cuenta IG
      const nameRes = await fetchT(`${GRAPH}/${igAccountId}?fields=name,username&access_token=${longToken}`);
      const nameData = await nameRes.json();
      igAccountName = nameData.name ?? nameData.username ?? igAccountId;
      break;
    }
  }

  if (!igAccountId) throw new Error("Ninguna Página de Facebook tiene una cuenta de Instagram Business vinculada. Conéctala en la configuración de Facebook.");

  await db.metaConnection.upsert({
    where: { projectId: st.projectId },
    create: {
      projectId: st.projectId,
      igAccountId,
      igAccountName,
      pageId,
      accessTokenEnc: encrypt(longToken),
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      connectedBy: userId,
    },
    update: {
      igAccountId,
      igAccountName,
      pageId,
      accessTokenEnc: encrypt(longToken),
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      connectedBy: userId,
      lastError: null,
    },
  });

  return st.projectId;
}

// ---------- Publicación ----------

async function getToken(projectId: string): Promise<{ token: string; igAccountId: string }> {
  const c = await db.metaConnection.findUnique({ where: { projectId } });
  if (!c) throw new MetaNotConnected();
  // Aviso si el token expira pronto (< 7 días) pero no bloquear
  if (c.tokenExpiresAt && c.tokenExpiresAt < new Date(Date.now() + 7 * 864e5)) {
    await db.metaConnection.update({ where: { projectId }, data: { lastError: "El token de Meta expira pronto: vuelve a conectar la cuenta." } });
  }
  return { token: decrypt(c.accessTokenEnc), igAccountId: c.igAccountId };
}

/** Publica una foto inmediatamente en Instagram. Devuelve el ID del post. */
export async function publishNow(projectId: string, imageUrl: string, caption: string): Promise<{ postId: string }> {
  const { token, igAccountId } = await getToken(projectId);

  // Paso 1: crear container
  const containerRes = await fetchT(`${GRAPH}/${igAccountId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ image_url: imageUrl, caption, access_token: token }).toString(),
  });
  const containerData = await containerRes.json();
  if (!containerRes.ok || !containerData.id) {
    const msg = containerData.error?.message ?? `Error Meta ${containerRes.status}`;
    throw new Error(`Error creando media container: ${msg}`);
  }
  const containerId: string = containerData.id;

  // Esperar a que el container esté listo
  await waitForContainer(igAccountId, containerId, token);

  // Paso 2: publicar
  const publishRes = await fetchT(`${GRAPH}/${igAccountId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: containerId, access_token: token }).toString(),
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.id) {
    const msg = publishData.error?.message ?? `Error Meta ${publishRes.status}`;
    throw new Error(`Error publicando post: ${msg}`);
  }

  return { postId: publishData.id as string };
}

/** Programa una foto para publicar en Instagram en una fecha futura. */
export async function schedulePost(projectId: string, imageUrl: string, caption: string, publishAt: Date): Promise<{ containerId: string }> {
  const { token, igAccountId } = await getToken(projectId);
  const minTime = new Date(Date.now() + 10 * 60_000); // mínimo 10 minutos en el futuro
  const maxTime = new Date(Date.now() + 75 * 24 * 3600_000); // máximo 75 días
  if (publishAt < minTime) throw new Error("La fecha programada debe ser al menos 10 minutos en el futuro");
  if (publishAt > maxTime) throw new Error("La fecha programada no puede ser más de 75 días en el futuro");

  const containerRes = await fetchT(`${GRAPH}/${igAccountId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      image_url: imageUrl,
      caption,
      scheduled_publish_time: String(Math.floor(publishAt.getTime() / 1000)),
      published: "false",
      access_token: token,
    }).toString(),
  });
  const data = await containerRes.json();
  if (!containerRes.ok || !data.id) {
    const msg = data.error?.message ?? `Error Meta ${containerRes.status}`;
    throw new Error(`Error programando post: ${msg}`);
  }

  return { containerId: data.id as string };
}

/** Espera a que un media container esté listo (hasta 30 seg). */
async function waitForContainer(igAccountId: string, containerId: string, token: string, maxTries = 6) {
  for (let i = 0; i < maxTries; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetchT(`${GRAPH}/${containerId}?fields=status_code&access_token=${token}`);
    const data = await res.json();
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") throw new Error(`Meta rechazó la imagen: ${data.status_code}`);
  }
}

/** Desconectar Meta: borra la conexión (no revoca en Meta, el usuario puede hacerlo desde su cuenta). */
export async function disconnect(projectId: string) {
  await db.metaConnection.deleteMany({ where: { projectId } });
}

/** Marca un error en la conexión para mostrarlo en la UI. */
export async function markConnectionError(projectId: string, msg: string | null) {
  await db.metaConnection.updateMany({ where: { projectId }, data: { lastError: msg } });
}
