// Themed sprite drawing shared by the Pixi renderer and the Marketplace previews.
// Everything draws through `Pen`, a subset of the Pixi Graphics API that a
// Canvas 2D adapter also implements, so a preview looks exactly like the game.
// Units are world pixels (one tile = 16), centered on the sprite, facing right.
import { DX, DY } from "../engine/constants";
import { hex, type Backdrop, type FruitStyle, type PelletStyle, type Skin } from "./skins";

type Fill = number | { color: number; alpha?: number };
interface Stroke { width: number; color: number; alpha?: number; cap?: "butt" | "round" | "square"; join?: "miter" | "round" | "bevel" }

export interface Pen {
  moveTo(x: number, y: number): Pen;
  lineTo(x: number, y: number): Pen;
  arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean): Pen;
  circle(x: number, y: number, r: number): Pen;
  ellipse(x: number, y: number, rx: number, ry: number): Pen;
  rect(x: number, y: number, w: number, h: number): Pen;
  poly(points: number[]): Pen;
  closePath(): Pen;
  fill(style: Fill): Pen;
  stroke(style: Stroke): Pen;
}

/** Canvas 2D implementation of `Pen`. */
export class CanvasPen implements Pen {
  private ctx: CanvasRenderingContext2D;
  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    ctx.beginPath();
  }
  moveTo(x: number, y: number) { this.ctx.moveTo(x, y); return this; }
  lineTo(x: number, y: number) { this.ctx.lineTo(x, y); return this; }
  arc(x: number, y: number, r: number, a: number, b: number, ccw = false) { this.ctx.arc(x, y, r, a, b, ccw); return this; }
  circle(x: number, y: number, r: number) { return this.ellipse(x, y, r, r); }
  ellipse(x: number, y: number, rx: number, ry: number) {
    this.ctx.moveTo(x + rx, y);
    this.ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    return this;
  }
  rect(x: number, y: number, w: number, h: number) { this.ctx.rect(x, y, w, h); return this; }
  poly(p: number[]) {
    this.ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) this.ctx.lineTo(p[i], p[i + 1]);
    this.ctx.closePath();
    return this;
  }
  closePath() { this.ctx.closePath(); return this; }
  fill(style: Fill) {
    const { color, alpha = 1 } = typeof style === "number" ? { color: style } : style;
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = hex(color);
    this.ctx.fill();
    return this.reset();
  }
  stroke(s: Stroke) {
    this.ctx.globalAlpha = s.alpha ?? 1;
    this.ctx.strokeStyle = hex(s.color);
    this.ctx.lineWidth = s.width;
    this.ctx.lineCap = s.cap ?? "butt";
    this.ctx.lineJoin = s.join ?? "miter";
    this.ctx.stroke();
    return this.reset();
  }
  private reset() {
    this.ctx.globalAlpha = 1;
    this.ctx.beginPath();
    return this;
  }
}

/** Body radius of Pac-Man and the ghosts. */
export const R = 7.4;

// ---------- Kasman ----------

const KASMAN_URLS = import.meta.glob<string>("../../assets/kasman*.png", { eager: true, import: "default" });

/** Kasman bitmap for a skin: its recolored bake (scripts/bake-kasman.py) or the original green one. */
export const kasmanUrl = (skinId: string) =>
  KASMAN_URLS[`../../assets/kasman-${skinId}.png`] ?? KASMAN_URLS["../../assets/kasman.png"];

/** Kasman sprite height in world pixels, a little over a ghost's diameter for the spikes. */
export const KASMAN_SIZE = R * 2.5;

/**
 * Theme accessory drawn over the Kasman sprite (centered, facing right, KASMAN_SIZE tall).
 * Landmarks: head center (1.4, 1.8) radius ~7, top of head (2.6, -5.3), eyes centered at
 * (0.9, -0.1) and (6.5, -0.1).
 */
