import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtml, type PageData } from "./audit/crawler";
import { boilerplateOf, classifyPage, contentText, detectLocation, editorialWords, majorityType, polishTitle, properNounLeads, STOP_UI } from "./content/clean";
import { dropContained } from "./content/analyze";
import { ngrams, tf } from "./text";

const LOREM = "Esta es una frase editorial larga que habla del servicio con bastante detalle para el lector";

function page(url: string, body: string, head = ""): PageData {
  const p = parseHtml(`<html><head>${head}</head><body>${body}</body></html>`, url);
  return { ...p, url, finalUrl: url, status: 200, redirects: [], contentType: "text/html", noindex: false, responseMs: 0, contentHash: null } as unknown as PageData;
}

const CHROME = `<nav><a href="/a">Inicio</a><a href="/b">Contacto</a></nav><div class="age">Confirmo que soy mayor de 18 años y acepto los términos</div>`;
const FOOTER = `<footer><p>Todos los derechos reservados 2026 sitio de ejemplo con texto largo de pie de página</p></footer>`;

test("bloques: sin los textos de respaldo de video/iframe/noscript", () => {
  const p = page("https://x.cl/a", `<p>${LOREM}</p><video><p>Tu navegador no soporta el elemento video</p></video><iframe>Cargando mapa</iframe><noscript>Activa JavaScript</noscript>`);
  assert.ok(!/navegador|Cargando|JavaScript/.test(p.text));
  assert.equal(p.blocks.length, 1);
});

test("boilerplate: lo que se repite en ≥ 50% de las páginas del dominio sale del texto y del largo editorial", () => {
  const a = page("https://x.cl/masajes/ana", `${CHROME}<main><p>${LOREM} ana</p><p>${LOREM} segunda ana</p></main>${FOOTER}`);
  const b = page("https://x.cl/masajes/bea", `${CHROME}<main><p>${LOREM} bea</p></main>${FOOTER}`);
  const c = page("https://x.cl/masajes/cata", `${CHROME}<main><p>${LOREM} cata</p></main>${FOOTER}`);
  // la muestra son OTRAS páginas del dominio (no la analizada)
  const boiler = boilerplateOf([b, c]);
  assert.ok(boiler.size >= 1);
  const text = contentText(a, boiler);
  assert.ok(!/mayor de 18/.test(text), "aviso de edad repetido = boilerplate");
  assert.ok(!/derechos reservados/.test(text), "footer fuera");
  assert.ok(/segunda ana/.test(text));
  // 2 párrafos (17 + 18 palabras); el aviso de edad y el footer no cuentan
  assert.equal(editorialWords(a, boiler), 35);
  // con una sola página no se adivina
  assert.equal(boilerplateOf([a]).size, 0);
});

test("stopwords de interfaz fuera de los bordes de n-gramas", () => {
  const g = ngrams("consultar ver más cargar navegador soporta video masaje relajante", { extraStop: STOP_UI });
  assert.ok(g.includes("masaje relajante"));
  assert.ok(!g.some((x) => /^(consultar|ver|cargar|navegador|soporta)\b|\b(consultar|navegador|soporta|video)$/.test(x)));
});

test("n-gramas: 'las condes' se emite completo y 'condes' suelto no", () => {
  const docs = ["Masajes en Las Condes. Atención en Las Condes todos los días.", "Las Condes y Providencia. Spa en Las Condes.", "Departamento en Las Condes"];
  const lead = properNounLeads(docs.join(" "));
  assert.ok(lead.has("las condes"));
  const totals = new Map<string, number>();
  for (const d of docs) for (const [t, c] of tf(ngrams(d, { allowLead: lead }))) totals.set(t, (totals.get(t) ?? 0) + c);
  assert.ok(totals.has("las condes"));
  const kept = dropContained(["condes", "las condes", "providencia"].map((term) => ({ term })), totals).map((x) => x.term);
  assert.deepEqual(kept, ["las condes", "providencia"]);
  // sin el n-grama largo como candidato, el unigrama se queda
  assert.deepEqual(dropContained([{ term: "condes" }], totals).map((x) => x.term), ["condes"]);
  // los bloques (saltos de línea) cortan n-gramas
  assert.ok(!ngrams("masaje\nrelajante").includes("masaje relajante"));
});

test("tipo de página: listado, ficha, artículo, home", () => {
  const cards = Array.from({ length: 12 }, (_, i) => `<li><a href="/escorts/perfil-${i}">Perfil ${i} · Las Condes</a></li>`).join("");
  const listing = page("https://x.cl/escorts/las-condes", `<h1>Escorts en Las Condes</h1><p>${LOREM}</p><ul>${cards}</ul>`);
  assert.equal(classifyPage(listing.url, listing, editorialWords(listing, new Set())), "listing");
  const art = page("https://x.cl/blog/guia", `<article><h1>Guía</h1>${Array.from({ length: 50 }, () => `<p>${LOREM}</p>`).join("")}<h2>a</h2><h2>b</h2><h2>c</h2></article>`);
  assert.equal(classifyPage(art.url, art, editorialWords(art, new Set())), "article");
  const prod = page("https://x.cl/p/1", `<h1>Aceite</h1><p>Precio $12.990</p><button>Agregar al carrito</button>`, `<script type="application/ld+json">{"@type":"Product","name":"x"}</script>`);
  assert.equal(classifyPage(prod.url, prod, editorialWords(prod, new Set())), "detail");
  const home = page("https://x.cl/", `<p>${LOREM}</p>`);
  assert.equal(classifyPage(home.url, home, 10), "home");
  assert.equal(majorityType([{ type: "listing", position: 1 }, { type: "article", position: 2 }, { type: "listing", position: 5 }]), "listing");
  // empate: gana el de mejor posición
  assert.equal(majorityType([{ type: "article", position: 1 }, { type: "listing", position: 3 }]), "article");
});

test("titles: marca al final, ubicación si es local, sin adjetivos genéricos", () => {
  assert.equal(detectLocation("masajes las condes"), "Las Condes");
  assert.equal(detectLocation("escort ñuñoa"), "Ñuñoa");
  assert.equal(detectLocation("masajes relajantes"), null);
  assert.equal(polishTitle("Masajes únicos e increíbles", "Uzeed", "Las Condes"), "Masajes en Las Condes | Uzeed");
  assert.equal(polishTitle("Masajes increíbles en Las Condes", "Uzeed", "Las Condes"), "Masajes en Las Condes | Uzeed");
  assert.equal(polishTitle("Masajes en Las Condes | Uzeed", "Uzeed", "Las Condes"), "Masajes en Las Condes | Uzeed");
  assert.equal(polishTitle("Uzeed: masajes en Las Condes", "Uzeed", "Las Condes"), "Masajes en Las Condes | Uzeed");
});
