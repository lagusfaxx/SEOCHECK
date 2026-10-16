"use client";
import ExpertPanel from "./ExpertPanel";
export default function Analytics() {
  return (
    <ExpertPanel
      kind="analytics"
      links={[{ title: "Conectar y sincronizar Analytics", path: "results" }]}
    />
  );
}
