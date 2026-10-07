# seocheck

Next.js 14 + Prisma + Postgres + worker con pg-boss (sin Redis).

## Deploy (Coolify)

1. Nuevo recurso → Docker Compose → este repo (`docker-compose.yml`).
2. Variables: ver `.env.example`. Mínimo `POSTGRES_PASSWORD`, `SERPENT_API_KEY`, `DATAFORSEO_LOGIN/PASSWORD`.
3. Dominio al servicio `web` (puerto 3000). `BASIC_AUTH=usuario:clave` protege todo.

Servicios: `db` (Postgres 16), `migrate` (one-shot: `prisma migrate deploy`), `web` (UI + API), `worker` (crawls, SERPs, clustering, sync GSC, rank tracking, briefs), `embeddings` (text-embeddings-inference con `paraphrase-multilingual-MiniLM-L12-v2` horneado en la imagen; límite de memoria `EMBEDDINGS_MEM_LIMIT`, def. 2304m, pico medido ~1,6 GiB), `browser` opcional (`--profile render`, Chromium para sitios con render JS).

Crons (zona `TZ`): `RANK_CRON` rank tracking diario/semanal, `GSC_CRON` sync de Search Console.

## Local

```bash
npm i
cp .env.example .env   # DATABASE_URL=postgresql://...
npm run db:migrate
npm run dev            # web
npm run worker         # worker
npm test
```

## Estructura

```
src/lib/providers   SerpProvider (Serpent), VolumeProvider (DataForSEO), Embeddings (TEI/OpenAI/hash), LLM (Anthropic/OpenAI), Google (GSC, URL Inspection, PSI, IndexNow), autocomplete
src/lib/keywords    expansión → relevancia → volumen → SERP → clusters por overlap de URLs → topics (HDBSCAN) → score
src/lib/audit       robots/sitemap, crawler BFS, issues por severidad, PSI, URL Inspection
src/lib/rank        rank tracking, sync GSC, alertas (caídas, canibalización, CTR bajo)
src/lib/content     top 10 → crawl → TF-IDF/n-gramas, secciones, PAA, schema → score 0–100 → brief
src/worker          colas pg-boss
src/app             UI + API (`/api/p/:id/...`)
```

Multi-tenant: `Workspace → Project`; todo cuelga de `projectId`.

GSC: crea una service account, agrega su email como usuario de la propiedad y pega el JSON (crudo o base64) en `GSC_SERVICE_ACCOUNT_JSON`. Propiedad en ajustes del proyecto (`sc-domain:dominio.cl` o `https://dominio.cl/`).

IndexNow: publica `https://dominio/<INDEXNOW_KEY>.txt` con la key como contenido.

## LLM

Por defecto `claude-sonnet-5-5`. Para usar Opus: `LLM_MODEL=claude-opus-5-5`. Sin `ANTHROPIC_API_KEY` usa OpenAI si hay `OPENAI_API_KEY`; sin ninguno, el intent queda por reglas y el brief es determinista.

Se usa para clasificar el intent de las keywords dudosas (effort `low`) y para generar el brief (effort `medium`).

