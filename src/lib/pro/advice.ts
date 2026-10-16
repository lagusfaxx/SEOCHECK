import { db } from "../db";
import { admin, project } from "./data";
import { ProError, type ProModule } from "./types";
import { profileOf } from "../advice/plan";
import { adviceReport } from "../advice/service";
import { requireProjectWrite, projectRole } from "../auth";
import { getBoss, jobError, QUEUES } from "../queue";
import { assertPlanActive } from "../plans";
export const module: ProModule = {
  prefix: "advice",
  routes: {
    GET: {
      "": async ({ id, user }) => {
        const [report, role, access] = await Promise.all([
          adviceReport(id),
          projectRole(user.id, id),
          db.projectAccess.findUnique({
            where: { projectId_userId: { projectId: id, userId: user.id } },
          }),
        ]);
        return {
          ...report,
          permissions: {
            manage: role === "owner" || role === "admin",
            analyze: role !== "member" || access?.role !== "viewer",
          },
        };
      },
    },
    PATCH: {
      profile: async (c) => {
        await admin(c);
        const b = c.body;
        if (
          b.siteType != null &&
          !["auto", "ecommerce", "services", "content", "general"].includes(
            b.siteType,
          )
        )
          throw new ProError("Tipo de sitio inválido");
        if (
          b.goal != null &&
          !["sales", "leads", "readers", "visibility"].includes(b.goal)
        )
          throw new ProError("Objetivo inválido");
        if (b.aiEnabled != null && typeof b.aiEnabled !== "boolean")
          throw new ProError("Preferencia de IA inválida");
        // jsonb_set conserva cambios concurrentes de otros ajustes del proyecto.
        const p = await project(c.id),
          profile = profileOf({
            ...profileOf((p.settings as any)?.advice),
            ...b,
          });
        await db.$executeRaw`UPDATE "Project" SET settings=jsonb_set(settings,'{advice}',${JSON.stringify(profile)}::jsonb,true) WHERE id=${c.id}`;
        return profile;
      },
    },
    POST: {
      analyze: async (c) => {
        await requireProjectWrite(c.user.id, c.id);
        await assertPlanActive(c.id);
        const report = await adviceReport(c.id);
        if (!report.ai.available || !report.profile.aiEnabled)
          throw new ProError(
            "La IA no está habilitada; puedes seguir usando el análisis y las acciones medidas",
          );
        if (report.ai.state === "ready") return { status: "reused" };
        if (!report.actions.length) return { status: "skipped" };
        const result = await db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.id + ":advice"}))`;
          const busy = await tx.jobRun.findFirst({
            where: {
              projectId: c.id,
              kind: QUEUES.advice,
              status: { in: ["queued", "running"] },
            },
          });
          return busy
            ? { job: busy, created: false }
            : {
                job: await tx.jobRun.create({
                  data: { projectId: c.id, kind: QUEUES.advice },
                }),
                created: true,
              };
        });
        if (result.created)
          try {
            const boss = await getBoss(),
              bossId = await boss.send(
                QUEUES.advice,
                { projectId: c.id, jobRunId: result.job.id },
                { retryLimit: 0, expireInMinutes: 10 },
              );
            if (!bossId) throw new Error("No se pudo encolar el análisis");
            await db.jobRun.update({
              where: { id: result.job.id },
              data: { bossId },
            });
          } catch (e) {
            await jobError(result.job.id, e);
            throw e;
          }
        return result.job;
      },
    },
  },
};
