import { test } from "node:test";
import assert from "node:assert/strict";
import { siteVocabulary, triageKeyword, type TriageContext } from "./keyword-triage";
import { byPriority, makeTask, priorityTier } from "./report-rules";
import { isGoogleOwned, shareOfVoice } from "./marketing";
import { checkStructuredData } from "./audit/structured";
import { computeExtraIssues } from "./audit/issues-extra";

// el sitio de la revisión: tienda de trajes de natación de competencia (taupoc.cl)
const pages = [
  { url: "https://taupoc.cl/", text: "Taupoc | Trajes de natación de competencia homologados World Aquatics" },
  { url: "https://taupoc.cl/catalogo", text: "Catálogo trajes de baño de competencia | Taupoc" },
  { url: "https://taupoc.cl/producto/r-skin-jammer-ts703", text: "R-Skin Jammer TS703 traje de natación hombre | Taupoc" },
  { url: "https://taupoc.cl/producto/r-skin-knee-suit-ts704", text: "R-Skin Knee Suit TS704 traje de competencia mujer | Taupoc" },
  { url: "https://taupoc.cl/guia-de-tallas", text: "Guía de tallas de trajes de natación | Taupoc" },
];
const ctx: TriageContext = {
  vocab: siteVocabulary([...pages.map((p) => p.text), "taupoc swimwear", "taupoc jammer"]),
  brand: "taupoc",
  home: "https://taupoc.cl/",
  pages,
  gsc: [
    { query: "taupoc", page: "https://taupoc.cl/", impressions: 17 },
    { query: "taupoc swimwear", page: "https://taupoc.cl/", impressions: 9 },
  ],
};

test("prueba 1: ninguna keyword de otro rubro o con términos ajenos se convierte en tarea", () => {
  for (const k of ["competencia traje de baño miss universo", "traje de baño miss grand international", "traje de baño los simpson", "fastskin", "traje de competencia arena", "speedo traje de natacion", "new balance", "bicicletas"]) {
    const t = triageKeyword(k, ctx);
    assert.ok(t.verdict === "unknown_terms" || t.verdict === "off_topic", `${k} → ${t.verdict}`);
  }
  assert.deepEqual(triageKeyword("competencia traje de baño miss universo", ctx).unknown, ["miss", "universo"]);
});

test("prueba 2: ninguna página nueva sin revisar las existentes (marca propia y temas ya cubiertos)", () => {
  assert.deepEqual([triageKeyword("taupoc", ctx).verdict, triageKeyword("taupoc", ctx).page], ["brand", "https://taupoc.cl/"]);
  assert.equal(triageKeyword("taupoc swimwear", ctx).verdict, "brand");
  const jammer = triageKeyword("jammer natacion", ctx);
  assert.deepEqual([jammer.verdict, jammer.page], ["existing", "https://taupoc.cl/producto/r-skin-jammer-ts703"]);
  assert.equal(triageKeyword("trajes de competencia", ctx).verdict, "existing");
  // del rubro y sin página que lo trate: recién ahí es candidata a página nueva
  assert.equal(triageKeyword("guia trajes natacion competencia homologados", ctx).verdict, "existing");
  assert.equal(triageKeyword("jammer knee suit", ctx).verdict, "create");
});

test("prueba 3: la solución corresponde al tipo de marcado (FAQ no se trata como precio/stock)", () => {
  const faq = checkStructuredData([{ "@type": "FAQPage", mainEntity: [{ name: "¿Hacen envíos a regiones?", acceptedAnswer: { text: "Sí, a todo Chile en 48 horas." } }] }], "Preguntas frecuentes. ¿Cuál es la talla correcta?");
  assert.equal(faq.length, 1);
  assert.match(faq[0], /^FAQ: la pregunta «¿Hacen envíos a regiones\?»/);
  // misma respuesta con otra puntuación: no es discrepancia
  assert.deepEqual(checkStructuredData([{ "@type": "FAQPage", mainEntity: { name: "¿Talla?", acceptedAnswer: { text: "<p>Usa la guía de tallas, mide tu cintura.</p>" } } }], "¿Talla? Usa la guía de tallas: mide tu cintura"), []);
});

test("prueba 4: un comportamiento posiblemente válido no es error confirmado ni encabeza la lista", () => {
  // agotado indexable: ya no es un problema por sí solo
  const page = { url: "https://taupoc.cl/producto/x", status: 200, error: null, blocked: false, template: "product", noindex: false, canonicalType: "self", commerce: { availability: "https://schema.org/OutOfStock" }, mainHash: null, title: "X", wordCount: 300 } as any;
  assert.ok(!computeExtraIssues([page], { site: "taupoc.cl" }).some((i) => i.code === "product_out_of_stock"));
  // oportunidades de contenido nunca pasan por delante de un problema comprobado, aunque su volumen sea enorme
  const landing = makeTask({ title: "Evaluar 10 páginas nuevas", fix: "", traffic: 1_483_900, trafficLabel: "", sev: 1.5, sevLabel: "oportunidad", ease: 0.4, confidence: "media" });
  const index = makeTask({ title: "No indexadas según Google", fix: "", traffic: 105, trafficLabel: "", sev: 3, sevLabel: "crítico", ease: 0.6, confidence: "alta" });
  const hypothesis = makeTask({ title: "Sin H1", fix: "", traffic: 2, trafficLabel: "", sev: 2, sevLabel: "Advertencia · hipótesis por verificar", ease: 1, confidence: "baja" });
  assert.deepEqual([landing, hypothesis, index].sort(byPriority).map((t) => t.title), ["No indexadas según Google", "Sin H1", "Evaluar 10 páginas nuevas"]);
  assert.equal(priorityTier(landing), 2);
});

test("cuota de visibilidad: los resultados de Google mismo no son competidores", () => {
  assert.ok(isGoogleOwned("www.google.com") && isGoogleOwned("google.cl") && !isGoogleOwned("googlesupport.cl"));
  const sov = shareOfVoice([{ keyword: "traje competencia", volume: 100, results: [{ domain: "google.com", position: 1 }, { domain: "arenastore.cl", position: 2 }, { domain: "taupoc.cl", position: 3 }] }], "taupoc.cl");
  assert.ok(!sov.rows.some((r) => r.domain === "google.com"));
});
