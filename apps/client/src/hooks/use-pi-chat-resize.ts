"use client";

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

export function chatWidthBounds(viewportWidth: number) {
  const max = Math.floor(viewportWidth / 2);
  return { min: Math.min(400, max), max };
}

export function usePiChatResize(open: boolean) {
  const [viewportWidth, setViewportWidth] = useState(800);
  const [savedWidth, setWidth] = useState(400);
  const bounds = chatWidthBounds(viewportWidth);
  const width = Math.min(bounds.max, Math.max(bounds.min, savedWidth));
  const panelRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; value: number } | null>(null);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const clamp = (value: number) => Math.min(bounds.max, Math.max(bounds.min, value));
  const finish = () => {
    if (!drag.current) return;
    setWidth(drag.current.value);
    drag.current = null;
    if (toolbarRef.current) toolbarRef.current.style.transitionDuration = "";
  };
  return {
    width,
    bounds,
    panelRef,
    toolbarRef,
    handleProps: {
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = { x: event.clientX, width, value: width };
        event.currentTarget.setPointerCapture(event.pointerId);
        if (toolbarRef.current) toolbarRef.current.style.transitionDuration = "0s";
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        if (!drag.current) return;
        const next = clamp(drag.current.width + drag.current.x - event.clientX);
        drag.current.value = next;
        if (panelRef.current) panelRef.current.style.width = `${next}px`;
        if (toolbarRef.current && open)
          toolbarRef.current.style.transform = `translateX(-${next}px)`;
        event.currentTarget.setAttribute("aria-valuenow", String(next));
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        const keys: Record<string, number> = {
          ArrowLeft: width + 16,
          ArrowRight: width - 16,
          Home: bounds.min,
          End: bounds.max,
        };
        const next = keys[event.key];
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        setWidth(clamp(next));
      },
    },
  };
}
