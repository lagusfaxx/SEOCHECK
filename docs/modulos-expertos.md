# Módulos expertos B–L

La pestaña **Experto** reúne doce vistas. Lee el último crawl público completado o parcial y conserva snapshots con fuente y fecha. **Actualizar análisis** recalcula con los datos guardados; inspeccionar y medir encolan trabajos del worker. No ejecuta búsquedas de pago al abrir las pestañas.

| Bloque | Implementación                                                                                                                | Fuente y límite                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B      | Robots según las reglas de Googlebot (o el grupo propio del bot si robots.txt lo nombra), parámetros/facetas, cadenas y bucles de redirección, canonicals en bucle, robots meta vs X-Robots-Tag, HTML vs DOM renderizado (render por sección), pausa/reanudación, auditorías privadas de staging, hipótesis de soft 404 y evidencia por URL | HTML final recibido, cabeceras sin cookies, cadena HTTP, directivas y fecha. Se leen hasta 2 MiB por respuesta y se guardan hasta 256 KB como evidencia; se indica si se recorta. Robots 429/5xx detiene el crawl. Las credenciales de staging se guardan cifradas, solo se envían a ese host y esos crawls no entran en informes, tareas ni avisos.           |
| C      | Matriz sitemap/indexación, inspección por lotes priorizada por clics e impresiones, canonical y motivo de cobertura           | URL Inspection de Google; las URLs sin inspección tienen estado desconocido. Se reutilizan inspecciones de menos de siete días. Hasta 100 por lote; no solicita indexación. |
| D      | Profundidad, enlaces con anchor y zona, páginas sin enlace encontrado y propuestas entre páginas relacionadas                 | Grafo del crawl. La cobertura parcial y las URLs solo vistas en sitemap se identifican; las sugerencias requieren revisión editorial.                                       |
| E      | LCP/INP de campo por URL y plantilla, medición representativa mobile/desktop                                                  | PageSpeed Insights/CrUX. Datos de origen se identifican sin atribuirlos a una plantilla; no se calcula un falso p75 combinando percentiles ni se convierte TBT en INP.      |
| F      | Stock indexable, variantes con SKU compartido y categorías sin texto principal                                                | Product/Offer, canonical y HTML. Hallazgos para revisar; sin stock y variantes no provocan desindexación automática.                                                        |
| G      | Extracción JSON-LD, microdatos y RDFa; comprobación de Product, Offer, Breadcrumb y FAQ                                       | Campos locales y comparación con texto leído. No garantiza elegibilidad en Google ni reemplaza Rich Results Test.                                                           |
| H      | Tipos de resultado y aparición/desaparición de featured snippets                                                              | Snapshots SERP existentes. Presencia del snippet no implica que lo posea el proyecto. El seguimiento se ejecuta desde Rankings.                                             |
| I      | Brief por cluster, contenido en caída, lastmod antiguo y calendario editorial persistente                                     | Keywords agrupadas, URL objetivo, períodos GSC consecutivos y tareas. Generar un brief usa las cuotas y controles existentes.                                               |
| J      | Ingreso **estimado** por consulta y escenarios a 28 días                                                                      | Cruce landing/día de GSC y GA4; reparto por clics observados. No es atribución de ventas a consultas. Exige 28 días contiguos para proyectar.                               |
| K      | Importación de logs, monitor del propio sitio (robots.txt, tamaño del sitemap, páginas críticas) y de competencia, verificación de migraciones, hreflang, imágenes y Google Business Profile        | Resúmenes de logs sin IP/query/líneas crudas. Googlebot, Bingbot y Applebot verificados por DNS inverso y directo (hasta 200 IP, sin guardarlas); los demás bots, solo declarados por UA. Hasta 10 URLs de competencia y una observación diaria. Inventario GBP con OAuth propio.          |
| L      | Qué hago hoy, plantillas, roles viewer/editor, API de lectura y avisos Slack/WhatsApp/webhook                                 | Tareas pendientes y vencidas hasta hoy según TZ; hasta 100 por vista. Credenciales de API se muestran una vez y solo se guarda su hash.                                     |

## Instalación y validación

Se mantienen Node.js 22, Next.js 14, Prisma 5.22 y PostgreSQL 16. Desde la raíz:

```sh
npm ci
npx prisma generate
npm run db:deploy
npm run typecheck
npm run build
npm run dev
npm run worker
```

Las migraciones añaden los modelos expertos y la evidencia de respuestas, formatos de canal y bandeja durable de entregas. No borran datos existentes. `DATABASE_URL` debe apuntar al entorno de desarrollo; los tests de integración requieren otra base, con las mismas migraciones:

```sh
DATABASE_URL=postgresql://.../seo_test npm run db:deploy
DATABASE_URL=postgresql://.../seo_test npm test
```

Sin `DATABASE_URL`, el runner omite los tests de integración. Eso **no** valida consultas ni el worker. Se necesita acceso HTTPS a `binaries.prisma.sh` para descargar los motores Prisma con sus verificaciones; no desactivar checksum ni TLS. Los tipos generados sin motores permiten compilar y ejecutar pruebas unitarias, pero no reemplazan la validación con base de datos.

