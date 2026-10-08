import { db } from "../db";
import { pageSpeed, urlInspect } from "../providers/google";
import { projectGscProperty } from "../rank/gsc";

export async function runPsi(projectId: string, urls: string[], strategies: ("mobile" | "desktop")[] = ["mobile", "desktop"]) {
  for (const url of urls) {
    for (const strategy of strategies) {
      const r = await pageSpeed(url, strategy);
      await db.psiResult.create({ data: { projectId, url, strategy, score: r.score, lab: r.lab, field: r.field } });
    }
  }
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
