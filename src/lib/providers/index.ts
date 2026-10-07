import { DataForSeoProvider } from "./dataforseo";
import { SerpentProvider } from "./serpent";
import type { SerpProvider, VolumeProvider } from "./types";

export function serpProvider(): SerpProvider {
  return new SerpentProvider();
}
export function volumeProvider(): VolumeProvider {
  return new DataForSeoProvider();
}
export { embeddingProvider } from "./embeddings";
export { llmProvider } from "./llm";
export * from "./types";
