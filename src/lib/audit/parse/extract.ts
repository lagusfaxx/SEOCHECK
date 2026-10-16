import type { CheerioAPI } from "cheerio";

/** Regla de extracción personalizada (settings.crawler.extract). */
export type ExtractRule = { name: string; type: "css" | "xpath" | "regex"; selector: string; attr?: string; all?: boolean };

/** Valores extraídos por regla: { nombre: [valores] }. */
export function extractCustom(_html: string, _$: CheerioAPI, _rules: ExtractRule[]): Record<string, string[]> {
  return {};
}
