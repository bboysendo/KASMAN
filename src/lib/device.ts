import { useEffect, useState } from "react";

/** Real touch-capability check (pointer hardware + touch points), never User-Agent sniffing. */
function detectTouch(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarse || navigator.maxTouchPoints > 0 || "ontouchstart" in window;
}

/** Tracks whether the primary pointer is touch, re-checked when a mouse/touch input connects or disconnects. */
export function useIsTouchDevice(): boolean {
  const [touch, setTouch] = useState(detectTouch);
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: coarse)");
    if (!mq) return;
    const onChange = () => setTouch(detectTouch());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return touch;
}
