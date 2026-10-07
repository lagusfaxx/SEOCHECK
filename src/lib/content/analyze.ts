import pLimit from "p-limit";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { fetchPage, type PageData } from "../audit/crawler";
import { llmProvider } from "../providers";
import { getSerp } from "../serp";
import { ngrams, tf, tokens } from "../text";
import { hostOf, median } from "../util";
import { jobProgress } from "../queue";

export type Section = { label: string; count: number; covered: boolean; variants: string[] };
export type Term = { term: string; weight: number; coverage: number; target: number; mine: number; missing: boolean };
export type Competitor = { url: string; domain: string; position: number; title: string | null; words: number; h2: number; h3: number; schema: string[]; questions: number };

export type ContentResult = {
  keyword: string;
  url: string;
  score: number;
  breakdown: { terms: number; length: number; sections: number; paa: number; schema: number };
  mine: { words: number; title: string | null; meta: string | null; h1: string[]; headings: { tag: string; text: string }[]; schema: string[] };
  competitors: Competitor[];
  targetWords: number;
  terms: Term[];
  sections: Section[];
  paa: { q: string; answered: boolean }[];
  questions: string[];
  schema: { type: string; count: number; mine: boolean }[];
};

export type Brief = {
  titles: string[];
  metas: string[];
  outline: { id: string; tag: "h2" | "h3"; text: string; notes?: string }[];
  faq: { q: string; a: string }[];
  notes?: string[];
};

const Q_START = /^(¿|qué|que|cómo|como|cuál|cual|cuáles|cuánto|cuanto|cuántos|dónde|donde|por qué|cuándo|quién|para qué|es |son |se puede)/i;

function questionsOf(p: PageData): string[] {
  const out = new Set<string>();
  for (const h of p.headings) if (h.text.endsWith("?") || Q_START.test(h.text)) out.add(h.text.replace(/^¿/, "").replace(/\?$/, "").trim());
  for (const m of p.text.matchAll(/¿([^?]{8,120})\?/g)) out.add(m[1].trim());
  return [...out].slice(0, 40);
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
};

async function corpusIdf(lang: string, terms: string[]) {
  const meta = await db.corpusMeta.findUnique({ where: { lang } });
  const docs = meta?.docs ?? 0;
  const rows = terms.length ? await db.corpusTerm.findMany({ where: { lang, term: { in: terms } } }) : [];
  const df = new Map(rows.map((r) => [r.term, r.df]));
  return (t: string) => Math.log((docs + 1) / ((df.get(t) ?? 0) + 1)) + 1;
}

async function addToCorpus(lang: string, docs: Set<string>[]) {
  const counts = new Map<string, number>();
  for (const d of docs) for (const t of d) counts.set(t, (counts.get(t) ?? 0) + 1);
  const entries = [...counts.entries()].filter(([t]) => t.length <= 80);
  for (let i = 0; i < entries.length; i += 2000) {
    const slice = entries.slice(i, i + 2000);
    await db.$executeRaw`
      INSERT INTO "CorpusTerm" (lang, term, df)
      SELECT ${lang}, t, d FROM unnest(${slice.map((e) => e[0])}::text[], ${slice.map((e) => e[1])}::int[]) AS x(t, d)
      ON CONFLICT (lang, term) DO UPDATE SET df = "CorpusTerm".df + EXCLUDED.df`;
  }
  await db.corpusMeta.upsert({ where: { lang }, create: { lang, docs: docs.length }, update: { docs: { increment: docs.length } } });
}

