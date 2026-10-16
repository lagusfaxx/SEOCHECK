"use client";
import ExpertPanel from "./ExpertPanel";
export default function Perf() {
  return (
    <ExpertPanel
      kind="perf"
      actions={[
        {
          title: "Medir una URL por plantilla",
          path: "measure",
          body: { limit: 5 },
        },
      ]}
    />
  );
}
