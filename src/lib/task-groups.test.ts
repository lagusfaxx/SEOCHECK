import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTasks } from "./task-groups";
const task = (id: string, url: string, status = "detected") => ({
  id,
  url,
  status,
  source: "crawl",
  code: "title_long",
  severity: "warning",
  priority: 2,
  title: "Título demasiado largo",
  reason: "76 caracteres",
});
test("76 incidencias de productos son una acción; otro patrón y otro código permanecen separados", () => {
  const rows = Array.from({ length: 76 }, (_, i) =>
    task(`p${i}`, `https://example.com/products/item-${i}`),
  );
  const groups = groupTasks([
    ...rows,
    task("blog", "https://example.com/blog/post"),
    {
      ...task("meta", "https://example.com/products/item-0"),
      code: "meta_long",
    },
  ]);
  assert.equal(groups.length, 3);
  const products = groups.find(
    (g) => g.pattern === "/products/*" && g.code === "title_long",
  )!;
  assert.equal(products.affected, 76);
  assert.equal(products.members.length, 76);
  assert.match(products.probableCause!, /Posible causa/);
  assert.match(products.probableCause!, /inferencia/);
  assert.equal(groupTasks([...rows].reverse())[0].id, products.id);
});
test("Una URL pendiente impide declarar el grupo solucionado; reapareció y exclusiones conservan su significado", () => {
  const a = task("a", "https://example.com/products/a", "resolved"),
    b = task("b", "https://example.com/products/b", "pending");
  assert.equal(groupTasks([a, b])[0].status, "pending");
  assert.equal(groupTasks([a, b])[0].affected, 1);
  assert.equal(groupTasks([a, b, {...a,id:"c",url:"https://example.com/products/c"}])[0].probableCause,null);
  assert.equal(
    groupTasks([a, { ...b, status: "reappeared" }])[0].status,
    "reappeared",
  );
  assert.equal(
    groupTasks([a, { ...b, status: "ignored" }])[0].status,
    "ignored",
  );
  assert.equal(
    groupTasks([a, { ...b, status: "resolved" }])[0].status,
    "resolved",
  );
});
test("Señales GSC y rankings elevan prioridad sin inventar una causa para una sola página", () => {
  const a = task("a", "https://example.com/products/a");
  const plain = groupTasks([a])[0];
  const enriched = groupTasks(
    [a],
    new Set([a.url]),
    new Map([[a.url, 1484]]),
  )[0];
  assert.ok(enriched.priority > plain.priority);
  assert.equal(enriched.gscImpressions, 1484);
  assert.equal(enriched.rankingUrls, 1);
  assert.equal(enriched.probableCause, null);
  assert.ok(!enriched.reason.includes("1484"));
  assert.match(enriched.priorityReason, /1484/);
});
