"use client";

import {
  clampImageQuality,
  GPT_SIZE_PRESETS,
  type GptQuality,
  gptQualityLabelOf,
  gptSizeOf,
  IMAGE_GEN_NODE_TYPE,
  IMAGE_GEN_NODE_WIDTH,
  IMAGE_MODELS,
  type ImageGenNodeData,
  imageModelOf,
  isGptImage,
  MAX_REFERENCE_IMAGES,
  NANO_ASPECT_RATIOS,
  NANO_IMAGE_SIZES,
} from "@aigc-flow/shared";
import {
  Handle,
  type NodeProps,
  Position,
  useNodeConnections,
  useNodesData,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { ChevronDown, CircleAlert, ImageIcon, Loader2, Plus, WandSparkles } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useProjectAgent } from "@/components/agent-workspace";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCanvasActions } from "@/hooks/use-canvas-actions";
import { downloadItemOf } from "@/lib/download";
import { CANVAS_WIDTH, resizedImageUrl, THUMB_WIDTH } from "@/lib/media-url";
import { nodeMarkOf } from "@/lib/node-mark";
import { cn } from "@/lib/utils";
import { GenMenuDialog } from "./gen-menu-dialog";
import {
  GEN_ACCENT,
  GEN_HANDLE_BASE,
  handleScaleStyle,
  PillOption,
  RatioOption,
} from "./gen-node-controls";
import { ModelIcon } from "./model-icon";
import { NodeActionPanel } from "./node-action-panel";
import { NodeInfoBar } from "./node-info-bar";
import {
  ChipRejectedMark,
  NodeMarkBadge,
  REJECTED_CHIP_CLASS,
  REJECTED_MEDIA_CLASS,
} from "./node-mark-badge";
import { reservedAspect, sizePatchOf } from "./node-size";
import { PromptEditor, type PromptMediaRef, usePromptTokens } from "./prompt-editor";

/** 占位区的宽高比跟随当前选择的比例；gpt 的 auto 档没有具体比例，退回 16:9 */
function currentAspect(gen: ImageGenNodeData): number {
  if (isGptImage(gen.model)) {
    const preset = gptSizeOf(gen.sizePreset);
    return preset.width > 0 ? preset.width / preset.height : 16 / 9;
  }
  const [w = 16, h = 9] = gen.aspectRatio.split(":").map(Number);
  return w / h;
}

