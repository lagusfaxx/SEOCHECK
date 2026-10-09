export const SEVERITY_LABEL: Record<string, string> = {
  critical: "Error",
  warning: "Advertencia",
  info: "Observación",
};
export const SEVERITY_TEXT: Record<string, string> = {
  critical: "text-rose-700 dark:text-rose-300",
  warning: "text-amber-700 dark:text-amber-300",
  info: "text-ink-500",
};
export const HEALTH_HELP =
  "Salud técnica = 100 − 10 × (5 × errores + advertencias) / URLs analizadas, redondeada y con mínimo 0. Las observaciones no descuentan puntos: puedes tener 98/100 y muchas sugerencias. No mide todo el SEO ni garantiza posiciones. Un análisis parcial solo describe las URLs leídas.";
export const healthLabel = (v: number | null | undefined) =>
  v == null
    ? "Sin datos suficientes"
    : v >= 90
      ? "Excelente"
      : v >= 75
        ? "Bueno"
        : v >= 50
          ? "Necesita atención"
          : "Requiere correcciones";
export const METRIC_HELP: Record<string, string> = {
  URL: "Dirección de la página. En Auditoría permite revisar sus problemas; en Rankings identifica qué página aparece en Google.",
  Estado:
    "Respuesta HTTP de la página: 200 indica que respondió; 3xx redirige; 4xx o 5xx indica un error. Un error puede impedir que Google acceda al contenido.",
  Problemas:
    "Incidencias detectadas en esta URL. Revisa su tipo: un error, una advertencia y una observación tienen distinta importancia.",
  Profundidad:
    "Número de enlaces desde la página de inicio. A más clics, más difícil puede ser descubrir la página; revisa las páginas importantes a más de tres niveles.",
  Entrantes:
    "Enlaces internos que apuntan a esta URL. Ayudan a descubrirla y entender su importancia; cero puede indicar una página aislada.",
  Salientes:
    "Enlaces que esta página dirige a otras URLs. Revisa los destinos rotos o innecesarios; tener muchos no es por sí solo un error.",
  Título:
    "Texto del elemento title, usado como referencia para el título en Google. Conviene que sea único y descriptivo; hasta unos 60 caracteres evita muchos cortes.",
  Meta: "Descripción que Google puede usar en el resultado. Una guía de hasta 155 caracteres ayuda a evitar cortes; no es un límite ni una penalización de Google.",
  Palabras:
    "Cantidad de palabras detectadas. Sirve para comparar páginas del mismo tipo; un número bajo no prueba que el contenido sea malo.",
  Respuesta:
    "Tiempo que tardó el servidor en devolver el HTML, en milisegundos. Menos de 500 ms suele ser adecuado; más de 1.500 ms merece revisión. No mide la carga visual completa.",
  Canonical:
    "URL que declaras como versión preferida de un contenido. Ayuda a consolidar duplicados; apuntar a otra página puede ser intencional.",
  Indexación:
    "Posibilidad de aparecer en Google. noindex pide excluir la página; puede ser correcto en páginas privadas. Poder indexarse no significa que Google ya la haya indexado.",
  noindex:
    "Instrucción que pide a Google excluir esta página del índice. Revisa si es intencional; úsala en contenido que no deba aparecer en búsquedas.",
  SERP: "Resultados de Google medidos para una keyword. Su composición depende de fecha, país y dispositivo; no es una recomendación generada.",
  Mejor:
    "Mejor posición registrada en el período seleccionado. Menor es mejor, pero puede ser una medición puntual.",
  Frecuencia:
    "Cada cuánto se mide el ranking. Diario detecta cambios antes y consume más mediciones que semanal.",
  "Img sin alt":
    "Imágenes sin descripción alternativa. El texto alternativo ayuda a accesibilidad y comprensión; las imágenes decorativas pueden llevar alt vacío intencionalmente.",
  hreflang:
    "Versiones por idioma o país de una página. Ayudan a Google a elegir la versión adecuada; las referencias deben ser recíprocas.",
  "JSON-LD":
    "Datos estructurados que describen el contenido. Pueden habilitar resultados enriquecidos, sin garantizarlos; los errores de formato impiden interpretarlos.",
  Redirecciones:
    "URLs que llevan a otra dirección mediante HTTP 3xx. Una redirección puede ser correcta; evita cadenas y enlaza directamente al destino final.",
  H1: "Encabezado principal visible de la página. Ayuda a entender su tema; procura que describa el contenido y no esté vacío.",
  LCP: "Tiempo hasta mostrar el contenido principal. Hasta 2,5 s es bueno; más de 4 s requiere atención. Distingue datos de usuarios reales y mediciones de laboratorio.",
  CLS: "Movimiento inesperado del contenido al cargar. Hasta 0,1 es bueno; más de 0,25 dificulta la lectura y los clics.",
  INP: "Tiempo de respuesta a una interacción de un usuario real. Hasta 200 ms es bueno; más de 500 ms merece revisión.",
  TBT: "Tiempo de bloqueo del navegador en laboratorio. Menos de 200 ms suele ser bueno; un valor alto puede indicar demasiado JavaScript.",
  CTR: "Porcentaje de impresiones que acaba en clic: clics / impresiones × 100. Compáralo con consultas y posiciones similares; un CTR bajo no siempre implica un problema.",
  Impresiones:
    "Veces que tu sitio apareció en resultados de Google. Miden visibilidad, no visitas; compáralas dentro del mismo período.",
  Clics:
    "Clics desde los resultados de Google hacia tu sitio. Compara períodos equivalentes para interpretar cambios.",
  Posición:
    "Lugar de tu URL en Google. Un número menor es mejor; en Search Console es un promedio que varía por consulta, país y dispositivo. Sin dato no equivale a posición cero.",
  Cambio:
    "Diferencia respecto a la medición anterior. Subir posiciones es mejorar aunque el número de posición baje. Sin dos mediciones no hay comparación.",
  Competencia:
    "Dominios o URLs que aparecen para la misma keyword en la SERP medida. Son competidores de búsqueda; no necesariamente competidores comerciales.",
  Sitemap:
    "Archivo con URLs que propones a Google para rastrear. Ayuda al descubrimiento, pero no garantiza indexación.",
  "robots.txt":
    "Archivo que indica qué rutas pueden rastrear los robots. Bloquear una ruta no garantiza que desaparezca de Google; conserva accesibles las páginas públicas importantes.",
  Huérfana:
    "URL del sitemap sin enlaces internos encontrados. Puede ser difícil de descubrir; un análisis parcial no permite confirmarlo.",
  "Salud técnica": HEALTH_HELP,
  Prioridad:
    "Orden de atención basado en severidad, URLs afectadas y señales de GSC o rankings disponibles. Alta requiere revisión antes que Media y Baja.",
  Intención:
    "Qué busca la persona: info (aprender), comercial (comparar opciones), transaccional (comprar o contratar) o navegacional (llegar a un sitio concreto).",
  Volumen:
    "Búsquedas mensuales promedio en Google para el país del proyecto. Un rango (ej. 1K–10K) indica que el proveedor solo entrega un tramo.",
  "Fuente del volumen":
    "De dónde viene el volumen: Google Ads (Keyword Planner o proveedor) o Search Console (impresiones reales de tu sitio).",
  CPC: "Costo por clic estimado en Google Ads, en dólares. Un CPC alto suele indicar que la búsqueda tiene valor comercial.",
  "Competencia Ads":
    "Competencia entre anunciantes en Google Ads, de 0 (baja) a 1 (alta). No mide lo difícil que es posicionar orgánicamente.",
  Dificultad:
    "Estimación de 0 a 100 de lo difícil que es entrar al top 10 orgánico. Verde: hasta 35; amarillo: hasta 60; rojo: más de 60.",
  Relevancia:
    "Similitud de la keyword con tus palabras iniciales. Sirve para filtrar ideas lejanas; no es una probabilidad de posicionar.",
  Oportunidad:
    "Puntaje para ordenar keywords: combina volumen, dificultad y relevancia. Más alto = conviene atacarla antes. Sin volumen no se calcula.",
  Fuente:
    "Cómo se encontró la keyword: tus palabras iniciales, autocompletado de Google, preguntas (PAA), búsquedas relacionadas o Search Console.",
  Afectadas:
    "URLs individuales incluidas en esta acción. Se agrupan por el mismo problema y patrón; abre la tarea para ver la evidencia por página.",
};
export function metricHelp(label: string) {
  return (
    METRIC_HELP[label] ??
    METRIC_HELP[label.replace(/ (lab|campo|28d|90d)$/, "")]
  );
}
