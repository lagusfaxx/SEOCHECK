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

`LLM_PROVIDER=openai` (default) con `OPENAI_API_KEY` y `LLM_MODEL` por defecto **`gpt-4o-mini`**: el modelo "mini" más barato vigente según la tabla de precios de OpenAI al 2026-10-07 ($0,15 / 1M tokens de entrada, $0,075 cacheados, $0,60 / 1M de salida), y no figura en su página de deprecaciones. Se llama por Chat Completions en JSON mode con `max_completion_tokens`, que sirve también para la familia gpt-5 si cambias el modelo.

Claude es opcional: `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (default `claude-sonnet-5-5`). Sin la clave del proveedor elegido no hay LLM: el intent queda por reglas y el brief es determinista.

Se usa para el intent de keywords dudosas y para el brief. Cada llamada registra en `ProviderUsage` el modelo, los tokens de entrada y salida y el costo en USD, calculado con `src/lib/pricing.ts`. Para un modelo que no está en la tabla se usa `LLM_PRICE_INPUT`/`LLM_PRICE_OUTPUT` (USD por 1M) o, si no están, la tarifa más cara conocida (conservador para el presupuesto).

**Rechazos con Claude (`LLM_PROVIDER=anthropic`).** Las requests van con `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`):

| Modelo | Categoría del rechazo | Qué pasa |
|---|---|---|
| `claude-sonnet-5-5` | `cyber`, `frontier_llm` | se reintenta en `claude-sonnet-5` |
| `claude-sonnet-5-5` | `bio`, `reasoning_extraction`, `general_harms` | sin fallback: rechazo final |
| `claude-opus-5-5` | según categoría (`cyber` → `claude-opus-4-8`) | destinos posibles: `claude-opus-5`, `claude-opus-4-8` |
| `claude-haiku-*` | — | sin fallback server-side |

Cada fallback y rechazo final queda en `JobRun.log`. Con OpenAI, un `refusal` también queda registrado y el job cae a reglas o brief determinista.

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

Prioridad por keyword:

1. **Impresiones de GSC** (28 días) cuando el proyecto las tiene: mandan sobre todo lo demás.
2. **Cadena `VOLUME_PROVIDERS`** (def. `dataforseo,apify,csv`): se usa el primer proveedor disponible. Uno sin credenciales, o que responde **sin saldo** (DataForSEO: HTTP 402 o `status_code` 40200/40210; Apify: 402), se salta y se pasa al siguiente. Queda marcado `PROVIDER_RETRY_HOURS` (def. 6) y la vista Keywords lo avisa.
3. `null`: lo que el proveedor elegido no devuelve queda sin dato (nunca 0) y no se pregunta a los demás.

Cada keyword guarda `volumeSource` y `volumeAt`; la tabla muestra la fuente. **Caché global** `VolumeCache` por país + idioma + keyword normalizada, sin importar el proyecto: no se vuelve a pedir un dato de menos de 30 días.

| Proveedor | Cómo funciona |
|---|---|
| `dataforseo` (default) | `DATAFORSEO_ENV=live` y `DATAFORSEO_MODE=live`: endpoint Live, hasta 1.000 keywords por task. `DATAFORSEO_ENV=sandbox` para pruebas gratis (datos ficticios). `DATAFORSEO_MODE=queue`: standard queue que junta keywords de varios proyectos por task y completa lo pendiente después. |
| `apify` (opcional) | Ver abajo. |
| `csv` | Solo lo importado desde Keyword Planner. |

### Apify (opcional)

Token en `APIFY_TOKEN` (header `Authorization: Bearer`). Con `APIFY_MONTHLY_USD=0` (default) queda bloqueado por presupuesto aunque haya token.

- **`s-r~google-keywords`** (`APIFY_ACTOR_ID` por defecto). El actor recibe **un** `keyword` y devuelve variantes de autocomplete con volumen.
  - `APIFY_MODE=exact` (default): un run por keyword con `limit=1` y `max_suggestions=0`, que devuelve la keyword exacta (verificado a mano: **$0,003 y ~28 s por run**). Corre `APIFY_CONCURRENCY` runs en paralelo (def. 3).
  - `APIFY_MODE=seed`: un run por seed del research (`limit` 500, `min_volume` 0) y se cruzan las variantes con nuestras keywords. Hasta 200 keywords usa `run-sync-get-dataset-items`; más, runs asíncronos con polling dentro del job.
- **`steadyfetch~keyword-search-volume-scraper`** (`APIFY_ACTOR_ID=steadyfetch~keyword-search-volume-scraper`): acepta la **lista** completa en un run (`keywords: [...]`, `country: "CL"`, `mode: "metrics-only"`). Según su ficha: $0,19 por run con datos frescos + $0,012 por keyword con dato en el plan free (menos en planes pagos); las keywords sin dato no se cobran. Exige `maxTotalChargeUsd ≥ 0,25`, que se envía calculado.

El costo de cada run (`usageTotalUsd`) queda en el log del job y en el registro de uso (en `run-sync` se busca el run por ventana de tiempo, best effort).

**Keywords Everywhere:** no está integrado (el plan mínimo es anual). Si se retoma: la API exige clave hasta para `/countries`, y el ejemplo de su doc no incluye Chile, así que hay que confirmar que CL esté soportado antes de usarla.

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

Fixtures reales de Apify para tests: `APIFY_TOKEN=... npm run apify-fixture` (s-r) y `npm run apify-fixture -- --actor steadyfetch~keyword-search-volume-scraper`. Los tests usan la salida real si existe; si no, el ejemplo del schema (s-r) o la fila real publicada en el README del actor (steadyfetch).