export async function analyzeContent(id: string, jobRunId?: string) {
  const a = await db.contentAnalysis.findUniqueOrThrow({ where: { id }, include: { project: true } });
  const p = a.project;
  await db.contentAnalysis.update({ where: { id }, data: { status: "running" } });
  await jobProgress(jobRunId, 5, "serp");
  const serp = await getSerp(p.id, a.keyword.toLowerCase(), { country: p.country, language: p.language });
  const own = hostOf(a.url);
  const top = serp.organic.filter((o) => o.domain !== own).slice(0, 10);

  await jobProgress(jobRunId, 15, "crawl");
  const limit = pLimit(5);
  let done = 0;
  const [mine, ...comps] = await Promise.all([
    fetchPage(a.url).catch(() => null),
    ...top.map((o) =>
      limit(async () => {
        const pd = await fetchPage(o.url).catch(() => null);
        await jobProgress(jobRunId, 15 + (++done / top.length) * 50, `${done}/${top.length}`);
        return pd && pd.status === 200 && pd.wordCount > 100 ? { o, pd } : null;
      })
    ),
  ]);
  const competitors = comps.filter(Boolean) as { o: (typeof top)[number]; pd: PageData }[];
  if (!competitors.length) throw new Error("No se pudo leer ningún competidor");
  const minePd = mine && mine.status === 200 ? mine : null;

  // Términos
  await jobProgress(jobRunId, 70, "términos");
  const compTf = competitors.map((c) => tf(ngrams(`${c.pd.title ?? ""} ${c.pd.headings.map((h) => h.text).join(" ")} ${c.pd.text}`)));
  const myTf = tf(ngrams(minePd ? `${minePd.title ?? ""} ${minePd.headings.map((h) => h.text).join(" ")} ${minePd.text}` : ""));
  const candidates = new Map<string, number[]>();
  compTf.forEach((m) => m.forEach((c, t) => candidates.set(t, [...(candidates.get(t) ?? []), c])));
  const N = competitors.length;
  const cand = [...candidates.entries()].filter(([, cs]) => cs.length >= Math.max(2, Math.ceil(N * 0.3)));
  const idf = await corpusIdf(p.language, cand.map(([t]) => t));
  const kwTokens = new Set(tokens(a.keyword));
  let terms: Term[] = cand
    .map(([term, cs]) => {
      const coverage = cs.length / N;
      const nWords = term.split(" ").length;
      const weight = coverage * idf(term) * Math.log(1 + median(cs)) * (1 + 0.3 * (nWords - 1));
      const mineCount = myTf.get(term) ?? 0;
      return { term, weight, coverage, target: Math.max(1, Math.round(median(cs))), mine: mineCount, missing: mineCount === 0 };
    })
    .filter((t) => !t.term.split(" ").every((w) => kwTokens.has(w)) || t.term.split(" ").length > 1)
    .sort((x, y) => y.weight - x.weight);
  // Quita unigramas contenidos en n-gramas más fuertes ya elegidos
  const chosen: Term[] = [];
  for (const t of terms) {
    if (chosen.length >= 60) break;
    if (chosen.some((c) => c.term.includes(t.term) && c.coverage >= t.coverage)) continue;
    chosen.push(t);
  }
  terms = chosen;
  await addToCorpus(p.language, competitors.map((c) => new Set(ngrams(c.pd.text))));

  // Secciones comunes (H2)
  const groups: { sig: Set<string>; label: string; variants: string[]; docs: Set<number> }[] = [];
  competitors.forEach((c, i) => {
    for (const h of c.pd.headings.filter((h) => h.tag === "h2")) {
      const sig = new Set(tokens(h.text));
      if (!sig.size) continue;
      const g = groups.find((g) => jaccard(g.sig, sig) >= 0.5);
      if (g) {
        g.docs.add(i);
        if (g.variants.length < 5) g.variants.push(h.text);
      } else groups.push({ sig, label: h.text, variants: [h.text], docs: new Set([i]) });
    }
  });
  const myHeads = (minePd?.headings ?? []).filter((h) => h.tag !== "h1").map((h) => new Set(tokens(h.text)));
  const sections: Section[] = groups
    .filter((g) => g.docs.size >= Math.max(2, Math.ceil(N * 0.25)))
    .sort((x, y) => y.docs.size - x.docs.size)
    .slice(0, 25)
    .map((g) => ({ label: g.label, count: g.docs.size, variants: g.variants, covered: myHeads.some((m) => jaccard(m, g.sig) >= 0.4) }));

  // PAA
  const myTokens = new Set(tokens(minePd?.text ?? ""));
  const paa = serp.paa.map((q) => {
    const qt = tokens(q).filter((t) => !kwTokens.has(t));
    const hit = qt.filter((t) => myTokens.has(t)).length / Math.max(1, qt.length);
    const inHeads = (minePd?.headings ?? []).some((h) => jaccard(new Set(tokens(h.text)), new Set(tokens(q))) >= 0.5);
    return { q, answered: inHeads || hit >= 0.8 };
  });
  const questions = [...new Set(competitors.flatMap((c) => questionsOf(c.pd)))].slice(0, 40);

  // Schema
  const schemaCount = new Map<string, number>();
  competitors.forEach((c) => c.pd.jsonldTypes.forEach((t) => schemaCount.set(t, (schemaCount.get(t) ?? 0) + 1)));
  const mySchema = new Set(minePd?.jsonldTypes ?? []);
  const schema = [...schemaCount.entries()].sort((x, y) => y[1] - x[1]).map(([type, count]) => ({ type, count, mine: mySchema.has(type) }));

  // Score
  const targetWords = Math.round(median(competitors.map((c) => c.pd.wordCount)));
  const myWords = minePd?.wordCount ?? 0;
  const wsum = terms.reduce((s, t) => s + t.weight, 0) || 1;
  const sTerms = terms.reduce((s, t) => s + (t.mine ? t.weight * Math.min(1, t.mine / t.target) : 0), 0) / wsum;
  const sLen = targetWords ? Math.min(1, myWords / (targetWords * 0.9)) : 1;
  const sSec = sections.length ? sections.filter((s) => s.covered).length / sections.length : 1;
  const sPaa = paa.length ? paa.filter((x) => x.answered).length / paa.length : 1;
  const common = schema.filter((s) => s.count >= Math.ceil(N * 0.3));
  const sSchema = common.length ? common.filter((s) => s.mine).length / common.length : 1;
  const breakdown = { terms: Math.round(sTerms * 40), length: Math.round(sLen * 15), sections: Math.round(sSec * 20), paa: Math.round(sPaa * 15), schema: Math.round(sSchema * 10) };
  const score = Object.values(breakdown).reduce((s, x) => s + x, 0);

  const result: ContentResult = {
    keyword: a.keyword,
    url: a.url,
    score,
    breakdown,
    mine: { words: myWords, title: minePd?.title ?? null, meta: null, h1: minePd?.h1 ?? [], headings: minePd?.headings ?? [], schema: [...mySchema] },
    competitors: competitors.map((c) => ({
      url: c.o.url, domain: c.o.domain, position: c.o.position, title: c.pd.title, words: c.pd.wordCount,
      h2: c.pd.headings.filter((h) => h.tag === "h2").length, h3: c.pd.headings.filter((h) => h.tag === "h3").length,
      schema: c.pd.jsonldTypes, questions: questionsOf(c.pd).length,
    })),
    targetWords,
    terms,
    sections,
    paa,
    questions,
    schema,
  };
  await db.contentAnalysis.update({ where: { id }, data: { result: result as unknown as Prisma.InputJsonValue, score, status: "brief" } });

  await jobProgress(jobRunId, 85, "brief");
  const brief = await makeBrief(result, p.language, p.country);
  await db.contentAnalysis.update({ where: { id }, data: { brief: brief as unknown as Prisma.InputJsonValue, status: "done" } });
  return { score };
}

