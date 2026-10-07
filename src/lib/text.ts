export const STOP_ES = new Set(
  `a al algo algunas algunos ante antes como con contra cual cuando de del desde donde durante e el ella ellas ellos en entre era erais eran eras eres es esa esas ese eso esos esta estaba estado estais estamos estan estar estas este esto estos estoy fue fueron fui ha hace han has hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros o os otra otro para pero poco por porque que quien se sea ser si sin sobre son su sus tambien te tiene tienen todo todos tu tus un una uno unos y ya yo él ésta más qué cómo sí también está están será puede pueden cada sus muy así aquí ahí allí the and of to in for is on with you your are this that it be or by as at from an we our`.split(/\s+/)
);

export function strip(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function tokens(text: string): string[] {
  return strip(text)
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_ES.has(t) && !/^\d+$/.test(t));
}

/** unigramas + bigramas + trigramas sin stopwords en los bordes */
export function ngrams(text: string): string[] {
  const words = strip(text).replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const g = words.slice(i, i + n);
      if (STOP_ES.has(g[0]) || STOP_ES.has(g[n - 1])) continue;
      if (g.some((w) => w.length < 3 && n === 1)) continue;
      if (/^\d+$/.test(g.join(""))) continue;
      out.push(g.join(" "));
    }
  }
  return out;
}

export function tf(grams: string[]) {
  const m = new Map<string, number>();
  for (const g of grams) m.set(g, (m.get(g) ?? 0) + 1);
  return m;
}
