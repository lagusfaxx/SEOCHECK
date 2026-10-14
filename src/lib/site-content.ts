/** Contenido del sitio público de FSV (fsvc.cl). Datos reales entregados por el equipo. */

export type Business = {
  name: string;
  /** archivo en /public/brand/clients; null = logo dibujado en código (Centinela) */
  logo: string | null;
  kind: string;
  text: string;
  tags: string;
  href?: string;
  /** frase corta para la home */
  short?: string;
};

/** Productos que construimos. Los textos dicen qué construimos, no que vendemos lo que ellos venden. */
export const OWN_BUSINESSES: Business[] = [
  { name: "Nomadbrew", logo: "nomadbrew.png", kind: "E-commerce de café portátil", tags: "E-commerce / Mercado Libre", text: "Construimos su tienda online y la integración con Mercado Libre Full para vender cafeteras portátiles en Chile." },
  { name: "Starseeker", logo: "starseeker.png", kind: "Marca de máquinas de espresso", tags: "Marca / E-commerce", text: "Construimos la marca y la tienda online de máquinas de espresso compactas en Chile.", href: "https://starseeker.cl" },
  { name: "TAUPOC", short: "Marca y tienda online de natación construidas por FSV.", logo: "taupoc.png", kind: "Natación de competencia", tags: "E-commerce / Next.js / SEO", text: "Construimos la marca, la tienda online en Next.js y el SEO de una línea de trajes de natación homologados por World Aquatics.", href: "https://taupoc.cl" },
  { name: "Uzeed", logo: "uzeed.png", kind: "Directorio de contenido para adultos", tags: "Software / Next.js / Infraestructura", text: "Construimos el directorio en Next.js, con pagos por PAC e infraestructura totalmente autoescalable.", href: "https://uzeed.cl" },
  { name: "La Frida", logo: "la-frida.png", kind: "Restaurante de comida mexicana", tags: "Gastronomía / Digital", text: "Construimos la presencia digital de un restaurante de comida mexicana." },
  { name: "ANDES Technologies", short: "Tecnología y ciberseguridad para instituciones públicas.", logo: "andes-technologies.png", kind: "Proveedor del Estado", tags: "Security / Compras públicas", text: "Construimos su oferta de ciberseguridad y tecnología para instituciones públicas, con licitaciones municipales adjudicadas." },
  { name: "Centinela", logo: null, kind: "Seguridad ofensiva", tags: "Security / SaaS", text: "Construimos esta plataforma de pruebas de seguridad con control de alcance y autorización, usada en licitaciones municipales." },
  { name: "Rent A Hacker", logo: "rent-a-hacker.png", kind: "Ciberseguridad para empresas", tags: "Security / Pentest", text: "Construimos el servicio de pentesting y auditorías de seguridad para empresas, siempre con autorización firmada.", href: "https://rentahacker.cl" },
];

/** Construidos para un cliente. */
export const CLIENT_WORK: Business[] = [
  { name: "Barzuo", short: "Sistema de operación para bar, cocina y clientes.", logo: "barzuo.png", kind: "Bar, lounge y club en Santiago", tags: "Software / Web application", text: "Construimos su sitio, punto de venta, pantallas de cocina y barra, fidelización y karaoke; hoy en etapa de escalamiento." },
];

/** Cifras entregadas por el equipo (CLP). `short` es la etiqueta en móvil. */
export const STATS: { value: string; short: string; long: string }[] = [
  { value: "+$20M", short: "Invertidos", long: "invertidos en los productos que construimos" },
  { value: "+$100M", short: "Retorno", long: "de retorno generado" },
  { value: "+$500M", short: "Valor SaaS", long: "valor estimado de los SaaS que creamos" },
  { value: "+20", short: "Proyectos", long: "proyectos construidos por nuestro equipo" },
];

/** Franja bajo el hero: productos y negocios construidos por FSV (evidencia antes de los servicios). */
export const PROOF: { name: string; fact: string; href: string; logo: string | null; external?: boolean }[] = [
  { name: "FSV Search", fact: "Plataforma de SEO técnico y search intelligence", href: "/search", logo: "/brand/fsv-search.png" },
  { name: "Uzeed", fact: "Directorio en Next.js, infraestructura autoescalable", href: "https://uzeed.cl", logo: "/brand/clients/uzeed.png", external: true },
  { name: "Centinela", fact: "Plataforma de pruebas de seguridad", href: "/work", logo: null },
  { name: "Nomadbrew", fact: "Tienda online e integración con Mercado Libre Full", href: "/work", logo: "/brand/clients/nomadbrew.png" },
];

/** Capacidades como hechos, cada una con proyectos reales que la prueban. */
export const CAPABILITIES = [
  { id: "software", n: "01", area: "Software", fact: "Desarrollo de plataformas y SaaS.", detail: "Aplicaciones web, sistemas internos, APIs e integraciones.", proof: ["Barzuo", "Uzeed"] },
  { id: "security", n: "02", area: "Security", fact: "Pentesting y seguridad de aplicaciones.", detail: "Aplicaciones web, APIs y evaluación técnica con autorización firmada.", proof: ["SistemaW", "Centinela", "Rent A Hacker"] },
  { id: "growth", n: "03", area: "Growth", fact: "SEO técnico y search intelligence.", detail: "Auditoría, datos de Search Console, keywords, rankings y contenido.", proof: ["FSV Search"] },
];

/** Los 3 casos de la home (distintos de la franja de evidencia): software, security y operación. */
export const FEATURED = ["Barzuo", "ANDES Technologies", "TAUPOC"];

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

export const IDEA_NEEDS = ["Validación", "Desarrollo", "Diseño y fabricación", "Ciberseguridad", "Ventas", "Compras públicas", "Legal", "Contabilidad", "Vender mi empresa"];
