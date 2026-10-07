export type Kw = { id: string; term: string; sources: string[]; relevance: number | null; volume: number | null; cpc: number | null; competition: number | null; intent: string | null; difficulty: number | null; score: number | null; excluded: boolean; clusterId: string | null };
export type Cl = { id: string; name: string; primary: string; intent: string | null; volume: number; score: number; urls: string[]; topicId: string | null; isPillar: boolean; pos: { x: number; y: number } | null };
export type Tp = { id: string; name: string; pos: { x: number; y: number } | null; forcedSplit: boolean };
export type RunSources = { serp?: "real" | "none"; embeddings?: string; volumes?: "real" | "none" };
export type Run = { id: string; seeds: string[]; status: string; threshold: number; stats: Record<string, number>; sources: RunSources; createdAt: string };
export type KwData = { runs: Run[]; runId?: string; keywords: Kw[]; clusters: Cl[]; topics: Tp[]; tracked: string[] };
