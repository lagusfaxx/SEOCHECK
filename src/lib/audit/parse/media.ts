import type { CheerioAPI } from "cheerio";
export type Img = {
  src: string;
  alt: string | null;
  width?: number | null;
  height?: number | null;
  loading?: string | null;
  format?: string | null;
  inLink?: boolean;
};
export function imageList(
  $: CheerioAPI,
  url: string,
): { images: Img[]; videos: { src: string; kind: string }[] } {
  const absolute = (s: string) => {
    try {
      return new URL(s, url).href;
    } catch {
      return "";
    }
  };
  return {
    images: $("img")
      .slice(0, 50)
      .map((_, el) => {
        const i = $(el),
          src = absolute(i.attr("src") ?? i.attr("data-src") ?? "");
        return {
          src,
          alt: i.attr("alt") ?? null,
          width: Number(i.attr("width")) || null,
          height: Number(i.attr("height")) || null,
          loading: i.attr("loading") ?? null,
          format: new URL(src || url).pathname.split(".").pop() ?? null,
          inLink: i.closest("a").length > 0,
        };
      })
      .get(),
    videos: $(
      "video[src],video source[src],iframe[src*='youtube'],iframe[src*='vimeo']",
    )
      .slice(0, 20)
      .map((_, el) => ({
        src: absolute($(el).attr("src") ?? ""),
        kind: el.tagName,
      }))
      .get(),
  };
}
