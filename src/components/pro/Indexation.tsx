"use client";
import ExpertPanel from "./ExpertPanel";
export default function Indexation() {
  return (
    <ExpertPanel
      kind="index"
      actions={[
        {
          title: "Inspeccionar 20 URLs prioritarias",
          path: "inspect",
          body: { limit: 20 },
        },
      ]}
      links={[
        { title: "Conectar Search Console", path: "settings" },
        { title: "Consultas y páginas", path: "gsc" },
      ]}
    />
  );
}
