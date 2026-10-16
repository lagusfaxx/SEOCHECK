import { db } from "../db";
import { safeFetch } from "../net/ssrf";
import { fetchPage } from "../audit/crawler";
import { parseServerLogs } from "./logs";
import { pagesOf, project, admin, text, bounded } from "./data";
import { json, type Analysis, type Row } from "./analysis";
import { ProError, type ProModule } from "./types";
import { normUrl, sameSite } from "../util";
import { projectClient } from "../gsc-oauth";

async function overview(id: string): Promise<Analysis> {
  const [{ pages }, logs, migrations, monitor, local, ai, gbp] =
    await Promise.all([
      pagesOf(id),
      db.logUpload.findMany({
        where: { projectId: id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      db.migration.findMany({
        where: { projectId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      db.proSnapshot.findMany({
        where: { projectId: id, kind: "competitor-monitor" },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      db.localRank.findMany({
        where: { projectId: id },
        orderBy: { checkedAt: "desc" },
        take: 30,
      }),
      db.aiCheck.findMany({
        where: { projectId: id },
        orderBy: { checkedAt: "desc" },
        take: 30,
      }),
      db.proSnapshot.findFirst({
        where: { projectId: id, kind: "gbp" },
        orderBy: { createdAt: "desc" },
      }),
    ]);
  const rows: Row[] = [];
  for (const l of logs) {
    const s = json(l.stats);
    rows.push({
      tipo: "Logs de servidor",
      archivo: l.fileName,
      lineas: l.lines,
      validas: s.parsed,
      invalidas: s.invalid,
      desperdicioBot: s.wasted,
      identidadBot: "Declarada; sin verificar",
      fecha: l.createdAt.toISOString(),
    });
    for (const u of s.topUrls ?? [])
      if (u.errors)
        rows.push({
          tipo: "Errores en logs",
          url: u.path,
          peticiones: u.requests,
          errores: u.errors,
        });
  }
  for (const m of migrations)
    for (const r of Array.isArray(m.results) ? m.results : []) {
      const v = json(r);
      rows.push({
        tipo: "Migración",
        url: v.from,
        destino: v.to,
        correcta: v.ok,
        detalle: v.problem ?? null,
        fecha: m.checkedAt?.toISOString() ?? null,
      });
    }
  for (const s of monitor) {
    const d = json(s.data);
    rows.push({
      tipo: "Cambio de competidor",
      url: d.url,
      detalle: d.changed?.join(", ") || "Primera observación / sin cambios",
      titulo: d.title,
      fecha: s.createdAt.toISOString(),
    });
  }
  // índice por URL normalizada: buscar con find() por cada hreflang era cuadrático en sitios grandes
  const byUrl = new Map(pages.map((q) => [normUrl(q.url) ?? q.url, q]));
  const imageRows = new Map<string, { sinAlt: number; sinDimensiones: number; ejemplo: string }>();
  for (const p of pages) {
    const langs = Array.isArray(p.hreflang) ? p.hreflang : [];
    for (const item of langs) {
      const l = json(item);
      const href = (() => {
        try {
          return new URL(l.href, p.url).href;
        } catch {
          return "";
        }
      })();
      const target = byUrl.get(normUrl(href) ?? href);
      if (
        !href ||
        !l.lang ||
        !/^([a-z]{2,3}(?:-[a-z]{2})?|x-default)$/i.test(l.lang)
      )
        rows.push({
          tipo: "Hreflang inválido",
          url: p.url,
          detalle: String(l.href),
        });
      else if (target && !Array.isArray(target.hreflang)) continue;
      else if (
        target &&
        !(target.hreflang as any[]).some((x: any) => {
          try {
            return (normUrl(new URL(x.href, target.url).href) ?? "") === (normUrl(p.url) ?? p.url);
          } catch {
            return false;
          }
        })
      )
        rows.push({ tipo: "Hreflang sin retorno", url: p.url, destino: href });
    }
    // una fila por página con conteos (una por imagen inundaba la tabla con miles de filas)
    for (const i of Array.isArray(p.images) ? p.images : []) {
      const image = json(i);
      const noAlt = image.alt === null,
        noDims = !image.width || !image.height;
      if (!noAlt && !noDims) continue;
      const r = imageRows.get(p.url) ?? { sinAlt: 0, sinDimensiones: 0, ejemplo: String(image.src ?? "") };
      if (noAlt) r.sinAlt++;
      if (noDims) r.sinDimensiones++;
      imageRows.set(p.url, r);
    }
  }
  for (const [url, r] of imageRows)
    rows.push({
      tipo: "Imágenes a revisar",
      url,
      detalle: [r.sinAlt ? `${r.sinAlt} sin atributo alt` : "", r.sinDimensiones ? `${r.sinDimensiones} sin width/height (pueden causar saltos de diseño)` : ""]
        .filter(Boolean)
        .join(", "),
      imagen: r.ejemplo,
    });
  for (const l of local)
    rows.push({
      tipo: "SEO local / Maps",
      keyword: l.keyword,
      ubicacion: l.location,
      posicion: l.position,
      fecha: l.checkedAt.toISOString(),
    });
  for (const a of ai)
    rows.push({
      tipo: "Visibilidad IA",
      keyword: a.keyword,
      fecha: a.checkedAt.toISOString(),
      motor: a.engine,
      encontrado: a.found,
      posicion: a.position,
      citados: a.cited.join(", "),
    });
  for (const l of json(gbp?.data).locations ?? [])
    rows.push({
      tipo: "Google Business Profile",
      nombre: l.title,
      direccion: l.storefrontAddress?.addressLines?.join(", ") ?? null,
      web: l.websiteUri ?? null,
      fecha: gbp?.createdAt.toISOString() ?? null,
    });
  return {
    title: "Logs, competencia, migraciones y presencia local",
    source: "Datos importados y conexiones del proyecto",
    notes: [
      "Los logs se resumen sin IP ni líneas crudas. El user-agent no demuestra que una petición provenga de Googlebot.",
      "El monitor compara solo URLs configuradas; no cambia ni rastrea sitios completos de la competencia.",
      gbp
        ? "Google Business Profile: inventario de ubicaciones accesibles por OAuth."
        : "Business Profile necesita permiso business.manage, acceso de la cuenta al negocio y la API habilitada.",
    ],
    rows: rows.slice(0, 3000),
  };
}
export async function monitorCompetitors(id: string) {
  const p = await project(id),
    urls = json(p.settings).pro?.monitorUrls ?? [];
  const results = [];
  for (const url of (Array.isArray(urls) ? urls : []).slice(0, 10)) {
    try {
      const last = await db.proSnapshot.findFirst({
        where: {
          projectId: id,
          kind: "competitor-monitor",
          source: { path: ["url"], equals: url },
        },
        orderBy: { createdAt: "desc" },
      });
      if (last && last.createdAt.getTime() > Date.now() - 864e5) continue;
      const page = await fetchPage(url);
      if (page.status !== 200 || page.error)
        throw new Error(
          `HTTP ${page.status}: ${page.error ?? "respuesta no válida"}`,
        );
      const prev = json(last?.data),
        changed = ["title", "metaDesc", "contentHash"].filter(
          (k) => last && prev[k] !== page[k as keyof typeof page],
        );
      const data = {
        url,
        title: page.title,
        metaDesc: page.metaDesc,
        contentHash: page.contentHash,
        changed,
      };
      await db.proSnapshot.create({
        data: {
          projectId: id,
          kind: "competitor-monitor",
          source: { url },
          data,
        },
      });
      results.push(data);
    } catch (e) {
      results.push({ url, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
export const module: ProModule = {
  prefix: "advanced",
  routes: {
    GET: { "": async ({ id }) => overview(id) },
    POST: {
      logs: async (c) => {
        await admin(c);
        const input = text(c.body.logs, 5000001);
        if (!input || input.length > 5000000)
          throw new ProError("Carga hasta 5 MB de logs Apache/Nginx combined");
        const stats = parseServerLogs(input);
        if (!stats.parsed)
          throw new ProError("No se reconocieron líneas en formato combined");
        return db.logUpload.create({
          data: {
            projectId: c.id,
            fileName: text(c.body.fileName, 150) || "access.log",
            lines: stats.lines,
            stats,
            createdBy: c.user.id,
          },
        });
      },
      monitor: async (c) => {
        await admin(c);
        return monitorCompetitors(c.id);
      },
      migration: async (c) => {
        await admin(c);
        if (
          !Array.isArray(c.body.mapping) ||
          !c.body.mapping.length ||
          c.body.mapping.length > 200
        )
          throw new ProError("Mapeo de 1 a 200 URLs requerido");
        const p = await project(c.id),
          mapping = c.body.mapping.map((v: any) => ({
            from: text(v.from),
            to: text(v.to),
          }));
        for (const m of mapping) {
          if (
            !/^https?:\/\//.test(m.from) ||
            !/^https?:\/\//.test(m.to) ||
            !sameSite(m.to, p.domain)
          )
            throw new ProError("El destino debe pertenecer al proyecto");
        }
        return db.migration.create({
          data: {
            projectId: c.id,
            name: text(c.body.name, 100) || "Migración",
            mapping,
          },
        });
      },
      "migration/check": async (c) => {
        await admin(c);
        const m = await db.migration.findFirst({
          where: { id: text(c.body.id), projectId: c.id },
        });
        if (!m) throw new ProError("Migración no encontrada", 404);
        const results = [];
        for (const item of (m.mapping as any[]).slice(
          0,
          bounded(c.body.limit, 20, 200),
        )) {
          try {
            const r = await safeFetch(item.from, { timeoutMs: 10000 });
            await r.res.body?.cancel();
            // se comparan normalizadas: una barra final o el host en mayúsculas no es un error de migración
            const same = (normUrl(r.finalUrl) ?? r.finalUrl) === (normUrl(item.to) ?? item.to);
            const ok =
              r.res.status === 200 &&
              same &&
              r.redirects.length === 1 &&
              [301, 308].includes(r.redirects[0].status);
            results.push({
              ...item,
              status: r.res.status,
              finalUrl: r.finalUrl,
              hops: r.redirects.length,
              ok,
              problem: ok
                ? null
                : [
                    r.res.status !== 200 ? `el destino final responde HTTP ${r.res.status}` : "",
                    !same ? `termina en ${r.finalUrl}, no en ${item.to}` : "",
                    r.redirects.length === 0 ? "no redirige" : r.redirects.length > 1 ? `${r.redirects.length} saltos (debe ser uno)` : "",
                    r.redirects.length && ![301, 308].includes(r.redirects[0].status) ? `redirección ${r.redirects[0].status} (debe ser 301 o 308)` : "",
                  ]
                    .filter(Boolean)
                    .join("; ") || "Revisar destino, estado final y redirección permanente directa",
            });
          } catch (e) {
            results.push({
              ...item,
              ok: false,
              problem: e instanceof Error ? e.message : String(e),
            });
          }
        }
        return db.migration.update({
          where: { id: m.id },
          data: { results, checkedAt: new Date() },
        });
      },
      gbp: async (c) => {
        await admin(c);
        const connected = await projectClient(c.id);
        if (!connected) throw new ProError("Conecta Google primero");
        const connection = await db.gscConnection.findUnique({
          where: { projectId: c.id },
        });
        if (!connection?.scope.includes("business.manage"))
          throw new ProError(
            "Vuelve a conectar Google incluyendo Google Business Profile",
          );
        const accounts: any[] = [],
          locations: any[] = [];
        let token = "";
        do {
          const res = await connected.client.request<any>({
            url: "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
            params: { pageSize: 20, ...(token ? { pageToken: token } : {}) },
          });
          accounts.push(...(res.data.accounts ?? []));
          token = res.data.nextPageToken ?? "";
        } while (token && accounts.length < 100);
        for (const account of accounts.slice(0, 100)) {
          token = "";
          do {
            const r = await connected.client.request<any>({
              url: `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`,
              params: {
                readMask:
                  "name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours",
                pageSize: 100,
                ...(token ? { pageToken: token } : {}),
              },
            });
            locations.push(...(r.data.locations ?? []));
            token = r.data.nextPageToken ?? "";
          } while (token && locations.length < 1000);
        }
        return db.proSnapshot.create({
          data: {
            projectId: c.id,
            kind: "gbp",
            data: { locations },
            source: { provider: "Google Business Profile" },
          },
        });
      },
    },
    PATCH: {
      settings: async (c) => {
        await admin(c);
        const p = await project(c.id),
          settings = json(p.settings),
          urls = c.body.monitorUrls;
        if (
          !Array.isArray(urls) ||
          urls.length > 10 ||
          urls.some(
            (u: unknown) =>
              typeof u !== "string" ||
              !/^https?:\/\//.test(u) ||
              u.length > 2000,
          )
        )
          throw new ProError("Indica hasta 10 URLs http(s) de competencia");
        for (const u of urls) new URL(u);
        return db.project.update({
          where: { id: c.id },
          data: {
            settings: {
              ...settings,
              pro: { ...settings.pro, monitorUrls: urls },
            },
          },
          select: { id: true },
        });
      },
    },
  },
  daily: monitorCompetitors,
};
