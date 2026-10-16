"use client";
import ExpertPanel from "./ExpertPanel";
export default function Serp() {
  return (
    <ExpertPanel
      kind="serp"
      links={[{ title: "Seguimiento de keywords", path: "rank" }]}
    />
  );
}
