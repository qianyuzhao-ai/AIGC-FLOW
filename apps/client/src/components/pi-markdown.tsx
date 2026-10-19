"use client";

import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noopener noreferrer">
      {alt || "图片链接"}
    </a>
  ),
  table: ({ children }) => (
    <div className="max-w-full overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};

export const PiMarkdown = memo(function PiMarkdown({ text }: { text: string }) {
  return (
    <div className="pi-markdown min-w-0 text-sm leading-relaxed">
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </Markdown>
    </div>
  );
});