export function drawKasmanGear(pen: Pen, skin: Skin) {
  switch (skin.pacHat) {
    case "helmet":
      pen.circle(0.6, 0.4, 10.4).fill({ color: 0xbfe8ff, alpha: 0.14 });
      pen.circle(0.6, 0.4, 10.4).stroke({ width: 1, color: 0xdff4ff, alpha: 0.85 });
      pen.arc(0.6, 0.4, 9, -2.6, -1.8).stroke({ width: 1.2, color: 0xffffff, alpha: 0.8, cap: "round" });
      break;
    case "horns":
      pen.poly([-1.6, -4.2, -3.4, -9.4, 1, -5.4]).poly([5, -5.2, 8.6, -9.6, 7.6, -3.6]).fill(0xffe0a0);
      pen.poly([-1.6, -4.2, -3.4, -9.4, 1, -5.4]).poly([5, -5.2, 8.6, -9.6, 7.6, -3.6]).stroke({ width: 0.6, color: 0x2a0500, join: "round" });
      break;
    case "crown":
      pen.poly([-1.6, -4.6, -2, -9.6, 0.6, -7, 2.8, -10.4, 5, -7, 7.6, -9.4, 7, -4.2]).fill(0xffc400);
      pen.poly([-1.6, -4.6, -2, -9.6, 0.6, -7, 2.8, -10.4, 5, -7, 7.6, -9.4, 7, -4.2]).stroke({ width: 0.6, color: 0x5a3a00, join: "round" });
      pen.circle(2.8, -6.2, 1).fill(0xff3355);
      break;
    case "leaf": {
      // Flower crown with the seedling, plus a ladybug on its leaf.
      flowerCrown(pen, 2, -5.8, 6.6, 2.2, 1);
      pen.circle(6.9, -9.2, 1).fill(0xe0302a);
      pen.circle(7.6, -9.7, 0.45).fill(0x111111);
      pen.moveTo(6.4, -8.9).lineTo(7.4, -9.5).stroke({ width: 0.25, color: 0x111111 });
      pen.circle(6.5, -9.5, 0.22).circle(7, -8.7, 0.22).fill(0x111111);
      break;
    }
    case "shades":
      pen.moveTo(-3.6, -1).lineTo(9, -1).stroke({ width: 1, color: 0x111111 });
      pen.poly([-1.8, -2.6, 3.8, -2, 3.4, 1.6, -1.2, 1.4]).poly([4.8, -2, 9, -2.6, 8.8, 1.2, 5.2, 1.6]).fill(0x111111);
      pen.rect(-0.6, -1.9, 2, 0.7).rect(5.8, -1.9, 1.6, 0.7).fill(skin.wallGlow);
      break;
    case "snorkel":
      pen.rect(-2.2, -3.4, 11.4, 5.6).fill({ color: 0x9be7ff, alpha: 0.55 });
      pen.rect(-2.2, -3.4, 11.4, 5.6).stroke({ width: 0.9, color: 0x0b3d5c });
      pen.moveTo(-3.2, 0.4).lineTo(-3.2, -9.4).lineTo(-1.6, -10.6).stroke({ width: 1.5, color: 0xffcc00, cap: "round" });
      break;
    case "none":
      break;
  }
}

/** Almond-shaped leaf from (x, y) along angle `a`. */
function leaf(pen: Pen, x: number, y: number, a: number, len: number, w: number) {
  const pts: number[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i <= 6 ? i / 6 : (12 - i) / 6;
    const side = (i <= 6 ? 1 : -1) * w * Math.sin(Math.PI * t);
    pts.push(x + Math.cos(a) * len * t - Math.sin(a) * side, y + Math.sin(a) * len * t + Math.cos(a) * side);
  }
  pen.poly(pts).fill(0x5fd35a);
  pen.poly(pts).stroke({ width: 0.4, color: 0x1d5a25, join: "round" });
  pen.moveTo(x, y).lineTo(x + Math.cos(a) * len * 0.8, y + Math.sin(a) * len * 0.8).stroke({ width: 0.3, color: 0x1d5a25 });
}

/** Five-petal flower centered at (x, y). */
function flower(pen: Pen, x: number, y: number, petal: number, heart: number, k = 1) {
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    pen.circle(x + Math.cos(a) * 1.15 * k, y + Math.sin(a) * 1.15 * k, 0.9 * k);
  }
  pen.fill(petal);
  pen.circle(x, y, 0.65 * k).fill(heart);
}

/**
 * Flower crown centered at (cx, cy): a ring (rx by ry, an ellipse seen from the front)
 * with small flowers on its far side, aligned flowers along its near side, leaves, and a
 * seedling growing through it. `k` scales flowers and leaves.
 */
