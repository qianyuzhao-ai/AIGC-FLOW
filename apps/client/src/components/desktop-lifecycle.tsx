"use client";

import { type ReactNode, useEffect, useState } from "react";
import { CanvasActivityContext, CanvasPortalContext } from "@/lib/desktop";

/** Keep hidden canvases mounted and measurable, but make them inert and silent. */
export function DesktopLifecycle({
  active,
  children,
  projectId,
}: {
  active: boolean;
  children: ReactNode;
  projectId?: number;
}) {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = panel;
    if (!element) return;
    const pauseHidden = (event: Event) => {
      if (!active && event.target instanceof HTMLMediaElement) event.target.pause();
    };
    if (!active)
      for (const media of element.querySelectorAll<HTMLMediaElement>("video, audio")) media.pause();
    element.addEventListener("play", pauseHidden, true);
    return () => element.removeEventListener("play", pauseHidden, true);
  }, [active, panel]);
  return (
    <div
      ref={setPanel}
      className="desktop-panel"
      data-project-id={projectId}
      data-active={active}
      aria-hidden={!active}
      inert={!active}
    >
      <CanvasPortalContext.Provider value={panel ?? undefined}>
        <CanvasActivityContext.Provider value={active}>{children}</CanvasActivityContext.Provider>
      </CanvasPortalContext.Provider>
    </div>
  );
}
