import { fetchT, normTerm, sleep } from "../util";

const QUESTIONS_ES = ["qué", "cómo", "cuál", "cuánto", "dónde", "por qué", "cuándo", "quién"];
const LETTERS = "abcdefghijklmnopqrstuvwxyzñ".split("");

export async function suggest(q: string, hl: string, gl: string): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetchT(url, { timeoutMs: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return [];
    const json = (await res.json()) as [string, string[]];
    return (json[1] ?? []).map(normTerm);
  } catch {
    return [];
  }
}

/** Expande un seed con a–z, interrogativos y el seed solo. */
export async function expandSeed(seed: string, hl = "es", gl = "cl", onProgress?: (n: number, total: number) => void) {
  const queries = [seed, ...LETTERS.map((l) => `${seed} ${l}`), ...QUESTIONS_ES.map((w) => `${w} ${seed}`)];
  const out = new Set<string>();
  let i = 0;
  for (const q of queries) {
    for (const s of await suggest(q, hl, gl)) out.add(s);
    onProgress?.(++i, queries.length);
    await sleep(120);
  }
  return [...out];
}
