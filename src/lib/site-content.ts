/** Contenido del sitio público de Fullstack Ventures (fsvc.cl). Datos reales entregados por el equipo. */

export type Business = {
  name: string;
  /** archivo en /public/brand/clients; null = logo dibujado en código (Centinela) */
  logo: string | null;
  kind: string;
  text: string;
  tags: string;
  href?: string;
};

/** Construidos y operados por nuestro equipo. */
export const OWN_BUSINESSES: Business[] = [
  { name: "Nomadbrew", logo: "nomadbrew.png", kind: "Café portátil", tags: "Importación / E-commerce", text: "Llevamos a Chile las cafeteras portátiles Wacaco con compra directa a la marca, y las vendemos por Mercado Libre Full, tienda propia y venta directa." },
  { name: "Starseeker", logo: "starseeker.png", kind: "Máquinas de espresso compactas", tags: "Importación / Marca", text: "Negociamos directo con la fábrica en Guangzhou, sin intermediarios, y lanzamos la marca en Chile con tienda propia.", href: "https://starseeker.cl" },
  { name: "TAUPOC", logo: "taupoc.png", kind: "Natación de competencia", tags: "Importación / E-commerce", text: "Importamos trajes homologados por World Aquatics, armamos la tienda online y un equipo de nadadores federados como embajadores.", href: "https://taupoc.cl" },
  { name: "Uzeed", logo: "uzeed.png", kind: "Entretenimiento para adultos", tags: "Software / Infraestructura", text: "Desarrollamos la plataforma completa y su infraestructura: paneles por tipo de usuario, mapas, integración con Mercado Libre, streaming propio y app instalable.", href: "https://uzeed.cl" },
  { name: "Sin Tornillo", logo: "sintornillo.png", kind: "Productos en madera", tags: "Diseño / Fabricación", text: "Diseñamos y fabricamos en Chile productos de madera que se arman sin tornillos.", href: "https://sintornillo.cl" },
  { name: "La Frida", logo: "la-frida.png", kind: "Gastronomía", tags: "Constitución / Operación", text: "Constituimos la sociedad y pusimos en marcha un negocio de comida mexicana." },
  { name: "ANDES Technologies", logo: "andes-technologies.png", kind: "Proveedor del Estado", tags: "Security / Compras públicas", text: "Ciberseguridad, productos tecnológicos y retail para instituciones públicas, con licitaciones municipales adjudicadas." },
  { name: "Centinela", logo: null, kind: "Seguridad ofensiva", tags: "Security / SaaS", text: "Desarrollamos nuestra propia plataforma de pruebas de seguridad, con control de alcance y autorización, usada en licitaciones municipales." },
  { name: "Rent A Hacker", logo: "rent-a-hacker.png", kind: "Ciberseguridad para empresas", tags: "Security / Pentest", text: "Pruebas de penetración y auditorías de seguridad, siempre con autorización firmada.", href: "https://rentahacker.cl" },
];

/** Construidos para un cliente. */
export const CLIENT_WORK: Business[] = [
  { name: "Barzuo", logo: "barzuo.png", kind: "Bar, lounge y club en Santiago", tags: "Software / Web application", text: "Desarrollamos su sistema completo (sitio, punto de venta, pantallas de cocina y barra, fidelización y karaoke) y hoy lo estamos escalando." },
];

/** Cifras entregadas por el equipo (CLP). */
export const STATS: [string, string][] = [
  ["+$20M", "invertidos en negocios propios"],
  ["+$100M", "de retorno generado"],
  ["+$500M", "valor estimado de los SaaS que creamos"],
  [String(OWN_BUSINESSES.length), "negocios construidos y operados por nuestro equipo"],
];

export const PLATFORMS: { name: string; file: string; use: string; h: string }[] = [
  { name: "Mercado Público", file: "mercado-publico.png", use: "Licitaciones", h: "h-7" },
  { name: "Tesorería General de la República", file: "tgr.png", use: "Pagos al Estado", h: "h-8" },
  { name: "Mercado Libre", file: "mercado-libre.png", use: "Ventas", h: "h-8" },
  { name: "Mercado Libre Developers", file: "mercado-libre-developers.png", use: "Integraciones API", h: "h-9" },
  { name: "Meta", file: "meta.png", use: "Publicidad", h: "h-6" },
  { name: "Uber Eats", file: "uber-eats.png", use: "Delivery", h: "h-9" },
  { name: "PedidosYa", file: "pedidosya.png", use: "Delivery", h: "h-9" },
  { name: "INAPI", file: "inapi.png", use: "Registro de marcas", h: "h-7" },
  { name: "AWS", file: "aws.png", use: "Infraestructura cloud", h: "h-9" },
];

export const IDEA_STAGES = [
  { id: "idea", label: "Tengo una idea" },
  { id: "app", label: "Tengo una app" },
  { id: "fisico", label: "Tengo un producto" },
  { id: "startup", label: "Ya estoy vendiendo" },
];

export const IDEA_NEEDS = ["Validación", "Desarrollo", "Diseño y fabricación", "Importación", "Ciberseguridad", "Ventas", "Compras públicas", "Legal", "Contabilidad", "Vender mi empresa"];
