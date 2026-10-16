import { fieldCls, vitalStatus } from "../web-vitals";
import { soft404 } from "../audit/soft404";
import type {
  Page as PrismaPage,
  GscRow,
  Ga4Row,
  UrlInspection,
  SerpSnapshot,
  PsiResult,
} from "@prisma/client";
import { tokens } from "../text";
import { hamming } from "../audit/parse/dup";

export type Page = Omit<PrismaPage, "responseHtml" | "htmlSnippet"> &
  Partial<Pick<PrismaPage, "responseHtml" | "htmlSnippet">>;
export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
export type Analysis = {
  title: string;
  source: string;
  notes: string[];
  rows: Row[];
};
export const json = (x: unknown): any => (x && typeof x === "object" ? x : {});
export const live = (p: Page) => p.status === 200 && !p.blocked && !p.error;
export const indexable = (p: Page) =>
  live(p) && !p.noindex && p.canonicalType !== "other";
export const pathOf = (u: string) => {
  try {
    return new URL(u, "https://x.invalid").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return u;
  }
};
const group = <T>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
};
export function crawlAnalysis(pages: Page[]): Analysis {
  return {
    title: "Respuesta y rastreo por URL",
    source: "Último crawl público",
    notes: [
      "El HTML recibido se conserva hasta 2 MiB por URL; las respuestas mayores se marcan como recortadas. No se guardan cookies de respuesta.",
      "Soft 404 es una hipótesis basada en el contenido, no una confirmación de Google.",
    ],
    rows: pages.map((p) => ({
      url: p.url,
      estado: p.status,
      plantilla: p.template,
      redirecciones: Array.isArray(p.redirects) ? p.redirects.length : 0,
      final: p.finalUrl,
      robots: p.blocked,
      noindex: p.noindex,
      respuestaMs: p.responseMs,
      recortada: p.responseTruncated,
      soft404: soft404(p),
    })),
  };
}
export { soft404 } from "../audit/soft404";

