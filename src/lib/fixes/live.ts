/**
 * Publicación en vivo: el script que el cliente pega una vez en su sitio y que aplica las correcciones aprobadas
 * (title, description, canonical, Open Graph, JSON-LD, alt, hreflang y links rotos), y el mismo contenido como
 * JSON para aplicarlo desde el servidor del sitio (SSR).
 *
 * El script nunca ejecuta texto como código: escribe con textContent / setAttribute, así que una corrección no
 * puede inyectar HTML ni JavaScript en el sitio del cliente.
 */

export type LiveFix = { url: string; kind: string; target: string; after: string };
/** Operaciones por página: [tipo, objetivo, valor]. */
export type Op = [string, string, string];
export type LivePayload = { v: 1; pages: Record<string, Op[]>; site: Op[] };

/** Clave de página: ruta sin barra final + parámetros ordenados sin los de seguimiento. Igual en servidor y navegador. */
export function pageKey(input: string): string {
  let path = input;
  let search = "";
  try {
    const u = new URL(input, "https://x.invalid");
    path = u.pathname;
    search = u.search;
  } catch {}
  try {
    path = decodeURI(path);
  } catch {}
  path = path.replace(/\/+$/, "") || "/";
  const params = search.replace(/^\?/, "").split("&").filter((kv) => kv && !/^(utm_[^=]*|gclid|gclsrc|dclid|fbclid|msclkid|yclid|mc_cid|mc_eid|_ga|_gl)(=|$)/i.test(kv)).sort();
  return params.length ? `${path}?${params.join("&")}` : path;
}

export function buildPayload(fixes: LiveFix[]): LivePayload {
  const pages: Record<string, Op[]> = {};
  const site: Op[] = [];
  for (const f of fixes) {
    if (f.kind === "link") {
      site.push(["link", f.target, f.after]);
      continue;
    }
    if (!f.url) continue;
    const k = pageKey(f.url);
    if (f.kind === "og") {
      try {
        for (const [prop, v] of Object.entries(JSON.parse(f.after) as Record<string, unknown>)) (pages[k] ??= []).push(["og", prop, String(v)]);
      } catch {}
    } else (pages[k] ??= []).push([f.kind, f.target, f.after]);
  }
  return { v: 1, pages, site };
}

/** Lo que le toca a una página: sus operaciones más las del sitio. */
export function opsFor(payload: LivePayload, url: string): Op[] {
  return [...(payload.pages[pageKey(url)] ?? []), ...payload.site];
}

/** El mismo contenido listo para el <head> desde el servidor del sitio. */
export function headFor(payload: LivePayload, url: string) {
  const ops = payload.pages[pageKey(url)] ?? [];
  const get = (k: string) => ops.find((o) => o[0] === k)?.[2] ?? null;
  return {
    title: get("title"),
    description: get("meta"),
    canonical: get("canonical"),
    openGraph: Object.fromEntries(ops.filter((o) => o[0] === "og").map((o) => [o[1], o[2]])),
    hreflang: ops.filter((o) => o[0] === "hreflang").map((o) => ({ lang: o[1], href: o[2] })),
    jsonLd: ops.filter((o) => o[0] === "jsonld").map((o) => {
      try {
        return JSON.parse(o[2]);
      } catch {
        return null;
      }
    }).filter(Boolean),
    imageAlt: Object.fromEntries(ops.filter((o) => o[0] === "alt").map((o) => [o[1], o[2]])),
    links: Object.fromEntries(payload.site.filter((o) => o[0] === "link").map((o) => [o[1], o[2]])),
  };
}

/**
 * Código que corre en el sitio del cliente: autocontenido (sin imports ni variables externas) y compatible con navegadores antiguos (sin optional chaining ni async).
 */
/* El código va como texto (no como función serializada con toString): los compiladores agregan ayudantes a las
   funciones y el script dejaría de ser autocontenido. Es JavaScript plano, sin tipos. */
