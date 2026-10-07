import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "./db";

/** Contexto del job en curso: lo que se loggee con jobLog() queda en JobRun.log. */
const store = new AsyncLocalStorage<{ jobRunId?: string; projectId?: string }>();

export function runWithJob<T>(jobRunId: string | undefined, fn: () => Promise<T>, projectId?: string) {
  return store.run({ jobRunId, projectId }, fn);
}

export const currentProjectId = () => store.getStore()?.projectId;

export async function jobLog(level: "info" | "warn" | "error", msg: string, data?: unknown) {
  const line = `[job${store.getStore()?.jobRunId ? ` ${store.getStore()!.jobRunId}` : ""}] ${msg}`;
  (level === "info" ? console.log : console.warn)(line, data !== undefined ? JSON.stringify(data).slice(0, 2000) : "");
  const id = store.getStore()?.jobRunId;
  if (!id) return;
  const entry = { at: new Date().toISOString(), level, msg, ...(data !== undefined ? { data } : {}) };
  // append atómico en Postgres (jsonb ||)
  await db.$executeRaw`UPDATE "JobRun" SET log = log || ${JSON.stringify([entry])}::jsonb WHERE id = ${id}`.catch((e) => console.warn("[jobLog]", e));
}
