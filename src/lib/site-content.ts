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
  { name: "Nomadbrew", logo: "nomadbrew.png", kind: "Café portátil", tags: "Importación / E-commerce", text: "Cafeteras portátiles Wacaco en Chile, en Mercado Libre Full, tienda propia y venta directa." },
  { name: "Starseeker", logo: "starseeker.png", kind: "Máquinas de espresso compactas", tags: "Importación / Marca", text: "Máquinas de espresso compactas, directo de fábrica, con tienda propia en Chile.", href: "https://starseeker.cl" },
  { name: "TAUPOC", logo: "taupoc.png", kind: "Natación de competencia", tags: "Importación / E-commerce", text: "Trajes de natación homologados por World Aquatics, con nadadores federados como embajadores.", href: "https://taupoc.cl" },
  { name: "Uzeed", logo: "uzeed.png", kind: "Directorio de contenido para adultos", tags: "Software / Next.js / Infraestructura", text: "Directorio de contenido para adultos en Next.js, con sistema PAC e infraestructura totalmente autoescalable.", href: "https://uzeed.cl" },
  { name: "La Frida", logo: "la-frida.png", kind: "Gastronomía", tags: "Gastronomía", text: "Restaurante de comida mexicana." },
  { name: "ANDES Technologies", logo: "andes-technologies.png", kind: "Proveedor del Estado", tags: "Security / Compras públicas", text: "Ciberseguridad, tecnología y retail para instituciones públicas, con licitaciones municipales adjudicadas." },
  { name: "Centinela", logo: null, kind: "Seguridad ofensiva", tags: "Security / SaaS", text: "Plataforma de pruebas de seguridad con control de alcance y autorización, usada en licitaciones municipales." },
  { name: "Rent A Hacker", logo: "rent-a-hacker.png", kind: "Ciberseguridad para empresas", tags: "Security / Pentest", text: "Pentesting y auditorías de seguridad para empresas, siempre con autorización firmada.", href: "https://rentahacker.cl" },
];

/** Construidos para un cliente. */
export const CLIENT_WORK: Business[] = [
  { name: "Barzuo", logo: "barzuo.png", kind: "Bar, lounge y club en Santiago", tags: "Software / Web application", text: "Sitio, punto de venta, pantallas de cocina y barra, fidelización y karaoke, hoy en etapa de escalamiento." },
];

/** Cifras entregadas por el equipo (CLP). `short` es la etiqueta en móvil. */
export const STATS: { value: string; short: string; long: string }[] = [
  { value: "+$20M", short: "Invertidos", long: "invertidos en negocios propios" },
  { value: "+$100M", short: "Retorno", long: "de retorno generado" },
  { value: "+$500M", short: "Valor SaaS", long: "valor estimado de los SaaS que creamos" },
  { value: "+20", short: "Negocios", long: "negocios construidos y operados por nuestro equipo" },
];

/** Los 3 casos de la home: muestran cosas distintas (e-commerce, software, security). */
export const FEATURED = ["Nomadbrew", "Uzeed", "Centinela"];

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
