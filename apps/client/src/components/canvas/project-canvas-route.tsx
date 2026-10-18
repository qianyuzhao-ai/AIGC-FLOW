"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { CanvasPage } from "@/components/canvas/canvas-page";
import { Button } from "@/components/ui/button";
import { useWebProjects } from "@/components/web-project-host";

/**
 * 画布路由的入口：项目 id 走查询参数而不是动态路由段。
 *
 * 静态导出（Electron 打包用）不支持没有 generateStaticParams 的动态路由，
 * 而项目 id 是运行时数据、枚举不出来。查询参数在 Next server 部署和静态导出下
 * 行为一致，一个 URL 两端通吃。
 */
export function ProjectCanvasRoute() {
  const projectId = Number(useSearchParams().get("id"));
  const activate = useWebProjects();
  useEffect(() => {
    if (!activate || !Number.isInteger(projectId) || projectId <= 0) return;
    activate(projectId);
    return () => activate(null);
  }, [activate, projectId]);

  // 查询参数是任意字符串，非法 id 就地提示，别让它带着 NaN 往下走
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">项目不存在</p>
        <Button asChild variant="outline">
          <Link href="/">返回项目列表</Link>
        </Button>
      </div>
    );
  }

  return activate ? null : <CanvasPage projectId={projectId} />;
}