function flowerCrown(pen: Pen, cx: number, cy: number, rx: number, ry: number, k: number) {
  // Point on the ring at x offset `u` in [-1, 1]; `back` picks the far side.
  const at = (u: number, back = false): [number, number] =>
    [cx + u * rx, cy + (back ? -1 : 1) * ry * Math.sqrt(1 - u * u)];
  const colors = [[0xff8fb8, 0xfff2a0], [0xffffff, 0xffc93c], [0xffd93c, 0xa0521d]];
  pen.ellipse(cx, cy, rx, ry).stroke({ width: 0.9 * k, color: 0x3f8f3a });
  for (const u of [-0.75, -0.25, 0.25, 0.75]) leaf(pen, ...at(u, true), -Math.PI / 2 + u, 1.8 * k, 0.7 * k);
  for (let i = 0; i < 3; i++) flower(pen, ...at(-0.6 + i * 0.6, true), ...(colors[(i + 1) % 3] as [number, number]), 0.7 * k);
  sprout(pen, cx + 0.6 * k, cy + 0.2 * k, 1.25 * k);
  for (const u of [-1, -0.5, 0, 0.5, 1]) {
    const [x, y] = at(u * 0.98);
    leaf(pen, x, y, -Math.PI / 2 - 0.6, 2.2 * k, 0.8 * k);
    if (Math.abs(u) > 0.7) leaf(pen, x, y, Math.PI / 2 + 0.6 * Math.sign(u), 2 * k, 0.75 * k);
  }
  for (let i = 0; i < 4; i++) flower(pen, ...at(-0.75 + i * 0.5), ...(colors[i % 3] as [number, number]), k);
}

/** Seedling growing from (x, y): a short stem with two leaves, scaled by `k`. */
function sprout(pen: Pen, x: number, y: number, k: number) {
  const top = y - 2.6 * k;
  pen.moveTo(x, y).lineTo(x + 0.2 * k, top).stroke({ width: 0.8 * k, color: 0x3f8f3a, cap: "round" });
  leaf(pen, x + 0.2 * k, top, -2.5, 3.6 * k, 1.3 * k);
  leaf(pen, x + 0.2 * k, top, -0.55, 4.2 * k, 1.5 * k);
}

// ---------- Ghosts ----------

export interface GhostLook {
  color: number;
  dir: number;
  wave: number; // 0 or 1, skirt animation phase
  eaten: boolean;
  /** Frightened face color, or null when not frightened. */
  frightFace: number | null;
}

const PIXEL_GHOST = ["..###..", ".#####.", "#######", "#######", "#######", "#######"];

function ghostBody(pen: Pen, skin: Skin, c: number, wave: number) {
  const r = R;
  switch (skin.ghostStyle) {
    case "classic":
    case "demon": {
      const demon = skin.ghostStyle === "demon";
      if (demon) {
        // Horns sit behind the dome.
        pen.poly([-6.2, -3, -7.4, -R - 3.6, -3.2, -5.2]).poly([6.2, -3, 7.4, -R - 3.6, 3.2, -5.2]).fill(0xffe0a0);
      }
      const feet = demon ? 4 : 3;
      const fw = (2 * r) / feet;
      const depth = demon ? 4 : 2.5;
      pen.moveTo(-r, r).arc(0, -1, r, Math.PI, 0).lineTo(r, r);
      for (let k = feet - 1; k >= 0; k--) {
        const x0 = -r + k * fw;
        pen.lineTo(x0 + fw / 2, r - ((k + wave) % 2) * depth - 1);
        pen.lineTo(x0, demon ? r + 1.5 : r);
      }
      pen.closePath().fill(c);
      break;
    }
    case "spirit": {
      const fw = (2 * r) / 3;
      const base = r - 2 + wave * 0.6;
      pen.moveTo(-r, base).arc(0, -1, r, Math.PI, 0).lineTo(r, base);
      for (let k = 0; k < 3; k++) pen.arc(r - fw / 2 - k * fw, base, fw / 2, 0, Math.PI);
      pen.closePath().fill(c);
      flowerCrown(pen, 0, -7, 6, 1.8, 0.75);
      break;
    }
    case "alien":
      for (const s of [-1, 1]) {
        pen.moveTo(s * 2.6, -r + 1.5).lineTo(s * 4.4, -r - 2.6).stroke({ width: 0.9, color: c });
        pen.circle(s * 4.4, -r - 2.6, 1.2).fill(0xffffff);
      }
      pen.ellipse(0, -0.8, r * 0.82, r * 0.92).fill(c);
      pen.ellipse(0, r * 0.62, r + 1.6, 2.6).fill({ color: 0xcfd8e3, alpha: 0.95 });
      for (let k = -2; k <= 2; k++) pen.circle(k * 3, r * 0.62, 0.7).fill((k + wave) % 2 === 0 ? 0xffe066 : 0xff5d8f);
      break;
    case "jelly": {
      pen.moveTo(-r, 1.5).arc(0, 1.5, r, Math.PI, 0).closePath().fill(c);
      const w = wave ? 1 : -1;
      for (const x of [-5, -1.7, 1.7, 5]) {
        pen.moveTo(x, 1.5).lineTo(x + w, 4.2).lineTo(x - w, 6.8).lineTo(x + w * 0.6, r + 2).stroke({ width: 1.3, color: c, cap: "round", join: "round" });
      }
      break;
    }
    case "pixel": {
      const cell = (2 * r) / 7;
      const rows = [...PIXEL_GHOST, wave ? "#.#.#.#" : ".#.#.#."];
      rows.forEach((row, y) => {
        for (let x = 0; x < 7; x++) if (row[x] === "#") pen.rect(-r + x * cell, -r + y * cell, cell + 0.05, cell + 0.05);
      });
      pen.fill(c);
      break;
    }
  }
}

