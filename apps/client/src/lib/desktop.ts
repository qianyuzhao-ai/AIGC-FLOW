import type { DesktopBridge, DesktopProject } from "@aigc-flow/shared";
import { createContext, useContext } from "react";
import type { SaveStatus } from "@/hooks/use-graph-autosave";

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export const getDesktopApi = () => (typeof window === "undefined" ? undefined : window.desktop);
export type ProjectSession = { name: string; status: SaveStatus; save: () => Promise<boolean> };
export type WorkspaceActions = {
  activeId: number | null;
  open: (project: DesktopProject) => void;
  activate: (id: number | null) => void;
  close: (id: number) => Promise<boolean>;
  beforeDelete: (id: number) => Promise<boolean>;
  report: (id: number, session: ProjectSession) => () => void;
};
export const WorkspaceContext = createContext<WorkspaceActions | null>(null);
export const CanvasPortalContext = createContext<HTMLElement | undefined>(undefined);
export const CanvasActivityContext = createContext(true);
export const useCanvasActive = () => useContext(CanvasActivityContext);
export const useDesktopWorkspace = () => useContext(WorkspaceContext);
