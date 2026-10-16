/** Señal local: nunca sustituye el estado de URL Inspection de Google. */
export function soft404(p: {
  status: number;
  title: string | null;
  h1: string[];
  wordCount: number;
}) {
  return (
    p.status === 200 &&
    p.wordCount < 200 &&
    /\b(404|not found|no encontrad[oa]|p[aá]gina no existe|page not found)\b/i.test(
      [p.title, ...p.h1].join(" "),
    )
  );
}
