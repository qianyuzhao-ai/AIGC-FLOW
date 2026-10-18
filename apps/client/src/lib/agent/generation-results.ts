import {
  type GenerationJobView,
  IMAGE_GEN_NODE_TYPE,
  VIDEO_GEN_NODE_TYPE,
} from "@aigc-flow/shared";
import type { Node } from "@xyflow/react";

const resultFields = [
  "generationJobId",
  "generationRequestId",
  "generationPrompt",
  "resultUrl",
  "status",
  "error",
  "naturalWidth",
  "naturalHeight",
];
/** Undo changes the graph, never cancels or rewinds an already submitted generation. */
export function retainGenerationResults(
  snapshot: Node[],
  current: Node[],
  jobs: GenerationJobView[],
): Node[] {
  return snapshot.map((node) => {
    if (node.type !== IMAGE_GEN_NODE_TYPE && node.type !== VIDEO_GEN_NODE_TYPE) return node;
    const latest = current.find((item) => item.id === node.id);
    const data = latest
      ? { ...node.data, ...Object.fromEntries(resultFields.map((key) => [key, latest.data[key]])) }
      : { ...node.data };
    if (latest && latest.data.generationJobId !== node.data.generationJobId)
      data.mark = latest.data.mark;
    const job = jobs.find((item) => item.id === data.generationJobId);
    if (job?.status === "succeeded")
      Object.assign(data, { status: "ready", resultUrl: job.resultUrl, error: undefined });
    if (job?.status === "failed" || job?.status === "unknown")
      Object.assign(data, { status: "error", error: job.error });
    return { ...node, data };
  });
}