const CLIENT_JS = String.raw`function (base, data) {
  var d = document, w = window;
  if (w.__fsvLive) return;
  w.__fsvLive = 1;
  function key(path, search) {
    try { path = decodeURI(path); } catch (e) {}
    path = path.replace(/\/+$/, "") || "/";
    var ps = search.replace(/^\?/, "").split("&").filter(function (kv) { return kv && !/^(utm_[^=]*|gclid|gclsrc|dclid|fbclid|msclkid|yclid|mc_cid|mc_eid|_ga|_gl)(=|$)/i.test(kv); }).sort();
    return ps.length ? path + "?" + ps.join("&") : path;
  }
  // misma página con o sin www, http o https: se compara por ruta; otro dominio (CDN), por URL completa
  var host = location.hostname.replace(/^www\./, "");
  function abs(u) {
    try {
      var x = new URL(u, location.href);
      return x.hostname.replace(/^www\./, "") === host ? x.pathname + x.search : x.href.replace(/#.*$/, "");
    } catch (e) { return u; }
  }
  function head(tag, sel, attrs) {
    var el = d.head.querySelector(sel);
    if (!el) { el = d.createElement(tag); d.head.appendChild(el); }
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    el.setAttribute("data-fsv", "1");
  }
  function q(s) { return s.replace(/["\\]/g, "\\$&"); }
  var count = 0;
  function apply(ops) {
    count = 0;
    var alts = {}, links = {}, hasAlt = false, hasLink = false;
    for (var i = 0; i < ops.length; i++) {
      var k = ops[i][0], t = ops[i][1], v = ops[i][2];
      try {
        if (k === "title") { if (d.title !== v) d.title = v; count++; }
        else if (k === "meta") { head("meta", 'meta[name="description"]', { name: "description", content: v }); count++; }
        else if (k === "canonical") { head("link", 'link[rel="canonical"]', { rel: "canonical", href: v }); count++; }
        else if (k === "og") {
          var a = t.indexOf("twitter:") === 0 ? "name" : "property", at = { content: v };
          at[a] = t;
          head("meta", "meta[" + a + '="' + q(t) + '"]', at); count++;
        }
        else if (k === "hreflang") { head("link", 'link[rel="alternate"][hreflang="' + q(t) + '"]', { rel: "alternate", hreflang: t, href: v }); count++; }
        else if (k === "jsonld") {
          var id = "fsv-ld-" + t.replace(/[^a-z0-9]/gi, "");
          var s = d.getElementById(id);
          if (!s) { s = d.createElement("script"); s.type = "application/ld+json"; s.id = id; s.setAttribute("data-fsv", "1"); d.head.appendChild(s); }
          if (s.textContent !== v) s.textContent = v;
          count++;
        }
        else if (k === "alt") { alts[abs(t)] = v; hasAlt = true; }
        else if (k === "link") { links[abs(t).replace(/\/$/, "")] = v; hasLink = true; }
      } catch (e) {}
    }
    function sweep() {
      if (hasAlt) {
        var imgs = d.images;
        for (var j = 0; j < imgs.length; j++) {
          var im = imgs[j], src = im.getAttribute("src") || im.getAttribute("data-src") || "";
          var val = alts[abs(src)] || alts[im.currentSrc];
          if (val && !im.getAttribute("alt")) { im.setAttribute("alt", val); count++; }
        }
      }
      if (hasLink) {
        var as = d.querySelectorAll("a[href]");
        for (var n = 0; n < as.length; n++) {
          var to = links[abs(as[n].getAttribute("href") || "").replace(/\/$/, "")];
          if (to) { as[n].setAttribute("href", to); count++; }
        }
      }
    }
    sweep();
    if (hasAlt || hasLink) {
      if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", sweep);
      w.addEventListener("load", sweep);
      // contenido que llega después (tiendas y sitios con carga diferida)
      if (w.MutationObserver && d.body) {
        var pending = 0;
        new w.MutationObserver(function () { if (!pending) pending = setTimeout(function () { pending = 0; sweep(); }, 400); }).observe(d.body, { childList: true, subtree: true });
      }
    }
  }
  function run(ops) {
    apply(ops);
    // un aviso por visita para confirmar la instalación (sin cookies ni datos de la persona)
    try {
      if (!w.sessionStorage || !sessionStorage.getItem("fsv_p")) {
        if (w.sessionStorage) sessionStorage.setItem("fsv_p", "1");
        new Image().src = base + "/ping?u=" + encodeURIComponent(location.pathname) + "&n=" + count;
      }
    } catch (e) {}
  }
  function go() {
    var k = key(location.pathname, location.search);
    if (data.pages) return run((data.pages[k] || []).concat(data.site || []));
    // sitio grande: pide solo lo de esta página
    try {
      var x = new XMLHttpRequest();
      x.open("GET", base + "/page.json?u=" + encodeURIComponent(k));
      x.onload = function () { try { var r = JSON.parse(x.responseText); run(r.ops || []); } catch (e) {} };
      x.send();
    } catch (e) {}
  }
  go();
  // navegación sin recarga (React, Vue, Next): volver a aplicar en la página nueva
  var last = location.href;
  function nav() { setTimeout(function () { if (location.href !== last) { last = location.href; go(); } }, 60); }
  try {
    var h = history, ps = h.pushState, rs = h.replaceState;
    h.pushState = function () { var r = ps.apply(this, arguments); nav(); return r; };
    h.replaceState = function () { var r = rs.apply(this, arguments); nav(); return r; };
    w.addEventListener("popstate", nav);
  } catch (e) {}
}`;


/** Sobre este tamaño el script deja de incluir todas las páginas y pide solo la que se está viendo. */
export const INLINE_LIMIT = 120_000;

const safeJson = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

export function liveScript(base: string, payload: LivePayload | null): string {
  const data = payload ? safeJson(payload) : "{}";
  const body = data.length <= INLINE_LIMIT ? data : "{}";
  return `/* FSV Search: correcciones SEO aprobadas */\n(${CLIENT_JS})(${safeJson(base)},${body});`;
}

export const snippetFor = (base: string, key: string) => `<script async src="${base}/api/live/${key}/s.js"></script>`;
