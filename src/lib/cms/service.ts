/** Conexión del proyecto con su CMS: guardar, verificar, aplicar correcciones y enviar borradores. */
import { db } from "../db";
import { decryptToken, encrypt } from "../gsc-oauth";
import { appBaseUrl, hostOf } from "../util";
import { ensureLive } from "../fixes/service";
import { CmsError, newSecret, normalizeShop, normalizeWpUrl, shopifyGql, shopifyImageStem, shopifyResourceOf, wpRequest, type WpStatus } from "./client";
import { wordpressPlugin } from "./plugin";

const secretOf = (c: { secret: string }) => decryptToken(c.secret).plain;
/** Lo que Shopify permite escribir por API; el resto lo aplica la línea de código en el tema. */
const SHOPIFY_KINDS = ["title", "meta", "alt", "redirect"] as const;
/** Marca de "no aplica en Shopify": no se reintenta salvo que la corrección cambie. */
const NA = "n/a";
/** ¿Hay que enviarla? Nunca enviada, falló, o se editó después de enviarla (el margen cubre el updatedAt del propio envío). */
export const needsPush = (f: { pushedAt: Date | null; pushError: string | null; pushedTo: string | null; updatedAt: Date }) =>
  !f.pushedAt || (f.pushError != null && f.pushedTo !== NA) || f.updatedAt.getTime() - f.pushedAt.getTime() > 5_000;

export async function cmsStatus(projectId: string) {
  const c = await db.cmsConnection.findUnique({ where: { projectId } });
  if (!c) return null;
  const pending = c.kind === "shopify" ? (await db.fix.findMany({ where: { projectId, status: "approved", kind: { in: [...SHOPIFY_KINDS] } }, select: { pushedAt: true, pushError: true, pushedTo: true, updatedAt: true } })).filter(needsPush).length : 0;
  return { kind: c.kind, siteUrl: c.siteUrl, status: c.status, lastError: c.lastError, lastCheckAt: c.lastCheckAt, lastPushAt: c.lastPushAt, info: c.info, pendingPush: pending };
}

/** WordPress: crea la conexión (pendiente hasta que el plugin responda) y su secreto. */
export async function connectWordpress(projectId: string, rawUrl: string) {
  const siteUrl = normalizeWpUrl(rawUrl);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { domain: true } });
  const host = hostOf(siteUrl);
  if (host !== project.domain && !host.endsWith(`.${project.domain}`)) throw new CmsError(`La dirección debe ser de ${project.domain}`);
  await ensureLive(projectId);
  const prev = await db.cmsConnection.findUnique({ where: { projectId } });
  // reconectar el mismo sitio conserva el secreto: el plugin ya instalado sigue sirviendo
  const secret = prev?.kind === "wordpress" ? prev.secret : encrypt(newSecret());
  return db.cmsConnection.upsert({
    where: { projectId },
    create: { projectId, kind: "wordpress", siteUrl, secret, status: "pending" },
    update: { kind: "wordpress", siteUrl, secret, status: "pending", lastError: null, info: {} },
  });
}

export async function pluginFile(projectId: string, origin: string) {
  const c = await db.cmsConnection.findUnique({ where: { projectId } });
  if (!c || c.kind !== "wordpress") throw new CmsError("Primero indica la dirección del sitio WordPress", 404);
  const live = await ensureLive(projectId);
  const base = appBaseUrl(origin);
  return wordpressPlugin({ api: `${base}/api/live/${live.key}`, secret: secretOf(c), app: `${base}/p/${projectId}/fixes` });
}

