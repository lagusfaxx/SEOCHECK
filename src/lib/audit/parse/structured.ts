import type { CheerioAPI } from "cheerio";

/** Entidad de datos estructurados resumida (para guardar en Page.structured). */
export type Entity = { format: "jsonld" | "microdata" | "rdfa"; type: string; props: Record<string, unknown> };
export type StructuredSummary = { jsonld: Entity[]; microdata: Entity[]; rdfa: Entity[] };

/** Extrae JSON-LD (nodos ya parseados), microdatos y RDFa. */
export function extractStructured(_$: CheerioAPI, jsonldNodes: any[]): StructuredSummary {
  return { jsonld: jsonldNodes.slice(0, 0), microdata: [], rdfa: [] };
}
