import { db } from "../db";
import { standard, admin, text } from "./data";
import { ProError } from "./types";
import { assertBudget, est } from "../budget";
import { assertProviderUp } from "../providers/health";
import { withProjectQuota } from "../plans";
import { enqueue, QUEUES } from "../queue";
import { sameSite } from "../util";
export const module = standard("content", {
  POST: {
    brief: async (c) => {
      await admin(c);
      const cluster = await db.cluster.findFirst({
        where: { id: text(c.body.clusterId), projectId: c.id },
      });
      if (!cluster) throw new ProError("Cluster no encontrado", 404);
      const p = await db.project.findUniqueOrThrow({ where: { id: c.id } }),
        url = text(c.body.url) || cluster.targetUrl;
      if (!url || !sameSite(url, p.domain) || !/^https?:\/\//.test(url))
        throw new ProError("Define una URL objetivo del dominio del proyecto");
      await assertProviderUp("serpent");
      await assertBudget(
        { serpent: est.serpCalls(1), llm: est.llmBrief() },
        "Brief por cluster",
      );
      const a = await withProjectQuota(c.id, "briefs", 1, (tx) =>
        tx.contentAnalysis.create({
          data: { projectId: c.id, url, keyword: cluster.primary },
        }),
      );
      await enqueue(c.id, QUEUES.content, { contentId: a.id }, a.id);
      return a;
    },
    calendar: async (c) => {
      await admin(c);
      const title = text(c.body.title, 200),
        due = new Date(c.body.dueAt);
      if (!title || !Number.isFinite(due.getTime()))
        throw new ProError("Indica título y fecha");
      const url = text(c.body.url) || null;
      const task = await db.projectTask.create({
        data: {
          projectId: c.id,
          fingerprint: `calendar:${crypto.randomUUID()}`,
          title,
          reason: text(c.body.reason) || "Plan editorial",
          source: "content-calendar",
          dueAt: due,
          url,
        },
      });
      return task;
    },
  },
});