/** Shopify: valida el token contra la tienda antes de guardarlo. */
export async function connectShopify(projectId: string, rawShop: string, token: string) {
  const shop = normalizeShop(rawShop);
  const t = String(token ?? "").trim();
  if (!/^shp(at|ca|pa)_[A-Za-z0-9]{20,}$/.test(t)) throw new CmsError("El token de la API de Admin empieza con «shpat_». Lo ves una sola vez al instalar la app en Shopify.");
  const data = await shopifyGql<{ shop: { name: string; primaryDomain: { host: string } } }>(shop, t, "{ shop { name primaryDomain { host } } }");
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { domain: true } });
  const prev = await db.cmsConnection.findUnique({ where: { projectId }, select: { kind: true, siteUrl: true } });
  if (prev && (prev.kind !== "shopify" || prev.siteUrl !== shop)) await resetPushes(projectId);
  const host = hostOf(`https://${data.shop.primaryDomain.host}`);
  if (host !== project.domain && !host.endsWith(`.${project.domain}`) && !project.domain.endsWith(`.${host}`))
    throw new CmsError(`Esa tienda usa el dominio ${data.shop.primaryDomain.host}, distinto de ${project.domain}`);
  return db.cmsConnection.upsert({
    where: { projectId },
    create: { projectId, kind: "shopify", siteUrl: shop, secret: encrypt(t), status: "connected", lastCheckAt: new Date(), info: { name: data.shop.name, domain: data.shop.primaryDomain.host } },
    update: { kind: "shopify", siteUrl: shop, secret: encrypt(t), status: "connected", lastError: null, lastCheckAt: new Date(), info: { name: data.shop.name, domain: data.shop.primaryDomain.host } },
  });
}

