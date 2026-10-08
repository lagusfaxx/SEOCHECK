import pLimit from "p-limit";
import { db } from "../db";
import { gscQuery } from "../providers/google";
import { projectGscProperty } from "../rank/gsc";
import { expandSeed } from "../providers/autocomplete";
import { embeddingProvider, type EmbeddingProvider } from "../providers";
import { resolveVolumes, volKey } from "../volume/broker";
import { HashEmbeddings } from "../providers/embeddings";
import { getSerp } from "../serp";
import { cosine, hostOf, normTerm } from "../util";
import { env } from "../env";
import { jobProgress } from "../queue";
import { classifyIntents } from "./intent";
import { difficultyProxy, embeddingClusters, kwScore, overlapClusters } from "./cluster";
import { topicLabels } from "./hdbscan";
import { matchGroups } from "./reconcile";
import { assertBudget, est } from "../budget";

type Opts = {
  maxKeywords?: number;
  serpTop?: number;
  useGsc?: boolean;
  minShared?: number;
  autocomplete?: boolean;
  /** Máx. de SERPs Deep extra de la 2ª ronda (sobre PAA/related de los seeds). 0 = desactivado. */
  serpExpansion?: number;
};

export async function runKeywordPipeline(runId: string, jobRunId?: string) {
  const run = await db.keywordRun.findUniqueOrThrow({ where: { id: runId }, include: { project: true } });
  const p = run.project;
  const settings = (p.settings ?? {}) as Record<string, any>;
  const opts: Opts = { maxKeywords: 400, serpTop: 150, useGsc: true, minShared: 3, serpExpansion: 20, ...(settings.keywords ?? {}) };
  const brands: string[] = settings.brands ?? [p.domain.split(".")[0]];
  // Presupuesto: cota superior de lo que este research puede gastar, antes de cualquier llamada
  await assertBudget(
    {
      serpent: est.serpCalls(run.seeds.length + (opts.serpExpansion ?? 0) + (opts.serpTop ?? 0)),
      llm: est.llmIntent(opts.maxKeywords ?? 400),
    },
    "Research de keywords"
  );
  const stats: Record<string, number> = {};
  const step = async (pct: number, msg: string) => {
    await jobProgress(jobRunId, pct, msg);
    await db.keywordRun.update({ where: { id: runId }, data: { status: msg } });
  };

  // 1. Expansión
  const sources = new Map<string, Set<string>>();
  const add = (t: string, s: string) => {
    const k = normTerm(t);
    if (!k || k.length > 80) return;
    if (!sources.has(k)) sources.set(k, new Set());
    sources.get(k)!.add(s);
  };
  for (const s of run.seeds) add(s, "seed");
  for (let i = 0; opts.autocomplete !== false && i < run.seeds.length; i++) {
    await step(2 + (i / run.seeds.length) * 15, "autocomplete");
    for (const s of await expandSeed(run.seeds[i], p.language, p.country)) add(s, "autocomplete");
  }
  stats.autocomplete = [...sources.values()].filter((v) => v.has("autocomplete")).length;

  // Queries reales del sitio en GSC (90 días)
  let gscState: "real" | "none" | "error" = "none";
  if (opts.useGsc && p.gscProperty && env.gscCredentials) {
    await step(18, "gsc");
    try {
      const end = new Date(Date.now() - 2 * 864e5);
      const start = new Date(end.getTime() - 90 * 864e5);
      const rows = await gscQuery((await projectGscProperty(p))!, {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        dimensions: ["query"],
        rowLimit: 5000,
      });
      for (const r of rows) add(r.keys[0], "gsc");
      stats.gsc = rows.length;
      gscState = "real";
    } catch (e) {
      gscState = "error";
      console.warn("[keywords] gsc", e);
    }
  }

  // SERP de los seeds → PAA + related (1ª ronda)
  await step(20, "serp seeds");
  let seedSerpOk = false;
  const round1: string[] = [];
  const harvest = (serp: { paa: string[]; related: string[] }, out?: string[]) => {
    for (const q of serp.related) { add(q, "related"); out?.push(normTerm(q)); }
    for (const q of serp.paa) { add(q, "paa"); out?.push(normTerm(q)); }
  };
  for (const s of env.serpentKey ? run.seeds : []) {
    try {
      harvest(await getSerp(p.id, normTerm(s), { country: p.country, language: p.language }), round1);
      seedSerpOk = true;
    } catch (e) {
      console.warn("[keywords] serp seed", e);
    }
  }

  // 2ª ronda: SERP de los términos descubiertos en la 1ª (related primero: suelen abrir subtemas)
  const seedSet = new Set(run.seeds.map(normTerm));
  const round2 = [...new Set(round1)].filter((t) => !seedSet.has(t) && t.length <= 80).slice(0, env.serpentKey ? opts.serpExpansion ?? 0 : 0);
  let r2 = 0;
  for (const t of round2) {
    await jobProgress(jobRunId, 22 + (r2 / Math.max(1, round2.length)) * 5, `serp ronda 2 ${r2 + 1}/${round2.length}`);
    try {
      harvest(await getSerp(p.id, t, { country: p.country, language: p.language }));
      r2++;
    } catch (e) {
      console.warn("[keywords] serp ronda 2", t, e);
    }
  }
  stats.serpRound2 = r2;
  stats.paa = [...sources.values()].filter((v) => v.has("paa")).length;
  stats.related = [...sources.values()].filter((v) => v.has("related")).length;
  stats.expanded = sources.size;

  // 2. Relevancia por embeddings
  await step(28, "embeddings");
  const terms = [...sources.keys()];
  let emb: EmbeddingProvider = embeddingProvider();
  let seedVecs: number[][], vecs: number[][];
  try {
    seedVecs = await emb.embed(run.seeds.map(normTerm));
    vecs = await emb.embed(terms);
  } catch (e) {
    console.warn(`[keywords] embeddings ${emb.name} fallaron, uso trigram-hash`, e);
    emb = new HashEmbeddings();
    seedVecs = await emb.embed(run.seeds.map(normTerm));
    vecs = await emb.embed(terms);
  }
  const rel = terms.map((_, i) => Math.max(...seedVecs.map((s) => cosine(s, vecs[i]))));
  let kept = terms
    .map((t, i) => ({ term: t, rel: rel[i], vec: vecs[i], src: [...sources.get(t)!] }))
    .filter((k) => k.src.includes("seed") || k.rel >= run.threshold)
    .sort((a, b) => b.rel - a.rel)
    .slice(0, opts.maxKeywords);
  stats.relevant = kept.length;

  // 3. Volumen
  await step(35, "volumen");
  const runOpts = (run.options ?? {}) as { volumeLive?: boolean };
  const vol = await resolveVolumes(
    kept.map((k) => k.term),
    { country: p.country, language: p.language, locationCode: p.locationCode, projectId: p.id, seeds: run.seeds, live: runOpts.volumeLive ? true : undefined }
  );
  const volMap = vol.data;
  stats.volCache = Number(vol.stats.cache ?? 0);
  stats.volFetched = Number(vol.stats.fetched ?? 0);
  stats.volGsc = Number(vol.stats.gsc ?? 0);
  stats.volMissing = Number(vol.stats.missing ?? 0);

  // 4. SERP top 10 (las N con más volumen×relevancia)
  const vget = (t: string) => volMap.get(volKey(t));
  const byPotential = [...kept].sort((a, b) => (vget(b.term)?.volume ?? 0) * b.rel - (vget(a.term)?.volume ?? 0) * a.rel);
  const serpTerms = env.serpentKey ? byPotential.slice(0, opts.serpTop) : [];
  const serps = new Map<string, Awaited<ReturnType<typeof getSerp>>>();
  const limit = pLimit(4);
  let done = 0;
  await Promise.all(
    serpTerms.map((k) =>
      limit(async () => {
        try {
          serps.set(k.term, await getSerp(p.id, k.term, { country: p.country, language: p.language }));
        } catch (e) {
          console.warn("[keywords] serp", k.term, e);
        }
        done++;
        if (done % 5 === 0) await jobProgress(jobRunId, 38 + (done / serpTerms.length) * 40, `serp ${done}/${serpTerms.length}`);
      })
    )
  );
  stats.serps = serps.size;

  // Intent
  await step(80, "intent");
  // El intent del proveedor de volumen (si lo trae) es dato; el resto va por reglas/LLM
  const intents = await classifyIntents(kept.filter((k) => !vget(k.term)?.intent).map((k) => ({ term: k.term, features: serps.get(k.term)?.features ?? [] })), brands);
  for (const k of kept) if (vget(k.term)?.intent) intents.set(k.term, vget(k.term)!.intent as any);

  // Persistir keywords
  await step(84, "guardando");
  const extraStrong: string[] = settings.strongDomains ?? [];
  const own = hostOf(p.domain);
  const rows = kept.map((k) => {
    const v = vget(k.term);
    const serp = serps.get(k.term);
    const difficulty = serp ? difficultyProxy(serp.organic.filter((o) => o.domain !== own), extraStrong) : null;
    return {
      term: k.term,
      sources: k.src,
      relevance: Number(k.rel.toFixed(3)),
      volume: v?.volume ?? null,
      volumeMin: v?.volumeMin ?? null,
      volumeMax: v?.volumeMax ?? null,
      volumeSource: v?.source ?? null,
      volumeAt: v?.at ?? null,
      cpc: v?.cpc ?? null,
      competition: v?.competition ?? null,
      intent: intents.get(k.term) ?? null,
      difficulty,
      // volumen desconocido → score desconocido (null), no 0
      score: v?.volume != null ? kwScore(v.volume, k.rel, difficulty ?? 50) : null,
      embedding: k.vec,
    };
  });
  // Estado previo del run (re-run): lo bloqueado a mano se conserva
  const prevClusters = await db.cluster.findMany({ where: { runId }, orderBy: { id: "asc" }, include: { keywords: { select: { term: true, locked: true } } } });
  const prevTopics = await db.topic.findMany({ where: { runId }, orderBy: { id: "asc" }, include: { clusters: { select: { id: true, topicLocked: true } } } });
  const lockedTerms = new Set(prevClusters.flatMap((c) => c.keywords.filter((k) => k.locked).map((k) => k.term)));
  const keptClusters = prevClusters.filter((c) => c.topicLocked || c.nameLocked || c.pillarLocked || c.keywords.some((k) => k.locked));
  const keptClusterIds = new Set(keptClusters.map((c) => c.id));
  const keptTopics = prevTopics.filter((t) => t.nameLocked || t.clusters.some((c) => c.topicLocked && keptClusterIds.has(c.id)));
  const prevTopicOf = new Map(prevClusters.map((c) => [c.id, c.topicId]));
  await db.cluster.deleteMany({ where: { runId, id: { notIn: [...keptClusterIds] } } });
  await db.topic.deleteMany({ where: { runId, id: { notIn: keptTopics.map((t) => t.id) } } });
  await db.keyword.updateMany({ where: { clusterId: { in: [...keptClusterIds] }, locked: false }, data: { clusterId: null } });
  await db.cluster.updateMany({ where: { id: { in: [...keptClusterIds] }, pillarLocked: false }, data: { isPillar: false } });
  await db.cluster.updateMany({ where: { id: { in: [...keptClusterIds] }, topicLocked: false }, data: { topicId: null } });

  // Keywords bloqueadas (en este u otro run) solo actualizan métricas; no cambian de run ni de cluster
  const lockedElsewhere = new Set(
    (await db.keyword.findMany({ where: { projectId: p.id, locked: true, term: { in: rows.map((r) => r.term) } }, select: { term: true } })).map((k) => k.term)
  );
  for (const r of rows) {
    const locked = lockedTerms.has(r.term) || lockedElsewhere.has(r.term);
    await db.keyword.upsert({
      where: { projectId_term: { projectId: p.id, term: r.term } },
      create: { ...r, projectId: p.id, runId },
      update: locked ? r : { ...r, runId, clusterId: null },
    });
  }
  const free = rows.filter((r) => !lockedTerms.has(r.term) && !lockedElsewhere.has(r.term));

  // 5. Clustering por overlap (solo keywords no bloqueadas)
  await step(88, "clusters");
  const withSerp = free
    .filter((r) => serps.has(r.term))
    .map((r) => ({ term: r.term, volume: r.volume ?? 0, intent: r.intent ?? "informational", urls: serps.get(r.term)!.organic.slice(0, 10).map((o) => o.url) }));
  const groups = overlapClusters(withSerp, opts.minShared);
  // Sin SERP: agrupación por similitud de embeddings para las restantes
  const inSerp = new Set(withSerp.map((w) => w.term));
  groups.push(
    ...embeddingClusters(
      free.filter((r) => !inSerp.has(r.term)).map((r) => ({ term: r.term, volume: r.volume ?? 0, intent: r.intent ?? "informational", urls: [], vec: r.embedding })),
      emb.name === "trigram-hash" ? 0.7 : 0.8
    )
  );
  const rowBy = new Map(rows.map((r) => [r.term, r]));
  const match = matchGroups(
    groups.map((g) => ({ members: g.members.map((m) => m.term) })),
    keptClusters.map((c) => ({ id: c.id, anchor: c.primary, prevMembers: new Set(c.keywords.map((k) => k.term)) }))
  );
  for (const [i, g] of groups.entries()) {
    let cid = match[i];
    if (!cid) {
      const c = await db.cluster.create({
        data: { projectId: p.id, runId, name: g.primary.term, primary: g.primary.term, intent: g.primary.intent, urls: g.primary.urls },
      });
      cid = c.id;
    }
    await db.keyword.updateMany({ where: { projectId: p.id, locked: false, term: { in: g.members.map((m) => m.term) } }, data: { clusterId: cid } });
  }
  const clusters = await db.cluster.findMany({ where: { runId }, orderBy: { id: "asc" } });
  for (const c of clusters) await refreshCluster(c.id);
  const live = await db.cluster.findMany({ where: { runId }, orderBy: { id: "asc" } });
  stats.clusters = live.length;

  // 6. Topics con HDBSCAN sobre embeddings de las primarias (clusters sin topic bloqueado)
  await step(94, "topics");
  const primEmb = new Map(
    (await db.keyword.findMany({ where: { projectId: p.id, term: { in: live.map((c) => c.primary) } }, select: { term: true, embedding: true } })).map((k) => [k.term, k.embedding])
  );
  const vecOf = (c: (typeof live)[number]) => rowBy.get(c.primary)?.embedding ?? primEmb.get(c.primary) ?? [];
  const floating = live.filter((c) => !c.topicLocked && vecOf(c).length);
  const { labels, forcedSplit } = topicLabels(floating.map(vecOf), 2);
  const byLabel = new Map<number, typeof floating>();
  floating.forEach((c, i) => {
    const l = labels[i] < 0 ? -1000 - i : labels[i]; // ruido = topic propio
    byLabel.set(l, [...(byLabel.get(l) ?? []), c]);
  });
  const labelGroups = [...byLabel.values()];
  const topicMatch = matchGroups(
    labelGroups.map((g) => ({ members: g.map((c) => c.id) })),
    keptTopics.map((t) => ({
      id: t.id,
      anchor: prevClusters.find((c) => prevTopicOf.get(c.id) === t.id && c.isPillar)?.id ?? null,
      prevMembers: new Set(prevClusters.filter((c) => prevTopicOf.get(c.id) === t.id).map((c) => c.id)),
    }))
  );
  for (const [i, members] of labelGroups.entries()) {
    const top = [...members].sort((a, b) => b.volume - a.volume)[0];
    const tid = topicMatch[i] ?? (await db.topic.create({ data: { projectId: p.id, runId, name: top.primary, forcedSplit } })).id;
    await db.cluster.updateMany({ where: { id: { in: members.map((m) => m.id) } }, data: { topicId: tid } });
  }
  // Pillar: la marcada a mano manda; si no, la de más volumen
  const topicsNow = await db.topic.findMany({ where: { runId }, orderBy: { id: "asc" }, include: { clusters: { orderBy: { id: "asc" } } } });
  for (const t of topicsNow) {
    if (!t.clusters.length && !t.nameLocked) {
      await db.topic.delete({ where: { id: t.id } });
      continue;
    }
    if (!t.nameLocked && t.clusters.length) {
      const top = [...t.clusters].sort((a, b) => b.volume - a.volume)[0];
      if (t.name !== top.primary && !keptTopics.some((k) => k.id === t.id)) await db.topic.update({ where: { id: t.id }, data: { name: top.primary } });
    }
    const manual = t.clusters.find((c) => c.pillarLocked);
    const pillar = manual ?? [...t.clusters].sort((a, b) => b.volume - a.volume)[0];
    await db.cluster.updateMany({ where: { topicId: t.id }, data: { isPillar: false } });
    if (pillar) await db.cluster.update({ where: { id: pillar.id }, data: { isPillar: true } });
  }
  stats.topics = await db.topic.count({ where: { runId } });
  stats.locked = lockedTerms.size;

  const runSources = { serp: serps.size > 0 || seedSerpOk ? "real" : "none", embeddings: emb.name, volumes: [...volMap.values()].some((v) => v.source !== "gsc") ? "real" : volMap.size ? "gsc" : "none", volumeProvider: vol.stats.provider ?? null, volumeSkipped: vol.stats.skipped ?? [], gsc: gscState };
  await db.keywordRun.update({ where: { id: runId }, data: { status: "done", stats, sources: runSources } });
  return stats;
}

/** Recalcula volumen/score de un cluster; borra los vacíos salvo que tengan ediciones manuales. */
export async function refreshCluster(clusterId: string) {
  const kws = await db.keyword.findMany({ where: { clusterId } });
  if (!kws.length) {
    const c = await db.cluster.findUnique({ where: { id: clusterId } });
    if (c && (c.nameLocked || c.topicLocked || c.pillarLocked)) {
      await db.cluster.update({ where: { id: clusterId }, data: { volume: 0, score: 0 } });
      return;
    }
    await db.cluster.delete({ where: { id: clusterId } }).catch(() => {});
    return;
  }
  await db.cluster.update({
    where: { id: clusterId },
    data: { volume: kws.reduce((s, k) => s + (k.volume ?? 0), 0), score: kws.reduce((s, k) => s + (k.score ?? 0), 0) },
  });
}
