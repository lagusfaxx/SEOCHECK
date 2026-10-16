"use client";
import ExpertPanel from "./ExpertPanel";
export default function ContentPro() {
  return (
    <ExpertPanel
      kind="content"
      links={[
        { title: "Briefs y versiones", path: "content" },
        { title: "Clusters", path: "keywords" },
      ]}
      forms={[
        {
          title: "Programar contenido",
          path: "calendar",
          fields: [
            { name: "title", label: "Título de la tarea", required: true },
            { name: "url", label: "URL objetivo", type: "url" },
            {
              name: "dueAt",
              label: "Fecha de entrega",
              type: "date",
              required: true,
            },
            {
              name: "reason",
              label: "Qué actualizar y cómo verificarlo",
              type: "textarea",
            },
          ],
        },
      ]}
    />
  );
}
