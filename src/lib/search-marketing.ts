/**
 * Contenido de marketing de FSV Search: una página por función (para posicionar búsquedas como "auditoría SEO" o
 * "seguimiento de rankings") y guías prácticas. Todo lo que se afirma del producto existe en la app; los consejos de SEO
 * son generales y verificables.
 */

export type Section = { h2: string; p?: string[]; list?: string[] };
export type Faq = [string, string];

export type FeaturePage = {
  slug: string;
  /** nombre corto (menús, tarjetas) */
  name: string;
  title: string;
  description: string;
  h1: string;
  lead: string;
  /** imagen del producto (capturas reales con datos de demostración) */
  img?: { src: string; alt: string };
  steps: [string, string][];
  sections: Section[];
  faq: Faq[];
  /** slugs de funciones relacionadas */
  related: string[];
  /** slugs de guías relacionadas */
  guides: string[];
};

export const FEATURE_PAGES: FeaturePage[] = [
  {
    slug: "auditoria-seo",
    name: "Auditoría SEO técnica",
    title: "Auditoría SEO técnica de tu sitio — FSV Search",
    description: "Revisa tu sitio como lo hace Google: errores, indexación, títulos, metas, canonicals, contenido y velocidad, con tareas ordenadas por impacto. Prueba 7 días gratis.",
    h1: "Auditoría SEO técnica que te dice qué arreglar primero",
    lead: "FSV Search recorre tu sitio página por página, detecta lo que frena tu posicionamiento en Google y lo convierte en una lista de tareas ordenada por impacto, agrupada por plantilla.",
    img: { src: "/brand/search-audit.png", alt: "Auditoría técnica en FSV Search: salud técnica, errores y páginas revisadas" },
    steps: [
      ["Escribe tu dominio", "El crawler recorre el sitio desde la portada y el sitemap, respetando robots.txt."],
      ["Revisa los hallazgos", "Errores, advertencias y observaciones, cada uno con qué significa y cómo se arregla."],
      ["Corrige por plantilla", "Si el problema viene de una plantilla (por ejemplo /producto/*), lo arreglas una vez y se corrigen todas sus URLs."],
    ],
    sections: [
      {
        h2: "Qué revisa la auditoría",
        list: [
          "Errores HTTP (4xx y 5xx), redirecciones y cadenas de redirecciones.",
          "Páginas con noindex, nofollow, bloqueadas por robots.txt o fuera del sitemap.",
          "Títulos y meta descripciones faltantes, duplicados, muy largos o muy cortos.",
          "H1 faltantes o múltiples, contenido escaso y contenido duplicado.",
          "Canonicals que apuntan a otra URL, hreflang y datos estructurados (JSON-LD) inválidos.",
          "Páginas huérfanas (en el sitemap pero sin links internos) y páginas demasiado profundas.",
          "Imágenes sin texto alternativo y tiempo de respuesta del servidor.",
        ],
      },
      {
        h2: "Pensada para sitios modernos",
        p: [
          "Muchos sitios hechos con Next.js, React o Shopify entregan el contenido de forma distinta a un HTML tradicional. FSV Search lee el contenido donde Google lo ve: entiende el streaming de React, los correos protegidos por Cloudflare y las redirecciones del CDN, para no inventar errores que no existen.",
          "Cada hallazgo indica si es un problema confirmado, uno posible o una oportunidad, para que no pierdas tiempo en falsos positivos.",
        ],
      },
      {
        h2: "Prioridades con datos reales",
        p: [
          "Si conectas Google Search Console, el impacto de cada tarea se calcula con las impresiones reales de las URLs afectadas. Así sabes si un problema afecta a páginas que Google muestra o a páginas que nadie visita.",
        ],
      },
    ],
    faq: [
      ["¿Cuántas páginas analiza?", "Durante la prueba gratis, hasta 100 páginas por auditoría. En el plan pagado, hasta 1.000 páginas por auditoría en cada perfil."],
      ["¿Necesito instalar algo en mi sitio?", "No. La auditoría lee el sitio desde afuera, igual que Google. Solo necesitas que el sitio sea público."],
      ["¿Cada cuánto conviene auditar?", "Después de cada cambio importante (rediseño, migración, nuevas plantillas) y al menos una vez al mes. Al volver a auditar, FSV Search confirma qué tareas quedaron resueltas."],
    ],
    related: ["search-console", "informes-seo", "investigacion-de-keywords"],
    guides: ["auditoria-seo-tecnica-paso-a-paso", "titulos-y-meta-descripciones"],
  },
  {
    slug: "search-console",
    name: "Google Search Console",
    title: "Google Search Console sin complicaciones — FSV Search",
    description: "Conecta Google Search Console con un clic y ve clics, impresiones, posición y oportunidades por página, sincronizados cada día. Prueba 7 días gratis.",
    h1: "Tus datos de Google Search Console, explicados y accionables",
    lead: "Conecta tu cuenta de Google con un clic y FSV Search sincroniza tus datos cada día: qué consultas te traen tráfico, qué páginas están cerca de la primera página y cuáles están perdiendo clics.",
    img: { src: "/brand/fsv-search-dashboard.png", alt: "Resumen de un proyecto en FSV Search con datos de Search Console" },
    steps: [
      ["Conecta con Google", "Autorizas el acceso de solo lectura a Search Console desde tu cuenta de Google."],
      ["Elige la propiedad", "La sincronización empieza sola y trae tu historial reciente."],
      ["Actúa sobre las oportunidades", "Consultas en posiciones 4 a 20, CTR bajo y páginas que perdieron clics, ordenadas por impacto."],
    ],
    sections: [
      {
        h2: "Qué puedes ver",
        list: [
          "Clics, impresiones, CTR y posición media por consulta, página, país y dispositivo.",
          "Tendencias de los últimos 28 días contra los 28 anteriores.",
          "Consultas de marca separadas de las genéricas.",
          "Oportunidades: consultas que ya rankean cerca de la primera página.",
          "Páginas que perdieron clics y canibalización entre URLs.",
        ],
      },
      {
        h2: "Seguro y de solo lectura",
        p: [
          "FSV Search pide solo permiso de lectura de Search Console. El acceso se guarda cifrado y puedes desconectarlo cuando quieras desde la app o desde tu cuenta de Google.",
        ],
      },
    ],
    faq: [
      ["¿Necesito tener Search Console configurado?", "Sí, tu sitio debe estar verificado en Google Search Console. Si no lo tienes, la guía de FSV Search te explica cómo hacerlo en pocos minutos."],
      ["¿Pueden modificar algo en mi cuenta de Google?", "No. El permiso es de solo lectura: FSV Search no puede cambiar nada en Search Console."],
      ["¿Los datos se actualizan solos?", "Sí. Se sincronizan automáticamente cada día."],
    ],
    related: ["auditoria-seo", "seguimiento-de-rankings", "informes-seo"],
    guides: ["como-conectar-google-search-console"],
  },
  {
    slug: "investigacion-de-keywords",
    name: "Investigación de keywords",
    title: "Investigación de keywords en español — FSV Search",
    description: "Encuentra las búsquedas reales de tus clientes con volumen, intención y dificultad, agrupadas en clusters y temas. Herramienta SEO hecha en Chile. Prueba 7 días gratis.",
    h1: "Investigación de keywords para saber qué busca tu cliente",
    lead: "A partir de unas pocas palabras semilla, FSV Search encuentra las búsquedas reales relacionadas con tu negocio, mide su volumen y su intención, y las agrupa en clusters listos para convertir en páginas.",
    img: { src: "/brand/search-keywords.png", alt: "Investigación de keywords en FSV Search: intención, volumen y dificultad" },
    steps: [
      ["Escribe tus semillas", "Por ejemplo: «traje de natación», «zapatillas running mujer»."],
      ["Obtén las búsquedas reales", "Sugerencias de Google, preguntas relacionadas y resultados reales, con volumen mensual."],
      ["Planifica por clusters", "Las keywords se agrupan por los resultados que comparten en Google: cada cluster es una página."],
    ],
    sections: [
      {
        h2: "Qué obtienes",
        list: [
          "Volumen de búsqueda mensual en tu país e idioma.",
          "Intención de búsqueda: informativa, comercial, transaccional o de navegación.",
          "Dificultad estimada según quién rankea hoy.",
          "Clusters y temas para planificar el contenido sin canibalizar.",
          "Qué página de tu sitio corresponde a cada cluster y cuáles faltan.",
        ],
      },
      {
        h2: "Hecha para el mercado hispano",
        p: ["La investigación se hace con resultados del país e idioma de tu proyecto (por ejemplo Chile y español), no con datos genéricos en inglés."],
      },
    ],
    faq: [
      ["¿Cuántas investigaciones puedo hacer?", "La prueba gratis incluye 2 investigaciones. El plan pagado incluye 6 al mes por perfil."],
      ["¿De dónde sale el volumen?", "De proveedores de datos de búsqueda de Google y, si conectas Search Console, de tus impresiones reales."],
    ],
    related: ["seguimiento-de-rankings", "briefs-de-contenido-ia", "search-console"],
    guides: ["como-elegir-keywords-para-tu-negocio", "seo-para-tiendas-online"],
  },
  {
    slug: "seguimiento-de-rankings",
    name: "Seguimiento de rankings",
    title: "Seguimiento de rankings en Google — FSV Search",
    description: "Mide la posición de tu sitio en Google para tus keywords, ve quién te supera y recibe alertas cuando algo cambia. Prueba 7 días gratis.",
    h1: "Seguimiento de rankings: sabe dónde apareces en Google",
    lead: "Elige las keywords que importan para tu negocio y FSV Search revisa tu posición en Google de forma automática, con la URL que rankea y los competidores que aparecen arriba.",
    steps: [
      ["Elige tus keywords", "Desde la investigación de keywords o escribiéndolas a mano."],
      ["Revisión automática", "Semanal o diaria, en el país de tu proyecto."],
      ["Recibe alertas", "Cuando una keyword cambia de posición de forma importante."],
    ],
    sections: [
      {
        h2: "Qué mide",
        list: [
          "Posición en Google y la URL de tu sitio que aparece.",
          "Competidores del top 10 para cada keyword.",
          "Elementos del resultado (fragmentos destacados, preguntas, mapas, etc.).",
          "Evolución en el tiempo y resumen top 3 / top 10.",
        ],
      },
    ],
    faq: [
      ["¿Cuántas keywords puedo seguir?", "10 durante la prueba gratis y 50 por perfil en el plan pagado."],
      ["¿Es lo mismo que la posición de Search Console?", "No. Search Console muestra un promedio de todas tus apariciones; el seguimiento revisa el resultado real de Google para una keyword y un país."],
    ],
    related: ["investigacion-de-keywords", "search-console", "informes-seo"],
    guides: ["como-elegir-keywords-para-tu-negocio"],
  },
  {
    slug: "briefs-de-contenido-ia",
    name: "Briefs de contenido con IA",
    title: "Briefs de contenido SEO con IA — FSV Search",
    description: "Compara tu página con el top 10 de Google y recibe un brief con los términos, secciones y preguntas que faltan. Prueba 7 días gratis.",
    h1: "Briefs de contenido con IA basados en lo que Google premia",
    lead: "Elige una página y la keyword que quieres posicionar. FSV Search la compara con los resultados que hoy rankean y te entrega un brief concreto: qué términos faltan, qué secciones agregar y qué preguntas responder.",
    img: { src: "/brand/search-content.png", alt: "Análisis de contenido en FSV Search: puntaje, términos faltantes y brief" },
    steps: [
      ["Elige página y keyword", "Una página existente o una nueva que quieres crear."],
      ["Comparación con el top 10", "Términos, estructura, extensión y tipo de página de los resultados reales."],
      ["Recibe el brief", "Con puntaje de contenido y los cambios ordenados por impacto."],
    ],
    sections: [
      {
        h2: "Qué incluye el brief",
        list: [
          "Puntaje de la página frente a los resultados que rankean.",
          "Términos y entidades que usan los competidores y tu página no.",
          "Estructura sugerida de títulos (H2 y H3).",
          "Preguntas que la página debería responder.",
          "Recomendaciones según el tipo de página: artículo, listado, ficha de producto o landing.",
        ],
      },
    ],
    faq: [
      ["¿La IA escribe el contenido por mí?", "El brief te dice qué escribir y por qué. Puedes regenerar secciones con IA, pero recomendamos revisar y adaptar todo a tu negocio."],
      ["¿Cuántos briefs incluye?", "2 en la prueba gratis y 8 al mes por perfil en el plan pagado."],
    ],
    related: ["investigacion-de-keywords", "auditoria-seo", "instagram-con-ia"],
    guides: ["como-elegir-keywords-para-tu-negocio", "titulos-y-meta-descripciones"],
  },
  {
    slug: "instagram-con-ia",
    name: "Instagram con IA",
    title: "Publica en Instagram con IA — FSV Search",
    description: "Genera imágenes y textos para Instagram con las keywords de tu negocio, publica o programa los posts y mide qué funciona. Prueba 7 días gratis.",
    h1: "Contenido para Instagram con IA, conectado a tu SEO",
    lead: "Usa las mismas keywords de tu sitio para crear posts de Instagram: FSV Search genera la imagen (también a partir de una foto de tu producto) y el texto, y los publica o programa en tu cuenta profesional.",
    steps: [
      ["Conecta tu cuenta", "Una cuenta profesional de Instagram (Empresa o Creador)."],
      ["Genera imagen y texto", "Con tus keywords y el tono que elijas, o sube tu propia imagen."],
      ["Publica o programa", "Y revisa el alcance y las interacciones de cada post."],
    ],
    sections: [
      {
        h2: "Qué puedes hacer",
        list: [
          "Generar imágenes cuadradas listas para Instagram, también a partir de una foto real de tu producto.",
          "Escribir captions con tus keywords, en el tono de tu marca.",
          "Publicar al instante o programar fecha y hora.",
          "Ver alcance, interacciones y los posts que mejor funcionaron; la IA aprende de ellos.",
        ],
      },
    ],
    faq: [
      ["¿Qué tipo de cuenta necesito?", "Una cuenta profesional de Instagram (Empresa o Creador)."],
      ["¿Cuántas imágenes puedo generar?", "3 en la prueba gratis y 30 al mes por perfil en el plan pagado, además de 100 textos con IA."],
    ],
    related: ["briefs-de-contenido-ia", "investigacion-de-keywords"],
    guides: ["seo-para-tiendas-online"],
  },
  {
    slug: "informes-seo",
    name: "Informes y tareas",
    title: "Informes SEO en PDF y tareas priorizadas — FSV Search",
    description: "Informes SEO en PDF para tu equipo o tus clientes y una lista de tareas priorizada por impacto, explicada en simple. Prueba 7 días gratis.",
    h1: "Informes SEO claros y tareas priorizadas",
    lead: "FSV Search junta la auditoría, Search Console, keywords y rankings en un informe ejecutivo y en una lista de tareas ordenada por impacto, para que tu equipo sepa exactamente qué hacer esta semana.",
    steps: [
      ["Corre todo de una vez", "Auditoría, Search Console, PageSpeed, indexación, keywords y rankings."],
      ["Recibe el informe", "En PDF y en un formato listo para que un desarrollador o un agente de IA lo implemente."],
      ["Marca lo resuelto", "La siguiente auditoría confirma qué tareas quedaron bien."],
    ],
    sections: [
      {
        h2: "Qué trae el informe",
        list: [
          "Tareas ordenadas por impacto (tráfico afectado × severidad × facilidad).",
          "Causas raíz: problemas que vienen de una plantilla y se arreglan una sola vez.",
          "Tendencias de Search Console y oportunidades por plantilla.",
          "Velocidad (PageSpeed) e indexación de las páginas principales.",
          "Lo revisado que parece intencional, para no perder tiempo.",
        ],
      },
    ],
    faq: [
      ["¿Puedo programar los informes?", "Sí, puedes programar informes periódicos para cada proyecto."],
      ["¿Cuántos informes incluye?", "1 en la prueba gratis y 4 al mes por perfil en el plan pagado."],
    ],
    related: ["auditoria-seo", "search-console", "seguimiento-de-rankings"],
    guides: ["auditoria-seo-tecnica-paso-a-paso"],
  },
];

