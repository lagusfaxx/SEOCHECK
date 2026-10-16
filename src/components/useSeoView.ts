"use client";
import { useEffect, useState } from "react";
import { useProject } from "./Shell";
export type SeoView = "guided" | "technical";
/** Preferencia por navegador/proyecto; cambiar de vista no cambia permisos ni el plan contratado. */
export function useSeoView() {
  const { id, project } = useProject();
  const [view, setState] = useState<SeoView>("guided");
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(`seo-view:${id}`);
    } catch {}
    const experience = project?.settings?.onboarding?.experience;
    setState(
      stored === "guided" || stored === "technical"
        ? stored
        : experience === "seo" || experience === "agency"
          ? "technical"
          : "guided",
    );
  }, [id, project?.settings?.onboarding?.experience]);
  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.id === id &&
        (detail.view === "guided" || detail.view === "technical")
      )
        setState(detail.view);
    };
    window.addEventListener("seo-view-change", sync);
    return () => window.removeEventListener("seo-view-change", sync);
  }, [id]);
  return [
    view,
    (v: SeoView) => {
      setState(v);
      try {
        localStorage.setItem(`seo-view:${id}`, v);
        window.dispatchEvent(
          new CustomEvent("seo-view-change", { detail: { id, view: v } }),
        );
      } catch {}
    },
  ] as const;
}
