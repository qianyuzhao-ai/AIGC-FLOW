"use client";

import { type DesktopWindowState, emptyWorkspace, workspaceReducer } from "@aigc-flow/shared";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { getDesktopApi, type ProjectSession, WorkspaceContext } from "@/lib/desktop";
import { getTaskCount } from "@/lib/desktop-tasks";
import { DesktopLifecycle } from "./desktop-lifecycle";
import { DesktopTabBar } from "./desktop-tab-bar";
import { WebProjectHost } from "./web-project-host";

const ResidentCanvas = lazy(() =>
  import("@/components/canvas/canvas-page").then((module) => ({
    default: module.CanvasPage,
  })),
);

export function DesktopWorkspace({ children }: { children: ReactNode }) {
  const [windowState, setWindowState] = useState<DesktopWindowState | null>(null);
  const [state, dispatch] = useReducer(workspaceReducer, emptyWorkspace);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const locked = useRef(false);
  const sessions = useRef(new Map<number, ProjectSession>());
  const api = getDesktopApi();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, resolvedTheme } = useTheme();

  useEffect(() => {
    if (!api) return;
    let mounted = true;
    void api.windowState().then((value) => {
      if (mounted) setWindowState(value);
    });
    const unsubscribe = api.onWindowState(setWindowState);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [api]);

  const activate = useCallback(
    (id: number | null) => {
      if (locked.current) return;
      if (
        document.activeElement instanceof HTMLElement &&
        document.activeElement.closest(".desktop-content")
      )
        document.activeElement.blur();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      dispatch({ type: "activate", id });
      if (id === null && pathname !== "/") router.push("/");
    },
    [pathname, router],
  );

  const prepare = useCallback(async (id: number) => {
    const bridge = getDesktopApi();
    const project = stateRef.current.projects.find((item) => item.id === id);
    if (!bridge || !project) return true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await new Promise((done) => setTimeout(done, 0));
    if (
      getTaskCount(id) > 0 &&
      (await bridge.confirmClose({
        projectName: project.name,
        reason: "running",
      })) === "cancel"
    )
      return false;
    for (;;) {
      const session = sessions.current.get(id);
      if (!session || (await session.save())) return true;
      const choice = await bridge.confirmClose({ projectName: project.name, reason: "unsaved" });
      if (choice === "cancel") return false;
      if (choice === "discard") return true;
    }
  }, []);

  const close = useCallback(
    async (id: number) => {
      if (!stateRef.current.projects.some((p) => p.id === id)) return true;
      if (locked.current) return false;
      locked.current = true;
      setBusy(true);
      try {
        if (!(await prepare(id))) return false;
        dispatch({ type: "close", id });
        return true;
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
    [prepare],
  );

  useEffect(
    () =>
      api?.beforeWindowClose(async () => {
        if (locked.current) return false;
        locked.current = true;
        setBusy(true);
        try {
          for (const project of stateRef.current.projects)
            if (!(await prepare(project.id))) return false;
          return true;
        } finally {
          locked.current = false;
          setBusy(false);
        }
      }),
    [api, prepare],
  );

  useEffect(
    () =>
      api?.onTabShortcut((action) => {
        if (locked.current) return;
        const current = stateRef.current;
        if (action === "close") {
          if (current.activeId !== null) void close(current.activeId);
          return;
        }
        const ids = current.projects.map((project) => project.id);
        if (!ids.length) return;
        const index = ids.indexOf(current.activeId ?? -1);
        const next =
          index < 0
            ? action === "next"
              ? 0
              : ids.length - 1
            : (index + (action === "next" ? 1 : -1) + ids.length) % ids.length;
        activate(ids[next] ?? null);
      }),
    [api, close, activate],
  );

  const name = state.projects.find((project) => project.id === state.activeId)?.name;
  useEffect(() => {
    if (api && resolvedTheme)
      void api.appearance(
        resolvedTheme === "dark",
        name ? `${name} · AIGC-FLOW` : "AIGC-FLOW",
        theme === "system",
      );
  }, [api, resolvedTheme, name, theme]);

  const report = useCallback((id: number, session: ProjectSession) => {
    sessions.current.set(id, session);
    dispatch({ type: "rename", id, name: session.name });
    return () => {
      if (sessions.current.get(id) === session) sessions.current.delete(id);
    };
  }, []);
  const value = useMemo(
    () => ({
      activeId: state.activeId,
      activate,
      close,
      beforeDelete: close,
      report,
      open: (project: { id: number; name: string }) => {
        if (!locked.current)
          dispatch({ type: "open", project: { id: project.id, name: project.name } });
      },
    }),
    [state.activeId, activate, close, report],
  );

  if (!windowState) return <WebProjectHost>{children}</WebProjectHost>;
  return (
    <WorkspaceContext.Provider value={value}>
      <div className="desktop-workspace">
        <DesktopTabBar
          state={state}
          windowState={windowState}
          busy={busy}
          activate={activate}
          close={close}
          move={(id, target, after) => {
            if (!locked.current) dispatch({ type: "move", id, target, after });
          }}
        />
        <div className="desktop-content" inert={busy}>
          <DesktopLifecycle active={state.activeId === null}>{children}</DesktopLifecycle>
          {state.projects.map((project) => (
            <DesktopLifecycle
              key={project.id}
              projectId={project.id}
              active={state.activeId === project.id}
            >
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    加载画布…
                  </div>
                }
              >
                <ResidentCanvas projectId={project.id} />
              </Suspense>
            </DesktopLifecycle>
          ))}
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