let seq = 0;
const nid = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

function fallbackBrief(r: ContentResult): Brief {
  const outline: Brief["outline"] = r.sections.slice(0, 10).map((s) => ({ id: nid(), tag: "h2", text: s.label }));
  for (const q of r.paa.filter((x) => !x.answered)) outline.push({ id: nid(), tag: "h3", text: q.q });
  return {
    titles: [`${r.keyword[0].toUpperCase()}${r.keyword.slice(1)}: guía completa ${new Date().getFullYear()}`],
    metas: [],
    outline,
    faq: r.paa.map((x) => ({ q: x.q, a: "" })),
  };
}

export async function makeBrief(r: ContentResult, language: string, country: string): Promise<Brief> {
  const llm = llmProvider();
  if (!llm) return fallbackBrief(r);
  const input = {
    keyword: r.keyword,
    idioma: language,
    pais: country,
    palabras_objetivo: r.targetWords,
    title_actual: r.mine.title,
    headings_actuales: r.mine.headings.slice(0, 40),
    terminos_faltantes: r.terms.filter((t) => t.missing).slice(0, 30).map((t) => t.term),
    terminos_clave: r.terms.slice(0, 30).map((t) => t.term),
    secciones_comunes: r.sections.map((s) => ({ seccion: s.label, competidores: s.count, cubierta: s.covered })),
    paa: r.paa,
    preguntas_competencia: r.questions.slice(0, 20),
    schema_competencia: r.schema.slice(0, 8),
    titles_competencia: r.competitors.map((c) => c.title).filter(Boolean).slice(0, 10),
  };
  try {
    const out = await llm.json<Omit<Brief, "outline"> & { outline: { tag: "h2" | "h3"; text: string; notes?: string }[] }>(
      "Eres un editor SEO senior. Escribes en el idioma y variante del país indicado. Títulos ≤ 60 caracteres, metas 140–155 caracteres. Sin relleno ni frases genéricas.",
      `Con este análisis de SERP genera el brief.\n\nFormato:\n{"titles": [5 strings], "metas": [3 strings], "outline": [{"tag":"h2"|"h3","text": string,"notes": string corto con términos a cubrir}], "faq": [{"q": string,"a": respuesta de 2-3 frases}], "notes": [máx 5 indicaciones concretas]}\n\nEl outline cubre las secciones comunes, los términos faltantes y las PAA sin responder. FAQ de 4 a 8 preguntas.\n\n${JSON.stringify(input)}`
    );
    return {
      titles: out.titles ?? [],
      metas: out.metas ?? [],
      outline: (out.outline ?? []).map((o) => ({ ...o, id: nid(), tag: o.tag === "h3" ? "h3" : "h2" })),
      faq: out.faq ?? [],
      notes: out.notes ?? [],
    };
  } catch (e) {
    console.warn("[brief]", e);
    return fallbackBrief(r);
  }
}

export function faqJsonLd(faq: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.filter((f) => f.q && f.a).map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}
