import type { CheerioAPI } from "cheerio";
export type Entity = {
  format: "jsonld" | "microdata" | "rdfa";
  type: string;
  props: Record<string, unknown>;
};
export type StructuredSummary = {
  jsonld: Entity[];
  microdata: Entity[];
  rdfa: Entity[];
};
export function extractStructured(
  $: CheerioAPI,
  nodes: any[],
): StructuredSummary {
  const out: StructuredSummary = { jsonld: [], microdata: [], rdfa: [] };
  const seen = new Set<object>();
  function walk(n: any) {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    for (const t of [n["@type"]].flat().filter(Boolean))
      out.jsonld.push({
        format: "jsonld",
        type: String(t).split(/[/:]/).pop()!,
        props: n,
      });
    Object.values(n).forEach(walk);
  }
  nodes.forEach(walk);
  for (const [format, selector, typeAttr, propAttr] of [
    ["microdata", "[itemscope][itemtype]", "itemtype", "itemprop"],
    ["rdfa", "[typeof]", "typeof", "property"],
  ] as const) {
    const readProps=(el:any,depth=0):Record<string,unknown>=>{
      const props:Record<string,unknown>={};
      if(depth>5)return props;
      $(el).find(`[${propAttr}]`).each((_,child)=>{
        if($(child).parents(selector).first()[0]!==el)return;
        const key=$(child).attr(propAttr)!.split(/[/:]/).pop()!;
        if(["__proto__","constructor","prototype"].includes(key))return;
        const val=$(child).is(selector)?{"@type":($(child).attr(typeAttr)??"").split(/[/:]/).pop(),...readProps(child,depth+1)}:$(child).attr("content")??$(child).attr("href")??$(child).attr("src")??$(child).text().trim();
        props[key]=props[key]===undefined?val:[props[key],val].flat();
      });return props;
    };
    $(selector).slice(0,100).each((_,el)=>{
      const props=readProps(el);
      for(const t of ($(el).attr(typeAttr)??"").split(/\s+/))out[format].push({format,type:t.split(/[/:]/).pop()!,props});
    });
  }
  return out;
}