export function drawGhost(pen: Pen, skin: Skin, look: GhostLook) {
  if (!look.eaten) {
    ghostBody(pen, skin, look.color, look.wave);
  }
  if (look.frightFace !== null && !look.eaten) {
    const f = look.frightFace;
    pen.rect(-3.2, -2.5, 1.8, 1.8).rect(1.4, -2.5, 1.8, 1.8).fill(f);
    pen.moveTo(-4, 3).lineTo(-2.7, 2).lineTo(-1.3, 3).lineTo(0, 2).lineTo(1.3, 3).lineTo(2.7, 2).lineTo(4, 3).stroke({ width: 0.8, color: f });
    return;
  }
  const lx = look.dir >= 0 ? DX[look.dir] * 1.2 : 0;
  const ly = look.dir >= 0 ? DY[look.dir] * 1.2 : 0;
  if (skin.ghostStyle === "pixel") {
    pen.rect(-4.4, -3.6, 3.4, 3.8).rect(1, -3.6, 3.4, 3.8).fill(0xffffff);
    pen.rect(-3.6 + lx, -2.6 + ly, 1.8, 1.8).rect(1.8 + lx, -2.6 + ly, 1.8, 1.8).fill(0x003311);
    return;
  }
  const pupil = skin.ghostStyle === "demon" ? 0xb00000 : 0x1a2a6c;
  pen.ellipse(-2.8, -1.5, 2.1, 2.6).ellipse(2.8, -1.5, 2.1, 2.6).fill(0xffffff);
  pen.circle(-2.8 + lx, -1.5 + ly, 1.2).circle(2.8 + lx, -1.5 + ly, 1.2).fill(pupil);
}

// ---------- Pellets ----------

const star = (s: number) => [0, -s, s * 0.3, -s * 0.3, s, 0, s * 0.3, s * 0.3, 0, s, -s * 0.3, s * 0.3, -s, 0, -s * 0.3, -s * 0.3];
const flame = (s: number, dy = 0) => [0, -s * 1.5 + dy, s * 0.55, -s * 0.5 + dy, s * 0.8, s * 0.3 + dy, 0, s + dy, -s * 0.8, s * 0.3 + dy, -s * 0.55, -s * 0.5 + dy];

/** Kaspa "K" mark, `s` = half height. */
function kMark(pen: Pen, s: number, color: number) {
  pen.moveTo(-s * 0.5, -s).lineTo(-s * 0.5, s).moveTo(s * 0.65, -s).lineTo(-s * 0.4, 0).lineTo(s * 0.65, s)
    .stroke({ width: s * 0.43, color });
}

