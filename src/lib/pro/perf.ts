import { standard, admin, pagesOf, bounded } from "./data";
import { indexable } from "./analysis";
import { enqueue, QUEUES } from "../queue";
import { db } from "../db";
import { ProError } from "./types";
export const module = standard("perf", {
  POST: {
    measure: async (c) => {
      await admin(c);
      const running = await db.jobRun.findFirst({
        where: {
          projectId: c.id,
          kind: QUEUES.psi,
          status: { in: ["queued", "running"] },
        },
      });
      if (running) return running;
      const { pages } = await pagesOf(c.id),
        groups = new Map<string, string>();
      for (const p of [...pages].sort((a, b) => b.inlinks - a.inlinks))
        if (indexable(p) && !groups.has(p.template ?? "other"))
          groups.set(p.template ?? "other", p.url);
      const urls = [...groups.values()].slice(0, bounded(c.body.limit, 5, 10));
      if (!urls.length) throw new ProError("Primero ejecuta un crawl");
      return enqueue(c.id, QUEUES.psi, {
        urls,
        strategies: ["mobile", "desktop"],
      });
    },
  },
});
