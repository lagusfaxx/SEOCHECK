import { signalTask } from "../tasks";
import { db } from "../db";

/** CTR esperado aproximado por posición (curva orgánica genérica). */
export function expectedCtr(pos: number) {
  const curve = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
  if (pos < 1) return curve[0];
  if (pos <= 10) return curve[Math.round(pos) - 1];
  return 0.01;
}

async function upsertAlert(projectId: string, type: string, key: string, data: Record<string, unknown>) {
  const label = type==="drop"?"Recuperar posiciones":type==="cannibal"?"Revisar canibalización":type==="urlchange"?"Revisar cambio de URL":"Mejorar CTR";
  const reason = type==="drop"?`La posición cambió de ${data.from??"fuera"} a ${data.to??"fuera"}. Revisa cambios de contenido, indexación y competidores.`:type==="urlchange"?`Google cambió la URL mostrada: ${data.from} → ${data.to}. Comprueba si el cambio coincide con la intención.`:type==="cannibal"?"Varias páginas propias aparecen para la consulta. Confirma intención y marca; consolida solo si compiten por el mismo objetivo.":`La consulta recibe ${data.impressions} impresiones con CTR ${Math.round(Number(data.ctr)*1000)/10}%. Revisa title y meta para su intención.`;
  await signalTask(projectId,type,key,`${label}: ${key}`,reason,Number(data.impressions??10),type==="drop"?"fix":"opportunity",typeof data.page==="string"?data.page:typeof data.url==="string"?data.url:null);
  const since = new Date(Date.now() - 7 * 864e5);
  const exists = await db.alert.findFirst({ where: { projectId, type, key, createdAt: { gte: since } } });
  if (exists) return db.alert.update({ where: { id: exists.id }, data: { data: data as any } });
  return db.alert.create({ data: { projectId, type, key, data: data as any } });
}

export async function computeAlerts(projectId: string) {
  const settings = ((await db.project.findUnique({ where: { id: projectId } }))?.settings ?? {}) as Record<string, any>;
  const dropTh: number = settings.alerts?.drop ?? 3;
  const minImpr: number = settings.alerts?.minImpressions ?? 500;
  let n = 0;

  // 1. Caídas > N posiciones
  const tracked = await db.trackedKeyword.findMany({ where: { projectId, active: true }, include: { checks: { orderBy: { date: "desc" }, take: 8 } } });
  for (const t of tracked) {
    const [cur, prev] = t.checks;
    if (!cur || !prev) continue;
    const a = prev.position ?? 101, b = cur.position ?? 101;
    if (settings.alerts?.dropsEnabled !== false && b - a > dropTh) {
      await upsertAlert(projectId, "drop", t.keyword, { from: prev.position, to: cur.position, url: cur.url });
      n++;
    }
    if (settings.alerts?.urlChangesEnabled !== false && cur.url && prev.url && cur.url !== prev.url) {
      await upsertAlert(projectId,"urlchange",t.keyword,{from:prev.url,to:cur.url,position:cur.position});
      n++;
    }
    // Cannibalización por rank tracking: URLs que se alternan
    const urls = t.checks.map((c) => c.url).filter(Boolean) as string[];
    const distinct = new Set(urls);
    if (settings.alerts?.cannibalEnabled !== false && distinct.size >= 2) {
      let switches = 0;
      for (let i = 1; i < urls.length; i++) if (urls[i] !== urls[i - 1]) switches++;
      if (switches >= 2) {
        await upsertAlert(projectId, "cannibal", t.keyword, { urls: [...distinct], switches, source: "rank" });
        n++;
      }
    }
  }

  // 2. GSC últimos 28 días
  const since = new Date(Date.now() - 30 * 864e5);
  const rows = await db.gscRow.groupBy({
    by: ["query", "page"],
    where: { projectId, date: { gte: since } },
    _sum: { clicks: true, impressions: true },
    _avg: { position: true },
  });
  const byQuery = new Map<string, typeof rows>();
  for (const r of rows) byQuery.set(r.query, [...(byQuery.get(r.query) ?? []), r]);
  for (const [query, list] of byQuery) {
    const impr = list.reduce((s, r) => s + (r._sum.impressions ?? 0), 0);
    const clicks = list.reduce((s, r) => s + (r._sum.clicks ?? 0), 0);
    const significant = list.filter((r) => (r._sum.impressions ?? 0) >= Math.max(20, impr * 0.15));
    if (settings.alerts?.cannibalEnabled !== false && significant.length >= 2 && impr >= 100) {
      await upsertAlert(projectId, "cannibal", query, { source: "gsc", pages: significant.map((r) => ({ page: r.page, impressions: r._sum.impressions, position: r._avg.position })) });
      n++;
    }
    const top = [...list].sort((a, b) => (b._sum.impressions ?? 0) - (a._sum.impressions ?? 0))[0];
    const pos = top._avg.position ?? 50;
    const ctr = impr ? clicks / impr : 0;
    if (settings.alerts?.ctrEnabled !== false && impr >= minImpr && pos <= 10 && ctr < expectedCtr(pos) * (settings.alerts?.ctrRatio ?? 0.5)) {
      await upsertAlert(projectId, "lowctr", query, { impressions: impr, clicks, ctr, position: pos, expected: expectedCtr(pos), page: top.page });
      n++;
    }
  }
  return n;
}
