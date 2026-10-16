export type View = "guided" | "technical";
const labels: Record<string, string> = {
  url: "Página",
  estado: "Estado",
  plantilla: "Tipo de página",
  redirecciones: "Saltos de redirección",
  final: "Destino final",
  robots: "Bloqueada por robots.txt",
  noindex: "Excluida por noindex",
  respuestaMs: "Respuesta del servidor (ms)",
  recortada: "Respuesta recortada",
  soft404: "Posible página inexistente",
  paginas: "Páginas",
  indexables: "Técnicamente indexables",
  profundidadMedia: "Distancia media desde el inicio",
  palabrasMedianas: "Mediana de palabras",
  similarA: "Página similar",
  tipo: "Hallazgo",
  detalle: "Detalle",
  sitemap: "En sitemap",
  clics: "Clics desde Google",
  estadoGoogle: "Estado informado por Google",
  motivo: "Motivo o dato pendiente",
  canonicalGoogle: "Versión principal elegida por Google",
  inspeccion: "Fecha de inspección",
  ultimoRastreo: "Último rastreo de Google",
  desde: "Página de origen",
  anchor: "Texto del enlace",
  profundidad: "Distancia desde el inicio",
  entrantes: "Enlaces internos recibidos",
  verificacion: "Cómo comprobarlo",
  accion: "Qué hacer",
  evidencia: "Dato observado",
  dispositivo: "Dispositivo",
  fuente: "Fuente de la medición",
  lcpCampo: "LCP de campo (ms)",
  inpCampo: "INP de campo (ms)",
  clsCampo: "CLS de campo (sin unidad)",
  estadoLcp: "Carga visible",
  estadoInp: "Respuesta a interacciones",
  estadoCls: "Estabilidad visual",
  lcpLaboratorio: "LCP de laboratorio (ms)",
  tbtLaboratorio: "Bloqueo de laboratorio (ms)",
  fecha: "Fecha",
  keyword: "Búsqueda",
  features: "Tipos de resultado",
  snippet: "Respuesta destacada presente",
  cambioSnippet: "Cambio de respuesta destacada",
  comparadoCon: "Observación anterior",
  cluster: "Grupo de búsquedas",
  intencion: "Intención de búsqueda",
  volumen: "Búsquedas mensuales estimadas",
  consultas: "Consultas del grupo",
  secciones: "Contenido del brief",
  consulta: "Consulta de Google",
  ingresoEstimado: "Ingreso estimado (moneda del informe)",
  tarea: "Tarea",
  vence: "Fecha límite",
  responsable: "Responsable",
  prioridad: "Prioridad",
  archivo: "Archivo",
  lineas: "Líneas",
  validas: "Líneas reconocidas",
  invalidas: "Líneas no reconocidas",
  desperdicioBot: "Peticiones de bots a revisar",
  identidadBot: "Identificación del bot",
  posicion: "Posición observada",
  encontrado: "Sitio citado",
  motor: "Motor de IA",
  citados: "Dominios citados",
  peticiones: "Peticiones",
  errores: "Errores",
  destino: "Destino esperado",
  correcta: "Comprobación correcta",
};
export function columnLabel(key: string) {
  return (
    labels[key] ??
    key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (s) => s.toUpperCase())
  );
}
const preferred: Record<string, string[]> = {
  crawl: ["url", "estado", "robots", "noindex", "soft404"],
  templates: ["plantilla", "paginas", "indexables", "tipo", "url", "similarA"],
  structure: ["url", "tipo", "detalle"],
  index: ["url", "estadoGoogle", "motivo", "clics"],
  arch: ["url", "tipo", "desde", "anchor", "profundidad"],
  perf: ["url", "plantilla", "lcpCampo", "inpCampo", "clsCampo", "fuente"],
  shop: ["url", "tipo", "accion", "evidencia"],
  serp: ["keyword", "features", "cambioSnippet", "fecha"],
  content: ["tipo", "cluster", "keyword", "url", "fecha", "accion"],
  analytics: ["consulta", "ingresoEstimado", "clics"],
  ops: ["tipo", "tarea", "vence", "responsable", "estado"],
  advanced: ["tipo", "url", "archivo", "detalle", "fecha", "posicion"],
};
export function visibleColumns(kind: string, keys: string[], view: View) {
  const all = keys.filter((k) => k !== "id" && k !== "clusterId");
  if (view === "technical") return all;
  const useful = (preferred[kind] ?? all.slice(0, 6)).filter((k) =>
    all.includes(k),
  );
  return useful.length ? useful : all.slice(0, 6);
}
export function displayValue(key: string, value: unknown) {
  if (value == null) return "Sin datos";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  const values: Record<string, string> = {
    product: "Ficha de producto",
    category: "Categoría",
    article: "Artículo",
    home: "Inicio",
    filter: "Filtro",
    pagination: "Paginación",
    search: "Búsqueda interna",
    legal: "Información legal",
    other: "Otra página",
    mobile: "Móvil",
    desktop: "Escritorio",
    detected: "Detectado",
    pending: "En progreso",
    resolved: "Solucionado",
    reappeared: "Reapareció",
    ignored: "Ignorado",
  };
  if (
    ["plantilla", "dispositivo", "estado"].includes(key) &&
    values[String(value)]
  )
    return values[String(value)];
  if (key === "features") {
    const f: Record<string, string> = {
      ads: "Anuncios",
      related: "Búsquedas relacionadas",
      paa: "Otras preguntas",
      videos: "Vídeos",
      shopping: "Productos",
      snippet: "Respuesta destacada",
      ai_overview: "Resumen con IA",
      knowledge: "Panel informativo",
      local: "Resultados locales",
    };
    return (
      String(value)
        .split(/,\s*/)
        .map((s) => f[s] ?? s)
        .join(", ") || "Ninguno observado"
    );
  }
  if (
    ["fecha", "inspeccion", "ultimoRastreo", "comparadoCon", "vence"].includes(
      key,
    ) &&
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}/.test(value)
  )
    return value.slice(0, 10);
  return typeof value === "number"
    ? new Intl.NumberFormat("es-CL", {
        maximumFractionDigits: key === "clsCampo" ? 3 : 2,
      }).format(value)
    : String(value);
}
export const MODULE_HELP: Record<
  string,
  { purpose: string; empty: string; href: string }
