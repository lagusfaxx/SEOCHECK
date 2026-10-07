import pLimit from "p-limit";
import { db } from "../db";
import { gscQuery } from "../providers/google";
import { expandSeed } from "../providers/autocomplete";
import { embeddingProvider, volumeProvider } from "../providers";
import { getSerp } from "../serp";
import { cosine, hostOf, normTerm } from "../util";
import { env } from "../env";
import { jobProgress } from "../queue";
import { classifyIntents } from "./intent";
import { difficultyProxy, embeddingClusters, kwScore, overlapClusters } from "./cluster";
import { topicLabels } from "./hdbscan";

type Opts = { maxKeywords?: number; serpTop?: number; useGsc?: boolean; minShared?: number };

export async function runKeywordPipeline(runId: string, jobRunId?: string) {
  const run = await db.keywordRun.findUniqueOrThrow({ where: { id: runId }, include: { project: true } });
  const p = run.project;
  const settings = (p.settings ?? {}) as Record<string, any>;
  const opts: Opts = { maxKeywords: 400, serpTop: 150, useGsc: true, minShared: 3, ...(settings.keywords ?? {}) };
  const brands: string[] = settings.brands ?? [p.domain.split(".")[0]];
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
  for (let i = 0; i < run.seeds.length; i++) {
    await step(2 + (i / run.seeds.length) * 15, "autocomplete");
    for (const s of await expandSeed(run.seeds[i], p.language, p.country)) add(s, "autocomplete");
  }
  stats.autocomplete = sources.size;

  if (opts.useGsc && p.gscProperty && env.gscCredentials) {
    await step(18, "gsc");
    try {
      const end = new Date(Date.now() - 2 * 864e5);
      const start = new Date(end.getTime() - 90 * 864e5);
      const rows = await gscQuery(p.gscProperty, {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        dimensions: ["query"],
        rowLimit: 5000,
      });
      for (const r of rows) add(r.keys[0], "gsc");
      stats.gsc = rows.length;
    } catch (e) {
      console.warn("[keywords] gsc", e);
    }
  }

  // SERP de los seeds → PAA + related
  await step(22, "serp seeds");
  for (const s of env.serpentKey ? run.seeds : []) {
    try {
      const serp = await getSerp(p.id, normTerm(s), { country: p.country, language: p.language });
      serp.paa.forEach((q) => add(q, "paa"));
      serp.related.forEach((q) => add(q, "related"));
    } catch (e) {
      console.warn("[keywords] serp seed", e);
    }
  }
  stats.expanded = sources.size;

  // 2. Relevancia por embeddings
  await step(28, "embeddings");
  const terms = [...sources.keys()];
  const emb = embeddingProvider();
  const seedVecs = await emb.embed(run.seeds.map(normTerm));
  const vecs = await emb.embed(terms);
  const rel = terms.map((_, i) => Math.max(...seedVecs.map((s) => cosine(s, vecs[i]))));
  let kept = terms
    .map((t, i) => ({ term: t, rel: rel[i], vec: vecs[i], src: [...sources.get(t)!] }))
    .filter((k) => k.src.includes("seed") || k.rel >= run.threshold)
    .sort((a, b) => b.rel - a.rel)
    .slice(0, opts.maxKeywords);
  stats.relevant = kept.length;

  // 3. Volumen
  await step(35, "volumen");
  const volMap = new Map<string, { volume: number | null; cpc: number | null; competition: number | null }>();
  if (env.dfsLogin) {
    try {
      for (const v of await volumeProvider().volumes(kept.map((k) => k.term), { locationCode: p.locationCode, language: p.language })) volMap.set(v.keyword, v);
    } catch (e) {
      console.warn("[keywords] volumen", e);
    }
  }

  // 4. SERP top 10 (las N con más volumen×relevancia)
  const byPotential = [...kept].sort((a, b) => (volMap.get(b.term)?.volume ?? 0) * b.rel - (volMap.get(a.term)?.volume ?? 0) * a.rel);
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
  const intents = await classifyIntents(kept.map((k) => ({ term: k.term, features: serps.get(k.term)?.features ?? [] })), brands);

  // Persistir keywords
  await step(84, "guardando");
  const extraStrong: string[] = settings.strongDomains ?? [];
  const own = hostOf(p.domain);
  const rows = kept.map((k) => {
    const v = volMap.get(k.term);
    const serp = serps.get(k.term);
    const difficulty = serp ? difficultyProxy(serp.organic.filter((o) => o.domain !== own), extraStrong) : null;
    return {
      term: k.term,
      sources: k.src,
      relevance: Number(k.rel.toFixed(3)),
      volume: v?.volume ?? null,
      cpc: v?.cpc ?? null,
      competition: v?.competition ?? null,
      intent: intents.get(k.term) ?? null,
      difficulty,
      score: v?.volume != null || difficulty != null ? kwScore(v?.volume ?? 0, k.rel, difficulty ?? 50) : null,
      embedding: k.vec,
    };
  });
  for (const r of rows) {
    await db.keyword.upsert({
      where: { projectId_term: { projectId: p.id, term: r.term } },
      create: { ...r, projectId: p.id, runId },
      update: { ...r, runId, clusterId: null },
    });
  }

  // 5. Clustering por overlap
  await step(88, "clusters");
  await db.cluster.deleteMany({ where: { runId } });
  await db.topic.deleteMany({ where: { runId } });
  const withSerp = rows
    .filter((r) => serps.has(r.term))
    .map((r) => ({ term: r.term, volume: r.volume ?? 0, intent: r.intent ?? "informational", urls: serps.get(r.term)!.organic.slice(0, 10).map((o) => o.url) }));
  const groups = overlapClusters(withSerp, opts.minShared);
  // Sin SERP: agrupación por similitud de embeddings para las restantes
  const inSerp = new Set(withSerp.map((w) => w.term));
  groups.push(
    ...embeddingClusters(
      rows.filter((r) => !inSerp.has(r.term)).map((r) => ({ term: r.term, volume: r.volume ?? 0, intent: r.intent ?? "informational", urls: [], vec: r.embedding })),
      env.embeddingsUrl || env.openaiKey ? 0.8 : 0.7
    )
  );
  const rowBy = new Map(rows.map((r) => [r.term, r]));
  const created: { id: string; primary: string; volume: number; vec: number[] }[] = [];
  for (const g of groups) {
    const vol = g.members.reduce((s, m) => s + m.volume, 0);
    const score = g.members.reduce((s, m) => s + (rowBy.get(m.term)?.score ?? 0), 0);
    const c = await db.cluster.create({
      data: { projectId: p.id, runId, name: g.primary.term, primary: g.primary.term, intent: g.primary.intent, volume: vol, score, urls: g.primary.urls },
    });
    await db.keyword.updateMany({ where: { projectId: p.id, term: { in: g.members.map((m) => m.term) } }, data: { clusterId: c.id } });
    created.push({ id: c.id, primary: g.primary.term, volume: vol, vec: rowBy.get(g.primary.term)!.embedding });
  }
  stats.clusters = created.length;

  // 6. Topics con HDBSCAN sobre embeddings de las primarias
  await step(94, "topics");
  const labels = topicLabels(created.map((c) => c.vec), 2);
  const byLabel = new Map<number, typeof created>();
  created.forEach((c, i) => {
    const l = labels[i] < 0 ? -1000 - i : labels[i]; // ruido = topic propio
    byLabel.set(l, [...(byLabel.get(l) ?? []), c]);
  });
  for (const members of byLabel.values()) {
    const pillar = [...members].sort((a, b) => b.volume - a.volume)[0];
    const t = await db.topic.create({ data: { projectId: p.id, runId, name: pillar.primary } });
    await db.cluster.updateMany({ where: { id: { in: members.map((m) => m.id) } }, data: { topicId: t.id } });
    await db.cluster.update({ where: { id: pillar.id }, data: { isPillar: true } });
  }
  stats.topics = byLabel.size;

  await db.keywordRun.update({ where: { id: runId }, data: { status: "done", stats } });
  return stats;
}

/** Recalcula volumen/score de un cluster tras mover keywords en la UI. */
export async function refreshCluster(clusterId: string) {
  const kws = await db.keyword.findMany({ where: { clusterId } });
  if (!kws.length) {
    await db.cluster.delete({ where: { id: clusterId } }).catch(() => {});
    return;
  }
  await db.cluster.update({
    where: { id: clusterId },
    data: { volume: kws.reduce((s, k) => s + (k.volume ?? 0), 0), score: kws.reduce((s, k) => s + (k.score ?? 0), 0) },
  });
}
