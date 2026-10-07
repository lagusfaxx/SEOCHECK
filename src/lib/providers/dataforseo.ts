import { env } from "../env";
import { logCost } from "../costs";
import { jobLog } from "../jobctx";
import { chunk, fetchT } from "../util";
import { sanitizeKeywords } from "./sanitize";
import type { VolumeProvider, VolumeRow } from "./types";

type Opts = { locationCode: number; language: string; projectId?: string };

export class DataForSeoProvider implements VolumeProvider {
  private auth() {
    return Buffer.from(`${env.dfsLogin}:${env.dfsPassword}`).toString("base64");
  }

  /** Un task; si DataForSEO rechaza el task completo, se parte en mitades para aislar keywords inválidas. */
  private async task(batch: string[], opts: Opts, depth = 0): Promise<any[]> {
    const res = await fetchT("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live", {
      method: "POST",
      headers: { Authorization: `Basic ${this.auth()}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ keywords: batch, location_code: opts.locationCode, language_code: opts.language }]),
      timeoutMs: 120000,
    });
    if (!res.ok) throw new Error(`DataForSEO ${res.status}`);
    // DataForSEO factura por task (hasta 1.000 keywords por task)
    await logCost("dataforseo", "google_ads/search_volume", 1, { projectId: opts.projectId, ref: `${batch.length} keywords` });
    const json: any = await res.json();
    const task = json.tasks?.[0];
    if (task?.status_code && task.status_code >= 40000) {
      if (batch.length === 1 || depth >= 6) {
        await jobLog("warn", `DataForSEO rechazó ${batch.length} keyword(s): ${task.status_message}`, { keywords: batch.slice(0, 20) });
        return [];
      }
      const mid = Math.ceil(batch.length / 2);
      await jobLog("warn", `DataForSEO rechazó un task de ${batch.length} (${task.status_message}); se divide para aislar la keyword inválida`);
      return [...(await this.task(batch.slice(0, mid), opts, depth + 1)), ...(await this.task(batch.slice(mid), opts, depth + 1))];
    }
    return task?.result ?? [];
  }

  async volumes(keywords: string[], opts: Opts): Promise<VolumeRow[]> {
    if (!env.dfsLogin) throw new Error("Falta DATAFORSEO_LOGIN");
    const { valid, rejected } = sanitizeKeywords(keywords);
    if (rejected.length) await jobLog("info", `DataForSEO: ${rejected.length} keywords no válidas para Google Ads, no se envían`, { rejected: rejected.slice(0, 50) });
    const out: VolumeRow[] = [];
    for (const batch of chunk([...valid.keys()], 1000)) {
      for (const r of await this.task(batch, opts)) {
        const cleaned = String(r.keyword).toLowerCase();
        for (const original of valid.get(cleaned) ?? [cleaned]) {
          out.push({
            keyword: original,
            volume: r.search_volume ?? null,
            cpc: r.cpc ?? null,
            competition: r.competition_index != null ? r.competition_index / 100 : null,
          });
        }
      }
    }
    return out;
  }
}