export type Guide = {
  slug: string;
  title: string;
  description: string;
  h1: string;
  /** fecha de publicación (ISO) */
  date: string;
  minutes: number;
  intro: string;
  sections: Section[];
  /** función de FSV Search relacionada (CTA al final) */
  feature: string;
};

export const GUIDES: Guide[] = [
  {
    slug: "auditoria-seo-tecnica-paso-a-paso",
    title: "Cómo hacer una auditoría SEO técnica paso a paso",
    description: "Guía práctica para auditar el SEO técnico de un sitio: rastreo, indexación, títulos, contenido, enlaces internos y velocidad, en el orden correcto.",
    h1: "Cómo hacer una auditoría SEO técnica paso a paso",
    date: "2026-10-15",
    minutes: 8,
    intro: "Una auditoría SEO técnica responde una pregunta simple: ¿puede Google encontrar, entender e indexar las páginas que te importan? Este es el orden que recomendamos para revisarlo sin perderte en detalles.",
    sections: [
      {
        h2: "1. Rastreo: que Google pueda llegar a tus páginas",
        p: ["Empieza por robots.txt y el sitemap. robots.txt no debe bloquear secciones que quieres posicionar, y el sitemap debe listar solo URLs que respondan 200, sin redirecciones ni noindex."],
        list: [
          "Revisa que robots.txt no bloquee CSS, JavaScript ni secciones importantes.",
          "Confirma que el sitemap existe, está declarado en robots.txt y está enviado en Search Console.",
          "Busca páginas huérfanas: están en el sitemap pero ningún link interno apunta a ellas.",
        ],
      },
      {
        h2: "2. Códigos de respuesta y redirecciones",
        p: ["Los errores 4xx y 5xx desperdician el rastreo y rompen la experiencia. Las cadenas de redirecciones (A → B → C) hacen más lento el acceso y diluyen señales."],
        list: ["Corrige los links internos que apuntan a páginas con error.", "Reemplaza las cadenas por una sola redirección 301 al destino final.", "Antes de reportar un link roto, confirma que lo esté para un visitante real: algunos CDN reescriben links (por ejemplo, la protección de correos de Cloudflare)."],
      },
      {
        h2: "3. Indexación: noindex, canonicals y duplicados",
        p: ["Una página con noindex no aparecerá en Google, y una con canonical a otra URL le pide a Google que muestre la otra. Ambos son correctos en filtros o variantes, pero un error aquí puede sacar páginas importantes del índice."],
        list: ["Usa «noindex, follow» en filtros y búsquedas internas: así Google sigue los links hacia tus productos.", "Evita «nofollow» en páginas internas: corta el paso de autoridad a todo lo que enlazan.", "Verifica que las variantes (color, talla, parámetros) apunten con canonical a la versión principal."],
      },
      {
        h2: "4. Títulos, metas y encabezados",
        p: ["El title y la meta descripción son lo que la gente ve en Google. Cada página debe tener un title único de hasta unos 60 caracteres y una meta descripción de hasta unos 155, y un solo H1 que diga de qué trata."],
      },
      {
        h2: "5. Contenido",
        p: ["Revisa las páginas con muy poco texto o contenido duplicado. Ojo con los sitios en JavaScript: si el contenido se carga solo en el navegador, una herramienta que no lo interpreta verá páginas vacías. Compara siempre con lo que muestra la inspección de URL de Search Console."],
      },
      {
        h2: "6. Velocidad y experiencia",
        p: ["Mide las plantillas principales con PageSpeed Insights y prioriza los datos de usuarios reales (campo) sobre los de laboratorio. Lo más común: imagen principal pesada, JavaScript que bloquea la carga y saltos de diseño."],
      },
      {
        h2: "7. Prioriza por impacto, no por cantidad",
        p: ["Una auditoría con 300 avisos no sirve si no sabes por dónde partir. Ordena los problemas por el tráfico de las páginas afectadas y su gravedad, y agrúpalos por plantilla: un cambio en la plantilla de producto puede arreglar cientos de URLs a la vez."],
      },
    ],
    feature: "auditoria-seo",
  },
  {
    slug: "como-conectar-google-search-console",
    title: "Cómo verificar tu sitio y conectar Google Search Console",
    description: "Paso a paso para verificar tu sitio en Google Search Console, enviar el sitemap y entender los primeros reportes.",
    h1: "Cómo verificar tu sitio y conectar Google Search Console",
    date: "2026-10-15",
    minutes: 5,
    intro: "Google Search Console es la única fuente oficial de cómo te ve Google: qué búsquedas te muestran, cuántos clics recibes y qué páginas tienen problemas de indexación. Es gratis y se configura en minutos.",
    sections: [
      {
        h2: "1. Crea la propiedad",
        p: ["Entra a search.google.com/search-console con tu cuenta de Google y agrega una propiedad. Recomendamos la propiedad de dominio (por ejemplo, tusitio.cl): incluye todas las versiones (www, sin www, http y https)."],
      },
      {
        h2: "2. Verifica que el sitio es tuyo",
        p: ["Para una propiedad de dominio, Google te da un registro TXT que debes agregar en el DNS de tu dominio (en tu proveedor de dominio o en Cloudflare). La verificación puede tardar desde minutos hasta unas horas."],
      },
      {
        h2: "3. Envía el sitemap",
        p: ["En la sección Sitemaps, agrega la URL de tu sitemap (normalmente /sitemap.xml). Así Google descubre tus páginas más rápido y puedes ver cuántas indexó."],
      },
      {
        h2: "4. Entiende los primeros reportes",
        list: [
          "Rendimiento: clics, impresiones, CTR y posición media por consulta y página.",
          "Páginas (indexación): qué páginas están indexadas y por qué otras no.",
          "Inspección de URLs: cómo ve Google una página específica.",
        ],
      },
      {
        h2: "5. Ten paciencia con los datos",
        p: ["Los datos empiezan a aparecer en unos días. Con pocas impresiones (por ejemplo, menos de mil al mes), los porcentajes de cambio pueden exagerar: compara valores absolutos y espera a tener más datos antes de sacar conclusiones."],
      },
    ],
    feature: "search-console",
  },
  {
    slug: "como-elegir-keywords-para-tu-negocio",
    title: "Cómo elegir keywords para tu negocio",
    description: "Cómo encontrar y elegir las palabras clave correctas: intención de búsqueda, volumen, dificultad y cómo agruparlas en páginas.",
    h1: "Cómo elegir keywords para tu negocio",
    date: "2026-10-15",
    minutes: 7,
    intro: "Elegir keywords no es buscar las de más volumen: es encontrar las búsquedas de personas que podrían comprarte y que tu sitio puede ganar. Este es un método simple para hacerlo.",
    sections: [
      {
        h2: "1. Parte de cómo habla tu cliente",
        p: ["Escribe 5 a 10 semillas con las palabras que usan tus clientes, no las de tu industria. Revisa las sugerencias de Google, las preguntas relacionadas y las búsquedas que ya te traen impresiones en Search Console."],
      },
      {
        h2: "2. Clasifica la intención",
        list: [
          "Informativa: «cómo elegir talla de traje de natación». Ideal para guías.",
          "Comercial: «mejor traje de natación para competencia». Ideal para comparativas y categorías.",
          "Transaccional: «comprar traje de natación jammer». Ideal para fichas y categorías.",
          "Navegación: el nombre de tu marca o de otra.",
        ],
      },
      {
        h2: "3. Mira volumen y dificultad juntos",
        p: ["Una keyword de 100 búsquedas al mes con intención de compra puede valer más que una de 10.000 informativa. Revisa quién rankea hoy: si son solo sitios enormes, apunta primero a variantes más específicas."],
      },
      {
        h2: "4. Agrupa en clusters: una página por intención",
        p: ["Las keywords que comparten resultados en Google deben ir en la misma página. Si creas una página por cada variante, tus propias páginas competirán entre sí (canibalización)."],
      },
      {
        h2: "5. Asigna cada cluster a una URL",
        p: ["Para cada cluster, decide qué página existente lo cubre o qué página nueva hay que crear. Ese mapa de keywords a URLs es tu plan de contenido."],
      },
    ],
    feature: "investigacion-de-keywords",
  },
  {
    slug: "titulos-y-meta-descripciones",
    title: "Títulos y meta descripciones que Google muestra (y la gente clickea)",
    description: "Cómo escribir títulos y meta descripciones efectivos: largo, keywords, marca y errores comunes en plantillas.",
    h1: "Títulos y meta descripciones que Google muestra y la gente clickea",
    date: "2026-10-15",
    minutes: 5,
    intro: "El title y la meta descripción son tu anuncio gratis en Google. Un buen title ayuda a posicionar; una buena descripción aumenta los clics. Estas son las reglas prácticas.",
    sections: [
      {
        h2: "El title",
        list: [
          "Hasta unos 60 caracteres: más largo, Google lo corta.",
          "La keyword principal al inicio, de forma natural.",
          "La marca al final y corta: un sufijo largo («· Mi Marca Chile») se repite en todas las páginas y empuja a la keyword fuera del espacio visible.",
          "Único en cada página.",
        ],
      },
      {
        h2: "La meta descripción",
        list: [
          "Hasta unos 155 caracteres.",
          "Responde a la búsqueda y da un motivo para hacer clic (precio, envío, garantía, beneficio).",
          "Única por página: las páginas legales o de sistema suelen quedar con la descripción por defecto.",
        ],
      },
      {
        h2: "En sitios con plantillas",
        p: ["En tiendas y sitios con muchas páginas, los títulos se generan con una plantilla. Revisa la plantilla una vez (por ejemplo, la de producto) en vez de corregir página por página, y prueba con los nombres más largos para que no se pasen del límite."],
      },
    ],
    feature: "auditoria-seo",
  },
  {
    slug: "seo-para-tiendas-online",
    title: "SEO para tiendas online en Chile: lo esencial",
    description: "Lo esencial del SEO para e-commerce: categorías, fichas de producto, variantes, filtros, datos estructurados y contenido.",
    h1: "SEO para tiendas online en Chile: lo esencial",
    date: "2026-10-15",
    minutes: 7,
    intro: "En una tienda online, la mayoría del tráfico orgánico llega a categorías y fichas de producto. Estos son los puntos que más pesan, en orden.",
    sections: [
      {
        h2: "1. Las categorías son tus páginas más valiosas",
        p: ["Las búsquedas comerciales («zapatillas running mujer») suelen llevar a categorías. Dale a cada categoría un title y un H1 claros, un texto breve útil arriba o abajo del listado, y links desde el menú."],
      },
      {
        h2: "2. Fichas de producto con texto propio",
        p: ["Copiar la descripción del fabricante deja tu ficha igual a la de otras tiendas. Agrega lo que el cliente necesita para decidir: medidas, materiales, uso, cuidados y preguntas frecuentes."],
      },
      {
        h2: "3. Variantes y filtros sin duplicados",
        list: [
          "Las variantes de color o talla deben apuntar con canonical a la ficha principal, o tener contenido propio si quieres posicionarlas por separado.",
          "Los filtros (?color=, ?talla=) normalmente van con «noindex, follow»: fuera del índice, pero Google sigue sus links hacia los productos.",
        ],
      },
      {
        h2: "4. Datos estructurados de producto",
        p: ["El JSON-LD de Product con precio, disponibilidad y valoraciones permite que Google muestre esa información en los resultados. Valídalo con la prueba de resultados enriquecidos de Google."],
      },
      {
        h2: "5. Contenido que lleva a las categorías",
        p: ["Guías y comparativas («cómo elegir...») atraen búsquedas informativas y enlazan a tus categorías y productos. Es la forma más estable de crecer sin depender solo de publicidad."],
      },
    ],
    feature: "investigacion-de-keywords",
  },
];

export const featureBySlug = (slug: string) => FEATURE_PAGES.find((f) => f.slug === slug);
export const guideBySlug = (slug: string) => GUIDES.find((g) => g.slug === slug);
