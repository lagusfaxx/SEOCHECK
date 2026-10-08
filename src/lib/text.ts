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

/**
 * unigramas + bigramas + trigramas sin stopwords en los bordes.
 * `extraStop`: palabras que tampoco pueden ir en los bordes (p. ej. de interfaz).
 * `allowLead`: pares "artículo + nombre" que sí pueden abrir un n-grama ("las condes").
 */
export function ngrams(text: string, o: { extraStop?: Set<string>; allowLead?: Set<string> } = {}): string[] {
  const out: string[] = [];
  const stop = (w: string) => STOP_ES.has(w) || Boolean(o.extraStop?.has(w));
  // los saltos de línea separan bloques: un n-grama no cruza de un bloque a otro
  for (const seg of strip(text).split(/\n+/)) {
    const words = seg.replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter(Boolean);
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const g = words.slice(i, i + n);
        const leadOk = n >= 2 && Boolean(o.allowLead?.has(`${g[0]} ${g[1]}`));
        if ((stop(g[0]) && !leadOk) || stop(g[n - 1])) continue;
        if (g.some((w) => w.length < 3 && n === 1)) continue;
        if (/^\d+$/.test(g.join(""))) continue;
        out.push(g.join(" "));
      }
    }
  }
  return out;
}

export function tf(grams: string[]) {
  const m = new Map<string, number>();
  for (const g of grams) m.set(g, (m.get(g) ?? 0) + 1);
  return m;
}
