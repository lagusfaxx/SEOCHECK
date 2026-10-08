/**
 * OAuth de Google para Search Console, por proyecto: el cliente autoriza con su propia cuenta de Google y
 * SEOCHECK guarda solo el refresh token, cifrado (AES-256-GCM). Con eso se piden tokens de acceso de corta vida.
 * PKCE + state atado al usuario: nadie puede completar el flujo por otro ni pegar la conexión en otro proyecto.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { db } from "./db";
import { newToken, tokenHash } from "./auth";

export const GSC_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly", "openid", "email"];

export class GscNotConnected extends Error {
  constructor(msg = "Search Console no está conectado: conéctalo en Ajustes del proyecto") {
    super(msg);
    this.name = "GscNotConnected";
  }
}

export const oauthConfigured = () => Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.TOKEN_ENC_KEY);

export const redirectUri = (origin: string) => `${(process.env.APP_URL ?? origin).replace(/\/$/, "")}/api/oauth/google/callback`;

// ---------- cifrado de tokens ----------

function encKey(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY ?? "";
  const k = /^[A-Za-z0-9+/=_-]{43,}$/.test(raw) ? Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64") : Buffer.alloc(0);
  if (k.length !== 32) throw new Error("TOKEN_ENC_KEY debe ser una clave de 32 bytes en base64 (genérala con: openssl rand -base64 32)");
  return k;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${data.toString("base64")}`;
}

export function decrypt(blob: string): string {
  const [v, iv, tag, data] = blob.split(".");
  if (v !== "v1") throw new Error("formato de token desconocido");
  const d = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

// ---------- flujo ----------

const oauthClient = (origin: string) => new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET, redirectUri(origin));

/** URL de consentimiento de Google para conectar el proyecto. */
export async function startUrl(projectId: string, userId: string, origin: string): Promise<string> {
  if (!oauthConfigured()) throw new Error("Falta configurar GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET y TOKEN_ENC_KEY");
  const state = newToken();
  const codeVerifier = randomBytes(48).toString("base64url");
  await db.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.oAuthState.create({ data: { id: tokenHash(state), userId, projectId, codeVerifier, expiresAt: new Date(Date.now() + 10 * 60_000) } });
  const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return oauthClient(origin).generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // asegura refresh token aunque ya haya autorizado antes
    include_granted_scopes: true,
    scope: GSC_SCOPES,
    state,
    code_challenge_method: "S256" as never,
    code_challenge: challenge,
  });
}

/** Callback: valida el state (y que sea del mismo usuario), cambia el code por tokens y guarda la conexión. */
export async function finish(stateRaw: string, code: string, userId: string, origin: string) {
  const st = await db.oAuthState.findUnique({ where: { id: tokenHash(stateRaw) } });
  if (st) await db.oAuthState.delete({ where: { id: st.id } }).catch(() => {});
  if (!st || st.expiresAt < new Date()) throw new Error("La autorización venció o no es válida: vuelve a intentarlo");
  if (st.userId !== userId) throw new Error("La autorización la empezó otro usuario");
  const client = oauthClient(origin);
  const { tokens } = await client.getToken({ code, codeVerifier: st.codeVerifier });
  if (!tokens.refresh_token) throw new Error("Google no entregó acceso permanente: quita el acceso de SEOCHECK en tu cuenta de Google y vuelve a conectar");
  if (!(tokens.scope ?? "").includes("webmasters")) throw new Error("No se dio permiso de Search Console: al conectar, marca la casilla de Search Console");
  let email: string | null = null;
  if (tokens.id_token) {
    const t = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_OAUTH_CLIENT_ID }).catch(() => null);
    email = t?.getPayload()?.email ?? null;
  }
  await db.gscConnection.upsert({
    where: { projectId: st.projectId },
    create: { projectId: st.projectId, googleEmail: email, refreshTokenEnc: encrypt(tokens.refresh_token), scope: tokens.scope ?? "", connectedBy: userId },
    update: { googleEmail: email, refreshTokenEnc: encrypt(tokens.refresh_token), scope: tokens.scope ?? "", connectedBy: userId, lastError: null },
  });
  return st.projectId;
}

/** Cliente autenticado con la cuenta de Google del proyecto (renueva el token de acceso solo). */
export async function projectClient(projectId: string): Promise<{ client: OAuth2Client; email: string | null } | null> {
  const c = await db.gscConnection.findUnique({ where: { projectId } });
  if (!c) return null;
  const client = new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  client.setCredentials({ refresh_token: decrypt(c.refreshTokenEnc) });
  return { client, email: c.googleEmail };
}

/** Desconectar: revoca el acceso en Google y borra el token. */
export async function disconnect(projectId: string) {
  const c = await db.gscConnection.findUnique({ where: { projectId } });
  if (!c) return;
  try {
    await new OAuth2Client().revokeToken(decrypt(c.refreshTokenEnc));
  } catch {
    /* si ya estaba revocado, igual se borra */
  }
  await db.gscConnection.delete({ where: { projectId } });
}

/** Guarda el error de la conexión (p. ej. el cliente revocó el acceso) para mostrarlo en la UI. */
export async function markConnectionError(projectId: string, msg: string | null) {
  await db.gscConnection.updateMany({ where: { projectId }, data: { lastError: msg } });
}