export async function checkCms(projectId: string) {
  const c = await db.cmsConnection.findUnique({ where: { projectId } });
  if (!c) throw new CmsError("No hay un CMS conectado", 404);
  try {
    let info: Record<string, unknown>;
    if (c.kind === "wordpress") {
      const s = await wpRequest<WpStatus>(c.siteUrl, secretOf(c), "GET", "/fsv-search/v1/status");
      info = { name: s.name, plugin: s.plugin, wordpress: s.wordpress, seo: s.seo, url: s.url };
    } else {
      const d = await shopifyGql<{ shop: { name: string; primaryDomain: { host: string } } }>(c.siteUrl, secretOf(c), "{ shop { name primaryDomain { host } } }");
      info = { name: d.shop.name, domain: d.shop.primaryDomain.host };
    }
    await db.cmsConnection.update({ where: { projectId }, data: { status: "connected", lastError: null, lastCheckAt: new Date(), info: info as object } });
    return cmsStatus(projectId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.cmsConnection.update({ where: { projectId }, data: { status: c.status === "pending" ? "pending" : "error", lastError: msg, lastCheckAt: new Date() } });
    throw e;
  }
}

/** El estado de envío es de una tienda concreta: al desconectar o cambiar de tienda se vuelve a enviar todo. */
const resetPushes = (projectId: string) => db.fix.updateMany({ where: { projectId, pushedAt: { not: null } }, data: { pushedAt: null, pushedTo: null, pushError: null } });

export async function disconnectCms(projectId: string) {
  await resetPushes(projectId);
  return db.cmsConnection.deleteMany({ where: { projectId } });
}

/** WordPress guarda 5 minutos cada página: al aprobar algo se le pide limpiar para que se vea al tiro. */
export async function notifyCms(projectId: string) {
  const c = await db.cmsConnection.findUnique({ where: { projectId } });
  if (c?.kind !== "wordpress" || c.status !== "connected") return;
  await wpRequest(c.siteUrl, secretOf(c), "POST", "/fsv-search/v1/flush", {}).catch(() => {});
}

// ── Shopify: aplicar correcciones aprobadas ───────────────────────────────────

const Q = {
  product: `query($q: String!) { products(first: 1, query: $q) { nodes { id handle media(first: 50) { nodes { ... on MediaImage { id image { url } } } } } } }`,
  collection: `query($q: String!) { collections(first: 1, query: $q) { nodes { id handle } } }`,
  page: `query($q: String!) { pages(first: 1, query: $q) { nodes { id handle } } }`,
  article: `query($q: String!) { articles(first: 1, query: $q) { nodes { id handle } } }`,
};
const userErrors = (r: any) => (Object.values(r ?? {}) as any[]).flatMap((x) => x?.userErrors ?? []).map((e: any) => e.message).join("; ");

/** Aplica en Shopify las correcciones aprobadas que Shopify permite escribir por API. Devuelve cuántas y los errores. */
export async function pushShopify(projectId: string) {
  const c = await db.cmsConnection.findUnique({ where: { projectId } });
  if (!c || c.kind !== "shopify") throw new CmsError("Conecta la tienda de Shopify primero", 404);
  const token = secretOf(c);
  const shop = c.siteUrl;
  const fixes = await db.fix.findMany({ where: { projectId, status: "approved", kind: { in: [...SHOPIFY_KINDS] } }, orderBy: { impact: "desc" }, take: 300 });
  const todo = fixes.filter(needsPush);
  const mark = (id: string, pushedTo: string | null, error: string | null) => db.fix.update({ where: { id }, data: { pushedAt: new Date(), pushedTo, pushError: error } });
  let unsupported = 0;
  const skip = async (id: string, msg: string) => {
    unsupported++;
    await mark(id, NA, msg);
  };
  const cache = new Map<string, any>();
  const resolve = async (url: string) => {
    const r = shopifyResourceOf(url);
    if (!r) return null;
    const k = `${r.type}:${r.handle}`;
    if (!cache.has(k)) {
      const d = await shopifyGql<any>(shop, token, Q[r.type], { q: `handle:'${r.handle}'` });
      const node = d[`${r.type === "product" ? "products" : r.type === "collection" ? "collections" : r.type === "page" ? "pages" : "articles"}`]?.nodes?.[0] ?? null;
      cache.set(k, node ? { ...node, type: r.type } : null);
    }
    return cache.get(k);
  };
  let done = 0;
  const failed: { id: string; error: string }[] = [];
  // título y descripción de un mismo recurso van en una sola llamada
  const byUrl = new Map<string, typeof todo>();
  for (const f of todo.filter((f) => f.kind === "title" || f.kind === "meta")) byUrl.set(f.url, [...(byUrl.get(f.url) ?? []), f]);
  for (const [url, list] of byUrl) {
    try {
      const node = await resolve(url);
      if (!node) {
        const msg = new URL(url).pathname === "/" ? "La portada se edita en Shopify: Tienda online → Preferencias. La línea de código sí la aplica." : "No es un producto, colección, página ni artículo de Shopify: queda para la línea de código.";
        for (const f of list) await skip(f.id, msg);
        continue;
      }
      const title = list.find((f) => f.kind === "title")?.after;
      const description = list.find((f) => f.kind === "meta")?.after;
      let r: any;
      if (node.type === "product") r = await shopifyGql(shop, token, `mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { userErrors { message } } }`, { p: { id: node.id, seo: { ...(title ? { title } : {}), ...(description ? { description } : {}) } } });
      else if (node.type === "collection") r = await shopifyGql(shop, token, `mutation($i: CollectionInput!) { collectionUpdate(input: $i) { userErrors { message } } }`, { i: { id: node.id, seo: { ...(title ? { title } : {}), ...(description ? { description } : {}) } } });
      else r = await shopifyGql(shop, token, `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { message } } }`, { m: [...(title ? [{ ownerId: node.id, namespace: "global", key: "title_tag", type: "single_line_text_field", value: title }] : []), ...(description ? [{ ownerId: node.id, namespace: "global", key: "description_tag", type: "multi_line_text_field", value: description }] : [])] });
      const err = userErrors(r) || null;
      for (const f of list) await mark(f.id, node.id, err);
      if (err) failed.push(...list.map((f) => ({ id: f.id, error: err })));
      else done += list.length;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const f of list) await mark(f.id, null, msg);
      failed.push(...list.map((f) => ({ id: f.id, error: msg })));
      if (e instanceof CmsError && e.status === 409) break;
    }
  }
  for (const f of todo.filter((f) => f.kind === "alt")) {
    try {
      const node = await resolve(f.url);
      const stem = shopifyImageStem(f.target);
      const media = node?.type === "product" ? (node.media?.nodes ?? []).find((m: any) => m?.id && shopifyImageStem(m.image?.url ?? "") === stem) : null;
      if (!media) {
        await skip(f.id, "La imagen no es de un producto de Shopify: queda para la línea de código.");
        continue;
      }
      const r = await shopifyGql(shop, token, `mutation($f: [FileUpdateInput!]!) { fileUpdate(files: $f) { userErrors { message } } }`, { f: [{ id: media.id, alt: f.after }] });
      const err = userErrors(r) || null;
      await mark(f.id, media.id, err);
      if (err) failed.push({ id: f.id, error: err });
      else done++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await mark(f.id, null, msg);
      failed.push({ id: f.id, error: msg });
    }
  }
  for (const f of todo.filter((f) => f.kind === "redirect")) {
    try {
      const path = (() => {
        const u = new URL(f.target);
        return u.pathname + u.search;
      })();
      const to = (() => {
        const u = new URL(f.after);
        return hostOf(f.after) === hostOf(f.target) ? u.pathname + u.search : f.after;
      })();
      const r: any = await shopifyGql(shop, token, `mutation($r: UrlRedirectInput!) { urlRedirectCreate(urlRedirect: $r) { urlRedirect { id } userErrors { message } } }`, { r: { path, target: to } });
      let err = userErrors(r) || null;
      // ya existía la misma redirección: no es un error
      if (err && /taken|already/i.test(err)) err = null;
      await mark(f.id, r?.urlRedirectCreate?.urlRedirect?.id ?? "redirect", err);
      if (err) failed.push({ id: f.id, error: err });
      else done++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await mark(f.id, null, msg);
      failed.push({ id: f.id, error: msg });
    }
  }
  await db.cmsConnection.update({ where: { projectId }, data: { lastPushAt: new Date(), ...(failed.some((x) => /token|permiso/i.test(x.error)) ? { status: "error", lastError: failed[0].error } : {}) } });
  return { applied: done, failed: failed.length, unsupported, errors: [...new Set(failed.map((f) => f.error))].slice(0, 5), alreadyApplied: fixes.length - todo.length };
}

