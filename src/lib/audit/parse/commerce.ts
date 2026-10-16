import type { CheerioAPI } from "cheerio";
import type { StructuredSummary } from "./structured";

export type Commerce = {
  price?: number | null;
  currency?: string | null;
  availability?: string | null;
  sku?: string | null;
  /** links a fichas de producto en la página (listados) */
  productLinks?: number;
  pagination?: { next?: string | null; prev?: string | null; infinite?: boolean; pageLinks?: number };
  /** parámetros de filtro presentes en la URL */
  filters?: string[];
};

export function commerceSignals(_$: CheerioAPI, _url: string, _s: StructuredSummary): Commerce {
  return {};
}
