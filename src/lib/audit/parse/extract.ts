import type { CheerioAPI } from "cheerio";
export type ExtractRule = {
  name: string;
  type: "css" | "xpath" | "regex";
  selector: string;
  attr?: string;
  all?: boolean;
};
/** XPath admite //tag, /descendiente, [@atributo='valor'], /text() y /@atributo. */
export function extractCustom(
  html: string,
  $: CheerioAPI,
  rules: ExtractRule[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rules.slice(0, 20)) {
    if (!/^[\w-]{1,60}$/.test(r.name) || ["__proto__", "constructor", "prototype"].includes(r.name))
      throw new Error("Nombre de extracción inválido");
    if (r.selector.length > 300) throw new Error("Selector demasiado largo");
    let values: string[] = [];
    if (r.type === "regex") {
      if (
        /[+*}][^)]*\)[+*{]|\([^)]*[|][^)]*\)[+*{]|\\[1-9]|\(\?|[|]/.test(
          r.selector,
        ) ||
        (r.selector.match(/(?<!\\)[+*?{]/g) ?? []).length > 1
      )
        throw new Error("Regex no segura");
      const re = new RegExp(r.selector, "g");
      for (const m of html.slice(0, 100000).matchAll(re)) {
        values.push(m[1] ?? m[0]);
        if (values.length >= 100) break;
      }
    } else {
      let selector = r.selector,
        attr = r.attr;
      if (r.type === "xpath") {
        const m = selector.match(/\/@([\w-]+)$/);
        if (m) {
          attr = m[1];
          selector = selector.slice(0, m.index);
        }
        selector = selector.replace(/\/text\(\)$/, " ").trim();
        if (
          !/^\/\/[\w*:-]+(?:\[@[\w:-]+=(?:'[^']*'|"[^"]*")\])?(?:\/{1,2}[\w*:-]+)*$/.test(
            selector,
          )
        )
          throw new Error(
            "XPath no admitido: usa CSS o //tag[@atributo='valor']",
          );
        selector = selector
          .slice(2)
          .replace(/\[@/g, "[")
          .replace(/\/\//g, " ")
          .replace(/\//g, " > ");
      }
      values = $(selector)
        .slice(0, 100)
        .map((_, el) => (attr ? ($(el).attr(attr) ?? "") : $(el).text().trim()))
        .get();
    }
    out[r.name] = values
      .filter(Boolean)
      .slice(0, r.all ? 100 : 1)
      .map((v) => v.slice(0, 2000));
  }
  return out;
}
