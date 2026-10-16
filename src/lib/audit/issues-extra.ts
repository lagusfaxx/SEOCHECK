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
      if (first)
        out.push({
          url: p.url,
          code: "main_duplicate",
          severity: "info",
          detail: `Texto principal idéntico a ${first}`,
        });
      else hashes.set(p.mainHash, p.url);
    }
    if (
      p.template === "product" &&
      !p.noindex &&
      p.canonicalType !== "other" &&
      /OutOfStock|SoldOut|Discontinued/i.test(
        String((p.commerce as any)?.availability ?? ""),
      )
    )
      out.push({
        url: p.url,
        code: "product_out_of_stock",
        severity: "info",
        detail: String((p.commerce as any).availability),
      });
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
