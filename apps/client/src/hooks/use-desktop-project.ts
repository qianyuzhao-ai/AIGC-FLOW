"use client";

import { useEffect, useRef } from "react";
import type { SaveStatus } from "@/hooks/use-graph-autosave";
import { useCanvasActive, useDesktopWorkspace } from "@/lib/desktop";

export function useDesktopProject(
  id: number,
  name: string,
  status: SaveStatus,
  save: () => Promise<boolean>,
) {
  const workspace = useDesktopWorkspace();
  const active = useCanvasActive();
  const report = workspace?.report;
  const latest = useRef(save);
  latest.current = save;
  useEffect(
    () => report?.(id, { name, status, save: () => latest.current() }),
    [report, id, name, status],
  );
  return active && (!workspace || workspace.activeId === id);
}
