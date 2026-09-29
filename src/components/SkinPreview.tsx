import { useEffect, useRef } from "react";
import { RIGHT } from "../game/engine/constants";
import { hex, type Skin } from "../game/render/skins";
import { CanvasPen, KASMAN_SIZE, drawBackdrop, drawFruit, drawGhost, drawKasmanGear, drawPellet, kasmanUrl } from "../game/render/sprites";

const W = 200;
const H = 80;
const ACTOR_SCALE = 1.4;

/** Static vignette of a skin, drawn with the same sprite code as the game. */
export default function SkinPreview({ skin }: { skin: Skin }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = ref.current!;
    const k = 2 * Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * k;
    canvas.height = H * k;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = hex(skin.background);
    ctx.fillRect(0, 0, W, H);
    const pen = new CanvasPen(ctx);
    drawBackdrop(pen, skin.backdrop, skin.backdropColor, W, H);

    // Corridor walls.
    if (skin.wallFill !== undefined) pen.rect(0, 0, W, 12).rect(0, H - 12, W, 12).fill({ color: skin.wallFill, alpha: 0.85 });
    ctx.shadowColor = hex(skin.wallGlow);
    ctx.shadowBlur = 6;
    pen.moveTo(0, 12).lineTo(W, 12).moveTo(0, H - 12).lineTo(W, H - 12).stroke({ width: skin.wallWidth ?? 2, color: skin.wall });
    ctx.shadowBlur = 0;

    const at = (x: number, scale: number, draw: () => void) => {
      ctx.save();
      ctx.translate(x, H / 2);
      ctx.scale(scale, scale);
      draw();
      ctx.restore();
    };
    const kasman = new Image();
    kasman.src = kasmanUrl(skin.id);
    const drawKasman = () => {
      if (cancelled) return;
      const h = KASMAN_SIZE * ACTOR_SCALE;
      const w = (h * kasman.naturalWidth) / kasman.naturalHeight;
      ctx.drawImage(kasman, 22 - w / 2, H / 2 - h / 2, w, h);
      at(22, ACTOR_SCALE, () => drawKasmanGear(pen, skin));
    };
    if (kasman.complete) drawKasman();
    else kasman.addEventListener("load", drawKasman, { once: true });
    for (const x of [40, 51, 62]) at(x, ACTOR_SCALE, () => drawPellet(pen, skin.pelletStyle, skin.pellet, false));
    at(78, 1.1, () => drawPellet(pen, skin.pelletStyle, skin.pellet, true));
    skin.ghosts.forEach((color, i) =>
      at(100 + i * 22, ACTOR_SCALE, () => drawGhost(pen, skin, { color, dir: RIGHT, wave: i % 2, eaten: false, frightFace: null })),
    );
    at(186, 1.1, () => drawFruit(pen, skin.fruitStyle, 0xff4757));
    return () => {
      cancelled = true;
    };
  }, [skin]);

  return <canvas ref={ref} className="aspect-[5/2] w-full rounded-lg" role="img" aria-label={`${skin.name} preview`} />;
}
