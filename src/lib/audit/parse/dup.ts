import type { TextBlock } from "../crawler";

/** Texto principal: sin menú, cabecera, footer ni bloques que son casi solo links. */
export function mainText(_blocks: TextBlock[]): string {
  return "";
}
/** Hash exacto del texto principal (null si no hay texto). */
export function mainHash(_text: string): string | null {
  return null;
}
/** Simhash de 64 bits en hex (null si hay poco texto). */
export function simhash(_text: string): string | null {
  return null;
}
/** Bits distintos entre dos simhash. */
export function hamming(_a: string, _b: string): number {
  return 64;
}
