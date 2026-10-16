/** Recomendaciones deterministas: la IA solo puede explicar estas acciones y citar su evidencia. */
export type SiteType =
  | "auto"
  | "ecommerce"
  | "services"
  | "content"
  | "general";
export type Goal = "sales" | "leads" | "readers" | "visibility";
export type Profile = { siteType: SiteType; goal: Goal; aiEnabled: boolean };
export type Evidence = {
  id: string;
  url: string | null;
  source: string;
  at: string;
  observation: string;
};
export type Action = {
  id: string;
  title: string;
  priority: "Alta" | "Media" | "Baja";
  confidence: "observado" | "hipótesis" | "revisión manual";
  why: string;
  steps: string[];
  verify: string;
  href: string;
  taskId?: string;
  affected: number;
  evidence: Evidence[];
  ai?: {
    explanation: string;
    steps: string[];
    verify: string;
    evidenceIds: string[];
  };
};
export type Check = {
  key: string;
  title: string;
  status: "available" | "missing" | "review";
  detail: string;
  href: string;
};
export type Plan = {
  version: string;
  profile: Profile;
  effectiveType: Exclude<SiteType, "auto">;
  goalLabel: string;
  actions: Action[];
  checks: Check[];
  coverage: {
    crawlAt: string | null;
    pages: number;
    partial: boolean;
    gsc: boolean;
    analytics: boolean;
    performance: boolean;
  };
  notes: string[];
};
export type AdvicePage = {
  url: string;
  template: string | null;
  status: number;
  noindex: boolean;
  blocked: boolean;
  error: string | null;
  title: string | null;
  h1: string[];
  canonicalType: string | null;
  commerce: unknown;
  structured: unknown;
  wordCount: number;
  inlinks: number;
};
export type AdviceTask = {
  id: string;
  title: string;
  code: string | null;
  reason: string;
  source: string;
  severity: string;
  priority: number;
  status: string;
  url: string | null;
  lastSeenAt?: Date | string;
};
export type Input = {
  profile?: Partial<Profile>;
  pages: AdvicePage[];
  groups: {
    id: string;
    title: string;
    code: string | null;
    reason: string;
    fix: string;
    priorityLabel: string;
    priority: number;
    severity: string;
    affected: number;
    pattern: string | null;
    members: AdviceTask[];
  }[];
  crawlAt: string | null;
  partial: boolean;
  gsc: boolean;
  analytics: boolean;
  performance: boolean;
  period: string | null;
  taskSampleLimited?: boolean;
};
export const RULES_VERSION = "advice-2026-10-16-v1";
export const SITE_LABELS: Record<SiteType, string> = {
  auto: "Detectar según el sitio",
  ecommerce: "Tienda online",
  services: "Servicios o negocio local",
  content: "Blog, revista o sitio de contenidos",
  general: "Otro sitio web",
};
export const GOAL_LABELS: Record<Goal, string> = {
  sales: "Aumentar ventas orgánicas",
  leads: "Conseguir consultas o contactos",
  readers: "Atraer lectores relevantes",
  visibility: "Mejorar presencia en buscadores",
};
export function profileOf(raw: unknown): Profile {
  const p =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    siteType: ["auto", "ecommerce", "services", "content", "general"].includes(
      String(p.siteType),
    )
      ? (p.siteType as SiteType)
      : "auto",
    goal: ["sales", "leads", "readers", "visibility"].includes(String(p.goal))
      ? (p.goal as Goal)
      : "visibility",
    aiEnabled: p.aiEnabled !== false,
  };
}
const obj = (v: unknown): any => (v && typeof v === "object" ? v : {});
const plain: Record<
  string,
  { title: string; why: string; steps: string[]; verify: string }
