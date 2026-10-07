import { normTerm } from "../util";
import { competition01, num } from "./apify";
import type { VolumeData } from "./types";

/**
 * CSV exportado desde Google Ads Keyword Planner: UTF-16 (LE con BOM normalmente), separado por
 * tabs, con 1–2 filas de título antes del header. Encabezados en inglés o español.
 * "Avg. monthly searches" viene como rango ("100 – 1K") sin gasto activo, o exacto con gasto.
 */
export function decodeCsv(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  // UTF-16LE sin BOM: muchos bytes nulos en posiciones impares
  const sample = buf.subarray(0, 200);
  const nulls = [...sample].filter((b, i) => i % 2 === 1 && b === 0).length;
  if (nulls > sample.length / 4) return buf.toString("utf16le");
  return buf.toString("utf8").replace(/^﻿/, "");
}

const MULT: Record<string, number> = { k: 1e3, m: 1e6, mil: 1e3 };

/** "100 – 1K" → [100, 1000]; "1,300" → [1300, 1300]; "–"/vacío → null. */
export function parseVolumeRange(raw: string): [number, number] | null {
  const s = raw.trim();
  if (!s || s === "-" || s === "–" || s === "--") return null;
  const one = (x: string): number | null => {
    const m = x.trim().toLowerCase().match(/^([\d.,\s]+)\s*(k|m|mil)?$/);
    if (!m) return null;
    const n = Number(m[1].replace(/[.,\s]/g, "")); // volumen siempre entero: . y , son separadores de miles
    return Number.isFinite(n) ? n * (m[2] ? MULT[m[2]] : 1) : null;
  };
  const parts = s.split(/\s+[–—-]\s+|\s*[–—]\s*/);
  if (parts.length === 2) {
    const a = one(parts[0]), b = one(parts[1]);
    return a != null && b != null ? [a, b] : null;
  }
  const v = one(s);
  return v != null ? [v, v] : null;
}

/** Valor representativo de un rango para ordenar/score: media geométrica (o max/2 si empieza en 0). */
export function representative(min: number, max: number) {
  if (min === max) return min;
  return min > 0 ? Math.round(Math.sqrt(min * max)) : Math.round(max / 2);
}

function splitRow(line: string) {
  // Keyword Planner exporta con tabs y comillas solo cuando hace falta
  return line.split("\t").map((c) => c.replace(/^"(.*)"$/, "$1").replace(/""/g, '"').trim());
}

export function parseKeywordPlannerCsv(input: Buffer | string): { rows: VolumeData[]; skipped: number; columns: string[] } {
  const text = typeof input === "string" ? input : decodeCsv(input);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const hi = lines.findIndex((l) => /^(keyword|palabra clave)\t/i.test(splitRow(l)[0] + "\t"));
  if (hi < 0) throw new Error("No se encontró el encabezado (Keyword / Palabra clave). ¿Es un export de Keyword Planner con tabs?");
  const header = splitRow(lines[hi]);
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const cKw = col(/^(keyword|palabra clave)$/i);
  const cVol = col(/^(avg\.? monthly searches|promedio de b[uú]squedas mensuales)/i);
  const cComp = col(/^(competition|competencia)$/i);
  const cCompIdx = col(/^(competition \(indexed value\)|competencia \(valor indexado\))/i);
  const cLow = col(/(low range|intervalo bajo)/i);
  const cHigh = col(/(high range|intervalo alto)/i);
  if (cKw < 0 || cVol < 0) throw new Error("Faltan columnas Keyword / Avg. monthly searches");
  const rows: VolumeData[] = [];
  let skipped = 0;
  for (const line of lines.slice(hi + 1)) {
    const c = splitRow(line);
    const kw = normTerm(c[cKw] ?? "");
    if (!kw) { skipped++; continue; }
    const range = parseVolumeRange(c[cVol] ?? "");
    const low = cLow >= 0 ? num(c[cLow]) : null;
    const high = cHigh >= 0 ? num(c[cHigh]) : null;
    rows.push({
      keyword: kw,
      volume: range ? representative(range[0], range[1]) : null,
      volumeMin: range ? range[0] : null,
      volumeMax: range ? range[1] : null,
      cpc: low != null && high != null ? Number(((low + high) / 2).toFixed(2)) : high ?? low,
      competition: cCompIdx >= 0 && c[cCompIdx] ? competition01(Number(c[cCompIdx]) / 100) : cComp >= 0 ? competition01(c[cComp]) : null,
      intent: null,
    });
  }
  return { rows, skipped, columns: header };
}
