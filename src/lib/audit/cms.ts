/**
 * Detección del CMS / framework a partir del HTML, para decir DÓNDE se corrige una plantilla
 * ("en Shopify: tema → template de producto") en vez de una instrucción genérica.
 */
export type Cms = "wordpress" | "shopify" | "woocommerce" | "nextjs" | "nuxt" | "webflow" | "wix" | "squarespace" | "jumpseller" | "vtex" | "magento" | "prestashop" | "drupal" | "joomla" | "ghost";

export const CMS_LABEL: Record<Cms, string> = {
  wordpress: "WordPress", woocommerce: "WooCommerce (WordPress)", shopify: "Shopify", nextjs: "Next.js", nuxt: "Nuxt", webflow: "Webflow", wix: "Wix",
  squarespace: "Squarespace", jumpseller: "Jumpseller", vtex: "VTEX", magento: "Magento", prestashop: "PrestaShop", drupal: "Drupal", joomla: "Joomla", ghost: "Ghost",
};

/** Dónde se editan title/meta/H1 de una plantilla en cada plataforma. */
export const CMS_FIX_HINT: Record<Cms, string> = {
  wordpress: "En WordPress viene del tema o del plugin SEO (Yoast / Rank Math → Apariencia en el buscador / Títulos y metas, por tipo de contenido).",
  woocommerce: "En WooCommerce: plugin SEO (Yoast / Rank Math → plantilla de Productos o Categorías de producto) o el tema.",
  shopify: "En Shopify: Tienda online → Temas → Editar código (theme.liquid y los templates de producto/colección); el title/meta por defecto usa el nombre y la descripción del producto.",
  nextjs: "En Next.js: metadata / generateMetadata del layout o page de esa ruta (app router) o el <Head> de la página.",
  nuxt: "En Nuxt: useHead / useSeoMeta de la página o layout de esa ruta.",
  webflow: "En Webflow: SEO settings de la Collection page (campos dinámicos) o de la página estática.",
  wix: "En Wix: Marketing y SEO → Configuración de SEO → patrones por tipo de página.",
  squarespace: "En Squarespace: Marketing → SEO → formatos de título por tipo de página.",
  jumpseller: "En Jumpseller: Temas → Editar plantilla (product.liquid / category.liquid) o el SEO de cada producto/categoría.",
  vtex: "En VTEX: Site Editor / CMS del template de producto o categoría.",
  magento: "En Magento: Contenido → Configuración de diseño (meta por defecto) o la plantilla del tema.",
  prestashop: "En PrestaShop: Preferencias → Tráfico y SEO, o la plantilla del tema.",
  drupal: "En Drupal: módulo Metatag, patrones por tipo de contenido.",
  joomla: "En Joomla: configuración global de metadatos o el override de la plantilla.",
  ghost: "En Ghost: Settings → General / meta del post, o el tema (default.hbs).",
};

export function detectCms(html: string): Cms | null {
  const h = html.slice(0, 400_000);
  const gen = (/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)/i.exec(h) ?? /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']generator["']/i.exec(h))?.[1]?.toLowerCase() ?? "";
  const wp = gen.includes("wordpress") || /\/wp-(content|includes)\//.test(h);
  if (wp) return /woocommerce/i.test(gen) || /\/plugins\/woocommerce\/|class=["'][^"']*woocommerce/i.test(h) ? "woocommerce" : "wordpress";
  if (/cdn\.shopify\.com|Shopify\.theme|shopify-section/.test(h)) return "shopify";
  if (gen.includes("wix") || /static\.wixstatic\.com/.test(h)) return "wix";
  if (/data-wf-(site|page)=/.test(h) || gen.includes("webflow")) return "webflow";
  if (gen.includes("squarespace") || /static1\.squarespace\.com/.test(h)) return "squarespace";
  if (/jumpseller/i.test(gen) || /assets\.jumpseller\.com|jumpseller-/i.test(h)) return "jumpseller";
  if (/vtex(assets|img|commercestable)|vtex\.render/i.test(h)) return "vtex";
  if (gen.includes("prestashop") || /prestashop/i.test(h.slice(0, 50_000))) return "prestashop";
  if (/Magento_|mage\/cookies|x-magento/i.test(h)) return "magento";
  if (gen.includes("drupal") || /drupal-settings-json|\/sites\/default\/files\//.test(h)) return "drupal";
  if (gen.includes("joomla")) return "joomla";
  if (gen.includes("ghost")) return "ghost";
  if (/__NEXT_DATA__|\/_next\/static\//.test(h)) return "nextjs";
  if (/__NUXT__|\/_nuxt\//.test(h)) return "nuxt";
  return null;
}
