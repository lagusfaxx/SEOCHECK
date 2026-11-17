"use client";
import Link from "next/link";
import { useProject } from "./Shell";
import { Icon, plural, useApi } from "./ui";

/** Lo primero del resumen: cuántos cambios concretos hay listos y en qué estado está su publicación. */
export function FixesBanner() {
  const { id } = useProject();
  const { data: s } = useApi<any>(`/api/p/${id}/fixes/summary`);
  if (!s?.crawl || (!s.proposed && !s.approved && !s.verified)) return null;
  const top = Object.entries(s.kinds as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const NAME: Record<string, [string, string]> = { title: ["título", "títulos"], meta: ["descripción", "descripciones"], h1: ["encabezado", "encabezados"], canonical: ["canonical", "canonical"], og: ["vista al compartir", "vistas al compartir"], jsonld: ["dato estructurado", "datos estructurados"], alt: ["texto de imagen", "textos de imagen"], hreflang: ["hreflang", "hreflang"], link: ["link roto", "links rotos"], redirect: ["redirección", "redirecciones"] };
  const publishing = s.live?.installed && s.live.enabled;
  return (
    <div className="card flex flex-wrap items-center gap-x-6 gap-y-3 border-acc/30 p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-acc-soft text-acc"><Icon name="wand" className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        {s.proposed ? (
          <>
            <div className="font-semibold">{plural(s.proposed, "corrección lista", "correcciones listas")} para revisar y publicar</div>
            <div className="text-sm text-ink-500">Ya escritas para cada página: {top.map(([k, n]) => plural(n, NAME[k]?.[0] ?? k, NAME[k]?.[1] ?? k)).join(", ")}{Object.keys(s.kinds).length > 3 ? " y más" : ""}.</div>
          </>
        ) : s.approved && !publishing ? (
          <>
            <div className="font-semibold">{plural(s.approved, "corrección aprobada", "correcciones aprobadas")} sin publicar</div>
            <div className="text-sm text-ink-500">Instala la línea de código o descarga los archivos para que lleguen al sitio.</div>
          </>
        ) : (
          <>
            <div className="font-semibold">{publishing ? `${plural(s.approvedLive, "corrección publicada", "correcciones publicadas")} en el sitio` : "Correcciones al día"}</div>
            <div className="text-sm text-ink-500">{s.verified ? `${plural(s.verified, "confirmada", "confirmadas")} en el HTML del sitio por el último análisis.` : "No hay cambios pendientes de revisar."}</div>
          </>
        )}
      </div>
      <Link className="btn-p" href={`/p/${id}/fixes`}>{s.proposed ? "Revisar correcciones" : "Ver correcciones"}<Icon name="chevr" className="h-3.5 w-3.5" /></Link>
    </div>
  );
}