**Rechazos y fallback.** Las requests van con `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Si el modelo rechaza, la API reintenta dentro de la misma llamada en otro modelo, según la categoría del rechazo:

| Modelo | Categoría del rechazo | Qué pasa |
|---|---|---|
| `claude-sonnet-5-5` | `cyber`, `frontier_llm` | se reintenta en `claude-sonnet-5` |
| `claude-sonnet-5-5` | `bio`, `reasoning_extraction`, `general_harms` | sin fallback: rechazo final |
| `claude-opus-5-5` | según categoría (`cyber` → `claude-opus-4-8`) | destinos posibles: `claude-opus-5`, `claude-opus-4-8` |
| `claude-haiku-*` | — | sin fallback server-side (no se envía el parámetro) |

Todo queda en `JobRun.log` del job: cada fallback (`LLM fallback: <modelo> rechazó, continuó <modelo>`), el modelo que respondió si no es el pedido, y el rechazo final con su categoría. Ante un rechazo final, el intent cae a `informational` y el brief al determinista; ambos casos también se registran.

## Crawler

Opciones por proyecto en `settings.crawler` (vía `PATCH /api/p/:id/_`), sobreescribibles por crawl en el body de `POST /api/p/:id/audit`:

| Opción | Default | Qué hace |
|---|---|---|
| `userAgent` | `CRAWLER_UA` | User-agent del crawl (robots.txt, páginas, sitemaps y render) |
| `maxPerPattern` | `50` | Máx. de URLs por patrón de path (`/productos/{n}?color&talla`). Corta trampas de facetas, calendarios y paginación infinita. `0` = sin límite |
| `ignoreParams` | `utm_*, gclid, fbclid, msclkid, sessionid, phpsessid, sid` | Parámetros que se quitan de las URLs descubiertas. `*` = todos |

Páginas de challenge/bloqueo de WAF (Cloudflare `cf-mitigated` / "Just a moment..." / `cf-chl`, DataDome, PerimeterX, Akamai) se guardan con `error = blocked_by_waf` y el issue crítico correspondiente, no como páginas válidas. Tras 15 bloqueos seguidos el crawl se detiene (`stats.wafAborted`).

Seguridad: todo fetch hacia URLs de usuario o crawleadas pasa por `safeFetch` (bloquea red interna, valida la IP al conectar y en cada redirect).

## Volumen de búsqueda

Prioridad por keyword: **impresiones de GSC** (28 días, si el proyecto tiene datos) > **`VOLUME_PROVIDER`** > `null`. Cada keyword guarda `volumeSource` (`gsc`/`dataforseo`/`apify`/`csv`) y `volumeAt`; la tabla muestra la fuente.

**Caché global:** `VolumeCache` por país + idioma + keyword normalizada, sin importar el proyecto. No se vuelve a pedir un dato de menos de 30 días. Lo que el proveedor no devuelve queda en `null` (nunca 0) y no se cachea.

| Proveedor | Cómo funciona |
|---|---|
| `dataforseo` | `DATAFORSEO_ENV=sandbox` por defecto (gratis, datos ficticios). Standard queue por defecto: las keywords pendientes de todos los proyectos se juntan en tasks de hasta 1.000 (`task_post` → `task_get`). El research espera hasta `DATAFORSEO_QUEUE_WAIT_SECONDS`; lo que llega después se aplica solo (backfill de volumen y score). Endpoint Live solo si el run lo pide: `POST /api/p/:id/keywords/run` con `"volumeLive": true`. |
| `apify` | Actor `APIFY_ACTOR_ID` (def. `s-r~google-keywords`), token en `Authorization: Bearer`. El actor expande **un seed** en variantes con volumen (no acepta listas): se corre un run por seed del research (`limit` 500, `min_volume` 0) y se cruzan las variantes con nuestras keywords. Hasta 200 keywords pedidas usa `run-sync-get-dataset-items`; más, runs asíncronos con polling dentro del job del worker. El costo (`usageTotalUsd`) queda en el log del job y en `ApiCall`. Sin `APIFY_TOKEN` el proveedor queda no disponible y la app sigue. |
| `csv` | Solo lo importado desde Keyword Planner. |

**Importar CSV de Keyword Planner** (UTF-16, tabs, inglés o español; rangos como `100 – 1K` → `volumeMin`/`volumeMax`, con volumen representativo = media geométrica del rango):

```bash
curl -X POST https://<host>/api/p/<projectId>/volumes/csv -H 'content-type: text/csv' --data-binary @"Keyword Stats.csv"
```

**Comparar proveedores** (máx. 100 keywords, una por línea):

```bash
npm run compare-volume -- --file keywords.txt [--out compare-volume.csv] [--apify-limit 20]
# en Docker: docker compose exec worker npm run compare-volume -- --file /tmp/keywords.txt
```

Genera `keyword, vol_dataforseo, vol_apify, diferencia_pct` y un resumen con Spearman, mediana de la diferencia % y cuántas devolvió cada uno. Con `DATAFORSEO_ENV=sandbox` los datos de DataForSEO son ficticios.

Fixture real de Apify para tests: `APIFY_TOKEN=... npm run apify-fixture` (el test usa la salida real si existe; si no, un ejemplo construido con el schema del dataset).
