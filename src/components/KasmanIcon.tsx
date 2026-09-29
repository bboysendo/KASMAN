import { useEffect, useRef } from "react";
import type { Skin } from "../game/render/skins";
import { CanvasPen, KASMAN_SIZE, drawKasmanGear, kasmanUrl } from "../game/render/sprites";

/** World units shown around Kasman's center: room for the tallest accessory (leaf, crown, helmet). */
const HALF = 12;

/** Kasman of a skin, with its accessory, drawn with the same code as the game. */
export default function KasmanIcon({ skin, size }: { skin: Skin; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const px = size * Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high"; // big downscale of the sprite: default quality looks pixelated
    const img = new Image();
    img.src = kasmanUrl(skin.id);
    let cancelled = false;
    const draw = () => {
      if (cancelled) return;
      ctx.setTransform(px / (HALF * 2), 0, 0, px / (HALF * 2), px / 2, px / 2);
      ctx.clearRect(-HALF, -HALF, HALF * 2, HALF * 2);
      const w = (KASMAN_SIZE * img.naturalWidth) / img.naturalHeight;
      ctx.drawImage(img, -w / 2, -KASMAN_SIZE / 2, w, KASMAN_SIZE);
      drawKasmanGear(new CanvasPen(ctx), skin);
    };
    if (img.complete) draw();
    else img.addEventListener("load", draw, { once: true });
    return () => {
      cancelled = true;
    };
  }, [skin, size]);

  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
}
