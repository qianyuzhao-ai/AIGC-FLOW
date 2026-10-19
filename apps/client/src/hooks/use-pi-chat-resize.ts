"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export function chatWidthBounds(viewportWidth: number) {
  const max = Math.floor(viewportWidth / 2);
  return { min: Math.min(400, max), max };
}

export function usePiChatResize(
  open: boolean,
  paletteRef: RefObject<HTMLDivElement | null>,
  controlsRef: RefObject<HTMLDivElement | null>,
  transition: { duration: number; ease: readonly number[] },
) {
  const [viewportWidth, setViewportWidth] = useState(800);
  const [savedWidth, setWidth] = useState(400);
  const bounds = chatWidthBounds(viewportWidth);
  const width = Math.min(bounds.max, Math.max(bounds.min, savedWidth));
  const panelRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; value: number } | null>(null);
  const positionPalette = useCallback(
    (chatWidth: number, dragging = false) => {
      const palette = paletteRef.current;
      const canvas = palette?.closest(".react-flow");
      if (!palette || !canvas) return;
      const canvasRect = canvas.getBoundingClientRect();
      const controls = controlsRef.current?.getBoundingClientRect();
      const availableWidth = canvasRect.width - chatWidth;
      const maxWidth = Math.max(0, availableWidth - 24);
      const paletteWidth = Math.min(palette.scrollWidth, maxWidth);
      let center = availableWidth / 2;
      let lift = 0;
      if (chatWidth && controls) {
        const left = controls.right - canvasRect.left + 12 + paletteWidth / 2;
        const right = availableWidth - 12 - paletteWidth / 2;
        if (left <= right) center = Math.max(center, left);
        else lift = controls.height + 12;
      }
      palette.style.overflowX = chatWidth && palette.scrollWidth > maxWidth ? "auto" : "";
      palette.style.maxWidth = chatWidth ? `${maxWidth}px` : "";
      palette.style.transitionDuration = `${dragging ? 0 : transition.duration}s`;
      palette.style.transitionTimingFunction = `cubic-bezier(${transition.ease.join(",")})`;
      palette.style.transform = `translate(${center - canvasRect.width / 2}px, -${lift}px)`;
    },
    [paletteRef, controlsRef, transition.duration, transition.ease],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: 窗口宽度变化会改变可用画布，即使聊天宽度未变也需重新定位。
  useLayoutEffect(() => {
    positionPalette(open ? (drag.current?.value ?? width) : 0, drag.current !== null);
  }, [positionPalette, open, width, viewportWidth]);
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
    width: drag.current?.value ?? width,
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
        if (open) positionPalette(next, true);
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