export function templateAnalysis(pages: Page[]): Analysis {
  const rows: Row[] = [];
  for (const [template, ps] of group(
    pages,
    (p) => p.template ?? "sin clasificar",
  ))
    rows.push({
      plantilla: template,
      paginas: ps.length,
      indexables: ps.filter(indexable).length,
      profundidadMedia:
        Math.round(
          (ps.filter((p) => p.depth >= 0).reduce((s, p) => s + p.depth, 0) /
            Math.max(1, ps.filter((p) => p.depth >= 0).length)) *
            10,
        ) / 10,
      palabrasMedianas:
        ps.map((p) => p.wordCount).sort((a, b) => a - b)[
          Math.floor(ps.length / 2)
        ] ?? 0,
    });
  const dup = new Map<string, Page>();
  for (const p of pages.filter(indexable)) {
    if (p.mainHash) {
      const prev = dup.get(p.mainHash);
      if (prev)
        rows.push({
          url: p.url,
          similarA: prev.url,
          tipo: "Duplicado exacto del contenido principal",
        });
      else dup.set(p.mainHash, p);
    }
  }
  const candidates = pages
    .filter((p) => indexable(p) && p.simhash)
    .slice(0, 1000);
  for (let i = 0; i < candidates.length; i++)
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i],
        b = candidates[j];
      if (
        a.mainHash !== b.mainHash &&
        a.template === b.template &&
        hamming(a.simhash!, b.simhash!) <= 3
      )
        rows.push({
          url: a.url,
          similarA: b.url,
          tipo: "Contenido parecido: verificar",
        });
      if (rows.length >= 2000) break;
    }
  return {
    title: "Plantillas y duplicados",
    source: "HTML del crawl, sin navegación ni pie de página",
    notes: [
      "La similitud no prueba canibalización. Revisar la intención y el canonical antes de consolidar páginas.",
    ],
    rows: rows.slice(0, 2000),
  };
}
export function architectureAnalysis(pages: Page[], partial = false): Analysis {
  const incomingByUrl = new Map<string, any[]>();
  for (const q of pages)
    for (const l of Array.isArray(q.linkDetails) ? q.linkDetails : []) {
      const v = json(l);
      if (typeof v.to === "string")
        incomingByUrl.set(v.to, [
          ...(incomingByUrl.get(v.to) ?? []),
          { from: q.url, ...v },
        ]);
    }
  const valid = pages.filter(indexable),
    rows: Row[] = [];
  const words = new Map(
    valid.map((p) => [p.url, new Set(tokens([p.title, ...p.h1].join(" ")))]),
  );
  for (const p of valid) {
    const incoming = incomingByUrl.get(p.url) ?? [];
    if (
      p.orphan ||
      p.depth > 3 ||
      incoming.some(
        (l: any) =>
          !l.anchor || /^(aqu[ií]|click|clic|ver m[aá]s)$/i.test(l.anchor),
      )
    )
      rows.push({
        url: p.url,
        tipo: p.orphan
          ? partial
            ? "Sin enlace encontrado (cobertura parcial)"
            : "Sin enlace encontrado"
          : p.depth > 3
            ? "Profundidad alta"
            : "Anchor poco descriptivo",
        profundidad: p.depth,
        entrantes: p.inlinks,
        plantilla: p.template,
      });
    if (p.inlinks >= 3 && !p.orphan) continue;
    const target = words.get(p.url)!;
    const suggestions = valid
      .filter((q) => q.url !== p.url && !q.links.includes(p.url))
      .map((q) => ({
        q,
        score: [...words.get(q.url)!].filter((w) => target.has(w)).length,
      }))
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const { q } of suggestions)
      rows.push({
        url: p.url,
        desde: q.url,
        tipo: "Propuesta de enlace interno",
        anchor: p.h1[0] || p.title || pathOf(p.url),
        verificacion:
          "Añadir solo donde ayude al lector; comprobar que el enlace se puede rastrear",
      });
  }
  return {
    title: "Arquitectura y enlaces internos",
    source: "Grafo del último crawl",
    notes: [
      partial
        ? "Crawl parcial: una página sin enlaces encontrados no se considera huérfana confirmada."
        : "Las URLs fuera del crawl pueden tener enlaces que no observamos.",
      "La profundidad se mide desde la URL de inicio; -1 significa descubierta solo en sitemap.",
    ],
    rows,
  };
}
export function indexationAnalysis(
  pages: Page[],
  inspections: UrlInspection[],
  traffic: Pick<GscRow, "page" | "clicks" | "impressions">[],
): Analysis {
  const latest = new Map<string, UrlInspection>();
  for (const i of inspections)
    if (!latest.has(i.url) || latest.get(i.url)!.createdAt < i.createdAt)
      latest.set(i.url, i);
  const clicks = new Map<string, number>();
  for (const r of traffic)
    clicks.set(r.page, (clicks.get(r.page) ?? 0) + r.clicks);
  const rows = pages
    .map((p) => {
      const i = latest.get(p.url),
        raw = json(i?.raw).indexStatusResult ?? {};
      const indexed = i?.verdict === "PASS";
      const reason = i
        ? i.coverageState ||
          String(
            raw.indexingState || i.verdict || "Google no informó el motivo",
          )
        : p.blocked
          ? "robots.txt impide el rastreo"
          : p.noindex
            ? "Directiva noindex observada"
            : p.status >= 400
              ? `HTTP ${p.status} observado`
              : p.canonicalType === "other"
                ? "Canonical a otra URL: verificar consolidación"
                : "Sin inspección: estado en Google desconocido";
      return {
        url: p.url,
        sitemap: p.inSitemap,
        clics: clicks.get(p.url) ?? 0,
        estadoGoogle: i
          ? indexed
            ? "Indexada según inspección"
            : "No confirmada / excluida"
          : "Desconocido",
        motivo: reason,
        canonicalGoogle: i?.googleCanonical ?? null,
        inspeccion: i?.createdAt.toISOString() ?? null,
        ultimoRastreo: i?.lastCrawl?.toISOString() ?? null,
      };
    })
    .sort((a, b) => b.clics - a.clics);
  return {
    title: "Sitemap e indexación",
    source: "Crawl + Search Console URL Inspection",
    notes: [
      "Estar en el sitemap no prueba indexación. Una inspección informa el estado almacenado por Google, no solicita indexar.",
      "Los lotes priorizan clics, luego impresiones; las inspecciones recientes se reutilizan y los errores por URL se registran.",
    ],
    rows,
  };
}
export function ecommerceAnalysis(pages: Page[]): Analysis {
  const rows: Row[] = [];
  const skus = group(
    pages.filter((p) => live(p) && json(p.commerce).sku),
    (p) => String(json(p.commerce).sku),
  );
  for (const p of pages.filter(live)) {
    const c = json(p.commerce);
    if (
      p.template === "product" &&
      indexable(p) &&
      /OutOfStock|SoldOut|Discontinued/i.test(c.availability ?? "")
    )
      rows.push({
        url: p.url,
        tipo: "Producto sin stock indexable",
        evidencia: String(c.availability),
        accion:
          "Verificar reposición; conservar ficha útil, alternativas y disponibilidad coherente",
      });
    if (p.template === "category" && indexable(p) && !p.mainHash)
      rows.push({
        url: p.url,
        tipo: "Categoría sin texto propio detectado",
        accion: "Comprobar contenido útil y diferenciado; evitar relleno",
      });
    if (p.template === "filter" && indexable(p))
      rows.push({
        url: p.url,
        tipo: "Faceta indexable",
        accion:
          "Verificar demanda e intención; controlar enlaces y canonical si duplica la categoría",
      });
  }
  for (const [sku, ps] of skus)
    if (ps.filter(indexable).length > 1)
      for (const p of ps.filter(indexable))
        rows.push({
          url: p.url,
          tipo: "Variantes con SKU compartido: posible canibalización",
          sku,
          variantes: ps.length,
          accion: "Comprobar intención por variante y estrategia de canonical",
        });
  return {
    title: "Ecommerce",
    source: "HTML, Product/Offer y canonical del crawl",
    notes: [
      "Sin stock no es por sí solo un error SEO. Las variantes se muestran como hipótesis, nunca se desindexan automáticamente.",
    ],
    rows,
  };
}
export function structuredAnalysis(pages: Page[]): Analysis {
  const rows: Row[] = [];
  for (const p of pages.filter(live)) {
    if (p.jsonldErrors)
      rows.push({
        url: p.url,
        tipo: "JSON-LD inválido",
        detalle: `${p.jsonldErrors} bloques no se pudieron parsear`,
      });
    for (const detail of p.schemaIssues)
      rows.push({
        url: p.url,
        tipo: "Diferencia frente a lo visible",
        detalle: detail,
      });
    const s = json(p.structured);
    for (const e of [
      ...(s.jsonld ?? []),
      ...(s.microdata ?? []),
      ...(s.rdfa ?? []),
    ]) {
      const props = json(e.props),
        missing: string[] = [];
      if (e.type === "Product") {
        if (!props.name) missing.push("name");
        if (!props.offers) missing.push("offers");
        if (!props.image) missing.push("image");
      }
      if (e.type === "Offer") {
        for (const k of ["price", "priceCurrency", "availability"])
          if (props[k] == null) missing.push(k);
      }
      if (e.type === "BreadcrumbList") {
        const items = props.itemListElement == null ? [] : [props.itemListElement].flat();
        if (!items.length) missing.push("itemListElement");
        else if (
          items.some(
            (x: any, i: number) => Number(x.position) !== i + 1 || !(x.name ?? x.item?.name),
          )
        )
          missing.push("posiciones consecutivas y nombres");
      }
      if (e.type === "FAQPage") {
        const questions = props.mainEntity == null ? [] : [props.mainEntity].flat();
        if (!questions.length) missing.push("mainEntity");
        else
          for (const q of questions)
            if (!q.name || !q.acceptedAnswer?.text)
              missing.push("pregunta y acceptedAnswer.text");
      }
      if (missing.length)
        rows.push({
          url: p.url,
          tipo: e.type,
          formato: e.format,
          detalle: `Falta / revisar: ${[...new Set(missing)].join(", ")}`,
        });
    }
  }
  return {
    title: "Datos estructurados",
    source: "JSON-LD, microdatos y RDFa del crawl",
    notes: [
      "Validación local de los campos analizados; no sustituye Rich Results Test ni garantiza resultados enriquecidos.",
      "FAQ solo es elegible para resultados enriquecidos en sitios de salud o gobierno reconocidos.",
    ],
    rows,
  };
}
export function perfAnalysis(pages: Page[], results: PsiResult[]): Analysis {
  const by = new Map<string, PsiResult>();
  for (const r of results) {
    const k = r.url + "|" + r.strategy;
    if (!by.has(k) || by.get(k)!.createdAt < r.createdAt) by.set(k, r);
  }
  const rows: Row[] = [...by.values()].map((r) => {
    const field = json(r.field),
      lab = json(r.lab),
      p = pages.find((p) => p.url === r.url);
    return {
      url: r.url,
      plantilla: p?.template ?? "desconocida",
      dispositivo: r.strategy,
      fuente:
        field.source === "url"
          ? "CrUX URL (p75)"
          : field.source === "origin"
            ? "CrUX origen (no atribuible a plantilla)"
            : "Solo laboratorio",
      lcpCampo: field.lcp?.p75 ?? null,
      inpCampo: field.inp?.p75 ?? null,
      clsCampo: fieldCls(field),
      estadoLcp: vitalStatus("lcp", field.lcp?.p75 ?? null),
      estadoInp: vitalStatus("inp", field.inp?.p75 ?? null),
      estadoCls: vitalStatus("cls", fieldCls(field)),
      lcpLaboratorio: lab.lcp ?? null,
      tbtLaboratorio: lab.tbt ?? null,
      fecha: r.createdAt.toISOString(),
    };
  });
  return {
    title: "Rendimiento por plantilla",
    source: "PageSpeed Insights / CrUX",
    notes: [
      "CrUX es una ventana móvil de 28 días, con datos solo cuando hay muestra suficiente. No se transforma TBT en INP.",
      "Cada fila conserva su URL y fuente: una medición de origen no se atribuye a una plantilla.",
    ],
    rows,
  };
}
export function serpAnalysis(snaps: SerpSnapshot[]): Analysis {
  const groups = group(snaps, (s) => s.keyword),
    rows: Row[] = [];
  for (const [keyword, ss] of groups) {
    ss.sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
    const cur = ss[0],
      prev = ss[1];
    rows.push({
      keyword,
      features: cur.features.join(", "),
      snippet: cur.features.includes("snippet"),
      cambioSnippet: prev
        ? cur.features.includes("snippet") === prev.features.includes("snippet")
          ? "Sin cambio"
          : cur.features.includes("snippet")
            ? "Apareció"
            : "Desapareció"
        : "Sin observación anterior",
      fecha: cur.fetchedAt.toISOString(),
      comparadoCon: prev?.fetchedAt.toISOString() ?? null,
    });
  }
  return {
    title: "Tipos de resultado y featured snippets",
    source: "Snapshots SERP existentes",
    notes: [
      "La presencia de un featured snippet no significa que lo posea el proyecto. Los cambios comparan observaciones, no todas las SERP del intervalo.",
    ],
    rows,
  };
}
/** Reparte solo el ingreso de cada landing/día entre sus consultas observadas; no inventa ingreso por consulta. */
export function revenueByQuery(
  gsc: Pick<GscRow, "date" | "page" | "query" | "clicks">[],
  ga4: Pick<Ga4Row, "date" | "landing" | "revenue" | "sessions">[],
) {
  const day = (d: Date) => d.toISOString().slice(0, 10),
    buckets = group(gsc, (r) => day(r.date) + "|" + pathOf(r.page));
  const totals = new Map<string, { revenue: number; clicks: number }>();
  let unallocated = 0;
  for (const a of ga4) {
    const rs = buckets.get(day(a.date) + "|" + pathOf(a.landing)) ?? [],
      clicks = rs.reduce((s, r) => s + r.clicks, 0);
    if (!clicks) {
      unallocated += a.revenue;
      continue;
    }
    for (const r of rs) {
      const e = totals.get(r.query) ?? { revenue: 0, clicks: 0 };
      e.revenue += (a.revenue * r.clicks) / clicks;
      e.clicks += r.clicks;
      totals.set(r.query, e);
    }
  }
  return {
    rows: [...totals]
      .map(([query, t]) => ({
        consulta: query,
        ingresoEstimado: Math.round(t.revenue * 100) / 100,
        clics: t.clicks,
      }))
      .sort((a, b) => b.ingresoEstimado - a.ingresoEstimado),
    unallocated,
  };
}
export function forecast(days: { date: string; clicks: number }[]) {
  const sorted = [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-28);
  const valid =
    sorted.length === 28 &&
    sorted.every(
      (d, i) =>
        i === 0 ||
        new Date(d.date).getTime() - new Date(sorted[i - 1].date).getTime() ===
          864e5,
    );
  if (!valid) return null;
  const recent = sorted.slice(-14),
    prev = sorted.slice(-28, -14),
    mean = recent.reduce((s, d) => s + d.clicks, 0) / 14,
    previous = prev.reduce((s, d) => s + d.clicks, 0) / 14;
  const trend = Math.max(0.5, Math.min(1.5, previous ? mean / previous : 1));
  return {
    next28Days: Math.round(mean * 28 * trend),
    low: Math.round(mean * 28 * 0.5),
    high: Math.round(mean * 28 * 1.5),
    method:
      "Extrapolación de 14 días con tendencia acotada; rango orientativo, sin intervalo estadístico",
  };
}
