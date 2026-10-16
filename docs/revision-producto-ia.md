# Revisión de utilidad, ecommerce e IA

Revisión del 16 de octubre de 2026. Objetivo: que una persona sin conocimientos de SEO entienda qué hacer y que un especialista pueda comprobarlo con datos. No se presenta una auditoría parcial como una certificación de todo el sitio.

## Investigación consultada

Se leyeron fuentes públicas de los proyectos oficiales. Las conclusiones de producto son decisiones de SEOCHECK; estas fuentes no certifican la aplicación.

| Fuente | Lo que aporta a la revisión | Aplicación |
| --- | --- | --- |
| [Google Lighthouse: configuración y auditorías](https://github.com/GoogleChrome/lighthouse/blob/main/core/config/default-config.js), [rastreo](https://github.com/GoogleChrome/lighthouse/blob/main/core/audits/seo/is-crawlable.js), [texto de enlaces](https://github.com/GoogleChrome/lighthouse/blob/main/core/audits/seo/link-text.js) | Acceso de los buscadores, robots, títulos, canonical, enlaces descriptivos y alternativas de imágenes; una puntuación automática tiene alcance limitado. | Priorizar problemas verificables, conservar evidencia y explicar el siguiente paso. No presentar un score técnico como prueba de éxito comercial o de indexación. |
| [GoogleChrome/web-vitals](https://github.com/GoogleChrome/web-vitals/blob/main/README.md) | LCP, INP y CLS reflejan dimensiones distintas de la experiencia real. La medición de usuarios y la simulación de laboratorio tienen usos distintos. | Mostrar fuente y unidades; separar campo/laboratorio, datos de URL/origen y métricas faltantes. No transformar TBT en INP ni promediar percentiles como si fueran un p75 real. |
| [Schema.org: vocabulario oficial](https://github.com/schemaorg/schemaorg/blob/main/data/schema.ttl) | Product, ProductGroup, Offer, variantes, disponibilidad, envío y políticas de devolución describen aspectos del catálogo. | Revisar coherencia con la ficha visible. Ofrecer revisión manual de políticas y compra; el marcado no prueba que la tienda cumpla lo declarado ni que Google muestre resultados enriquecidos. |
| [OpenAI Cookbook: Structured Outputs](https://github.com/openai/openai-cookbook/blob/main/examples/Structured_Outputs_Intro.ipynb) | Esquemas estrictos para la forma de la respuesta y manejo de respuestas que no cumplen lo solicitado. | Pedir un esquema y validar IDs y referencias después. Un JSON válido no demuestra veracidad: las explicaciones son propuestas contrastables con el hallazgo original. |

Los archivos se consultaron desde `raw.githubusercontent.com`. El acceso directo a las guías de `developers.google.com` y `web.dev` devolvió HTTP 403 en este entorno. No se afirma haber verificado su contenido actual ni haber accedido a las cuentas privadas de Google del proyecto.

## Resultado de la revisión e implementación

La app ya reunía auditoría, Search Console, rankings, contenido, datos de negocio y doce módulos expertos B–L. La mayor carencia de uso era conectar esos datos con una decisión comprensible: varios paneles mostraban nombres internos de columnas y no explicaban cómo empezar cuando no había datos.

| Necesidad | Comportamiento incorporado | Evidencia o límite |
| --- | --- | --- |
| Principiante: saber por dónde empezar | Resumen con tres acciones, explicación, pasos y forma de comprobar la corrección. Inicio explícito cuando falta crawl. | Tareas activas del último crawl público; muestra acotada, con cobertura indicada. |
| Experto: contrastar diagnóstico | Vista técnica con todas las columnas; vista guiada con las relevantes y detalle expandible. Preferencia persistente por proyecto/navegador. | No cambia permisos ni elimina herramientas avanzadas. |
| Negocios distintos | Perfil de tienda, servicios/negocio local, contenidos u otro sitio; objetivo de ventas, contactos, lectores o visibilidad. Detección inicial de productos/artículos con opción de corregirla. | La detección depende de las páginas de la muestra. No presupone que todo sitio sea ecommerce. |
| Ecommerce | Revisión de fichas, precio, moneda, stock, variantes, categorías y facetas; lista de revisión de envíos, devoluciones y confianza. | Sin stock y filtros no desencadenan desindexación automática. Checkout, políticas y conversión requieren comprobar el negocio real. |
| Servicios y sitios editoriales | Revisión de servicios, zonas, contacto/formularios; autoría, fuentes, intención y vigencia para contenidos. | No exige una cantidad de palabras ni genera páginas locales vacías para superar un score. |
| Indexación fiable | Distinguir crawl, sitemap e inspección de Google; señalar alcance parcial y fuentes no conectadas. | Un sitemap o una respuesta 200 no prueban indexación. |
| Rendimiento fiable | CLS normalizado, incluidos registros históricos, umbrales interpretados y estados sin datos. | No declarar que todos los Web Vitals están bien cuando solo hay una métrica de campo. |
| Resultados del negocio | Señalar conexión y validación de conversiones/ventas como requisito. Mantener el ingreso por consulta etiquetado como estimación. | Es un reparto por landing/día, no una venta atribuida a una búsqueda individual. |
| Entrega a otras personas | Próximos pasos y comprobaciones incluidos en Markdown y PDF ejecutivo; lecturas de informes reutilizan la explicación existente. | Exportar no inicia una llamada al modelo. Snapshots antiguos siguen siendo compatibles. |
| Acceso al proyecto | Las páginas del servidor usan la misma comprobación de acceso al proyecto que la API. | Un miembro excluido de ese proyecto no puede consultar sus metadatos mediante el layout. |

La vista guiada conserva las herramientas detalladas. La prioridad sigue basada en gravedad y señales disponibles; cambiar el objetivo comercial no inventa un pronóstico ni reordena arbitrariamente errores críticos.

## Cómo se utiliza la IA

1. El análisis por reglas construye acciones con prioridad, estado de certeza, pasos, comprobación e IDs de evidencia. Excluye tareas de crawls privados o anteriores del plan del crawl público actual y tareas ya resueltas/ignoradas.
2. El modelo recibe como máximo doce acciones acotadas, el tipo de sitio y objetivo. No recibe HTML completo ni configuración o credenciales. Se eliminan correos y parámetros de las URLs de los textos enviados. El contenido de las tareas se trata como evidencia sin autoridad para dar instrucciones.
3. OpenAI recibe un JSON Schema estricto. Anthropic recibe el esquema en el prompt; ambos pasan por la validación local. Se rechazan IDs desconocidos/duplicados, referencias ajenas, textos fuera de límite, enlaces/correos, garantías detectables y cifras ausentes de la entrada.
4. La respuesta añade una explicación y pasos sugeridos a la acción original. No cambia sus métricas, prioridad, certeza, estado ni evidencia. Se conserva el hallazgo original para contrastarlo.
5. La huella incluye reglas, evidencia, perfil, proveedor y modelo. Una explicación vigente se reutiliza hasta un día; evidencia diferente invalida la caché. Errores tienen un breve intervalo de espera para evitar llamadas repetidas. Se conservan como máximo veinte snapshots por proyecto.
6. El análisis se ejecuta en el worker, usa el presupuesto mensual y del espacio y no permite dos trabajos manuales simultáneos para el mismo proyecto. Los lectores no pueden encolar análisis ni cambiar el perfil. La generación dentro del informe completo se puede desactivar en el perfil.
7. Sin proveedor, presupuesto o respuesta válida, continúan disponibles las recomendaciones por reglas. La interfaz muestra la situación. No se aplican cambios al sitio automáticamente.

Estas verificaciones reducen errores detectables; no convierten una explicación del modelo en un diagnóstico certificado. La evidencia medida y su comprobación siguen siendo la referencia.

## Uso

- Abrir **Resumen → Tu plan de mejora**. En **Adaptar el plan a mi negocio**, elegir tipo de sitio y objetivo si la detección no corresponde.
- Usar **Vista guiada** para decidir y **Vista técnica** para investigar. Abrir cada acción para ver pasos, URLs y comprobación; su título lleva a la tarea correspondiente.
- Revisar **Fuentes y revisiones que faltan**. Conectar/sincronizar Search Console y Analytics, revisar páginas representativas y comprobar compras/eventos clave antes de evaluar resultados comerciales.
- Con la conexión de IA habilitada en el servidor, usar **Explicar acciones con IA** o completar un informe. El perfil permite desactivar la explicación al terminar informes. La app utiliza el proveedor/modelo existentes y sus límites de consumo.
- Abrir **Experto** para inspección, arquitectura, rendimiento, catálogo, schema, SERP, contenidos, analítica, herramientas avanzadas y trabajo diario. Configuraciones e importaciones están bajo opciones avanzadas.

## Validación y límites pendientes

Las pruebas unitarias cubren los cuatro perfiles, prioridad, incertidumbre de auditorías parciales, exclusión de tareas resueltas, contrato de IA, referencias y cifras inválidas, redacción de evidencia, petición OpenAI con esquema, invalidación por evidencia, presentación y unidades de CLS. Hay pruebas de integración para el plan público, caché y permisos; requieren una base y motores Prisma funcionales.

La suite final obtuvo **221 pruebas aprobadas, 65 omitidas por requerir base de datos y ningún fallo (286 en total)**. `tsc --noEmit` y la compilación de Next.js pasaron usando el cliente generado para tipos. La compilación emitió un aviso de descarga de Google Fonts bloqueada; no impidió generar las páginas.

La revisión con Chromium usa componentes reales en un arnés externo al producto y respuestas simuladas: escritorio y móvil, selector persistente, perfil, evidencia desplegable, filtro, estado vacío, teclado y paginación de 66 filas. También comprobó el botón de IA con una respuesta de API simulada. No equivale a una prueba E2E autenticada contra la API y la base reales.

En esta sesión los motores nativos de Prisma siguen bloqueados por el HTTP 403 de `binaries.prisma.sh`. El cliente generado para compilar no sustituye esos motores. La suite omite las pruebas de base cuando falta `DATABASE_URL`; no debe contarse esa omisión como una aprobación de integración.

La conexión real de `taupoc.cl` a Search Console/GA4, inspecciones, PageSpeed con red real, proveedores de IA y entrega de notificaciones necesita sus autorizaciones y configuración en el entorno de despliegue. No se usaron credenciales reales ni se hicieron llamadas pagadas durante esta revisión. Los pasos para Google están en [modulos-expertos.md](./modulos-expertos.md).
