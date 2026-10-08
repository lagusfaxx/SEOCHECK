/** Tipos y transformaciones del explorador (compartido entre servidor y cliente). */
export type GType = "site" | "topic" | "cluster" | "keyword" | "page" | "domain" | "issue" | "question";

export type GNode = {
  id: string;
  type: GType;
  key: string;
  label: string;
  /** dato corto bajo el nombre: volumen, posición, impresiones… */
  sub?: string;
  /** página del propio sitio */
  own?: boolean;
  url?: string;
};
export type GEdge = { source: string; target: string; label?: string };
export type GResult = { nodes: GNode[]; edges: GEdge[]; note?: string };

export const nodeId = (type: GType, key: string) => `${type}:${key}`;

export const TYPE_LABEL: Record<GType, string> = {
  site: "Sitio",
  topic: "Topic",
  cluster: "Cluster",
  keyword: "Keyword",
  page: "Página",
  domain: "Dominio",
  issue: "Problema",
  question: "Pregunta",
};

export const TRANSFORMS: Record<GType, { id: string; label: string; desc: string }[]> = {
  site: [
    { id: "topics", label: "Topics", desc: "Temas del último research de keywords" },
    { id: "competitors", label: "Competidores", desc: "Dominios que más aparecen en Google para tus keywords" },
    { id: "pages", label: "Páginas principales", desc: "Las más enlazadas dentro de tu sitio" },
    { id: "issues", label: "Problemas técnicos", desc: "Tipos de problema del último crawl" },
    { id: "gsc_queries", label: "Consultas de Google", desc: "Top consultas en Search Console (28 días)" },
  ],
  topic: [{ id: "clusters", label: "Clusters", desc: "Grupos de keywords de este tema" }],
  cluster: [
    { id: "keywords", label: "Keywords", desc: "Keywords del cluster" },
    { id: "serp", label: "URLs que rankean", desc: "Páginas que Google muestra para este cluster" },
    { id: "topic", label: "Topic", desc: "Tema al que pertenece" },
  ],
  keyword: [
    { id: "serp", label: "Top 10 de Google", desc: "Quién rankea para esta keyword" },
    { id: "gsc_pages", label: "Tus páginas en Google", desc: "Tus URLs que reciben impresiones por esta consulta (Search Console)" },
    { id: "paa", label: "Preguntas", desc: "\"Otras preguntas de los usuarios\" en Google" },
    { id: "cluster", label: "Cluster", desc: "Cluster al que pertenece" },
  ],
  page: [
    { id: "inlinks", label: "Quién la enlaza", desc: "Páginas de tu sitio que enlazan a esta" },
    { id: "outlinks", label: "A dónde enlaza", desc: "Páginas internas a las que enlaza" },
    { id: "issues", label: "Problemas", desc: "Problemas técnicos de esta URL" },
    { id: "gsc_queries", label: "Consultas de Google", desc: "Consultas por las que aparece (Search Console)" },
    { id: "serp_keywords", label: "Keywords donde rankea", desc: "Keywords donde aparece en el top 10" },
    { id: "domain", label: "Dominio", desc: "Dominio de la página" },
  ],
  domain: [
    { id: "keywords", label: "Keywords donde rankea", desc: "Tus keywords donde este dominio aparece en Google" },
    { id: "pages", label: "Sus páginas", desc: "URLs de este dominio que aparecen en Google" },
  ],
  issue: [{ id: "pages", label: "Páginas afectadas", desc: "URLs con este problema" }],
  question: [],
};
