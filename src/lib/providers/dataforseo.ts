import { env } from "../env";
import { logCost } from "../costs";
import { chunk, fetchT } from "../util";
import type { VolumeProvider, VolumeRow } from "./types";

export class DataForSeoProvider implements VolumeProvider {
  async volumes(keywords: string[], opts: { locationCode: number; language: string; projectId?: string }): Promise<VolumeRow[]> {
    if (!env.dfsLogin) throw new Error("Falta DATAFORSEO_LOGIN");
    const auth = Buffer.from(`${env.dfsLogin}:${env.dfsPassword}`).toString("base64");
    const out: VolumeRow[] = [];
    // Google Ads limita a 80 caracteres y 10 palabras por keyword
    const valid = keywords.filter((k) => k.length <= 80 && k.split(" ").length <= 10);
    for (const batch of chunk(valid, 1000)) {
      const res = await fetchT("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify([{ keywords: batch, location_code: opts.locationCode, language_code: opts.language }]),
        timeoutMs: 120000,
      });
      if (!res.ok) throw new Error(`DataForSEO ${res.status}`);
      // DataForSEO factura por task (hasta 1.000 keywords por task)
      await logCost("dataforseo", "google_ads/search_volume", 1, { projectId: opts.projectId, ref: `${batch.length} keywords` });
      const json: any = await res.json();
      const task = json.tasks?.[0];
      if (task?.status_code && task.status_code >= 40000) throw new Error(`DataForSEO: ${task.status_message}`);
      for (const r of task?.result ?? []) {
        out.push({
          keyword: String(r.keyword).toLowerCase(),
          volume: r.search_volume ?? null,
          cpc: r.cpc ?? null,
          competition: r.competition_index != null ? r.competition_index / 100 : null,
        });
      }
    }
    return out;
  }
}
