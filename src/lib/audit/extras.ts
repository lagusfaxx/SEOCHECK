import { db } from "../db";
import { pageSpeed, urlInspect } from "../providers/google";
import { ProviderError } from "../providers/errors";
import { jobLog } from "../jobctx";
import { projectGscProperty } from "../rank/gsc";

/**
 * PageSpeed por URL: si una falla (timeout, el sitio bloquea a Lighthouse) se sigue con las otras; solo si fallan
 * todas el job queda en error, con el motivo. Una key inválida o sin cuota corta enseguida (fallaría igual).
 */
export async function runPsi(projectId: string, urls: string[], strategies: ("mobile" | "desktop")[] = ["mobile", "desktop"]) {
  const failed: string[] = [];
  let ok = 0;
  for (const url of urls) {
    for (const strategy of strategies) {
      try {
        const r = await pageSpeed(url, strategy);
        await db.psiResult.create({ data: { projectId, url, strategy, score: r.score, lab: r.lab, field: r.field } });
        ok++;
      } catch (e) {
        if (e instanceof ProviderError && (e.kind === "auth" || e.kind === "rate_limit" || e.kind === "no_balance")) throw e;
        failed.push(`${url} (${strategy}): ${e instanceof Error ? e.message : String(e)}`);
        await jobLog("warn", `PageSpeed falló para ${url} (${strategy})`, { error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  if (!ok && failed.length) throw new Error(`PageSpeed no pudo medir ninguna URL. ${failed[0]}`);
  return { ok, failed: failed.length };
}

export async function runInspection(projectId: string, urls: string[]) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const prop = await projectGscProperty(p);
  if (!prop) throw new Error("El proyecto no tiene propiedad de GSC");
  for (const url of urls) {
    const r = await urlInspect(prop, url, `${p.language}-${p.country.toUpperCase()}`, projectId);
    const idx = r?.indexStatusResult ?? {};
    await db.urlInspection.create({
      data: {
        projectId,
        url,
        verdict: idx.verdict ?? null,
        coverageState: idx.coverageState ?? null,
        googleCanonical: idx.googleCanonical ?? null,
        userCanonical: idx.userCanonical ?? null,
        lastCrawl: idx.lastCrawlTime ? new Date(idx.lastCrawlTime) : null,
        raw: r ?? {},
      },
    });
  }
}
