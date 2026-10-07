export type OrganicResult = { position: number; url: string; title: string; snippet?: string; domain: string };

export type Serp = {
  keyword: string;
  organic: OrganicResult[];
  paa: string[];
  related: string[];
  features: string[];
  aiOverview: unknown | null;
};

export interface SerpProvider {
  search(q: string, opts: { country: string; language: string; depth?: number }): Promise<Serp>;
}

export type VolumeRow = { keyword: string; volume: number | null; cpc: number | null; competition: number | null };

export interface VolumeProvider {
  volumes(keywords: string[], opts: { locationCode: number; language: string }): Promise<VolumeRow[]>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export interface LLMProvider {
  json<T>(system: string, user: string, maxTokens?: number): Promise<T>;
}
