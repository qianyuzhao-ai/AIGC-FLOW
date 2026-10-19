import type { AgentCommandView } from "@aigc-flow/shared";

export function commandNodeIds(command: AgentCommandView): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string") ids.add(value);
  };
  for (const source of [command.args, command.result?.data]) {
    if (!source) continue;
    if (Array.isArray(source.nodeIds)) source.nodeIds.forEach(add);
    add(source.groupId);
    for (const key of ["nodes", "updates", "results", "jobs", "connections"]) {
      const entries = source[key];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        if (key === "nodes") add(entry.id);
        else {
          add(entry.nodeId);
          add(entry.source);
          add(entry.target);
        }
      }
    }
  }
  return [...ids];
}
