"use client";
import ExpertPanel from "./ExpertPanel";
export default function CrawlPro() {
  return (
    <ExpertPanel
      kind="crawl"
      links={[{ title: "Ejecutar auditoría", path: "audit" }]}
      forms={[
        {
          title: "User-agent de rastreo",
          path: "settings",
          method: "PATCH",
          fields: [
            {
              name: "userAgent",
              label: "User-agent",
              required: true,
              placeholder: "SEOCheckBot/1.0",
            },
          ],
        },
        {
          title: "Controlar facetas",
          path: "settings",
          method: "PATCH",
          hint: "Los parámetros de seguimiento se eliminan; las facetas útiles se conservan hasta el límite por patrón.",
          fields: [
            {
              name: "maxPerPattern",
              label: "Máximo de URLs por patrón",
              type: "number",
              parse: "number",
              required: true,
            },
            {
              name: "ignoreParams",
              label: "Parámetros a ignorar (uno por línea)",
              type: "textarea",
              parse: "lines",
              placeholder: "utm_*\ngclid\nfbclid",
            },
          ],
        },
        {
          title: "Reglas de plantilla",
          path: "settings",
          method: "PATCH",
          fields: [
            {
              name: "templates",
              label: "Reglas de rutas",
              type: "textarea",
              parse: "json",
              required: true,
              placeholder: '[{"name":"product","pattern":"/tienda/*"}]',
            },
          ],
        },
        {
          title: "Extracción personalizada",
          path: "settings",
          method: "PATCH",
          hint: "CSS, XPath simple o regex. XPath: //tag[@atributo='valor'], /text() y /@atributo.",
          fields: [
            {
              name: "extract",
              label: "Reglas de extracción",
              type: "textarea",
              parse: "json",
              required: true,
              placeholder:
                '[{"name":"sku","type":"css","selector":"[itemprop=sku]","attr":"content"}]',
            },
          ],
        },
      ]}
    />
  );
}