export function ImageGenNode({ id, data, selected }: NodeProps) {
  const gen = data as unknown as ImageGenNodeData;
  const { updateNodeData } = useReactFlow();
  // 配置菜单只在「单击选中」时展开；框选（批量选中）不展开
  const { activeNodeId, dropTargetId, setNodeMark, duplicateNode, projectId } = useCanvasActions();
  const agent = useProjectAgent(projectId);
  const showMenu = Boolean(selected) && activeNodeId === id;
  // 右侧功能面板（下载 / 全屏）和下方菜单同时出现，且只在已经出结果时才有东西可操作
  const actionItem = showMenu ? downloadItemOf({ id, type: IMAGE_GEN_NODE_TYPE, data }) : null;
  const mark = nodeMarkOf({ type: IMAGE_GEN_NODE_TYPE, data });
  // 拖线悬停且本节点能接受时播放「可放置」动画
  const isDropTarget = dropTargetId === id;
  // 只有可见的固定尺寸 UI 需要跟随缩放；其余节点不因画布缩放而重渲染。
  const zoom = useStore((state) => (selected || mark || isDropTarget ? state.transform[2] : 1));

  // 左侧入边连着的上游节点 → 参考图列表。连线增删时这两个 hook 会自动触发重渲
  const connections = useNodeConnections({ handleType: "target" });
  const sources = useNodesData(connections.map((connection) => connection.source));
  // 图像模型只吃图，视频 / 音频的上限给 0（连线约束本来也不让它们连进来）
  const { texts, refs, resolvedPrompt } = usePromptTokens(id, gen.prompt, sources, {
    image: MAX_REFERENCE_IMAGES,
    video: 0,
    audio: 0,
  });
  // id 是源节点 id：同一张图可以连入多次，chips 的 React key 必须用它而不是 url
  const referenceItems = refs.filter(
    (item): item is PromptMediaRef & { kind: "image"; url: string } =>
      item.kind === "image" && Boolean(item.url),
  );

  const generating = gen.status === "generating";
  // 提示词多到出滚动条时可以把整个浮动菜单放大成弹层专心改
  const [expanded, setExpanded] = useState(false);

  /**
   * 点生成：状态机 idle/ready/error → generating → ready | error。
   * 内网接口同步阻塞，这个请求可能要等几十秒到几分钟。
   */
  async function handleGenerate() {
    if (generating) return;
    try {
      await agent.generate(id);
    } catch (error) {
      toast.error("生成失败", { description: error instanceof Error ? error.message : "提交失败" });
    }
  }

  return (
    <>
      {selected && (
        <NodeInfoBar
          nodeId={id}
          label={gen.label}
          icon={WandSparkles}
          accent={GEN_ACCENT}
          zoom={zoom}
          naturalWidth={gen.naturalWidth}
          naturalHeight={gen.naturalHeight}
        />
      )}

      <div className="flex flex-col gap-4" style={{ width: IMAGE_GEN_NODE_WIDTH }}>
        {/*
          连接端点挂在占位符容器上（relative 定位的这层），垂直居中于占位符两侧，
          菜单在下方展开 / 收起都不会影响端点位置。端点不能放进 overflow-hidden
          那层，会被圆角裁掉，所以套了两层。
        */}
        <motion.div
          // z-10：右侧功能面板是 1/zoom 反向缩放的，画布缩小后它在屏幕上比结果区高，
          // 会伸进下方的菜单区域；菜单在 DOM 里排在后面，不抬层级就会盖住面板
          className="relative z-10"
          animate={isDropTarget ? { scale: [1, 1.02, 1] } : { scale: 1 }}
          transition={
            isDropTarget
              ? { duration: 0.9, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }
              : { duration: 0.15 }
          }
        >
          <div
            className={cn(
              "w-full overflow-hidden rounded-md",
              selected && "outline outline-1 outline-[#3b82f6]",
              isDropTarget && "outline outline-2 outline-[#3b82f6]",
            )}
          >
            <div className={cn(mark === "reject" && REJECTED_MEDIA_CLASS)}>
              <ResultArea
                gen={gen}
                aspect={currentAspect(gen)}
                onNaturalSize={(width, height) => {
                  const patch = sizePatchOf(gen, width, height);
                  if (patch) updateNodeData(id, patch);
                }}
              />
            </div>
          </div>

          {mark && <NodeMarkBadge mark={mark} zoom={zoom} />}

          {/* 左入右出，两头都是选中才露出（和媒体节点同款）。target 另外在被拉线悬停时
              也露出来当落点提示；不选中时连线照样能落在节点身上，不靠这个端点接线。
              藏起来用 opacity + pointerEvents 而不是不渲染：不渲染的话它上面已有的连线
              会被 React Flow 判成悬空直接丢掉 */}
          <Handle
            type="target"
            position={Position.Left}
            style={{
              ...GEN_HANDLE_BASE,
              left: -10,
              ...handleScaleStyle(zoom, Position.Left),
              opacity: selected || isDropTarget ? 1 : 0,
              pointerEvents: selected || isDropTarget ? "auto" : "none",
            }}
          >
            <Plus className="pointer-events-none size-3" />
          </Handle>
          <Handle
            type="source"
            position={Position.Right}
            style={{
              ...GEN_HANDLE_BASE,
              right: -10,
              ...handleScaleStyle(zoom, Position.Right),
              opacity: selected ? 1 : 0,
              pointerEvents: selected ? "auto" : "none",
            }}
          >
            <Plus className="pointer-events-none size-3" />
          </Handle>

          {actionItem && (
            <NodeActionPanel
              item={actionItem}
              zoom={zoom}
              mark={mark}
              onMark={(next) => setNodeMark(id, next)}
              onDuplicate={() => duplicateNode(id)}
            />
          )}
        </motion.div>

        {/*
          配置菜单单击节点才展开（框选不展开）。外层用 1/zoom 反向缩放让它在屏幕上
          恒定大小 —— transform 不改变布局盒，缩小画布时菜单会视觉上超出节点宽度，
          这是预期行为（和选中工具条一类的固定 UI 同语义）。
        */}
        {showMenu && (
          <div style={{ transform: `scale(${1 / zoom})`, transformOrigin: "top center" }}>
            <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm">
              {renderMenu(false)}
            </div>
          </div>
        )}
      </div>

      {/* 放大后的弹层：同一套菜单的大号形态，portal 到 body，不受画布缩放影响 */}
      <GenMenuDialog open={expanded} onOpenChange={setExpanded} title={gen.label}>
        {renderMenu(true)}
      </GenMenuDialog>
    </>
  );

  /** 浮动菜单的内容：参考图 → 提示词 → 底部选项 + 生成。节点里和放大弹层里各渲染一份 */
  function renderMenu(large: boolean) {
    return (
      <>
        <ReferenceChips items={referenceItems} />

        <PromptEditor
          value={gen.prompt}
          texts={texts}
          refs={refs}
          onChange={(value) => updateNodeData(id, { prompt: value })}
          placeholder="今天我们要创作什么？"
          onExpand={large ? undefined : () => setExpanded(true)}
          large={large}
          autoFocus={large}
        />

        <div className="flex items-center justify-between gap-2">
          <SizeSetting nodeId={id} gen={gen} />
          <div className="flex items-center gap-2">
            <ModelSelect nodeId={id} gen={gen} />
            <Button
              size="sm"
              className="nodrag rounded-full px-5"
              disabled={generating || !resolvedPrompt}
              onClick={handleGenerate}
            >
              {generating && <Loader2 className="animate-spin" />}
              {generating ? "生成中" : "生成"}
            </Button>
          </div>
        </div>
      </>
    );
  }
}

