/**
 * Reglas adicionales del crawl: plantillas, duplicados aproximados, extracción personalizada y datos estructurados
 * (JSON-LD, microdatos, RDFa). Se suman a computeIssues.
 */
import type { Page } from "@prisma/client";
import type { IssueRow } from "./issues";

export const EXTRA_ISSUE_LABELS: Record<string, string> = {};
export const EXTRA_ISSUE_FIX: Record<string, string> = {};
export const EXTRA_ISSUE_WHY: Record<string, string> = {};
export const EXTRA_ISSUE_VERIFY: Record<string, string> = {};

export function computeExtraIssues(_pages: Page[], _ctx: { site: string }): IssueRow[] {
  return [];
}
