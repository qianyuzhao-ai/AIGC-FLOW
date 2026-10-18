"use client";

import type { ProjectGraph } from "@aigc-flow/shared";
import type { Edge, Node, Viewport } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { hasGraphContentChanges, isSameGraph, toPersistedGraph } from "@/lib/graph";
import { SaveQueue } from "@/lib/save-queue";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";
type AutosaveOptions = {
  projectId: number;
  nodes: Node[];
  edges: Edge[];
  getViewport: () => Viewport;
  initialGraph: ProjectGraph;
  initialVersion: number;
  readGraph?: () => ProjectGraph;
};
export function useGraphAutosave({
  projectId,
  nodes,
  edges,
  getViewport,
  initialGraph,
  initialVersion,
  readGraph,
}: AutosaveOptions) {
  const version = useRef(initialVersion);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const read = useRef(() => toPersistedGraph(nodes, edges, getViewport()));
  read.current = readGraph ?? (() => toPersistedGraph(nodes, edges, getViewport()));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previous = useRef<{ nodes: Node[]; edges: Edge[] } | undefined>(undefined);
  const [queue] = useState(
    () =>
      new SaveQueue(
        initialGraph,
        () => read.current(),
        async (graph) => {
          const response = await api.api.projects[":id"].graph.$put({
            param: { id: String(projectId) },
            json: { graph, expectedVersion: version.current },
          });
          if (!response.ok) throw new Error("保存失败");
          version.current = (await response.json()).version;
        },
        isSameGraph,
        setStatus,
      ),
  );
  const saveNow = useCallback(() => {
    clearTimeout(timer.current);
    return queue.flush();
  }, [queue]);
  useEffect(() => {
    const before = previous.current;
    previous.current = { nodes, edges };
    // 选中态和自动测量不会取消正在等待的保存，也不会把画布误标成未保存。
    if (before && !hasGraphContentChanges(before, { nodes, edges })) return;
    clearTimeout(timer.current);
    if (queue.saving) return;
    // 先保护未保存内容；完整快照和深比较只在防抖后由队列执行。
    // 首次挂载也检查一次加载时的归一化，但不提前显示 dirty。
    if (before) setStatus("dirty");
    timer.current = setTimeout(() => void saveNow(), 800);
  }, [nodes, edges, queue, saveNow]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      previous.current = undefined;
    },
    [],
  );
  useEffect(() => {
    if (status === "saved") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);
  return { status, saveNow };
}
