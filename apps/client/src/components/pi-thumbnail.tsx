"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";
import { API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PiThumbnail({
  url,
  label,
  className,
}: {
  url: string;
  label: string;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  if (failedUrl === url)
    return (
      <span
        role="img"
        aria-label={`${label}：缩略图不可用`}
        className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}
      >
        <ImageOff className="size-5" />
      </span>
    );
  return (
    // biome-ignore lint/performance/noImgElement: 服务端已输出不超过 480p 的缩略图。
    <img
      src={`${API_BASE}/api/pi/thumbnail?${new URLSearchParams({ url })}`}
      alt={label}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailedUrl(url)}
    />
  );
}
