import type { CheerioAPI } from "cheerio";

export type Img = { src: string; alt: string | null; width?: number | null; height?: number | null; loading?: string | null; format?: string | null; inLink?: boolean };

/** Imágenes de la página (máx. 50) y si hay video embebido. */
export function imageList(_$: CheerioAPI, _url: string): { images: Img[]; videos: { src: string; kind: string }[] } {
  return { images: [], videos: [] };
}