/**
 * 上方结果区：占位 → 生成中 → 结果图 / 失败。
 * 拉满节点宽度，占位比例跟随图像设置里选的宽高比；结果图按自身比例展示。
 */
function ResultArea({
  gen,
  aspect,
  onNaturalSize,
}: {
  gen: ImageGenNodeData;
  aspect: number;
  onNaturalSize: (width: number, height: number) => void;
}) {
  // 结果图地址失效（内网结果有有效期）时兜底成占位符，避免破图 + 大段 alt 文字
  const [loadFailed, setLoadFailed] = useState(false);
  // 结果图有没有解出来。没解出来之前必须自己把高度占住，见 reservedAspect
  const [loaded, setLoaded] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 依赖 url 正是为了在换地址时重置
  useEffect(() => {
    setLoadFailed(false);
    setLoaded(false);
  }, [gen.resultUrl]);

  if (gen.status === "ready" && gen.resultUrl && !loadFailed) {
    const src = resizedImageUrl(gen.resultUrl, CANVAS_WIDTH);
    // 生成结果带签名 query，resizedImageUrl 会原样返回（怕加参数破坏签名），
    // 所以渲染的就是原图、量出来就是真实尺寸。这里仍按媒体节点那套判一次，
    // 万一哪天生成地址变成不带签名的裸地址，缩略参数会生效，数就不能信了。
    const exact = src === gen.resultUrl;

    return (
      // biome-ignore lint/performance/noImgElement: 生成结果是任意远程图片，无需 next/image
      <img
        src={src}
        alt={gen.prompt || gen.label}
        draggable={false}
        loading="lazy"
        decoding="async"
        // 图还没解出来时先按比例把高度占住，解出来之后交回给图片自身的比例
        style={loaded ? undefined : { aspectRatio: reservedAspect(gen, aspect) }}
        onLoad={(event) => {
          setLoaded(true);
          if (exact) {
            onNaturalSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          }
        }}
        onError={() => setLoadFailed(true)}
        // 画布上渲染的是缩略版，双击才在新标签页看全尺寸原图
        onDoubleClick={() => gen.resultUrl && window.open(gen.resultUrl, "_blank")}
        className="w-full select-none"
      />
    );
  }

  if (loadFailed) {
    return (
      <div
        className="flex w-full flex-col items-center justify-center gap-1.5 bg-[#e6e6e6] text-muted-foreground/70 dark:bg-muted"
        style={{ aspectRatio: aspect }}
      >
        <ImageIcon className="size-6" strokeWidth={1.5} />
        <span className="text-[10px] opacity-70">结果图已失效，可重新生成</span>
      </div>
    );
  }

  if (gen.status === "error") {
    return (
      <div
        className="flex w-full flex-col items-center justify-center gap-1.5 border border-destructive/60 border-dashed bg-destructive/5 px-4 text-center text-destructive text-xs"
        style={{ aspectRatio: aspect }}
      >
        <CircleAlert className="size-5" />
        <span className="line-clamp-3">{gen.error ?? "生成失败"}</span>
      </div>
    );
  }

  return (
    <div
      // 占位底色浅色下用 #E6E6E6（画布底已是 #F5F5F5，muted 会融进去看不出边界）
      className="flex w-full flex-col items-center justify-center gap-2 bg-[#e6e6e6] text-muted-foreground/50 dark:bg-muted"
      style={{ aspectRatio: aspect }}
    >
      {gen.status === "generating" ? (
        <>
          <Loader2 className="size-8 animate-spin" />
          <span className="text-xs">生成中，请耐心等待…</span>
        </>
      ) : (
        <ImageIcon className="size-14" strokeWidth={1.25} />
      )}
    </div>
  );
}