export function drawPellet(pen: Pen, style: PelletStyle, c: number, power: boolean) {
  const s = power ? 4.5 : 1.8;
  switch (style) {
    case "dot":
      pen.circle(0, 0, s).fill(c);
      break;
    case "block":
      if (power) {
        // A KAS coin.
        pen.circle(0, 0, s).fill(c);
        kMark(pen, 2.4, 0x07100e);
      } else pen.rect(-1.6, -1.6, 3.2, 3.2).fill(c);
      break;
    case "star":
      if (power) {
        // A small ringed planet.
        pen.circle(0, 0, 3.6).fill(c);
        pen.ellipse(0, 0, 6.4, 1.8).stroke({ width: 1, color: c, alpha: 0.8 });
      } else pen.poly(star(2.6)).fill(c);
      break;
    case "ember":
      pen.poly(flame(s * 1.1)).fill(power ? 0xff5a1f : c);
      if (power) pen.poly(flame(2.4, 1)).fill(c);
      break;
    case "seed":
      if (power) {
        // A flower.
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          pen.circle(Math.cos(a) * 2.9, Math.sin(a) * 2.9, 2.2);
        }
        pen.fill(c);
        pen.circle(0, 0, 1.8).fill(0xff9f1c);
      } else pen.ellipse(0, 0, 1.3, 2.1).fill(c);
      break;
    case "bubble":
      if (power) {
        // A pearl.
        pen.circle(0, 0, s).fill(c);
        pen.circle(-1.4, -1.4, 1.1).fill({ color: 0xffffff, alpha: 0.9 });
      } else {
        pen.circle(0, 0, 2.1).stroke({ width: 0.8, color: c });
        pen.circle(-0.7, -0.7, 0.5).fill(c);
      }
      break;
    case "coin":
      pen.circle(0, 0, power ? s : 2.3).fill(c);
      pen.circle(0, 0, power ? s - 1.4 : 1.3).stroke({ width: power ? 1 : 0.6, color: 0x000000, alpha: 0.3 });
      break;
    case "bit":
      if (power) {
        pen.rect(-4, -4, 8, 8).stroke({ width: 1.2, color: c });
        pen.rect(-1.8, -1.8, 3.6, 3.6).fill(c);
      } else pen.rect(-1.4, -1.4, 2.8, 2.8).fill(c);
      break;
  }
}

// ---------- Bonus fruit ----------

export function drawFruit(pen: Pen, style: FruitStyle, c: number) {
  switch (style) {
    case "coin":
      pen.circle(0, 0, 5.5).fill(c).circle(0, 0, 4).stroke({ width: 1, color: 0x000000, alpha: 0.35 });
      kMark(pen, 3, 0x05090f);
      break;
    case "planet":
      pen.circle(0, 0, 4.6).fill(c);
      pen.ellipse(-1, -1.2, 2, 1).fill({ color: 0xffffff, alpha: 0.35 });
      pen.ellipse(0, 0, 8, 2.2).stroke({ width: 1.2, color: 0xffffff, alpha: 0.85 });
      break;
    case "apple":
      pen.circle(-1.7, 0.8, 4.1).circle(1.7, 0.8, 4.1).fill(c);
      pen.moveTo(0, -2.6).lineTo(0.6, -5.4).stroke({ width: 1, color: 0x6b4f2a, cap: "round" });
      pen.poly([0.6, -4.6, 2.8, -6.2, 4.8, -5, 2.6, -3.8]).fill(0x3fbf4f);
      break;
    case "flame":
      pen.poly(flame(5, 0.5)).fill(c);
      pen.poly(flame(2.6, 2)).fill(0xffe066);
      break;
    case "gem":
      pen.poly([-5.2, -1.5, -2.6, -4.6, 2.6, -4.6, 5.2, -1.5, 0, 5.2]).fill(c);
      pen.moveTo(-5.2, -1.5).lineTo(5.2, -1.5).moveTo(-1.4, -4.6).lineTo(-2, -1.5).lineTo(0, 5.2).lineTo(2, -1.5).lineTo(1.4, -4.6)
        .stroke({ width: 0.6, color: 0xffffff, alpha: 0.6 });
      break;
    case "shell":
      pen.moveTo(0, 4.6).arc(0, 4.6, 8, Math.PI * 1.18, Math.PI * 1.82).lineTo(0, 4.6).fill(c);
      for (let k = 1; k < 5; k++) {
        const a = Math.PI * (1.18 + (0.64 * k) / 5);
        pen.moveTo(0, 4.6).lineTo(Math.cos(a) * 8, 4.6 + Math.sin(a) * 8);
      }
      pen.stroke({ width: 0.7, color: 0x000000, alpha: 0.3 });
      break;
    case "chip":
      for (let k = -1; k <= 1; k++) pen.moveTo(k * 2.4, -6).lineTo(k * 2.4, 6).moveTo(-6, k * 2.4).lineTo(6, k * 2.4);
      pen.stroke({ width: 0.8, color: c, alpha: 0.8 });
      pen.rect(-4, -4, 8, 8).fill(c);
      pen.rect(-2, -2, 4, 4).fill({ color: 0x000000, alpha: 0.4 });
      break;
  }
}

