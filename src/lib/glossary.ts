export const GLOSSARY: Record<string, string> = {
  CLS: "Desplazamiento inesperado del contenido: hasta 0,1 es bueno; más de 0,25 requiere revisión.",
  sitemap: "Archivo con URLs propuestas a Google. Facilita descubrirlas, sin garantizar indexación.",
  "robots.txt": "Reglas de acceso para rastreadores. Bloquear el rastreo no equivale a excluir del índice.",
  huérfana: "Página del sitemap sin enlaces internos encontrados en un análisis completo.",
  canonical:
    "URL preferida de una página. Ayuda a Google a agrupar duplicados; es una señal, no una orden de indexación.",
  CTR: "Porcentaje de impresiones que terminan en clic: clics ÷ impresiones × 100. Compáralo entre consultas y posiciones similares.",
  LCP: "Tiempo hasta que aparece el elemento principal de la página. Un LCP de 2,5 segundos o menos es bueno; prioriza datos de usuarios reales.",
  H1: "Encabezado principal visible de la página. Debe explicar con claridad el tema de esa URL.",
  H2: "Encabezado que organiza una sección del contenido; los H3 subdividen esa sección.",
  SERP: "Página de resultados de Google para una consulta. Los resultados cambian según fecha, país y dispositivo.",
  cluster:
    "Grupo de keywords que pueden responderse con una misma página. Compartir resultados de Google es una señal de intención común.",
  canibalización:
    "Dos o más URLs propias compiten por la misma intención. Confirma que no sea una aparición legítima antes de consolidar.",
  impresiones:
    "Veces que una página aparece en los resultados de Google. Una impresión no equivale a una visita.",
  noindex:
    "Instrucción para que Google no incluya una página en su índice. Es habitual en páginas privadas o sin valor de búsqueda.",
};
