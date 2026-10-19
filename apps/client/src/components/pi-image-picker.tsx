"use client";

import type { PiImageAttachment } from "@aigc-flow/shared";
import { Check, ImagePlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ProjectRuntime } from "@/lib/agent/project-runtime";
import { cn } from "@/lib/utils";

export function PiImagePicker({
  runtime,
  value,
  onChange,
  disabled,
}: {
  runtime: ProjectRuntime;
  value: PiImageAttachment[];
  onChange: (images: PiImageAttachment[]) => void;
  disabled: boolean;
}) {
  const [images, setImages] = useState<PiImageAttachment[]>([]);
  const [search, setSearch] = useState("");
  const visible = images.filter((image) =>
    image.label.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          setImages(runtime.canvasImages());
          setSearch("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled}>
          <ImagePlus />
          画布图片{value.length > 0 ? ` · ${value.length}` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 max-w-[calc(100vw-2rem)] p-3">
        <PopoverHeader>
          <PopoverTitle>选择画布图片</PopoverTitle>
          <PopoverDescription>已选 {value.length} / 6 张，按选择顺序发送。</PopoverDescription>
        </PopoverHeader>
        <Input
          aria-label="搜索画布图片"
          placeholder="搜索图片名称…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto p-0.5">
          {visible.map((image) => {
            const selected = value.some((item) => item.nodeId === image.nodeId);
            return (
              <button
                key={image.nodeId}
                type="button"
                aria-pressed={selected}
                disabled={!selected && value.length >= 6}
                aria-label={`${selected ? "移除" : "选择"}图片：${image.label}`}
                className={cn(
                  "relative min-w-0 overflow-hidden rounded-md border text-left focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40",
                  selected && "border-primary ring-1 ring-primary",
                )}
                onClick={() =>
                  onChange(
                    selected
                      ? value.filter((item) => item.nodeId !== image.nodeId)
                      : [...value, image],
                  )
                }
              >
                {/* biome-ignore lint/performance/noImgElement: 画布已有的远程媒体使用原始缩略图。 */}
                <img
                  src={image.url}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full bg-muted object-cover"
                />
                <span className="block truncate p-1.5 text-xs">{image.label}</span>
                {selected && (
                  <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
          {visible.length === 0 && (
            <p className="col-span-3 py-6 text-center text-muted-foreground text-sm">
              {images.length ? "没有匹配的图片" : "画布还没有可用图片，先上传或生成图片。"}
            </p>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          单张最多 10 MB，合计最多 20 MB。仅支持图片。
        </p>
      </PopoverContent>
    </Popover>
  );
}