> = {
  http_4xx: {
    title: "Recuperar las páginas que ya no abren",
    why: "Un enlace lleva a una respuesta de error. Puede impedir que una persona o Google acceda al contenido.",
    steps: [
      "Comprueba si la página debería seguir existiendo.",
      "Si tiene reemplazo equivalente, corrige los enlaces y configura una redirección directa. Si se eliminó sin reemplazo, conserva un 404/410 correcto.",
    ],
    verify:
      "Repite la auditoría: la página útil debe responder correctamente y los enlaces deben llegar al destino esperado.",
  },
  http_5xx: {
    title: "Corregir errores del servidor",
    why: "El servidor no pudo entregar estas páginas durante la revisión.",
    steps: [
      "Entrega las URLs y su fecha de revisión a quien administra el sitio.",
      "Revisa registros, recursos y cambios recientes; confirma si el error persiste.",
    ],
    verify:
      "Vuelve a consultar las páginas y repite la auditoría; confirma que devuelven contenido y HTTP 200.",
  },
  canonical_bad_target: {
    title: "Corregir la página principal de las versiones duplicadas",
    why: "La dirección declarada como versión principal apunta a un destino con problemas.",
    steps: [
      "Revisa qué versión debe aparecer en buscadores.",
      "Ajusta la etiqueta canonical para apuntar a una página válida, sin errores ni otra consolidación inesperada.",
    ],
    verify:
      "Repite el crawl y comprueba el destino y el canonical en la inspección de Search Console.",
  },
  soft_404: {
    title: "Comprobar páginas que parecen eliminadas",
    why: "Se detectó una respuesta correcta de servidor con texto de página no encontrada. Es una hipótesis que requiere comprobación.",
    steps: [
      "Abre la URL y confirma si existe contenido útil.",
      "Si no existe, entrega el estado HTTP apropiado; si existe, corrige el mensaje o la plantilla.",
    ],
    verify: "Contrasta el contenido, el estado HTTP y la inspección de Google.",
  },
  product_out_of_stock: {
    title: "Revisar productos sin stock que pueden aparecer en Google",
    why: "Un producto agotado puede seguir siendo útil. Lo importante es informar disponibilidad real y ofrecer una alternativa.",
    steps: [
      "Confirma si volverá a estar disponible y muestra su estado con claridad.",
      "Mantén coherentes precio y stock en la ficha y sus datos estructurados; ofrece alternativas pertinentes.",
    ],
    verify:
      "Comprueba ficha y Offer. No elimines ni desindexes productos automáticamente solo por falta temporal de stock.",
  },
  category_no_main: {
    title: "Ayudar a elegir en las categorías de la tienda",
    why: "No se detectó texto propio fuera de menús y tarjetas. Puede ser suficiente, pero conviene revisar si faltan criterios de elección.",
    steps: [
      "Comprueba la categoría y su intención de búsqueda.",
      "Añade orientación útil sobre diferencias, compatibilidad o selección cuando aporte valor; evita relleno.",
    ],
    verify:
      "Confirma que la ayuda es visible y propia de esa categoría. Si usa JavaScript, contrasta con un crawl renderizado.",
  },
  jsonld_mismatch: {
    title: "Hacer coincidir la información de producto con lo visible",
    why: "La auditoría encontró diferencias entre los datos que leen los buscadores y la página.",
    steps: [
      "Revisa el dato señalado: precio, stock, reseñas u otro atributo.",
      "Genera ambas versiones desde la misma fuente de datos y comprueba posibles cachés antiguas.",
    ],
    verify:
      "Repite la auditoría y prueba la URL en la herramienta de resultados enriquecidos de Google.",
  },
  orphan: {
    title: "Facilitar el acceso a páginas sin enlaces encontrados",
    why: "Se encontró la URL en el sitemap, pero no un camino mediante los enlaces revisados. La cobertura del crawl puede ser incompleta.",
    steps: [
      "Comprueba si existe un enlace visible y rastreable hacia la página.",
      "Si falta y la página es útil, enlázala desde una categoría o contenido relacionado.",
    ],
    verify:
      "Repite el rastreo con cobertura suficiente; revisa los enlaces generados con JavaScript antes de confirmar que es huérfana.",
  },
};
export function buildPlan(input: Input): Plan {
  const profile = profileOf(input.profile),
    live = input.pages.filter(
      (p) => p.status === 200 && !p.blocked && !p.error,
    ),
    products = live.filter((p) => p.template === "product"),
    articles = live.filter((p) => p.template === "article");
  const effectiveType =
    profile.siteType !== "auto"
      ? profile.siteType
      : products.length
        ? "ecommerce"
        : articles.length && articles.length >= live.length / 2
          ? "content"
          : "general";
  const actions: Action[] = input.groups
    .filter((g) =>
      g.members.some((t) => !["resolved", "ignored"].includes(t.status)),
    )
    .sort(
      (a, b) =>
        (({ critical: 3, warning: 2, info: 1 })[b.severity] ?? 1) -
          ({ critical: 3, warning: 2, info: 1 }[a.severity] ?? 1) ||
        b.priority - a.priority,
    )
    .slice(0, 20)
    .map((g, i) => {
      const copy = plain[g.code ?? ""],
        id = `action-${i + 1}`;
      const confidence = [
        "soft_404",
        "orphan",
        "category_no_main",
        "main_duplicate",
      ].includes(g.code ?? "")
        ? "hipótesis"
        : g.members.every((t) => t.source === "manual")
          ? "revisión manual"
          : "observado";
      return {
        id,
        title: copy?.title ?? g.title,
        priority:
          g.priorityLabel === "Alta"
            ? "Alta"
            : g.priorityLabel === "Media"
              ? "Media"
              : "Baja",
        confidence,
        why: copy?.why ?? g.reason,
        steps: copy?.steps ?? [
          g.fix ||
            "Abre el detalle de la tarea y contrasta la evidencia antes de aplicar un cambio.",
        ],
        verify:
          copy?.verify ??
          "Comprueba las URLs afectadas y ejecuta una nueva revisión; no marques una corrección solo por haberla planificado.",
        href: `tasks?task=${encodeURIComponent(g.id)}`,
        taskId: g.id,
        affected: g.affected,
        evidence: g.members
          .filter((t) => !["resolved", "ignored"].includes(t.status))
          .slice(0, 3)
          .map((t, j) => ({
            id: `${id}-e${j + 1}`,
            url: t.url,
            source:
              t.source === "crawl"
                ? "Auditoría del sitio"
                : "Tarea del proyecto",
            at: t.lastSeenAt
              ? new Date(t.lastSeenAt).toISOString()
              : t.source === "crawl"
                ? (input.crawlAt ?? "")
                : "",
            observation: t.reason.slice(0, 700),
          })),
      };
    });
  const checks: Check[] = [
    {
      key: "crawl",
      title: "Acceso e indexación técnica",
      status: input.crawlAt
        ? input.partial
          ? "review"
          : "available"
        : "missing",
      detail: input.crawlAt
        ? `${input.pages.length} ${input.pages.length === 1 ? "página revisada" : "páginas revisadas"}${input.partial ? "; cobertura parcial: no confirma todo el sitio" : ""}. Un crawl no prueba que Google haya indexado las páginas.`
        : "Primero revisa el sitio para obtener evidencia real; no hay una auditoría terminada.",
      href: "audit",
    },
    {
      key: "gsc",
      title: "Lo que la gente busca y ve en Google",
      status: input.gsc ? "available" : "missing",
      detail: input.gsc
        ? `Search Console con datos${input.period ? ` de ${input.period}` : ""}.`
        : "Conecta y sincroniza Search Console para priorizar con consultas, clics e impresiones.",
      href: "gsc",
    },
    {
      key: "performance",
      title: "Experiencia y velocidad",
      status: input.performance ? "available" : "missing",
      detail: input.performance
        ? "Hay mediciones de PageSpeed. En el detalle se distingue laboratorio y usuarios reales."
        : "Mide páginas representativas; sin datos de campo no se puede afirmar cómo viven la experiencia los usuarios.",
      href: "pro?tab=perf",
    },
    {
      key: "analytics",
      title:
        effectiveType === "ecommerce"
          ? "Ventas del tráfico orgánico"
          : profile.goal === "leads" || effectiveType === "services"
            ? "Contactos y conversiones orgánicas"
            : "Conversiones y resultados",
      status: input.analytics ? "available" : "missing",
      detail: input.analytics
        ? "Hay datos de Analytics. Comprueba que las compras o eventos clave y la moneda se midan correctamente."
        : "Conecta Analytics y verifica compras o eventos clave para evaluar resultados del negocio, además de posiciones.",
      href: "results",
    },
    {
      key: "content",
      title: "Contenido y enlaces útiles",
      status: input.crawlAt ? "review" : "missing",
      detail:
        "Revisa si cada página responde a una intención y si los enlaces ayudan a encontrar lo que sigue. Ninguna cantidad fija de palabras demuestra calidad.",
      href: "content",
    },
  ];
  if (effectiveType === "ecommerce") {
    const entities = products.flatMap((p) => {
      const s = obj(p.structured);
      return [...(s.jsonld ?? []), ...(s.microdata ?? []), ...(s.rdfa ?? [])];
    });
    const hasOffer = entities.some(
      (e) => e.type === "Offer" || obj(e.props).offers,
    );
    checks.push(
      {
        key: "products",
        title: "Fichas de producto y disponibilidad",
        status: products.length
          ? hasOffer
            ? "available"
            : "review"
          : "missing",
        detail: products.length
          ? `${products.length} ${products.length === 1 ? "ficha detectada" : "fichas detectadas"}. Revisa precio, moneda, disponibilidad, imágenes y variantes contra lo que ve el comprador.`
          : "No se identificaron fichas en la muestra. Añade productos al alcance antes de concluir que la tienda está cubierta.",
        href: "pro?tab=shop",
      },
      {
        key: "commerce-journey",
        title: "Categorías, filtros y variantes",
        status: input.crawlAt ? "review" : "missing",
        detail:
          "Comprueba categorías rastreables, variantes y facetas según su demanda. Un filtro o un producto agotado no se debe desindexar por defecto.",
        href: "pro?tab=arch",
      },
      {
        key: "trust",
        title: "Envíos, devoluciones y confianza",
        status: "review",
        detail:
          "Revisión manual: comprueba plazos, costos de envío, devoluciones, contacto y políticas visibles. El marcado no prueba que se cumplan.",
        href: "pro?tab=structured",
      },
    );
  } else if (effectiveType === "services")
    checks.push({
      key: "leads",
      title: "Servicios, zonas de atención y contacto",
      status: "review",
      detail:
        "Revisión manual: explica qué servicio ofreces, dónde atiendes y cómo contactar. Prueba el formulario y mide su envío como evento clave, sin crear páginas locales vacías.",
      href: "results",
    });
  else if (effectiveType === "content")
    checks.push({
      key: "editorial",
      title: "Autoría, fuentes y vigencia",
      status: "review",
      detail:
        "Revisión editorial: comprueba quién escribe, fuentes, actualización real y utilidad. Cambiar una fecha o añadir texto no demuestra una mejora.",
      href: "pro?tab=content",
    });
  return {
    version: RULES_VERSION,
    profile,
    effectiveType,
    goalLabel: GOAL_LABELS[profile.goal],
    actions,
    checks,
    coverage: {
      crawlAt: input.crawlAt,
      pages: input.pages.length,
      partial: input.partial,
      gsc: input.gsc,
      analytics: input.analytics,
      performance: input.performance,
    },
    notes: [
      "Las prioridades son recomendaciones; no garantizan posiciones, indexación ni ventas.",
      ...(input.partial
        ? [
            "Una auditoría parcial no permite confirmar páginas huérfanas ni dar por resueltas URLs que no se revisaron.",
          ]
        : []),
      ...(input.taskSampleLimited
        ? [
            "La lista utiliza una muestra de tareas. Consulta Tareas para revisar el detalle completo.",
          ]
        : []),
    ],
  };
}
