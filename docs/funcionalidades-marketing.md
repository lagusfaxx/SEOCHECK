# Funcionalidades para que marketing use la herramienta y mueva las métricas

Referencia: lo que ofrecen Semrush, Ahrefs, SE Ranking, Sistrix y los paneles de Search Console + GA4 que usan los equipos de marketing, filtrado por una pregunta: **¿ayuda a decidir qué hacer esta semana y a demostrar que funcionó?**

Estados: ✅ disponible · 🆕 agregado en esta versión · ⏳ pendiente (orden sugerido).

## 1. Medir resultados (lo que pide gerencia)

| Funcionalidad | Estado | Dónde |
|---|---|---|
| Clics, impresiones, CTR y posición con período y fuente explícitos | 🆕 un solo período en todo | Resultados, Informe, PDF |
| Clics **sin marca** vs **de marca** | 🆕 | Resultados |
| Rendimiento por sección / plantilla con variación | 🆕 | Resultados |
| Objetivo mensual de clics con proyección y clics/día faltantes | 🆕 | Resultados |
| Anotaciones de cambios con efecto antes/después en su alcance | 🆕 | Resultados → Cambios |
| Medición automática de tareas resueltas | 🆕 | Resultados, Informe |
| Resumen por correo con lo esencial y próximas acciones | 🆕 solo a miembros del equipo | Informe → Programación |
| Informe PDF ejecutivo y técnico, white-label | ✅ | Informe |
| **Conversiones e ingresos por landing (GA4)** | ⏳ 1 | — |
| Exportación a Looker Studio / Sheets (API o CSV programado) | ⏳ 4 | — |

## 2. Encontrar crecimiento

| Funcionalidad | Estado | Dónde |
|---|---|---|
| Oportunidades posición 4–20 con **clics extra estimados** | 🆕 | Resultados |
| CTR bajo para la posición | ✅ | Search Console, Informe |
| Contenido en caída sostenida para refrescar | 🆕 | Resultados |
| Research de keywords con volumen, intención y clusters | ✅ | Keywords |
| Páginas a crear por cluster sin URL propia | ✅ | Keywords, Informe |
| Canibalización con excepciones (marca, posición ≤ 1,5) | ✅ | Rankings, Informe |
| Variantes ortográficas con tráfico | ✅ | Informe |
| Brief de contenido verificado contra el sitio | 🆕 links reales, sin filtros repetidos ni afirmaciones sin respaldo | Contenido |
| **Keyword gap contra competidores** (lo que ellos rankean y tú no) | ⏳ 2 | — |
| Estacionalidad de la demanda (tendencia mensual del volumen) | ⏳ 6 | — |

## 3. Competencia y visibilidad

| Funcionalidad | Estado | Dónde |
|---|---|---|
| Rank tracking diario/semanal con alertas de caída | ✅ | Rankings |
| Cuota de visibilidad por dominio en las keywords monitoreadas | 🆕 | Resultados |
| Presencia en **AI Overviews** y si te citan | 🆕 | Resultados |
| **Backlinks**: dominios de referencia vs competidores, nuevos/perdidos, links rotos entrantes a recuperar con 301 y dominios que enlazan a la competencia y no a ti | 🆕 con la cuenta DataForSEO del servidor; el cliente no configura nada | Resultados, Informe, correo |
| SEO local: Google Business Profile, reseñas, rankings por comuna | ⏳ 5 | — |

## 4. Salud técnica (que no se pierda lo ganado)

| Funcionalidad | Estado | Dónde |
|---|---|---|
| Auditoría con estados: error confirmado, hipótesis, mejora opcional, intencional | 🆕 | Auditoría, Informe |
| Evidencia por incidencia (URL, estado HTTP, origen, valor, fecha) | 🆕 | Auditoría, Informe, PDF |
| Contenido y links que dependen de JavaScript (con render) | 🆕 | Auditoría |
| Datos estructurados vs lo visible (precio, stock, reseñas) | 🆕 | Auditoría |
| Enlazado interno de páginas clave (profundidad, desde dónde) | 🆕 | Informe |
| Embudo de URLs: sitemap → rastreadas → con impresiones → indexadas | 🆕 | Informe |
| Core Web Vitals de campo separados del laboratorio | ✅ | Auditoría, Informe, PDF |
| Verificación específica por corrección (qué cambia y qué se conserva) | 🆕 | Informe, PDF |
| **Monitoreo de cambios entre crawls** (title, canonical, noindex, robots que cambian solos) | ⏳ 7 | — |

## 5. Trabajo en equipo

| Funcionalidad | Estado |
|---|---|
| Tareas con estados e historial, verificadas por el siguiente crawl | ✅ |
| Workspaces, roles e invitaciones | ✅ |
| **Responsable y fecha límite por tarea** | ⏳ 8 |
| Notificaciones de alertas por correo/Slack al ocurrir (no solo en el resumen) | ⏳ 9 |

## Orden sugerido de lo pendiente

1. **GA4** (conversiones e ingresos por landing orgánica): sin esto no se puede hablar de retorno. Requiere agregar el permiso `analytics.readonly` a la conexión de Google existente y elegir la propiedad.
2. **Keyword gap**: con las SERPs que ya se guardan se puede listar qué keywords traen tráfico a los competidores y no al sitio; para cobertura completa hace falta un proveedor (DataForSEO Labs).
4. Exportación programada a Sheets/Looker Studio.
5. SEO local (Google Business Profile API).
6. Estacionalidad del volumen (ya viene en la respuesta de DataForSEO; falta guardarla).
7. Monitoreo de cambios entre crawls.
8. Responsable y fecha límite por tarea.
9. Alertas inmediatas por correo/Slack.