// ---------- Backdrop ----------

/** Static decoration behind the maze. Deterministic, so it never flickers between redraws. */
export function drawBackdrop(pen: Pen, style: Backdrop, c: number, w: number, h: number) {
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 48271) % 2147483647) - 1) / 2147483646;
  const count = Math.round((w * h) / 900);
  switch (style) {
    case "none":
      break;
    case "grid":
      for (let x = 0; x <= w; x += 32) pen.moveTo(x, 0).lineTo(x, h);
      for (let y = 0; y <= h; y += 32) pen.moveTo(0, y).lineTo(w, y);
      pen.stroke({ width: 0.5, color: c, alpha: 0.08 });
      break;
    case "blockdag": {
      // Columns of blocks, each linked to one or two blocks of the previous column.
      let prev: number[] = [];
      for (let x = 12; x < w; x += 44) {
        const col = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => 8 + rnd() * (h - 16));
        for (const y of col) {
          for (let k = 0; k < Math.min(prev.length, 1 + Math.floor(rnd() * 2)); k++) {
            pen.moveTo(x, y).lineTo(x - 44, prev[Math.floor(rnd() * prev.length)]);
          }
        }
        pen.stroke({ width: 0.6, color: c, alpha: 0.1 });
        for (const y of col) pen.rect(x - 4, y - 3, 8, 6);
        pen.fill({ color: c, alpha: 0.12 });
        prev = col;
      }
      break;
    }
    case "stars":
      for (const alpha of [0.25, 0.5, 0.9]) {
        for (let i = 0; i < count; i++) pen.circle(rnd() * w, rnd() * h, 0.3 + rnd() * 0.6);
        pen.fill({ color: c, alpha });
      }
      break;
    case "grass":
      for (let i = 0; i < count * 1.5; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        pen.moveTo(x - 1.5, y - 2.5).lineTo(x, y).lineTo(x + 1.5, y - 2.5).moveTo(x, y).lineTo(x, y - 3);
      }
      pen.stroke({ width: 0.6, color: c, alpha: 0.22 });
      break;
    case "embers":
      for (const [alpha, size] of [[0.18, 1.4], [0.35, 0.7]]) {
        for (let i = 0; i < count; i++) pen.circle(rnd() * w, rnd() * h, size * (0.5 + rnd()));
        pen.fill({ color: c, alpha });
      }
      break;
    case "bubbles":
      for (let i = 0; i < count; i++) pen.circle(rnd() * w, rnd() * h, 0.8 + rnd() * 2.6);
      pen.stroke({ width: 0.6, color: c, alpha: 0.22 });
      break;
    case "sunset": {
      const r = Math.min(w, h) * 0.32;
      pen.circle(w / 2, h * 0.45, r).fill({ color: 0xffb347, alpha: 0.1 });
      for (let y = h * 0.45; y < h; y += 4 + (y - h * 0.45) * 0.12) pen.moveTo(0, y).lineTo(w, y);
      for (let k = -8; k <= 8; k++) pen.moveTo(w / 2 + k * w * 0.02, h * 0.45).lineTo(w / 2 + k * w * 0.16, h);
      pen.stroke({ width: 0.6, color: c, alpha: 0.14 });
      break;
    }
    case "code":
      for (let i = 0; i < count / 3; i++) {
        const x = Math.floor(rnd() * (w / 6)) * 6;
        const y0 = rnd() * h;
        const len = 3 + Math.floor(rnd() * 8);
        for (let k = 0; k < len; k++) if (rnd() > 0.3) pen.rect(x, y0 + k * 5, 2.2 + rnd() * 1.5, 3);
      }
      pen.fill({ color: c, alpha: 0.13 });
      break;
  }
}
