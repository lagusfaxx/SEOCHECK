import { SerpentProvider } from "./serpent";
import type { SerpProvider } from "./types";

export function serpProvider(): SerpProvider {
  return new SerpentProvider();
}
export { embeddingProvider } from "./embeddings";
export { llmProvider } from "./llm";
export * from "./types";
