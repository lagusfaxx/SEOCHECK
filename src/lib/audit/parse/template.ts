export type TemplateRule = { name: string; pattern: string };
export type TemplateInput = {
  url: string;
  signals: {
    linkGroup: number;
    article: boolean;
    time: boolean;
    cart: boolean;
    price: boolean;
  };
  jsonldTypes: string[];
  h1: string[];
  title: string | null;
};
export function classifyTemplate(
  p: TemplateInput,
  rules: TemplateRule[] = [],
): string {
  const u = new URL(p.url);
  for (const r of rules.slice(0, 30)) {
    const glob = r.pattern
      .split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    if (new RegExp("^" + glob + "$").test(u.pathname))
      return r.name.slice(0, 80);
  }
  const t = p.jsonldTypes.join(" ");
  if (u.searchParams.has("page") || /\/page\/\d+/.test(u.pathname))
    return "pagination";
  if (
    [...u.searchParams.keys()].some((k) =>
      /filter|facet|color|size|talla|marca/i.test(k),
    )
  )
    return "filter";
  if (
    u.searchParams.has("q") ||
    u.searchParams.has("s") ||
    /\/search/.test(u.pathname)
  )
    return "search";
  if (u.pathname === "/") return "home";
  if (
    /Product/i.test(t) ||
    p.signals.cart ||
    /\/(products?|productos?)\//i.test(u.pathname)
  )
    return "product";
  if (
    /\/(collections?|categor(y|ies)|categorias?)\//i.test(u.pathname) ||
    p.signals.linkGroup >= 5
  )
    return "category";
  if (/Article|BlogPosting|NewsArticle/i.test(t) || p.signals.article)
    return "article";
  if (/privacidad|privacy|terms|legal|terminos/i.test(u.pathname))
    return "legal";
  return "other";
}
