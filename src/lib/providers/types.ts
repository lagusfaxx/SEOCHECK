export type OrganicResult = { position: number; url: string; title: string; snippet?: string; domain: string };

export type Serp = {
  keyword: string;
  organic: OrganicResult[];
  paa: string[];
  related: string[];
  features: string[];
  aiOverview: unknown | null;
};

export type SerpOpts = { country: string; language: string; projectId?: string };

export interface SerpProvider {
  /** SERP completo de 1 página: orgánicos + PAA + related + features. Research y content. */
  deep(q: string, opts: SerpOpts): Promise<Serp>;
  /** Solo orgánicos hasta `num` (≤100) en una llamada facturada una vez. Rank tracking. */
  quick(q: string, opts: SerpOpts & { num?: number }): Promise<Serp>;
}

export type VolumeRow = { keyword: string; volume: number | null; cpc: number | null; competition: number | null };

export interface VolumeProvider {
  volumes(keywords: string[], opts: { locationCode: number; language: string; projectId?: string }): Promise<VolumeRow[]>;
}

export interface EmbeddingProvider {
  /** Modelo efectivo (p.ej. paraphrase-multilingual-MiniLM-L12-v2) o "trigram-hash". */
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface LLMProvider {
  json<T>(system: string, user: string, maxTokens?: number): Promise<T>;
}
