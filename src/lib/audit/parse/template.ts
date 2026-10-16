/** Plantillas de página: home | product | category | article | filter | pagination | legal | search | other. */
export type TemplateRule = { name: string; pattern: string };
export type TemplateInput = {
  url: string;
  signals: { linkGroup: number; article: boolean; time: boolean; cart: boolean; price: boolean };
  jsonldTypes: string[];
  h1: string[];
  title: string | null;
};

export function classifyTemplate(_p: TemplateInput, _rules: TemplateRule[] = []): string | null {
  return null;
}
