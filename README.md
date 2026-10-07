# seocheck

Next.js 14 + Prisma + Postgres + worker con pg-boss (sin Redis).

## Deploy (Coolify)

1. Nuevo recurso → Docker Compose → este repo (`docker-compose.yml`).
2. Variables: ver `.env.example`. Mínimo `POSTGRES_PASSWORD`, `SERPENT_API_KEY`, `DATAFORSEO_LOGIN/PASSWORD`.
3. Dominio al servicio `web` (puerto 3000). `BASIC_AUTH=usuario:clave` protege todo.

Servicios: `db` (Postgres 16), `migrate` (one-shot: `prisma migrate deploy`), `web` (UI + API), `worker` (crawls, SERPs, clustering, sync GSC, rank tracking, briefs), `embeddings` (text-embeddings-inference con `paraphrase-multilingual-MiniLM-L12-v2`), `browser` opcional (`--profile render`, Chromium para sitios con render JS).

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
