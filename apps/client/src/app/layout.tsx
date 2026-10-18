import type { Metadata } from "next";
import { Geist } from "next/font/google";
import type { ReactNode } from "react";
import { AgentWorkspace } from "@/components/agent-workspace";
import { DesktopWorkspace } from "@/components/desktop-workspace";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "AIGC-FLOW",
  description: "画布节点工作流，用于调用各种模型进行影视资产创作",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={cn("min-h-dvh bg-background font-sans antialiased", geist.variable)}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AgentWorkspace>
            <DesktopWorkspace>{children}</DesktopWorkspace>
          </AgentWorkspace>
          {/* 上传 / 生成失败等临时提示，右下角弹出 */}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
