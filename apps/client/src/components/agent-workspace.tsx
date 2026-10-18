"use client";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { ProjectRuntime } from "@/lib/agent/project-runtime";
import { getTaskCount } from "@/lib/desktop-tasks";

const AgentContext = createContext<Map<number, ProjectRuntime> | null>(null);
export function AgentWorkspace({ children }: { children: ReactNode }) {
  const [projects] = useState(() => new Map<number, ProjectRuntime>());
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if ([...projects.keys()].some((id) => getTaskCount(id) > 0)) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [projects]);
  return <AgentContext.Provider value={projects}>{children}</AgentContext.Provider>;
}
export function useProjectAgent(projectId: number) {
  const projects = useContext(AgentContext);
  if (!projects) throw new Error("缺少 AgentWorkspace");
  let project = projects.get(projectId);
  if (!project) {
    project = new ProjectRuntime(projectId);
    projects.set(projectId, project);
  }
  return project;
}
