"use client";

import { NODE_MARK_LABEL, type NodeMark, type Project } from "@aigc-flow/shared";
import { ChevronLeft, CircleCheck, CircleDashed, CircleX } from "lucide-react";
import { useReducedMotion } from "motion/react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useProjectAgent } from "@/components/agent-workspace";
import { ProjectName } from "@/components/canvas/project-name";
import { SaveIndicator } from "@/components/canvas/save-indicator";
import { PiChat, piChatTransition } from "@/components/pi-chat";
import { SettingsDialog } from "@/components/settings-dialog";
import { StatsDialog } from "@/components/stats-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SaveStatus } from "@/hooks/use-graph-autosave";
import { usePiChatResize } from "@/hooks/use-pi-chat-resize";
import { useDesktopWorkspace } from "@/lib/desktop";
import type { MarkSummary } from "@/lib/node-mark";
import { cn } from "@/lib/utils";

/** 浮在画布之上的胶囊容器，左右两组共用 */
const GROUP =
  "flex items-center gap-1 rounded-xl border bg-background/90 px-1 py-1 shadow-lg backdrop-blur-sm";

type CanvasInfoGroupProps = {
  project: Project;
  nodeCount: number;
  saveStatus: SaveStatus;
  onRename: (name: string) => Promise<void>;
  /** 素材按标记的计数：采用 / 废弃 / 待审（有素材但还没打标） */
  marks: MarkSummary;
  /** 点计数芯片：选中该态的全部素材节点（null 是待审），接着就能批量下载或整理 */
  onSelectByMark: (mark: NodeMark | null) => void;
};

/**
 * 三个计数芯片的定义。三个都用圆形一族的图标：待审是虚线圈，
 * 采用 / 废弃是圈里的勾和叉 —— 裸的勾会和右边保存指示器的勾撞在一起。
 * 颜色和节点上的角标同一套：采用绿、废弃灰，待审用次要色。
 */
const MARK_CHIPS: Array<{
  mark: NodeMark | null;
  key: keyof MarkSummary;
  label: string;
  icon: typeof CircleCheck;
  className: string;
}> = [
  {
    mark: "keep",
    key: "keep",
    label: NODE_MARK_LABEL.keep,
    icon: CircleCheck,
    className: "text-emerald-600 dark:text-emerald-400",
  },
  {
    mark: "reject",
    key: "reject",
    label: NODE_MARK_LABEL.reject,
    icon: CircleX,
    className: "text-muted-foreground",
  },
  {
    mark: null,
    key: "unmarked",
    label: "待审",
    icon: CircleDashed,
    className: "text-muted-foreground",
  },
];

export function CanvasInfoGroup({
  project,
  nodeCount,
  saveStatus,
  onRename,
  marks,
  onSelectByMark,
}: CanvasInfoGroupProps) {
  const workspace = useDesktopWorkspace();
  return (
    <div className={GROUP}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon">
            <Link
              href="/"
              aria-label="返回项目列表"
              onClick={(event) => {
                if (!workspace) return;
                event.preventDefault();
                workspace.activate(null);
              }}
            >
              <ChevronLeft />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">返回项目列表</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="!h-5 !self-center" />

      <ProjectName name={project.name} onRename={onRename} />

      <Separator orientation="vertical" className="!h-5 !self-center" />

      <span className="whitespace-nowrap px-1 text-muted-foreground text-xs">{nodeCount} 节点</span>

      <Separator orientation="vertical" className="!h-5 !self-center" />

      {/* 按标记计数，点击选中那一批。一个素材都没有时三个都置灰，芯片本身不隐藏，位置稳定 */}
      <span className="flex items-center">
        {MARK_CHIPS.map(({ mark, key, label, icon: Icon, className }) => {
          const count = marks[key];
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                {/* disabled 的按钮不派发鼠标事件，tooltip 收不到 hover，套一层 span 承接 */}
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={count === 0}
                    onClick={() => onSelectByMark(mark)}
                    aria-label={`选中全部${label}的素材`}
                    className={cn("h-7 gap-1 px-1.5 text-xs tabular-nums", className)}
                  >
                    <Icon className="size-3.5" />
                    {count}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {count === 0 ? `没有${label}的素材` : `选中全部${label}的素材（${count}）`}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </span>

      <Separator orientation="vertical" className="!h-5 !self-center" />

      <span className="px-1">
        <SaveIndicator status={saveStatus} />
      </span>
    </div>
  );
}

export function CanvasActionGroup({ projectId }: { projectId: number }) {
  const runtime = useProjectAgent(projectId);
  const chatOpen = useSyncExternalStore(
    runtime.subscribe,
    () => runtime.getSnapshot().chatOpen,
    () => false,
  );
  const resize = usePiChatResize(chatOpen);
  const reducedMotion = useReducedMotion();
  const transition = piChatTransition(chatOpen, reducedMotion);
  return (
    <div
      ref={resize.toolbarRef}
      className={cn(GROUP, "transition-transform motion-reduce:transition-none")}
      style={{
        transform: chatOpen ? `translateX(-${resize.width}px)` : "translateX(0)",
        transitionDuration: `${transition.duration}s`,
        transitionTimingFunction: `cubic-bezier(${transition.ease.join(",")})`,
      }}
    >
      <PiChat
        projectId={projectId}
        open={chatOpen}
        onOpenChange={runtime.setChatOpen}
        resize={resize}
      />
      <StatsDialog projectId={projectId} />
      <ThemeToggle />
      <SettingsDialog />
    </div>
  );
}
