import { useEffect, type RefObject } from "react";

interface ScrollAction {
  type: "scroll";
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}
/** Capture wheel input locally; send at most one coalesced batch at a time. */
export function useRemoteScroll(
  image: RefObject<HTMLImageElement | null>,
  enabled: boolean,
  send: (action: ScrollAction) => Promise<void>,
) {
  useEffect(() => {
    const element = image.current;
    if (!element || !enabled) return;
    let pending: ScrollAction | undefined;
    let sending = false;
    let disposed = false;
    let scheduled = 0;
    async function flush() {
      scheduled = 0;
      if (sending || !pending || disposed) return;
      const action = pending;
      pending = undefined;
      sending = true;
      try {
        await send(action);
      } finally {
        sending = false;
        if (pending && !disposed)
          scheduled = requestAnimationFrame(() => void flush());
      }
    }
    function wheel(event: WheelEvent) {
      event.preventDefault();
      event.stopPropagation();
      const rect = element!.getBoundingClientRect();
      const scale = 1280 / rect.width;
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      pending = {
        type: "scroll",
        x: Math.max(0, Math.min(1280, (event.clientX - rect.left) * scale)),
        y: Math.max(0, Math.min(800, (event.clientY - rect.top) * scale)),
        deltaX: Math.max(
          -10000,
          Math.min(10000, (pending?.deltaX ?? 0) + event.deltaX * unit * scale),
        ),
        deltaY: Math.max(
          -10000,
          Math.min(10000, (pending?.deltaY ?? 0) + event.deltaY * unit * scale),
        ),
      };
      if (!sending && !scheduled)
        scheduled = requestAnimationFrame(() => void flush());
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      disposed = true;
      cancelAnimationFrame(scheduled);
      element.removeEventListener("wheel", wheel);
    };
  }, [image, enabled, send]);
}
