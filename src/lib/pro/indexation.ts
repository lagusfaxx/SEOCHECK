import { db } from "../db";
import { standard, admin, pagesOf, traffic, bounded, lastCrawl } from "./data";
import { enqueue, QUEUES } from "../queue";
import { json } from "./analysis";
import { parseRobots, robotsAllows } from "../audit/robots";
import { sameSite } from "../util";
import { project } from "./data";
import { ProError } from "./types";
export const module = standard("index", {
  POST: {
    inspect: async (c) => {
      await admin(c);
      const running = await db.jobRun.findFirst({
        where: {
          projectId: c.id,
          kind: QUEUES.inspect,
          status: { in: ["queued", "running"] },
        },
      });
      if (running) return running;
      const [{ pages }, { rows }] = await Promise.all([
          pagesOf(c.id),
          traffic(c.id),
        ]),
        scores = new Map<string, number>();
      for (const r of rows)
        scores.set(
          r.page,
          (scores.get(r.page) ?? 0) + r.clicks * 1000 + r.impressions,
        );
      const recent = await db.urlInspection.findMany({
          where: {
            projectId: c.id,
            createdAt: { gte: new Date(Date.now() - 7 * 864e5) },
          },
          select: { url: true },
        }),
        skip = new Set(recent.map((r) => r.url));
      const [crawl, p] = await Promise.all([lastCrawl(c.id), project(c.id)]),
        robots = parseRobots(
          crawl?.robots ?? "",
          json(crawl?.config).userAgent ?? "SEOCheckBot",
        );
      const candidates = [
        ...new Set([
          ...pages.filter((p) => !p.blocked && !p.error).map((p) => p.url),
          ...(json(crawl?.sitemapAudit).entries ?? []).map((e: any) => e.url),
        ]),
      ] as string[];
      const urls = candidates
        .filter(
          (u) =>
            sameSite(u, p.domain) && robotsAllows(robots, u) && !skip.has(u),
        )
        .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))
        .slice(0, bounded(c.body.limit, 20, 100));
      if (!urls.length)
        throw new ProError(
          "No hay URLs pendientes: las inspecciones de menos de siete días se reutilizan",
        );
      return enqueue(c.id, QUEUES.inspect, { urls });
    },
  },
});
