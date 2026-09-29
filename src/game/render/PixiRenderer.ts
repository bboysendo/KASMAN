import { Application, Assets, Container, Graphics, GraphicsContext, Sprite, Text, type Texture } from "pixi.js";
import { GlowFilter } from "pixi-filters";
import { DX, DY, DYING_FRAMES, FRIGHT_FLASH_FRAMES, LEFT, U, fruitForLevel } from "../engine/constants";
import { isFrightFlashing, type GameEvent, type GameState } from "../engine/game";
import { H, POWER, W, mazeFor } from "../engine/map";
import type { Skin } from "./skins";
import { KASMAN_SIZE, drawBackdrop, drawFruit, drawGhost, drawKasmanGear, drawPellet, kasmanUrl } from "./sprites";

/** World pixels per tile. The world container is scaled to fit the host. */
const T = 16;
const WORLD_W = W * T;
const WORLD_H = H * T;

export type Snapshot = { x: number; y: number }[]; // pac first, then ghosts

export const snapshot = (s: GameState): Snapshot => [s.pac, ...s.ghosts].map(({ x, y }) => ({ x, y }));

interface Particle { g: Graphics; vx: number; vy: number; life: number; max: number }
interface Popup { t: Text; life: number }

export class PixiRenderer {
  private app: Application;
  private world = new Container();
  private backdrop = new Graphics();
  private maze = new Graphics();
  private pellets = new Container();
  private pelletByTile = new Map<number, Graphics>();
  private fruit = new Graphics();
  /** Kasman: the skin's sprite plus its accessory. */
  private pac = new Container();
  private kasman = new Sprite();
  private gear = new Graphics();
  private ghosts = [0, 1, 2, 3].map(() => new Graphics());
  private fx = new Container();
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private shake = 0;
  private lastSize = "";
  private pelletsDirty = true;
  private mazeMap = mazeFor(1);
  private skin: Skin;
  reducedMotion = false;

  private constructor(app: Application, skin: Skin) {
    this.app = app;
    this.skin = skin;
    this.kasman.anchor.set(0.5);
    this.pac.addChild(this.kasman, this.gear);
    this.world.addChild(this.backdrop, this.maze, this.pellets, this.fruit, ...this.ghosts, this.pac, this.fx);
    // Clip actors crossing the tunnel edges.
    const mask = new Graphics().rect(0, 0, WORLD_W, WORLD_H).fill(0xffffff);
    this.world.addChild(mask);
    this.world.mask = mask;
    app.stage.addChild(this.world);
    this.setSkin(skin);
  }