// ── Borradores de artículos ───────────────────────────────────────────────────

export type DraftInput = { title: string; html: string; meta: string; slug: string; previousId?: string | null };

export async function sendDraft(projectId: string, a: DraftInput): Promise<{ kind: string; id: string; url: string }> {
  const c = await db.cmsConnection.findUnique({ where: { projectId } });
  if (!c || c.status !== "connected") throw new CmsError("Conecta WordPress o Shopify en Correcciones → Publicar para enviar borradores", 409);
  if (c.kind === "wordpress") {
    const r = await wpRequest<{ id: number; edit: string }>(c.siteUrl, secretOf(c), "POST", "/fsv-search/v1/draft", { id: a.previousId ? Number(a.previousId) : undefined, title: a.title, content: a.html, excerpt: a.meta, slug: a.slug, meta_title: a.title, meta_description: a.meta });
    return { kind: "wordpress", id: String(r.id), url: r.edit };
  }
  const token = secretOf(c);
  const blogs = await shopifyGql<any>(c.siteUrl, token, "{ blogs(first: 1) { nodes { id handle } } }");
  const blog = blogs.blogs?.nodes?.[0];
  if (!blog) throw new CmsError("La tienda no tiene un blog: crea uno en Tienda online → Entradas de blog", 409);
  const r = await shopifyGql<any>(c.siteUrl, token, `mutation($a: ArticleCreateInput!) { articleCreate(article: $a) { article { id handle } userErrors { message } } }`, {
    a: { blogId: blog.id, title: a.title, body: a.html, summary: a.meta, handle: a.slug, isPublished: false, author: { name: (c.info as any)?.name ?? "FSV Search" }, metafields: [{ namespace: "global", key: "title_tag", type: "single_line_text_field", value: a.title }, { namespace: "global", key: "description_tag", type: "multi_line_text_field", value: a.meta }] },
  });
  const err = userErrors(r);
  if (err) throw new CmsError(`Shopify: ${err}`, 502);
  const id = String(r.articleCreate.article.id);
  return { kind: "shopify", id, url: `https://${c.siteUrl}/admin/articles/${id.split("/").pop()}` };
}
