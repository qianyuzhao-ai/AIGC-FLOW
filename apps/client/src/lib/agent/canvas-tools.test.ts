import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasCommand } from "@aigc-flow/shared";
import { applyCanvasTool, type CanvasState } from "./canvas-tools";

const command = (
  id: string,
  name: CanvasCommand["name"],
  args: Record<string, unknown>,
): CanvasCommand => ({ id, runId: "run", name, args, expectedRevision: null });
test("create, edit, arrange and group use exact IDs without selected-node side effects", () => {
  let state: CanvasState = {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    center: { x: 500, y: 400 },
  };
  const result = applyCanvasTool(
    command("create", "create_nodes", {
      nodes: [1, 2, 3].map((i) => ({ kind: "image", label: `图片${i}`, prompt: `提示词${i}` })),
    }),
    state,
  );
  state = { ...state, ...result };
  assert.equal(state.nodes.length, 3);
  const ids = state.nodes.map((node) => node.id);
  state = {
    ...state,
    ...applyCanvasTool(
      command("arrange", "arrange_nodes", { nodeIds: ids, layout: "horizontal" }),
      state,
    ),
  };
  assert.deepEqual(
    state.nodes.map((node) => node.position.x),
    [233, 807, 1381],
  );
  assert.equal(new Set(state.nodes.map((node) => node.position.y)).size, 1);
  state = {
    ...state,
    ...applyCanvasTool(
      command("edit", "update_nodes", { updates: [{ nodeId: ids[1], prompt: "新提示词" }] }),
      state,
    ),
  };
  assert.equal(state.nodes[1]?.data.prompt, "新提示词");
  state = {
    ...state,
    ...applyCanvasTool(command("group", "group_nodes", { nodeIds: ids, label: "创意组" }), state),
  };
  assert.equal(state.nodes.filter((node) => node.parentId === "group").length, 3);
  state = {
    ...state,
    ...applyCanvasTool(
      command("vertical", "arrange_nodes", { nodeIds: ids, layout: "vertical" }),
      state,
    ),
  };
  const parent = state.nodes.find((node) => node.id === "group");
  for (const child of state.nodes.filter((node) => node.parentId === "group"))
    assert.ok((parent?.height ?? 0) > child.position.y + (child.measured?.height ?? 480));
  state = {
    ...state,
    ...applyCanvasTool(command("ungroup", "ungroup_nodes", { groupId: "group" }), state),
  };
  assert.equal(state.nodes.length, 3);
  assert.ok(state.nodes.every((node) => !node.parentId));
  assert.throws(() =>
    applyCanvasTool(
      command("bad", "connect_nodes", { connections: [{ source: ids[0], target: ids[0] }] }),
      state,
    ),
  );
  assert.throws(() =>
    applyCanvasTool(
      command("bad", "update_nodes", { updates: [{ nodeId: "missing", prompt: "x" }] }),
      state,
    ),
  );
});
