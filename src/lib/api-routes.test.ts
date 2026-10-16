/**
 * Cada llamada de la interfaz a /api/p/{id}/… tiene que existir con el mismo método en la API.
 * (Bug real: varias rutas nuevas quedaron como PATCH y la pantalla las llamaba con POST → "not found".)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []; });

/** Claves de cada tabla (GETS/POSTS/PATCHS/DELETES) leídas del código, sin importar módulos con base de datos. */
function tables() {
  const out: Record<string, Set<string>> = { GET: new Set(), POST: new Set(), PATCH: new Set(), DELETE: new Set() };
  const scan = (src: string, startRe: RegExp, method: string) => {
    const m = startRe.exec(src);
    if (!m) return;
    // hasta el cierre de la tabla: primera línea "};" al inicio
    const body = src.slice(m.index + m[0].length, src.indexOf("\n};", m.index));
    for (const k of body.matchAll(/^  (?:"([^"]*)"|([a-zA-Z]+)): async/gm)) out[method].add(k[1] ?? k[2]);
  };
  const api = readFileSync(path.join(ROOT, "lib/product-api.ts"), "utf8");
  const route = readFileSync(path.join(ROOT, "app/api/p/[id]/[...path]/route.ts"), "utf8");
  for (const [m, t] of [["GET", "GETS"], ["POST", "POSTS"], ["PATCH", "PATCHS"], ["DELETE", "DELETES"]]) {
    scan(api, new RegExp(`export const PRODUCT_${t}: Record<string, Handler> = \\{`), m);
    scan(route, new RegExp(`const ${t}: Record<string, H> = \\{`), m);
  }
  return out;
}

test("las llamadas de la interfaz existen en la API con el mismo método", () => {
  const t = tables();
  const missing: string[] = [];
  for (const f of files(path.join(ROOT, "components")).concat(files(path.join(ROOT, "app/p")))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/api(?:<[^>]*>)?\(\s*`\/api\/p\/\$\{id\}\/([a-z0-9/_-]*)[`?]\s*(?:,\s*"(GET|POST|PATCH|DELETE)")?/g)) {
      // el router ignora los segmentos "_" (`/api/p/{id}/_` = raíz del proyecto)
      const key = m[1].split("/").filter((s) => s && s !== "_").join("/");
      const method = m[2] ?? "GET";
      if (!t[method].has(key)) missing.push(`${method} ${key} (${path.relative(ROOT, f)})`);
    }
  }
  assert.deepEqual(missing, []);
});
