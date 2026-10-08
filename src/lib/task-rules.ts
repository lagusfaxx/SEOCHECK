export type TaskStatus =
  | "detected"
  | "pending"
  | "resolved"
  | "reappeared"
  | "ignored";
export const TASK_STATUSES: TaskStatus[] = [
  "detected",
  "pending",
  "resolved",
  "reappeared",
  "ignored",
];
/** Ignoring is durable. A resolution is contradicted only by a later successful observation. */
export function observedStatus(status: string, sameCrawl: boolean): TaskStatus {
  if (status === "ignored") return "ignored";
  if (status === "resolved" && !sameCrawl) return "reappeared";
  return TASK_STATUSES.includes(status as TaskStatus)
    ? (status as TaskStatus)
    : "detected";
}
export function canAutoResolve(
  crawlStatus: string,
  successfulPages: Set<string>,
  url: string | null,
) {
  return crawlStatus === "completed" && !!url && successfulPages.has(url);
}
export function issueIdentity(code: string, url: string) {
  return JSON.stringify([code, url]);
}
export function priorityFor(
  severity: string,
  impressions: number,
  inlinks: number,
) {
  const severityWeight =
    severity === "critical" ? 5 : severity === "warning" ? 2 : 1;
  return (
    severityWeight * (impressions > 0 ? impressions : Math.max(1, inlinks))
  );
}