> = {
  crawl: {
    purpose:
      "Comprueba si las páginas se pueden abrir y rastrear. Los detalles técnicos explican cada respuesta.",
    empty:
      "Primero ejecuta una auditoría. Una tabla vacía no demuestra que el sitio esté libre de problemas.",
    href: "audit",
  },
  templates: {
    purpose:
      "Revisa grupos de páginas y contenido similar antes de decidir consolidaciones.",
    empty:
      "Revisa el sitio para detectar plantillas. Sin duplicados detectados no se descartan similitudes fuera de la muestra.",
    href: "audit",
  },
  structure: {
    purpose:
      "Comprueba que los datos para buscadores coincidan con la información de la página.",
    empty:
      "No hay incidencias en los campos analizados, o falta una auditoría. Esto no certifica elegibilidad en Google.",
    href: "audit",
  },
  index: {
    purpose:
      "Distingue páginas rastreadas, incluidas en sitemap e inspeccionadas por Google: son estados distintos.",
    empty:
      "Ejecuta una auditoría y conecta Search Console. Sin inspección no se conoce el estado de Google.",
    href: "gsc",
  },
  arch: {
    purpose:
      "Ayuda a encontrar páginas útiles y a entender qué enlaces faltan o son poco claros.",
    empty:
      "No hay propuestas con la muestra actual. Revisa el alcance del crawl antes de concluir que no faltan enlaces.",
    href: "audit",
  },
  perf: {
    purpose:
      "LCP mide carga visible; INP, respuesta a interacciones; CLS, movimientos inesperados. La fuente determina qué se puede concluir.",
    empty:
      "Mide una URL por plantilla con el botón de esta vista. Sin mediciones no hay un diagnóstico de velocidad.",
    href: "audit",
  },
  shop: {
    purpose:
      "Revisa fichas, categorías y variantes sin desindexar automáticamente productos agotados o filtros.",
    empty:
      "No se detectaron incidencias de ecommerce en la muestra. Comprueba que se rastrearon fichas y categorías.",
    href: "audit",
  },
  serp: {
    purpose:
      "Muestra qué tipos de resultado aparecen y cómo cambiaron entre observaciones.",
    empty:
      "Investiga o sigue búsquedas para guardar resultados de Google. Sin snapshots no hay comparación.",
    href: "rank",
  },
  content: {
    purpose:
      "Planifica una página por intención, actualiza contenido con evidencia y conserva el calendario.",
    empty:
      "Investiga búsquedas y agrúpalas o sincroniza Search Console para detectar contenido que necesita revisión.",
    href: "keywords",
  },
  analytics: {
    purpose:
      "Relaciona tráfico y resultados del negocio. El ingreso por consulta es una estimación, no una venta atribuida por Google.",
    empty:
      "Conecta Analytics y Search Console y sincroniza fechas coincidentes. No se estiman ingresos con datos faltantes.",
    href: "results",
  },
  advanced: {
    purpose:
      "Contrasta cambios, registros del servidor y presencia local con sus fuentes y fechas.",
    empty:
      "Importa registros, configura competencia o conecta la fuente que quieras revisar. No se han medido estas fuentes todavía.",
    href: "settings",
  },
  ops: {
    purpose:
      "Convierte los hallazgos en tareas comprobables y conserva responsables y estados.",
    empty:
      "No hay tareas pendientes para hoy. Revisa el alcance de la auditoría y las tareas futuras.",
    href: "tasks",
  },
};
