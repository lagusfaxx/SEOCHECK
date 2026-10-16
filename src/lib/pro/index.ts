/**
 * Módulos expertos. Cada uno registra sus rutas bajo /api/p/:id/pro/<prefix>/<ruta> y, opcionalmente, una tarea
 * diaria y un gancho al terminar el crawl.
 */
import { module as advice } from "./advice";
import type { ProHandler, ProModule } from "./types";
import { module as crawlpro } from "./crawlpro";
import { module as indexation } from "./indexation";
import { module as architecture } from "./architecture";
import { module as perf } from "./perf";
import { module as ecommerce } from "./ecommerce";
import { module as serp } from "./serp";
import { module as contentpro } from "./contentpro";
import { module as analytics } from "./analytics";
import { module as advanced } from "./advanced";
import { module as ops } from "./ops";
import { module as structure, templatesModule } from "./structure";

export const PRO_MODULES: ProModule[] = [
  advice,
  crawlpro,
  structure,
  templatesModule,
  indexation,
  architecture,
  perf,
  ecommerce,
  serp,
  contentpro,
  analytics,
  advanced,
  ops,
];

function table(method: "GET" | "POST" | "PATCH" | "DELETE") {
  const out: Record<string, ProHandler> = {};
  for (const m of PRO_MODULES)
    for (const [k, h] of Object.entries(m.routes[method] ?? {}))
      out[`pro/${m.prefix}${k ? `/${k}` : ""}`] = h;
  return out;
}
export const PRO_GETS = table("GET");
export const PRO_POSTS = table("POST");
export const PRO_PATCHS = table("PATCH");
export const PRO_DELETES = table("DELETE");

/** Tarea diaria de todos los módulos; un módulo que falla no frena a los demás. */
export async function runProDaily(projectId: string) {
  const errors: string[] = [];
  for (const m of PRO_MODULES)
    if (m.daily)
      await m.daily(projectId).catch((e) => {
        errors.push(
          `${m.prefix}: ${e instanceof Error ? e.message : String(e)}`,
        );
        console.warn(`[pro.daily] ${m.prefix}`, e);
      });
  return { errors };
}

/** Ganchos al terminar un crawl (no deben tirar el crawl). */
export async function runAfterCrawl(crawlId: string, projectId: string) {
  for (const m of PRO_MODULES)
    if (m.afterCrawl)
      await m
        .afterCrawl(crawlId, projectId)
        .catch((e) => console.warn(`[pro.afterCrawl] ${m.prefix}`, e));
}
