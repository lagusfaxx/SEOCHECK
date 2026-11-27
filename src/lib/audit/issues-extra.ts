import type { Page } from "@prisma/client";
import type { IssueRow } from "./issues";
import { soft404 } from "./soft404";
export const EXTRA_ISSUE_LABELS: Record<string, string> = {
  soft_404: "Posible soft 404",
  product_out_of_stock: "Producto sin stock indexable",
  category_no_main: "Categoría sin texto propio detectado",
  main_duplicate: "Contenido principal duplicado",
};
export const EXTRA_ISSUE_FIX: Record<string, string> = {
  soft_404:
    "Si la página no existe, devolver 404/410; si existe, restaurar contenido útil y revisar la inspección de Google.",
  product_out_of_stock:
    "Verificar reposición y mostrar disponibilidad y alternativas; no desindexar automáticamente.",
  category_no_main:
    "Revisar si la categoría responde a una intención propia; añadir ayuda útil solo cuando haga falta.",
  main_duplicate:
    "Comprobar intención y consolidar mediante canonical o redirección cuando sean equivalentes.",
};
export const EXTRA_ISSUE_WHY: Record<string, string> = {
  soft_404:
    "Respuesta 200 con señales de página inexistente: requiere verificación.",
  product_out_of_stock:
    "El producto declara que no está disponible, pero sigue siendo indexable.",
  category_no_main: "No se encontró texto editorial fuera de menús y tarjetas.",
  main_duplicate: "Dos URLs indexables contienen el mismo texto principal.",
};
export const EXTRA_ISSUE_VERIFY: Record<string, string> = {
  soft_404: "Verificar estado HTTP, contenido y cobertura en Search Console.",
  product_out_of_stock: "Verificar que el estado visible y Offer coincidan.",
  category_no_main:
    "Comprobar contenido visible y utilidad, sin objetivos de número de palabras.",
  main_duplicate:
    "Comprobar que las páginas distintas conservan intención y canonical correctos.",
};
/** Identificador de grupo del producto en sus datos estructurados (modelo, grupo de variantes o MPN). */
function productGroup(p: Page): string | null {
  const s = (p.structured ?? {}) as { jsonld?: { type: string; props: Record<string, any> }[] };
  for (const e of s.jsonld ?? []) {
    if (!/^(Product|ProductGroup)$/i.test(e.type)) continue;
    const g = e.props?.inProductGroupWithID ?? e.props?.productGroupID ?? e.props?.isVariantOf?.productGroupID ?? e.props?.mpn ?? e.props?.model;
    if (g != null && String(g).trim()) return String(g).trim().toLowerCase();
  }
  return null;
}
/** Dos fichas son variantes del mismo producto: mismo grupo en sus datos, o misma ruta salvo el último tramo (color/talla). */
export function sameProductGroup(a: Page, b: Page): boolean {
  if (a.template !== "product" && b.template !== "product") return false;
  const ga = productGroup(a), gb = productGroup(b);
  if (ga && gb) return ga === gb;
  const stem = (u: string) => {
    try {
      return new URL(u).pathname.replace(/\/+$/, "").split("-").slice(0, -1).join("-");
    } catch {
      return u;
    }
  };
  // "/producto/jammer-ts703-rojo" y "/producto/jammer-ts703-azul": mismo tronco con al menos dos palabras
  const sa = stem(a.url), sb = stem(b.url);
  return sa.length > 12 && sa === sb;
}

export function computeExtraIssues(
  pages: Page[],
  _ctx: { site: string },
): IssueRow[] {
  const out: IssueRow[] = [];
  const hashes = new Map<string, string>();
  for (const p of pages) {
    if (p.status !== 200 || p.error || p.blocked) continue;
    if (soft404(p))
      out.push({
        url: p.url,
        code: "soft_404",
        severity: "warning",
        detail: `HTTP 200; título ${p.title ?? ""}; ${p.wordCount} palabras. Hipótesis: confirmar en Google.`,
      });
    if (p.mainHash && !p.noindex && p.canonicalType !== "other") {
      const first = hashes.get(p.mainHash);
      // variantes del mismo producto (colores, tallas) comparten descripción: es normal en una tienda
      const firstPage = first ? pages.find((x) => x.url === first) : undefined;
      if (first && firstPage && sameProductGroup(p, firstPage)) continue;
      if (first)
        out.push({
          url: p.url,
          code: "main_duplicate",
          severity: "info",
          detail: `Texto principal idéntico a ${first}`,
        });
      else hashes.set(p.mainHash, p.url);
    }
    // un agotado indexable puede ser correcto: no es un problema por sí solo. La discrepancia entre el JSON-LD y lo
    // visible ya la reporta jsonld_mismatch; el inventario de agotados queda en Experto → Ecommerce

    if (p.template === "category" && !p.noindex && !p.mainHash)
      out.push({
        url: p.url,
        code: "category_no_main",
        severity: "info",
        detail:
          "No se detectó texto principal fuera de navegación y tarjetas; verificar con render si usa JavaScript.",
      });
  }
  return out;
}
