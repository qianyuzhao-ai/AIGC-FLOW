"use client";
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { DesktopLifecycle } from "./desktop-lifecycle";

const ResidentCanvas = lazy(() =>
  import("./canvas/canvas-page").then((module) => ({ default: module.CanvasPage })),
);
const WebProjectsContext = createContext<((projectId: number | null) => void) | null>(null);
export const useWebProjects = () => useContext(WebProjectsContext);

/** Keep visited project canvases alive across client-side navigation, like desktop tabs. */
export function WebProjectHost({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<number[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const activate = useCallback((id: number | null) => {
    if (id !== null) setProjects((current) => (current.includes(id) ? current : [...current, id]));
    setActiveId(id);
  }, []);
  const content = useMemo(
    () =>
      projects.map((id) => (
        <DesktopLifecycle key={id} projectId={id} active={activeId === id}>
          <Suspense fallback={<div className="p-6 text-muted-foreground">加载画布…</div>}>
            <ResidentCanvas projectId={id} />
          </Suspense>
        </DesktopLifecycle>
      )),
    [projects, activeId],
  );
  return (
    <WebProjectsContext.Provider value={activate}>
      {children}
      <div
        className="fixed inset-0"
        style={{ pointerEvents: activeId === null ? "none" : undefined }}
      >
        {content}
      </div>
    </WebProjectsContext.Provider>
  );
}
