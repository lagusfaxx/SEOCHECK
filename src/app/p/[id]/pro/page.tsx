"use client";
import CrawlPro from "@/components/pro/CrawlPro";
import Templates from "@/components/pro/Templates";
import Structured from "@/components/pro/Structured";
import Indexation from "@/components/pro/Indexation";
import Architecture from "@/components/pro/Architecture";
import Perf from "@/components/pro/Perf";
import Ecommerce from "@/components/pro/Ecommerce";
import Serp from "@/components/pro/Serp";
import ContentPro from "@/components/pro/ContentPro";
import Analytics from "@/components/pro/Analytics";
import Advanced from "@/components/pro/Advanced";
import Ops from "@/components/pro/Ops";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, useLocal } from "@/components/ui";

const TABS = [
  { id: "crawl", label: "Rastreo", C: CrawlPro },
  { id: "templates", label: "Plantillas", C: Templates },
  { id: "structured", label: "Datos estructurados", C: Structured },
  { id: "index", label: "Indexación", C: Indexation },
  { id: "arch", label: "Arquitectura", C: Architecture },
  { id: "perf", label: "Rendimiento", C: Perf },
  { id: "shop", label: "Ecommerce", C: Ecommerce },
  { id: "serp", label: "Keywords y SERP", C: Serp },
  { id: "content", label: "Contenido", C: ContentPro },
  { id: "analytics", label: "Analítica", C: Analytics },
  { id: "advanced", label: "Avanzado", C: Advanced },
  { id: "ops", label: "Equipo y API", C: Ops },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Herramientas expertas: cada pestaña muestra su fuente, fecha y qué no se pudo medir. */
export default function ProPage() {
  const [tab, setTab] = useLocal<TabId>("pro-tab", "crawl");
  const search=useSearchParams();
  useEffect(()=>{const requested=search.get("tab");if(TABS.some(t=>t.id===requested))setTab(requested as TabId);},[search]);
  const Cur = (TABS.find((t) => t.id === tab) ?? TABS[0]).C;
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="overflow-x-auto">
        <Tabs value={tab} onChange={setTab} items={TABS.map((t) => ({ id: t.id, label: t.label }))} />
      </div>
      <Cur />
    </div>
  );
}