  static async create(host: HTMLElement, skin: Skin) {
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: skin.background,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      autoStart: false, // GameCanvas drives rendering from its own loop
    });
    app.canvas.style.display = "block";
    app.canvas.style.touchAction = "none";
    host.appendChild(app.canvas);
    return new PixiRenderer(app, skin);
  }

  get canvas() {
    return this.app.canvas;
  }

  setSkin(skin: Skin) {
    this.skin = skin;
    this.app.renderer.background.color = skin.background;
    this.backdrop.clear();
    drawBackdrop(this.backdrop, skin.backdrop, skin.backdropColor, WORLD_W, WORLD_H);
    this.drawMaze();
    this.gear.clear();
    drawKasmanGear(this.gear, skin);
    // Not awaited: the game can start while the bitmap loads.
    const url = kasmanUrl(skin.id);
    void Assets.load<Texture>(url).then((t) => {
      if (kasmanUrl(this.skin.id) === url) this.kasman.texture = t;
    });
    this.pelletsDirty = true;
    this.lastSize = ""; // force re-cache of the maze texture
  }

  private drawMaze() {
    const g = this.maze;
    const { isWall } = this.mazeMap;
    g.clear();
    const inset = T * 0.3;
    const half = T / 2;
    const open = (x: number, y: number) => y >= 0 && y < H && !isWall(x, y);
    if (this.skin.wallFill !== undefined) {
      // Fill each wall tile up to the edge lines (inset on sides facing a corridor).
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!isWall(x, y)) continue;
          const l = open(x - 1, y) ? inset : 0;
          const r = open(x + 1, y) ? inset : 0;
          const t = open(x, y - 1) ? inset : 0;
          const b = open(x, y + 1) ? inset : 0;
          g.rect(x * T + l, y * T + t, T - l - r, T - t - b);
        }
      }
      g.fill({ color: this.skin.wallFill, alpha: 0.85 });
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!isWall(x, y)) continue;
        const cx = x * T + half;
        const cy = y * T + half;
        for (let d = 0; d < 4; d++) {
          if (!open(x + DX[d], y + DY[d])) continue;
          // Edge line facing the open neighbor; ends adapt to convex / straight / concave joins.
          const nx = DX[d];
          const ny = DY[d];
          const tx = -ny;
          const ty = nx;
          const ends = [-1, 1].map((sign) => {
            const sideOpen = open(x + tx * sign, y + ty * sign);
            const diagOpen = open(x + tx * sign + nx, y + ty * sign + ny);
            const reach = sideOpen ? half - inset : diagOpen ? half : half + inset;
            return {
              x: cx + nx * (half - inset) + tx * sign * reach,
              y: cy + ny * (half - inset) + ty * sign * reach,
            };
          });
          g.moveTo(ends[0].x, ends[0].y).lineTo(ends[1].x, ends[1].y);
        }
      }
    }
    g.stroke({ width: this.skin.wallWidth ?? 2, color: this.skin.wall, cap: "round", join: "round" });
    g.filters = [new GlowFilter({ distance: 8, outerStrength: 2.2, innerStrength: 0.4, color: this.skin.wallGlow, quality: 0.2 })];
  }

  private rebuildPellets() {
    this.pellets.removeChildren().forEach((c) => c.destroy());
    this.pelletByTile.clear();
    const dot = new GraphicsContext();
    const power = new GraphicsContext();
    drawPellet(dot, this.skin.pelletStyle, this.skin.pellet, false);
    drawPellet(power, this.skin.pelletStyle, this.skin.pellet, true);
    // Full layout, not the current state, so eaten pellets exist when the next level refills them.
    this.mazeMap.createPellets().forEach((p, i) => {
      if (!p) return;
      const g = new Graphics(p === POWER ? power : dot);
      g.position.set((i % W) * T + T / 2, Math.floor(i / W) * T + T / 2);
      if (p === POWER) g.label = "power";
      this.pellets.addChild(g);
      this.pelletByTile.set(i, g);
    });
  }

  private syncPellets(s: GameState) {
    // Only a skin or maze change rebuilds the pellet sprites.
    if (this.pelletsDirty) {
      this.pelletsDirty = false;
      this.rebuildPellets();
    }
    for (const [i, g] of this.pelletByTile) g.visible = s.pellets[i] !== 0;
  }

  private layout() {
    const { width, height } = this.app.screen;
    const key = `${width}x${height}`;
    if (key === this.lastSize) return;
    this.lastSize = key;
    const scale = Math.min(width / WORLD_W, height / WORLD_H);
    this.world.scale.set(scale);
    this.world.position.set((width - WORLD_W * scale) / 2, (height - WORLD_H * scale) / 2);
    // Maze never changes within a level: render it (with glow) once per size and maze.
    for (const g of [this.backdrop, this.maze]) {
      g.cacheAsTexture(false);
      g.cacheAsTexture({ resolution: scale * this.app.renderer.resolution, antialias: true });
    }
  }

  handleEvents(events: GameEvent[]) {
    for (const e of events) {
      if (e.type === "ghostEaten" || e.type === "fruit") {
        this.popup(e.x, e.y, String(e.points), e.type === "fruit" ? 0xffe16a : 0x78f7ff);
        this.burst(e.x * T + T / 2, e.y * T + T / 2, e.type === "fruit" ? 0xffe16a : this.skin.wallGlow, 18, 1.6);
      } else if (e.type === "death") {
        this.shake = 10;
      } else if (e.type === "power") {
        this.shake = Math.max(this.shake, 3);
      }
    }
  }

  private burst(x: number, y: number, color: number, count: number, speed: number) {
    if (this.reducedMotion) return;
    for (let i = 0; i < count && this.particles.length < 300; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random();
      const v = speed * (0.4 + Math.random());
      const g = new Graphics().circle(0, 0, 1.3).fill(color);
      g.position.set(x, y);
      this.fx.addChild(g);
      const life = 30 + Math.random() * 20;
      this.particles.push({ g, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life });
    }
  }

  private popup(tx: number, ty: number, text: string, color: number) {
    const t = new Text({ text, style: { fontFamily: '"Press Start 2P", monospace', fontSize: 7, fill: color } });
    t.anchor.set(0.5);
    t.resolution = 4;
    t.position.set(tx * T + T / 2, ty * T + T / 2);
    this.fx.addChild(t);
    this.popups.push({ t, life: 60 });
  }

  private updateFx() {
    this.particles = this.particles.filter((p) => {
      p.g.x += p.vx;
      p.g.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.g.alpha = --p.life / p.max;
      if (p.life > 0) return true;
      p.g.destroy();
      return false;
    });
    this.popups = this.popups.filter((p) => {
      p.t.y -= 0.35;
      p.t.alpha = Math.min(1, --p.life / 20);
      if (p.life > 0) return true;
      p.t.destroy();
      return false;
    });
  }

  /** `prev` + `alpha` interpolate between the last two simulation frames for smooth motion. */
  render(s: GameState, prev: Snapshot | null, alpha: number) {
    const maze = mazeFor(s.level);
    if (maze !== this.mazeMap) {
      this.mazeMap = maze;
      this.drawMaze();
      this.pelletsDirty = true;
      this.lastSize = ""; // force re-cache of the maze texture
    }
    this.layout();
    this.syncPellets(s);
    this.updateFx();
    const f = s.frame;
    const motion = !this.reducedMotion;

    const lerp = (i: number, a: { x: number; y: number }) => {
      const p = prev?.[i];
      // Skip interpolation across tunnel wraps.
      if (!p || Math.abs(p.x - a.x) > U * 2) return { x: a.x, y: a.y };
      return { x: p.x + (a.x - p.x) * alpha, y: p.y + (a.y - p.y) * alpha };
    };
    const toWorld = (v: number) => (v / U) * T + T / 2;

    // Level clear: classic maze flash.
    this.maze.alpha = s.phase === "levelclear" && Math.floor(s.phaseTimer / 12) % 2 === 0 ? 0.25 : 1;

    for (const g of this.pellets.children) {
      if (g.label === "power") g.scale.set(motion ? 0.85 + 0.25 * Math.sin(f * 0.15) : 1);
    }

    this.drawFruit(s, motion);
    const p = lerp(0, s.pac);
    this.drawPac(s, toWorld(p.x), toWorld(p.y));
    s.ghosts.forEach((ghost, i) => {
      const pos = lerp(i + 1, ghost);
      this.drawGhost(s, i, toWorld(pos.x), toWorld(pos.y), motion);
    });
    const hideActors = s.phase === "gameover" || s.phase === "levelclear";
    this.ghosts.forEach((g) => (g.visible = !hideActors && s.phase !== "dying"));
    if (s.phase === "gameover") this.pac.visible = false;

    if (this.shake > 0 && motion) {
      this.world.pivot.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= 0.88;
      if (this.shake < 0.3) this.shake = 0;
    } else this.world.pivot.set(0, 0);

    this.app.render();
  }

  private drawFruit(s: GameState, motion: boolean) {
    const g = this.fruit;
    g.clear();
    if (!s.fruit.active) return;
    drawFruit(g, this.skin.fruitStyle, fruitForLevel(s.level).color);
    g.position.set(s.fruit.x * T + T / 2, s.fruit.y * T + T / 2 + (motion ? Math.sin(s.frame * 0.1) : 0));
  }

  private drawPac(s: GameState, x: number, y: number) {
    const g = this.pac;
    const dying = s.phase === "dying" ? 1 - s.phaseTimer / DYING_FRAMES : 0;
    g.visible = this.kasman.texture.height > 1 && dying < 1;
    g.position.set(x, y);
    // Kasman stays upright: mirrored when facing left, spinning and shrinking while dying.
    g.rotation = dying * Math.PI * 3;
    const bob = s.pac.moving && s.phase === "playing" ? Math.sin(s.frame * 0.5) * 0.06 : 0;
    const k = (KASMAN_SIZE / this.kasman.texture.height) * (1 - dying);
    this.kasman.scale.set(k * (1 + bob), k * (1 - bob));
    g.scale.set(s.pac.dir === LEFT && !dying ? -1 : 1, 1);
  }

  private drawGhost(s: GameState, i: number, x: number, y: number, motion: boolean) {
    const ghost = s.ghosts[i];
    const g = this.ghosts[i];
    const flashing = ghost.frightened && isFrightFlashing(s, FRIGHT_FLASH_FRAMES);
    g.clear();
    drawGhost(g, this.skin, {
      color: ghost.frightened ? (flashing ? this.skin.frightFlash : this.skin.fright) : this.skin.ghosts[i],
      dir: ghost.dir,
      wave: motion ? Math.floor(s.frame / 8) % 2 : 0,
      eaten: ghost.state === "eaten",
      frightFace: ghost.frightened ? (flashing ? 0xff3355 : 0xffe0d0) : null,
    });
    const bob = ghost.state === "house" && motion ? Math.sin(s.frame * 0.15 + i) * 1.5 : 0;
    g.position.set(x, y + bob);
  }

  destroy() {
    this.app.destroy(true, { children: true });
  }
}
