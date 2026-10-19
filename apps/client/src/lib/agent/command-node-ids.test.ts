import assert from "node:assert/strict";
import test from "node:test";
import type { AgentCommandView } from "@aigc-flow/shared";
import { commandNodeIds } from "./command-node-ids";

test("generation receipts locate node IDs rather than job IDs", () => {
  const command: AgentCommandView = {
    id: "command",
    runId: "run",
    name: "generate_nodes",
    args: { nodeIds: ["image-a", "image-b"] },
    expectedRevision: 1,
    status: "completed",
    result: {
      success: true,
      revision: 2,
      applied: true,
      saved: true,
      data: {
        results: [
          { id: "job-a", nodeId: "image-a" },
          { id: "job-b", nodeId: "image-b" },
        ],
      },
    },
  };
  assert.deepEqual(commandNodeIds(command), ["image-a", "image-b"]);
});

test("read receipts and update arguments preserve the affected node locations", () => {
  const command: AgentCommandView = {
    id: "command",
    runId: "run",
    name: "get_nodes",
    args: {},
    expectedRevision: null,
    status: "completed",
    result: {
      success: true,
      revision: 1,
      applied: false,
      saved: true,
      data: { nodes: [{ id: "image-a" }, { id: "image-b" }] },
    },
  };
  assert.deepEqual(commandNodeIds(command), ["image-a", "image-b"]);
  assert.deepEqual(
    commandNodeIds({
      ...command,
      name: "update_nodes",
      result: null,
      args: { updates: [{ nodeId: "image-a", prompt: "new prompt" }] },
    }),
    ["image-a"],
  );
});
