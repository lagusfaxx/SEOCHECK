"use client";
import ExpertPanel from "./ExpertPanel";
import { useProject } from "../Shell";
import { api, useAction } from "../ui";
export default function Advanced() {
  const { id } = useProject();
  const [connect, busy] = useAction(async () => {
    const r = await api<{ url: string }>(`/api/p/${id}/gsc/connect`, "POST", {
      business: true,
    });
    window.location.assign(r.url);
  });
  return (
    <div className="space-y-4">
      <button className="btn" disabled={busy} onClick={() => connect()}>
        Autorizar Google Business Profile
      </button>
      <ExpertPanel
        kind="advanced"
        actions={[
          { title: "Comprobar competencia", path: "monitor" },
          { title: "Leer ubicaciones de Business Profile", path: "gbp" },
        ]}
        links={[{ title: "SEO local y visibilidad en IA", path: "results" }]}
        forms={[
          {
            title: "Páginas críticas a vigilar",
            path: "critical",
            method: "PATCH",
            hint: "Además de la home: si cambia su estado HTTP, canonical o noindex, o desaparecen, llega un aviso inmediato. robots.txt y el tamaño del sitemap se vigilan solos.",
            fields: [{ name: "criticalUrls", label: "URLs (una por línea)", type: "textarea", parse: "lines", required: true, placeholder: "https://tusitio.cl/categoria\nhttps://tusitio.cl/producto-estrella" }],
          },
          {
            title: "Importar logs del servidor",
            path: "logs",
            hint: "Apache/Nginx combined, hasta 5 MB. Se conserva el resumen sin IP ni líneas crudas.",
            fields: [
              { name: "fileName", label: "Nombre del archivo" },
              {
                name: "logs",
                label: "Contenido del log",
                type: "textarea",
                required: true,
              },
            ],
          },
          {
            title: "URLs de competencia a monitorizar",
            path: "settings",
            method: "PATCH",
            hint: "Hasta 10 URLs públicas, una observación diaria por URL.",
            fields: [
              {
                name: "monitorUrls",
                label: "URLs (una por línea)",
                type: "textarea",
                parse: "lines",
                required: true,
              },
            ],
          },
          {
            title: "Crear mapeo de migración",
            path: "migration",
            fields: [
              { name: "name", label: "Nombre", required: true },
              {
                name: "mapping",
                label: "URLs antiguas y nuevas",
                type: "textarea",
                parse: "json",
                required: true,
                placeholder:
                  '[{"from":"https://anterior.cl/a","to":"https://tu-sitio.cl/a"}]',
              },
            ],
          },
          {
            title: "Verificar migración",
            path: "migration/check",
            fields: [
              {
                name: "id",
                label: "Identificador de la migración",
                required: true,
              },
              {
                name: "limit",
                label: "Máximo de URLs por comprobación (1–200)",
                type: "number",
                parse: "number",
                required: true,
              },
            ],
          },
        ]}
      />
    </div>
  );
}
