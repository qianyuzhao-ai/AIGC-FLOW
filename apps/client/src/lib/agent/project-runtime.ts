import {
  type AgentCommandView,
  type AgentRunView,
  type CanvasCommand,
  type CanvasReceipt,
  canvasToolSchemas,
  type GenerationJobView,
  generationJobViewSchema,
  MAX_PI_IMAGES,
  type PiChatMessage,
  type PiConversation,
  type PiImageAttachment,
  type PiSessionInfo,
  type PiThinkingLevel,
} from "@aigc-flow/shared";
import { api } from "../api";
import { apiError } from "../api-error";
import { beginDesktopTask } from "../desktop-tasks";
import { toPersistedGraph } from "../graph";
import { nodeMediaOf } from "../node-media";
import { readPiStream } from "../pi-stream";
import { applyCanvasTool, type CanvasBinding } from "./canvas-tools";
import { generationRequest } from "./generation-input";

type View = {
  chatOpen: boolean;
  draftImages: PiImageAttachment[];
  sessionInfo: PiSessionInfo | null;
  thinkingLevel?: PiThinkingLevel;
  conversationId: string | null;
  conversations: PiConversation[];
  messages: PiChatMessage[];
  run: AgentRunView | null;
  commands: AgentCommandView[];
  jobs: GenerationJobView[];
  loading: boolean;
  error: string;
};
const initial: View = {
  chatOpen: false,
  draftImages: [],
  sessionInfo: null,
  conversationId: null,
  conversations: [],
  messages: [],
  run: null,
  commands: [],
  jobs: [],
  loading: false,
  error: "",
};
export class ProjectRuntime {
  private binding?: CanvasBinding;
  private revision = 0;
  private fingerprint = "";
  private listeners = new Set<() => void>();
  private view: View = { ...initial };
  private stream?: AbortController;
  private executions = new Map<string, Promise<CanvasReceipt>>();
  private sent = new Set<string>();
  private delivering = new Set<string>();
  private generating = new Map<string, Promise<GenerationJobView>>();
  private activeFinish?: () => void;
  readonly clientId = crypto.randomUUID();
  constructor(readonly projectId: number) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.view;
  private patch(patch: Partial<View>) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }
  bind(binding: CanvasBinding) {
    this.binding = binding;
    void this.restoreJobs();
    return () => {
      if (this.binding === binding) {
        if (this.view.run?.clientId === this.clientId) void this.stop();
        this.binding = undefined;
      }
    };
  }
  private canvas() {
    if (!this.binding) throw new Error("当前项目画布尚未加载");
    return this.binding;
  }
  private currentRevision() {
    const state = this.canvas().read();
    const { nodes, edges } = toPersistedGraph(state.nodes, state.edges, state.viewport);
    const value = JSON.stringify({ nodes, edges });
    if (this.fingerprint !== value) {
      this.revision++;
      this.fingerprint = value;
    }
    return this.revision;
  }
  focus(ids: string[]) {
    this.binding?.focus(ids);
  }
  setChatOpen = (chatOpen: boolean) => this.patch({ chatOpen });
  addChatImages(nodeIds: string[]) {
    if (this.view.loading) throw new Error("正在处理请求，请稍后添加图片");
    const available = this.canvasImages();
    const images = new Map(this.view.draftImages.map((image) => [image.nodeId, image]));
    for (const id of nodeIds) {
      const image = available.find((item) => item.nodeId === id);
      if (!image) throw new Error("所选图片尚未就绪或已不存在");
      images.set(id, image);
    }
    if (images.size > MAX_PI_IMAGES) throw new Error(`每条消息最多添加 ${MAX_PI_IMAGES} 张图片`);
    this.patch({ draftImages: [...images.values()], chatOpen: true, error: "" });
  }
  removeChatImage(nodeId: string) {
    this.patch({ draftImages: this.view.draftImages.filter((image) => image.nodeId !== nodeId) });
  }
  setThinkingLevel(thinkingLevel: PiThinkingLevel) {
    if (this.view.sessionInfo?.thinkingLevels.includes(thinkingLevel))
      this.patch({ thinkingLevel });
  }
  async refreshSessionInfo() {
    const conversationId = this.view.conversationId;
    try {
      const response = await api.api.pi.projects[":projectId"]["session-info"].$get({
        param: { projectId: String(this.projectId) },
        query: { conversationId: conversationId ?? undefined },
      });
      if (!response.ok) throw await apiError(response);
      const sessionInfo = await response.json();
      if (this.view.conversationId !== conversationId) return;
      const sameModel =
        sessionInfo.model?.id === this.view.sessionInfo?.model?.id &&
        sessionInfo.model?.provider === this.view.sessionInfo?.model?.provider;
      this.patch({
        sessionInfo,
        thinkingLevel:
          sameModel &&
          this.view.thinkingLevel &&
          sessionInfo.thinkingLevels.includes(this.view.thinkingLevel)
            ? this.view.thinkingLevel
            : undefined,
      });
    } catch (error) {
      if (this.view.conversationId === conversationId)
        this.patch({ error: error instanceof Error ? error.message : "读取模型信息失败" });
    }
  }
  canvasImages(): PiImageAttachment[] {
    return this.canvas()
      .read()
      .nodes.flatMap((node) => {
        const media = nodeMediaOf(node);
        return media?.kind === "image"
          ? [
              {
                nodeId: node.id,
                label: String(node.data.label ?? "图片"),
                url: media.url,
              },
            ]
          : [];
      });
  }
  async newConversation() {
    if (this.view.loading || this.view.run?.status === "running") return;
    this.patch({ loading: true, error: "" });
    try {
      const response = await api.api.pi.projects[":projectId"].conversations.$post({
        param: { projectId: String(this.projectId) },
      });
      if (!response.ok) throw await apiError(response);
      const conversation = await response.json();
      this.patch({ loading: false });
      await this.load(conversation.id);
    } catch (error) {
      this.patch({
        loading: false,
        error: error instanceof Error ? error.message : "创建对话失败",
      });
    }
  }
  async renameConversation(conversationId: string, title: string) {
    const response = await api.api.pi.projects[":projectId"].conversations[
      ":conversationId"
    ].$patch({
      param: { projectId: String(this.projectId), conversationId },
      json: { title },
    });
    if (!response.ok) throw await apiError(response);
    const conversation = await response.json();
    this.patch({
      conversations: this.view.conversations.map((item) =>
        item.id === conversation.id ? conversation : item,
      ),
    });
  }
  async load(conversationId = this.view.conversationId) {
    if (this.view.loading || this.view.run?.status === "running") return;
    this.patch({ loading: true, error: "" });
    try {
      const res = await api.api.pi.projects[":projectId"].messages.$get({
        param: { projectId: String(this.projectId) },
        query: { conversationId: conversationId ?? undefined },
      });
      if (!res.ok) throw await apiError(res);
      const value = await res.json();
      const switching =
        this.view.conversationId !== null && this.view.conversationId !== value.conversationId;
      this.patch({ ...value, ...(switching ? { draftImages: [], thinkingLevel: undefined } : {}) });
      void this.refreshSessionInfo();
      if (value.run?.status === "running") void this.connect(value.run.id);
    } catch (error) {
      this.patch({ error: error instanceof Error ? error.message : "读取对话失败" });
    } finally {
      this.patch({ loading: false });
    }
  }
  async send(message: string, imageNodeIds: string[] = []) {
    if (this.view.loading) throw new Error("正在处理请求");
    if (this.view.run?.status === "running") throw new Error("当前项目仍有任务运行");
    const selectedNodeIds = this.canvas()
      .read()
      .nodes.filter((node) => node.selected)
      .map((node) => node.id);
    this.patch({ loading: true, error: "" });
    try {
      const attachments = imageNodeIds.map((id) => {
        const image = this.canvasImages().find((item) => item.nodeId === id);
        if (!image) throw new Error("选择的图片已不可用，请重新选择");
        return image;
      });
      if (attachments.length && !(await this.canvas().save()))
        throw new Error("画布保存失败，图片尚未发送");
      const res = await api.api.pi.projects[":projectId"].messages.$post({
        param: { projectId: String(this.projectId) },
        json: {
          message,
          clientId: this.clientId,
          requestId: crypto.randomUUID(),
          selectedNodeIds,
          conversationId: this.view.conversationId ?? undefined,
          imageNodeIds,
          thinkingLevel: this.view.thinkingLevel ?? this.view.sessionInfo?.thinkingLevel,
        },
      });
      if (!res.ok) throw await apiError(res);
      const { runId, conversationId } = await res.json();
      this.patch({
        conversationId,
        draftImages: [],
        commands: [],
        messages: [
          ...this.view.messages,
          { id: `${runId}-user`, role: "user", text: message, runId, attachments, commands: [] },
          {
            id: `${runId}-assistant`,
            role: "assistant",
            text: "",
            runId,
            attachments: [],
            commands: [],
          },
        ],
        run: {
          id: runId,
          projectId: this.projectId,
          clientId: this.clientId,
          status: "running",
          error: null,
          partial: "",
          conversationId,
        },
      });
      this.activeFinish?.();
      this.activeFinish = beginDesktopTask(this.projectId);
      void this.connect(runId);
    } catch (error) {
      this.patch({ error: error instanceof Error ? error.message : "发送失败" });
      throw error;
    } finally {
      this.patch({ loading: false });
    }
  }
  private async connect(runId: string) {
    this.stream?.abort();
    const controller = new AbortController();
    this.stream = controller;
    const route = api.api.pi.projects[":projectId"].runs[":runId"];
    const param = { projectId: String(this.projectId), runId };
    while (!controller.signal.aborted) {
      try {
        const res = await route.events.$get(
          { param, query: { clientId: this.clientId } },
          { init: { signal: controller.signal } },
        );
        if (!res.ok) throw await apiError(res);
        for await (const event of readPiStream(res)) {
          if (event.type === "partial" && this.view.run) {
            this.patch({ run: { ...this.view.run, partial: event.text } });
            continue;
          }
          if (event.type !== "state") continue;
          this.patch({
            messages: event.messages,
            run: event.run,
            commands: event.commands,
            error: event.run?.error ?? "",
          });
          if (event.run?.clientId === this.clientId && event.run.status === "running") {
            for (const command of event.commands.filter((item) => item.status === "pending"))
              void this.deliver(command);
          }
          if (event.run?.status !== "running") {
            this.activeFinish?.();
            this.activeFinish = undefined;
            void this.refreshConversations();
            void this.refreshSessionInfo();
            return;
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        this.patch({
          error: `连接中断，正在重连：${error instanceof Error ? error.message : "网络错误"}`,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  async refreshConversations() {
    try {
      const response = await api.api.pi.projects[":projectId"].conversations.$get({
        param: { projectId: String(this.projectId) },
      });
      if (!response.ok) throw await apiError(response);
      this.patch(await response.json());
    } catch (error) {
      this.patch({ error: error instanceof Error ? error.message : "读取历史对话失败" });
    }
  }
  async stop() {
    const run = this.view.run;
    if (run?.status !== "running") return;
    try {
      const res = await api.api.pi.projects[":projectId"].runs[":runId"].cancel.$post({
        param: { projectId: String(this.projectId), runId: run.id },
      });
      if (!res.ok) throw await apiError(res);
    } catch (error) {
      this.patch({ error: error instanceof Error ? error.message : "停止请求未送达，请重试" });
    }
  }
  private async deliver(command: CanvasCommand) {
    if (this.sent.has(command.id) || this.delivering.has(command.id)) return;
    this.delivering.add(command.id);
    try {
      const result = await this.executeCommand(command);
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          const res = await api.api.pi.projects[":projectId"].runs[":runId"].commands[
            ":commandId"
          ].result.$post({
            param: {
              projectId: String(this.projectId),
              runId: command.runId,
              commandId: command.id,
            },
            json: { clientId: this.clientId, result },
          });
          if (!res.ok) {
            this.patch({ error: (await apiError(res)).message });
            return;
          }
          this.sent.add(command.id);
          return;
        } catch (error) {
          this.patch({
            error: `回执未送达，正在重送：${error instanceof Error ? error.message : "网络错误"}`,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } finally {
      this.delivering.delete(command.id);
    }
  }
  executeCommand(command: CanvasCommand): Promise<CanvasReceipt> {
    let execution = this.executions.get(command.id);
    if (!execution) {
      execution = this.execute(command);
      this.executions.set(command.id, execution);
    }
    return execution;
  }
  private async progress(command: CanvasCommand, message: string) {
    await api.api.pi.projects[":projectId"].runs[":runId"].commands[":commandId"].progress.$post({
      param: { projectId: String(this.projectId), runId: command.runId, commandId: command.id },
      json: { clientId: this.clientId, message },
    });
  }
  private async execute(command: CanvasCommand): Promise<CanvasReceipt> {
    let applied = false;
    try {
      const binding = this.canvas();
      const revision = this.currentRevision();
      const readOnly = ["get_canvas", "get_nodes", "get_generation_status"].includes(command.name);
      if (!readOnly && command.expectedRevision !== revision)
        return {
          success: false,
          revision,
          applied: false,
          saved: true,
          code: "STALE_CANVAS",
          message: "画布已变化或尚未读取，请重新 get_canvas",
          data: {},
        };
      if (command.name === "generate_nodes") {
        const { nodeIds } = canvasToolSchemas.generate_nodes.parse(command.args);
        const results = [];
        let batchError: string | undefined;
        const submitted = new Map(
          nodeIds.map((id) => [
            id,
            JSON.stringify(generationRequest(binding.read(), id, `${command.runId}-${id}`)),
          ]),
        );
        for (const nodeId of nodeIds) {
          if (this.view.run?.id !== command.runId || this.view.run.status !== "running") break;
          try {
            if (
              submitted.get(nodeId) !==
              JSON.stringify(
                generationRequest(binding.read(), nodeId, `${command.runId}-${nodeId}`),
              )
            )
              throw new Error("等待期间目标节点已修改，请重新读取");
            await this.progress(
              command,
              `正在生成 ${results.length + 1}/${nodeIds.length}：${String(binding.read().nodes.find((node) => node.id === nodeId)?.data.label ?? "节点")}`,
            );
            const job = await this.generate(nodeId, `${command.runId}-${nodeId}`, command.runId);
            const parameters = Object.fromEntries(
              Object.entries(job.input).filter(
                ([key]) => !["imageList", "videoList", "audioList"].includes(key),
              ),
            );
            const appliedToNode = binding
              .read()
              .nodes.some((node) => node.id === nodeId && node.data.generationJobId === job.id);
            results.push({
              id: job.id,
              nodeId,
              status: job.status,
              error: job.error,
              parameters,
              appliedToNode,
            });
          } catch (error) {
            batchError = error instanceof Error ? error.message : "生成提交结果未知";
            break;
          }
        }
        const saved = await binding.save();
        const success =
          results.length === nodeIds.length &&
          results.every((job) => job.status === "succeeded" && job.appliedToNode);
        return {
          success: success && saved,
          revision: this.currentRevision(),
          applied: true,
          saved,
          message:
            batchError ??
            `${results.filter((job) => job.status === "succeeded").length}/${nodeIds.length} 项生成成功`,
          data: { results },
        };
      }
      if (command.name === "get_generation_status") {
        const { jobIds } = canvasToolSchemas.get_generation_status.parse(command.args);
        const jobs = await Promise.all(jobIds.map((id) => this.fetchJob(id)));
        return {
          success: true,
          revision,
          applied: false,
          saved: true,
          data: {
            jobs: jobs.map(({ id, nodeId, status, error }) => ({ id, nodeId, status, error })),
          },
        };
      }
      const next = applyCanvasTool(command, binding.read());
      if (next.changed) {
        binding.apply(next.nodes, next.edges, true);
        applied = true;
      }
      const appliedRevision = this.currentRevision();
      const saved = !next.changed || (await binding.save());
      if (saved && appliedRevision !== this.currentRevision())
        return {
          success: false,
          revision: this.revision,
          applied,
          saved,
          code: "STALE_CANVAS",
          message: "操作已应用，期间画布又被编辑，请重新读取",
          data: next.data,
        };
      return {
        success: saved,
        revision: this.currentRevision(),
        applied,
        saved,
        code: saved ? undefined : "SAVE_FAILED",
        message: saved ? undefined : "已应用，但保存失败",
        data: next.data,
      };
    } catch (error) {
      return {
        success: false,
        revision: this.revision,
        applied,
        saved: !applied,
        code: "EXECUTION_FAILED",
        message: error instanceof Error ? error.message : "执行失败",
        data: {},
      };
    }
  }
  private updateNode(nodeId: string, patch: Record<string, unknown>, jobId?: string) {
    const binding = this.binding;
    if (!binding) return;
    const state = binding.read();
    binding.apply(
      state.nodes.map((node) =>
        node.id === nodeId && (!jobId || node.data.generationJobId === jobId)
          ? { ...node, data: { ...node.data, ...patch } }
          : node,
      ),
      state.edges,
      false,
    );
  }
  private rememberJob(job: GenerationJobView) {
    this.patch({ jobs: [...this.view.jobs.filter((item) => item.id !== job.id), job] });
  }
  private async fetchJob(jobId: string) {
    const res = await api.api["generation-jobs"][":projectId"].jobs[":jobId"].$get({
      param: { projectId: String(this.projectId), jobId },
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  }
  private async findJob(requestId: string) {
    const res = await api.api["generation-jobs"][":projectId"].requests[":requestId"].$get({
      param: { projectId: String(this.projectId), requestId },
    });
    if (!res.ok) throw await apiError(res);
    return (await res.json()).job;
  }
  private async waitJob(job: GenerationJobView) {
    let current = job;
    this.rememberJob(current);
    if (current.status === "running")
      this.updateNode(current.nodeId, { status: "generating" }, current.id);
    while (current.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        current = await this.fetchJob(job.id);
        this.rememberJob(current);
      } catch (error) {
        this.patch({
          error: `读取生成进度失败，正在重试查询：${error instanceof Error ? error.message : "网络错误"}`,
        });
      }
    }
    this.updateNode(
      current.nodeId,
      current.status === "succeeded"
        ? { status: "ready", resultUrl: current.resultUrl, error: undefined }
        : { status: "error", error: current.error ?? "生成失败或结果未知" },
      current.id,
    );
    await this.binding?.save();
    return current;
  }
  generate(
    nodeId: string,
    requestId: string = crypto.randomUUID(),
    runId?: string,
  ): Promise<GenerationJobView> {
    const pending = this.generating.get(nodeId);
    if (pending) return Promise.reject(new Error("该节点正在生成"));
    const operation = (async () => {
      const finish = beginDesktopTask(this.projectId);
      try {
        const binding = this.canvas();
        const request = generationRequest(binding.read(), nodeId, requestId);
        this.updateNode(nodeId, {
          status: "generating",
          generationRequestId: requestId,
          generationJobId: undefined,
          generationPrompt: request.input.prompt,
          error: undefined,
          mark: undefined,
          naturalWidth: undefined,
          naturalHeight: undefined,
        });
        if (!(await binding.save())) throw new Error("画布保存失败，未提交生成");
        if (
          JSON.stringify(generationRequest(binding.read(), nodeId, requestId)) !==
          JSON.stringify(request)
        )
          throw new Error("生成前节点已被修改，请重新读取");
        let res: Response;
        try {
          res = await api.api["generation-jobs"][":projectId"].jobs.$post({
            param: { projectId: String(this.projectId) },
            json: { ...request, runId },
          });
        } catch {
          const recovered = await this.findJob(requestId);
          if (!recovered) throw new Error("提交结果未知，未自动重试；重新打开项目后会查询该请求");
          this.updateNode(nodeId, { generationJobId: recovered.id });
          await binding.save();
          return await this.waitJob(recovered);
        }
        if (!res.ok) throw await apiError(res);
        const job = generationJobViewSchema.parse(await res.json());
        this.updateNode(nodeId, {
          status: "generating",
          generationJobId: job.id,
          generationPrompt: request.input.prompt,
          error: undefined,
          mark: undefined,
          naturalWidth: undefined,
          naturalHeight: undefined,
        });
        await binding.save();
        return await this.waitJob(job);
      } catch (error) {
        this.updateNode(nodeId, {
          status: "error",
          error: error instanceof Error ? error.message : "提交结果未知",
        });
        await this.binding?.save();
        throw error;
      } finally {
        finish();
        this.generating.delete(nodeId);
      }
    })();
    this.generating.set(nodeId, operation);
    return operation;
  }
  private async restoreJobs() {
    const nodes = this.binding?.read().nodes ?? [];
    for (const node of nodes) {
      const id = node.data.generationJobId;
      const requestId = node.data.generationRequestId;
      if ((typeof id !== "string" && typeof requestId !== "string") || this.generating.has(node.id))
        continue;
      try {
        const job =
          typeof id === "string" ? await this.fetchJob(id) : await this.findJob(String(requestId));
        if (!job) {
          this.updateNode(node.id, {
            status: "error",
            error: "未找到该请求的生成结果，请核实后手动重新生成",
          });
          await this.binding?.save();
          continue;
        }
        this.updateNode(node.id, { generationJobId: job.id });
        const finish = job.status === "running" ? beginDesktopTask(this.projectId) : () => {};
        const pending = this.waitJob(job).finally(() => {
          finish();
          this.generating.delete(node.id);
        });
        this.generating.set(node.id, pending);
        void pending.catch((error: unknown) =>
          this.patch({ error: error instanceof Error ? error.message : "恢复生成状态失败" }),
        );
      } catch (error) {
        this.patch({ error: error instanceof Error ? error.message : "读取生成状态失败" });
      }
    }
  }
}
