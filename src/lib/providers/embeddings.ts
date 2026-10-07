import { env } from "../env";
import { chunk, fetchT } from "../util";
import type { EmbeddingProvider } from "./types";

/** text-embeddings-inference (HF) corriendo paraphrase-multilingual-MiniLM-L12-v2 en local. */
class TeiEmbeddings implements EmbeddingProvider {
  async embed(texts: string[]) {
    const out: number[][] = [];
    for (const batch of chunk(texts, 32)) {
      const res = await fetchT(`${env.embeddingsUrl.replace(/\/$/, "")}/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: batch, normalize: true, truncate: true }),
        timeoutMs: 120000,
      });
      if (!res.ok) throw new Error(`Embeddings ${res.status}`);
      out.push(...((await res.json()) as number[][]));
    }
    return out;
  }
}

class OpenAIEmbeddings implements EmbeddingProvider {
  async embed(texts: string[]) {
    const out: number[][] = [];
    for (const batch of chunk(texts, 512)) {
      const res = await fetchT("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: batch }),
        timeoutMs: 120000,
      });
      if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}`);
      const json: any = await res.json();
      out.push(...json.data.map((d: any) => d.embedding));
    }
    return out;
  }
}

/** Sin proveedor: bolsa de trigramas de caracteres hasheados (degradado pero funcional). */
class HashEmbeddings implements EmbeddingProvider {
  async embed(texts: string[]) {
    const D = 512;
    return texts.map((t) => {
      const v = new Array(D).fill(0);
      const s = ` ${t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
      for (let i = 0; i < s.length - 2; i++) {
        let h = 0;
        for (const c of s.slice(i, i + 3)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        v[h % D] += 1;
      }
      const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
      return v.map((x) => x / n);
    });
  }
}

export function embeddingProvider(): EmbeddingProvider {
  if (env.embeddingsUrl) return new TeiEmbeddings();
  if (env.openaiKey) return new OpenAIEmbeddings();
  return new HashEmbeddings();
}
