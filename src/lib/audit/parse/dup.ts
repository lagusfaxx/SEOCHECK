import { createHash } from "node:crypto";
import type { TextBlock } from "../crawler";
export function mainText(blocks: TextBlock[]) {
  return blocks
    .filter((b) => !b.chrome && b.link < 0.5)
    .map((b) => b.t)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
export function mainHash(text: string) {
  return text.trim()
    ? createHash("sha256")
        .update(text.toLowerCase().replace(/\s+/g, " ").trim())
        .digest("hex")
    : null;
}
export function simhash(text: string) {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  if (words.length < 30) return null;
  const weights = new Array<number>(64).fill(0);
  for (let i = 0; i < words.length - 2; i++) {
    const h = BigInt(
      "0x" +
        createHash("sha256")
          .update(words.slice(i, i + 3).join(" "))
          .digest("hex")
          .slice(0, 16),
    );
    for (let b = 0; b < 64; b++) weights[b] += h & (1n << BigInt(b)) ? 1 : -1;
  }
  return weights
    .reduce((h, w, b) => (w >= 0 ? h | (1n << BigInt(b)) : h), 0n)
    .toString(16)
    .padStart(16, "0");
}
export function hamming(a: string, b: string) {
  if (!/^[a-f0-9]{16}$/i.test(a) || !/^[a-f0-9]{16}$/i.test(b)) return 64;
  let n = BigInt("0x" + a) ^ BigInt("0x" + b),
    d = 0;
  while (n) {
    d++;
    n &= n - 1n;
  }
  return d;
}