## Conexión Google de taupoc.cl

1. En el proyecto de `taupoc.cl`, conectar Google con una cuenta que tenga acceso a Search Console y a la propiedad GA4 del dominio. Habilitar Search Console API, Google Analytics Admin API y Google Analytics Data API en el proyecto OAuth.
2. La lista de propiedades recorre todas las páginas de `accountSummaries` y de `dataStreams`. La asociación usa `webStreamData.defaultUri`, nunca el nombre visible de la propiedad. Los fallos al leer flujos se distinguen de la ausencia de un dominio coincidente.
3. Si hay una única propiedad coincidente se selecciona; si hay varias, elegir en Resultados. Sincronizar Analytics y comprobar fechas, moneda, sesiones orgánicas e ingresos frente a la interfaz de GA4.
4. `runReport` filtra el canal Organic Search y los hosts del dominio del proyecto. Las landings `(not set)` se conservan como no identificadas, sin sumarlas a la portada.
5. Para Business Profile, **Autorizar Google Business Profile** solicita además `business.manage`. Habilitar las APIs de administración de cuentas e información del negocio y obtener acceso de Google al negocio. El botón de lectura guarda las ubicaciones accesibles; no modifica fichas.

Las pruebas con respuestas simuladas verifican contratos y paginación; el acceso real a `taupoc.cl` solo se puede comprobar después de autorizar esa cuenta.

Referencias oficiales: [accountSummaries.list](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list), [dataStreams.list](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.dataStreams/list), [runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport), [URL Inspection](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect), [Business Profile locations.list](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list).

## Avisos, permisos y API

Crear canales en **Experto → Equipo y API** requiere rol dueño/admin del espacio. Slack usa un webhook entrante HTTPS de `hooks.slack.com`. WhatsApp usa Cloud API con `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, una plantilla aprobada con un parámetro de texto y el idioma `WHATSAPP_TEMPLATE_LANGUAGE`. Esos valores se configuran de forma segura en el servidor; no se guardan en el repositorio ni en el navegador. Docker Compose transmite las variables al web y al worker.

El worker ejecuta `pro.daily` según `PRO_CRON` y revisa `pro.deliver` cada minuto. Las entregas se guardan antes de enviar, se deduplican por canal/evento y se reintentan hasta cinco veces con espera creciente. La interfaz muestra el estado y el último error. Un proceso reiniciado retoma la cola pendiente. La entrega puede repetirse si el receptor aceptó el mensaje y se perdió la respuesta; los webhooks genéricos reciben `X-Seocheck-Delivery` para deduplicar y `X-Seocheck-Signature` (`sha256=HMAC(secret, cuerpo exacto)`). Se validan destinos públicos con la protección SSRF existente y no se siguen redirects en envíos.

Eventos implementados: `daily.digest`, `crawl.completed`, `alert.created`, `task.updated` y `report.ready`; `*` suscribe a todos. El token de lectura de API permite:

```text
GET /api/expert/PROJECT_ID/MODULE
Authorization: Bearer TOKEN
```

Módulos: `crawl`, `templates`, `structure`, `index`, `arch`, `perf`, `shop`, `serp`, `content`, `analytics`. El token solo sirve para su proyecto, tiene límite de solicitudes y se puede revocar. No permite escribir ni usar la sesión de un usuario.

La lista de acceso por proyecto (se agrega a cada persona por su correo) restringe a los miembros del espacio: `viewer` solo consulta y `editor` puede trabajar. Dueños y administradores conservan acceso. Al quitar la última restricción, se recupera el acceso normal de los miembros del espacio.

## Evidencia de esta entrega (16 de octubre de 2026)

- `npm run typecheck`: aprobado.
- `npx next build`: aprobado, con el cliente Prisma generado sin motores para comprobar tipos y bundles. El script completo `npm run build` todavía requiere descargar los motores.
- `npm test` sin `DATABASE_URL`: **261 pruebas registradas, 199 aprobadas, 62 omitidas, 0 fallidas**. Incluye 23 pruebas nuevas de parsers, robots, indexación, arquitectura, ecommerce, datos estructurados, rendimiento, SERP, ingresos, logs, firmas y contrato de Analytics; las seis nuevas pruebas de integración forman parte de las omitidas.
- Todas las migraciones SQL, incluidas las dos migraciones expertas, aplicadas con `ON_ERROR_STOP` en una base nueva y aislada de PostgreSQL 16. No equivale a ejecutar `prisma migrate deploy`.
- Build arrancado con `next start`: health y setup respondieron 200; API de sesión, API de token sin credencial y escritura no autorizada respondieron 401. El servidor de esta comprobación se detuvo después.
- `docker compose config --quiet` y `git diff --check`: aprobados.

Queda bloqueada la integración con Prisma/worker: el proxy devuelve HTTP 403 al descargar los motores de `binaries.prisma.sh`. Aplicar el permiso de red y ejecutar `npx prisma generate`, migraciones y la suite contra una base de pruebas antes de desplegar. Google real (`taupoc.cl` y Business Profile), PageSpeed y canales de avisos requieren sus conexiones y no se probaron contra servicios reales en esta máquina. No se enviaron mensajes reales.
