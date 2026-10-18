import { piChatEventSchema } from "@aigc-flow/shared";

export async function* readPiStream(response: Response) {
  if (!response.body) throw new Error("对话响应没有内容");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = false;
  let heartbeat = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (done && buffer) buffer += "\n";
      let end = buffer.indexOf("\n");
      while (end >= 0) {
        const line = buffer.slice(0, end).trimEnd();
        buffer = buffer.slice(end + 1);
        if (line.startsWith("event:")) heartbeat = line.trim() === "event: heartbeat";
        if (line === "") heartbeat = false;
        if (line.startsWith("data: ") && !heartbeat) {
          const event = piChatEventSchema.parse(JSON.parse(line.slice(6)));
          if (event.type === "done" || event.type === "error") complete = true;
          if (event.type === "state" && event.run?.status !== "running") complete = true;
          yield event;
        }
        end = buffer.indexOf("\n");
      }
      if (done) break;
    }
    if (!complete) throw new Error("对话连接中断，请重新打开对话查看已保存内容");
  } finally {
    reader.releaseLock();
  }
}