/** 参考图横排：已连接的缩略图（上限 16），未满时只补一个占位示例格。废弃的上游灰显 + 小叉 */
function ReferenceChips({
  items,
}: {
  items: Array<{ id: string; url: string; rejected: boolean }>;
}) {
  const shown = items.slice(0, MAX_REFERENCE_IMAGES);

  return (
    <div className="nodrag nowheel flex gap-2 overflow-x-auto pb-1">
      {shown.map(({ id, url, rejected }) => (
        <div
          key={id}
          className="relative h-[68px] w-[56px] shrink-0 overflow-hidden rounded-lg border"
        >
          {/* biome-ignore lint/performance/noImgElement: 画布素材缩略图，无需 next/image */}
          <img
            src={resizedImageUrl(url, THUMB_WIDTH)}
            alt="参考图"
            draggable={false}
            loading="lazy"
            decoding="async"
            className={cn("size-full object-cover", rejected && REJECTED_CHIP_CLASS)}
          />
          {rejected && <ChipRejectedMark />}
        </div>
      ))}
      {shown.length < MAX_REFERENCE_IMAGES && (
        <div className="flex h-[68px] w-[56px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border bg-muted/40 text-muted-foreground/60">
          <ImageIcon className="size-5" strokeWidth={1.5} />
          <span className="text-[10px]">参考图</span>
        </div>
      )}
    </div>
  );
}

/**
 * 底部左侧：图像设置弹层。gpt 配质量 + 尺寸档（对齐设计稿的「图像设置」面板），
 * nano 配分辨率 + 宽高比 —— 两家接口的 config 形状不同，弹层内容跟着模型切换。
 */
