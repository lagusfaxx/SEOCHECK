export type VolumeSource = "gsc" | "dataforseo" | "apify" | "csv";

export type VolumeData = {
  keyword: string; // normalizada
  volume: number | null;
  volumeMin?: number | null;
  volumeMax?: number | null;
  cpc: number | null;
  competition: number | null; // 0–1
  intent?: string | null;
};

export type VolumeCtx = {
  country: string;
  language: string;
  locationCode: number;
  projectId?: string;
  /** Seeds del research (Apify trabaja por seed) */
  seeds?: string[];
  /** DataForSEO: endpoint Live en vez de standard queue */
  live?: boolean;
};

export interface VolumeProvider {
  readonly source: Exclude<VolumeSource, "gsc">;
  /** null = disponible; string = motivo por el que no lo está */
  unavailable(): string | null;
  /** Devuelve solo lo que el proveedor efectivamente trae; lo que no viene queda fuera (→ null). */
  fetch(keywords: string[], ctx: VolumeCtx): Promise<VolumeData[]>;
}
