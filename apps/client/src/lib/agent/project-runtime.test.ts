import assert from "node:assert/strict";
import test from "node:test";
import {
  type CanvasCommand,
  DEFAULT_IMAGE_GEN_DATA,
  type GenerationJobView,
} from "@aigc-flow/shared";
import { copiedNodeData } from "../graph";
import type { CanvasState } from "./canvas-tools";
import { retainGenerationResults } from "./generation-results";
import { ProjectRuntime } from "./project-runtime";

const command = (
  id: string,
  name: CanvasCommand["name"],
  args: Record<string, unknown>,
  revision: number | null,
): CanvasCommand => ({ id, runId: "run", name, args, expectedRevision: revision });
test("canvas executor rejects stale edits, deduplicates commands and reports failed saves", async () => {
  const runtime = new ProjectRuntime(1);
  let state: CanvasState = {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    center: { x: 500, y: 400 },
  };
  let writes = 0;
  let saved = true;
  runtime.bind({
    read: () => state,
    apply: (nodes, edges, history) => {
      state = { ...state, nodes, edges };
      if (history) writes++;
    },
    save: async () => saved,
    focus: () => {},
  });
  const read = await runtime.executeCommand(command("read", "get_canvas", {}, null));
  const create = command(
    "create",
    "create_nodes",
    { nodes: [{ kind: "image", prompt: "first" }] },
    read.revision,
  );
  const created = await runtime.executeCommand(create);
  assert.equal(created.success, true);
  assert.equal(writes, 1);
  await runtime.executeCommand(create);
  assert.equal(writes, 1);
  assert.equal(state.nodes.length, 1);
  const first = state.nodes[0];
  assert.ok(first);
  state = { ...state, nodes: [{ ...first, data: { ...first.data, prompt: "manual" } }] };
  const conflict = await runtime.executeCommand(
    command(
      "stale",
      "update_nodes",
      { updates: [{ nodeId: first.id, prompt: "overwrite" }] },
      created.revision,
    ),
  );
  assert.equal(conflict.code, "STALE_CANVAS");
  assert.equal(state.nodes[0]?.data.prompt, "manual");
  const reread = await runtime.executeCommand(command("reread", "get_canvas", {}, null));
  saved = false;
  const failure = await runtime.executeCommand(
    command(
      "save",
      "update_nodes",
      { updates: [{ nodeId: first.id, prompt: "new" }] },
      reread.revision,
    ),
  );
  assert.equal(failure.applied, true);
  assert.equal(failure.saved, false);
  assert.equal(failure.success, false);
});
test("undo preserves completed generation and redo recovers a result without regenerating", () => {
  const before = {
    id: "image",
    type: "image-gen",
    position: { x: 0, y: 0 },
    data: { label: "image", prompt: "old", status: "idle" },
  };
  const generated = {
    ...before,
    position: { x: 600, y: 0 },
    data: {
      ...before.data,
      prompt: "new",
      status: "ready",
      generationJobId: "job",
      resultUrl: "https://example.test/image.png",
    },
  };
  const restored = retainGenerationResults([before], [generated], [])[0];
  assert.equal(restored?.position.x, 0);
  assert.equal(restored?.data.prompt, "old");
  assert.equal(restored?.data.resultUrl, generated.data.resultUrl);
  const job: GenerationJobView = {
    id: "job",
    projectId: 1,
    nodeId: "image",
    kind: "image",
    status: "succeeded",
    resultUrl: generated.data.resultUrl,
    error: null,
    input: {},
  };
  const redo = retainGenerationResults(
    [{ ...generated, data: { ...generated.data, status: "generating", resultUrl: undefined } }],
    [],
    [job],
  )[0];
  assert.equal(redo?.data.status, "ready");
  assert.equal(redo?.data.resultUrl, job.resultUrl);
  assert.deepEqual(retainGenerationResults([], [generated], [job]), []);
  const copy = copiedNodeData({
    ...generated.data,
    status: "generating",
    generationRequestId: "request",
  });
  assert.equal(copy.resultUrl, job.resultUrl);
  assert.equal(copy.generationJobId, undefined);
  assert.equal(copy.generationRequestId, undefined);
  assert.equal(copy.status, "ready");
});

test("a lost generation response recovers by request ID without resubmission", async () => {
  const runtime = new ProjectRuntime(3);
  let state: CanvasState = {
    nodes: [
      {
        id: "image",
        type: "image-gen",
        position: { x: 0, y: 0 },
        data: { ...DEFAULT_IMAGE_GEN_DATA, prompt: "test" },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    center: { x: 0, y: 0 },
  };
  runtime.bind({
    read: () => state,
    apply: (nodes, edges) => {
      state = { ...state, nodes, edges };
    },
    save: async () => true,
    focus: () => {},
  });
  const original = globalThis.fetch;
  let submissions = 0;
  const job: GenerationJobView = {
    id: "recovered",
    projectId: 3,
    nodeId: "image",
    kind: "image",
    status: "succeeded",
    resultUrl: "https://example.test/actual.png",
    error: null,
    input: { prompt: "test" },
  };
  globalThis.fetch = async (input, init) => {
    if (init?.method === "POST") {
      submissions++;
      assert.equal(state.nodes[0]?.data.generationRequestId, "lost-response");
      throw new TypeError("connection lost after acceptance");
    }
    assert.match(String(input), /requests\/lost-response$/);
    return Response.json({ job });
  };
  try {
    assert.equal((await runtime.generate("image", "lost-response")).id, "recovered");
    assert.equal(submissions, 1);
    assert.equal(state.nodes[0]?.data.resultUrl, job.resultUrl);
  } finally {
    globalThis.fetch = original;
  }
});