function SizeSetting({ nodeId, gen }: { nodeId: string; gen: ImageGenNodeData }) {
  const { updateNodeData } = useReactFlow();
  const isGpt = isGptImage(gen.model);
  // 质量档按模型给（2.5 比 2 多出超高 / 最高两档），不是所有 gpt 模型都一样
  const qualities: readonly GptQuality[] = imageModelOf(gen.model).qualities;
  const label = isGpt
    ? `${gptQualityLabelOf(gen.quality)} · ${gen.sizePreset}`
    : `${gen.aspectRatio} · ${gen.imageSize}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="nodrag rounded-full">
          {label}
          <ChevronDown className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-4">
        <p className="font-medium text-sm">图像设置</p>

        <section className="space-y-2">
          <p className="text-muted-foreground text-xs">{isGpt ? "质量" : "分辨率"}</p>
          <div className="flex flex-wrap gap-2">
            {isGpt
              ? qualities.map((value) => (
                  <PillOption
                    key={value}
                    active={gen.quality === value}
                    onClick={() => updateNodeData(nodeId, { quality: value })}
                  >
                    {gptQualityLabelOf(value)}
                  </PillOption>
                ))
              : NANO_IMAGE_SIZES.map((size) => (
                  <PillOption
                    key={size}
                    active={gen.imageSize === size}
                    onClick={() => updateNodeData(nodeId, { imageSize: size })}
                  >
                    {size}
                  </PillOption>
                ))}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-muted-foreground text-xs">宽高比</p>
          <div className="grid grid-cols-4 gap-2">
            {isGpt
              ? GPT_SIZE_PRESETS.map((preset) => (
                  <RatioOption
                    key={preset.id}
                    label={preset.id}
                    width={preset.width}
                    height={preset.height}
                    active={gen.sizePreset === preset.id}
                    onClick={() => updateNodeData(nodeId, { sizePreset: preset.id })}
                  />
                ))
              : NANO_ASPECT_RATIOS.map((ratio) => {
                  const [w = 1, h = 1] = ratio.split(":").map(Number);
                  return (
                    <RatioOption
                      key={ratio}
                      label={ratio}
                      width={w}
                      height={h}
                      active={gen.aspectRatio === ratio}
                      onClick={() => updateNodeData(nodeId, { aspectRatio: ratio })}
                    />
                  );
                })}
          </div>
        </section>

        {isGpt && gen.sizePreset !== "auto" && (
          <p className="text-muted-foreground text-xs">
            输出尺寸：{gptSizeOf(gen.sizePreset).width} × {gptSizeOf(gen.sizePreset).height}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** 底部右侧：模型选择，选项对齐设计稿的「图像模型」菜单 */
function ModelSelect({ nodeId, gen }: { nodeId: string; gen: ImageGenNodeData }) {
  const { updateNodeData } = useReactFlow();
  const model = imageModelOf(gen.model);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="nodrag rounded-full">
          <ModelIcon modelId={model.id} />
          {model.label}
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      {/*
        必须 w-auto：DropdownMenuContent 默认是 w-(--radix-dropdown-menu-trigger-width)
        + overflow-x-hidden，宽度跟着触发按钮走、超出的部分**无声裁掉**（没有省略号）。
        触发按钮是 text-[0.8rem] 而菜单项是 text-sm，选中短名（GPT Image 2）时按钮才 130px 上下，
        "GPT Image 2.5 Sunburst" 这一项就会被切掉尾巴。w-auto 交回给内容撑，min-w 只当下限。
      */}
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        <DropdownMenuLabel className="text-muted-foreground">图像模型</DropdownMenuLabel>
        {IMAGE_MODELS.map((item) => (
          <DropdownMenuItem
            key={item.id}
            // 质量档按模型收敛，和服务端调的是同一个 clampImageQuality：
            // 不像视频那边把 clampVideoConfig 的规则又手抄了一遍在 onSelect 里
            onSelect={() =>
              updateNodeData(nodeId, {
                model: item.id,
                quality: clampImageQuality(item.id, gen.quality),
              })
            }
            // items-start：带说明的项是两行，图标要对齐第一行而不是两行的中线
            className={cn("items-start py-1.5", item.id === gen.model && "bg-accent")}
          >
            <ModelIcon modelId={item.id} className="mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="whitespace-nowrap">{item.label}</span>
              {/* 只有需要区分擅长场景的版本才有 hint，用 in 收窄联合类型 */}
              {"hint" in item && (
                <span className="whitespace-nowrap text-muted-foreground text-xs">{item.hint}</span>
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
