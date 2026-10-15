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
| **Conversiones e ingresos por landing (GA4)**, canal Organic Search, mismo período que Search Console | 🆕 con la conexión de Google del cliente (sin claves) | Resultados, Informe, correo |
| Exportación a Google Sheets / Looker Studio (CSV con token revocable) | 🆕 | Resultados |

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
| **Keyword gap contra competidores** (top 20 de ellos, el sitio no aparece) | 🆕 DataForSEO Labs del servidor, mensual | Resultados, Informe |
| Estacionalidad: meses pico por keyword y "se viene la temporada" | 🆕 | Resultados, Informe |

## 3. Competencia y visibilidad

| Funcionalidad | Estado | Dónde |
|---|---|---|
| Rank tracking diario/semanal con alertas de caída | ✅ | Rankings |
| Cuota de visibilidad por dominio en las keywords monitoreadas | 🆕 | Resultados |
| Presencia en **AI Overviews** y si te citan | 🆕 | Resultados |
| **Backlinks**: dominios de referencia vs competidores, nuevos/perdidos, links rotos entrantes a recuperar con 301 y dominios que enlazan a la competencia y no a ti | 🆕 con la cuenta DataForSEO del servidor; el cliente no configura nada | Resultados, Informe, correo |
| Visibilidad en IA: si ChatGPT, Claude, Gemini y Perplexity citan el sitio | 🆕 Serpent del servidor, semanal | Resultados, Informe, correo |
| SEO local: posición y rating en Google Maps por ciudad o comuna, top 3 | 🆕 Serpent del servidor, semanal | Resultados, Informe, correo |

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
| Cambios entre crawls (estado, noindex, title, canonical, H1, páginas desaparecidas) | 🆕 | Resultados → Avisos, Informe |

## 5. Trabajo en equipo

| Funcionalidad | Estado |
|---|---|
| Tareas con estados e historial, verificadas por el siguiente crawl | ✅ |
| Workspaces, roles e invitaciones | ✅ |
| Responsable (miembro del equipo, avisado por correo) y fecha límite por tarea | 🆕 |
| Avisos inmediatos por correo: home caída, robots.txt que bloquea todo, noindex o errores nuevos en páginas con tráfico, cambios masivos, caída de clics, caída de keywords, backlinks perdidos | 🆕 |

## Qué configura cada uno

- **Servidor (una vez, quien opera la instalación):** `DATAFORSEO_LOGIN/PASSWORD` (backlinks, keyword gap, volumen), `SERPENT_API_KEY` (rankings, IA, Google Maps), `GOOGLE_OAUTH_CLIENT_ID/SECRET` + `TOKEN_ENC_KEY` (conexión de Google), `RESEND_API_KEY` + `MAIL_FROM` (correos), `PAGESPEED_API_KEY`. Los límites de gasto mensuales (`DATAFORSEO_MONTHLY_USD`, `SERPENT_MONTHLY_USD`) frenan cualquier paso que no quepa.
- **Cliente:** solo inicia sesión con Google (Search Console y Analytics en una autorización) y, si quiere, define objetivo del mes, competidores, búsquedas locales y quién recibe correos. No pone claves.

## Siguientes pasos posibles

- Slack o WhatsApp como canal de avisos además del correo.
- Google Business Profile API (con OAuth del cliente) para responder reseñas y ver llamadas/rutas desde Maps.
- Atribución de ingresos por consulta (cruce GSC × GA4 por landing) y pronóstico de tráfico por keyword.
