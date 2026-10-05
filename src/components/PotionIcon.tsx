import { useEffect, useRef } from "react";
import { CanvasPen, POTION_SIZE, drawPotion } from "../game/render/sprites";

/** World units shown around the potion's center. */
const HALF = POTION_SIZE / 2 + 1;

/** Retro pixel-art potion bottle, drawn with the same code as the Shop card and the HUD. */
export default function PotionIcon({ color, size }: { color: number; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const px = size * Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(px / (HALF * 2), 0, 0, px / (HALF * 2), px / 2, px / 2);
    ctx.clearRect(-HALF, -HALF, HALF * 2, HALF * 2);
    drawPotion(new CanvasPen(ctx), color);
  }, [color, size]);

  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
}
