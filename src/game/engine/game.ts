import {
  AMBUSH_RADIUS, AMBUSH_WEIGHT, BONUS_LIFE_STEP, BUY_LIFE, DX, DY, DYING_FRAMES, EATEN_SPEED, FORCE_RELEASE_FRAMES, FREEZE_FRAMES, GHOSTHUNT_FRAMES,
  GHOST_DEFS, GHOST_HOME, LEFT, LEVEL_CLEAR_FRAMES, MAGNET_FRAMES, MAGNET_RADIUS, MAX_BOUGHT_LIVES, MAX_FREEZE_PER_LEVEL, MAX_GHOSTHUNT_PER_LEVEL,
  MAX_GHOST_CHAIN, MAX_MAGNET_PER_LEVEL, MAX_SHIELD_PER_LEVEL, MAX_SPEED_PER_LEVEL, MAX_SURGE_PER_LEVEL, MIN_FRUIT_DISTANCE, NONE, PAC_START, READY_FRAMES,
  SCORE_GHOST, SCORE_PELLET, SCORE_POWER, SHIELD_FRAMES, SPEED_FRAMES, SPEED_MULT, STARTING_LIVES, SURGE_FRAMES, SURGE_MULT, TURN_BUFFER_FRAMES,
  TURN_TOLERANCE, U, UP, USE_FREEZE, USE_GHOSTHUNT, USE_MAGNET, USE_SHIELD, USE_SPEED, USE_SURGE,
  elroyThresholds, fruitForLevel, levelTuning, modeSchedule, opposite,
  type GhostId, type LevelTuning, type Point,
} from "./constants";
import { H, MAZE_COUNT, POWER, W, mazeFor, wrapX } from "./map";

export type Phase = "ready" | "playing" | "dying" | "levelclear" | "gameover";

/** Position in sub-units: tile (tx, ty) center is (tx * U, ty * U). */
export interface Actor { x: number; y: number; dir: number }
export interface Pacman extends Actor { next: number; nextTtl: number; moving: boolean }
export interface Ghost extends Actor {
  id: GhostId;
  state: "house" | "active" | "eaten";
  frightened: boolean;
}

export type GameEvent =
  | { type: "pellet" | "power" | "death" | "levelClear" | "extraLife" | "gameOver" | "ready" | "shield" | "freeze" | "surge" | "speed" | "magnet" | "ghosthunt" }
  | { type: "ghostEaten" | "fruit"; x: number; y: number; points: number }
  | { type: "shardCollected"; x: number; y: number };

export interface GameState {
  seed: number;
  rng: number;
  frame: number;
  phase: Phase;
  phaseTimer: number;
  level: number;
  /** Cleared the last level: the game is over and the player won. */
  won: boolean;
  score: number;
  lives: number;
  /** Life number since game start (1 for the first life), incremented on death, not on level-clear. */
  life: number;
  livesBought: number;
  /** Potions used this level (each capped independently of how many are owned); reset to 0 in `resetLevel` on every level clear. */
  shieldBought: number;
  freezeBought: number;
  surgeBought: number;
  speedBought: number;
  magnetBought: number;
  ghosthuntBought: number;
  /** Frames left on the active effect, 0 when off. */
  shieldTimer: number;
  freezeTimer: number;
  surgeTimer: number;
  speedTimer: number;
  magnetTimer: number;
  nextBonus: number;
  pellets: Uint8Array;
  pelletsLeft: number;
  pelletsTotal: number;
  dotsThisRound: number;
  roundFrame: number;
  modeIndex: number;
  modeFrame: number;
  mode: "scatter" | "chase";
  frightTimer: number;
  eatChain: number;
  pac: Pacman;
  ghosts: Ghost[];
  fruit: { active: boolean; x: number; y: number; timer: number; spawns: number };
  /**
   * This level's Puzzle Shard pickups: `level` of them (level 1 has 1, level 2 has 2, ...), each
   * independently collected (`spawnShards`). A fresh set is created every time the level changes;
   * within a level, still-uncollected ones are re-rolled onto a new reachable tile every round.
   */
  shards: { active: boolean; collected: boolean; x: number; y: number }[];
  /** Total Puzzle Shards collected so far this game, across every level. The server credits that many on submit. */
  shardsCollected: number;
  events: GameEvent[];
}

export function hashSeed(value: number) {
  const raw = Math.trunc(value);
  if (!Number.isFinite(raw) || raw === 0) return 123456789;
  return Math.abs(raw) % 2147483647 || 123456789;
}

// Park-Miller LCG, same as the original game. Products stay below 2^53 so it is exact.
function rand(s: GameState) {
  s.rng = (s.rng * 48271) % 2147483647;
  return (s.rng - 1) / 2147483646;
}
const randInt = (s: GameState, n: number) => Math.floor(rand(s) * n);

export const tileOf = (a: Actor): Point => ({ x: Math.round(a.x / U) + 0, y: Math.round(a.y / U) + 0 });
const tuning = (s: GameState): LevelTuning => levelTuning(s.level);
const maze = (s: GameState) => mazeFor(s.level);

export function createGame(seed: number): GameState {
  const s: GameState = {
    seed: hashSeed(seed),
    rng: hashSeed(seed),
    frame: 0,
    phase: "ready",
    phaseTimer: READY_FRAMES,
    level: 1,
    won: false,
    score: 0,
    lives: STARTING_LIVES,
    life: 1,
    livesBought: 0,
    shieldBought: 0,
    freezeBought: 0,
    surgeBought: 0,
    speedBought: 0,
    magnetBought: 0,
    ghosthuntBought: 0,
    shieldTimer: 0,
    freezeTimer: 0,
    surgeTimer: 0,
    speedTimer: 0,
    magnetTimer: 0,
    nextBonus: BONUS_LIFE_STEP,
    pellets: new Uint8Array(0),
    pelletsLeft: 0,
    pelletsTotal: 0,
    dotsThisRound: 0,
    roundFrame: 0,
    modeIndex: 0,
    modeFrame: 0,
    mode: "scatter",
    frightTimer: 0,
    eatChain: 0,
    pac: { x: 0, y: 0, dir: LEFT, next: NONE, nextTtl: 0, moving: false },
    ghosts: [],
    fruit: { active: false, x: 0, y: 0, timer: 0, spawns: 0 },
    shards: [],
    shardsCollected: 0,
    events: [],
  };
  resetLevel(s);
  return s;
}

function resetLevel(s: GameState) {
  s.pellets = maze(s).createPellets();
  s.pelletsTotal = s.pellets.reduce((n, p) => n + (p ? 1 : 0), 0);
  s.pelletsLeft = s.pelletsTotal;
  // Each potion's per-level cap renews on a new level; bought lives stay capped for the whole game.
  s.shieldBought = 0;
  s.freezeBought = 0;
  s.surgeBought = 0;
  s.speedBought = 0;
  s.magnetBought = 0;
  s.ghosthuntBought = 0;
  // A fresh set of Puzzle Shards for this level: 1 at level 1, 2 at level 2, and so on.
  s.shards = Array.from({ length: s.level }, () => ({ active: false, collected: false, x: 0, y: 0 }));
  resetRound(s);
}

/** Re-rolls every uncollected shard in `s.shards` onto its own reachable tile, leaving collected ones alone. */
function spawnShards(s: GameState) {
  const m = maze(s);
  const pool = m.reachable.filter((p) => !m.isTunnel(p.x, p.y) && !(p.x === PAC_START.x && p.y === PAC_START.y));
  for (const shard of s.shards) {
    if (shard.collected || pool.length === 0) {
      shard.active = false;
      continue;
    }
    const spot = pool.splice(randInt(s, pool.length), 1)[0];
    shard.active = true;
    shard.x = spot.x;
    shard.y = spot.y;
  }
}

function resetRound(s: GameState) {
  spawnShards(s);
  s.pac = { x: PAC_START.x * U, y: PAC_START.y * U, dir: LEFT, next: NONE, nextTtl: 0, moving: false };
  s.ghosts = GHOST_DEFS.map((d) => ({
    id: d.id,
    x: d.spawn.x * U,
    y: d.spawn.y * U,
    dir: d.inHouse ? UP : LEFT,
    state: d.inHouse ? "house" : "active",
    frightened: false,
  }));
  s.dotsThisRound = 0;
  s.roundFrame = 0;
  s.modeIndex = 0;
  s.modeFrame = 0;
  s.mode = "scatter";
  s.frightTimer = 0;
  s.eatChain = 0;
  s.fruit = { active: false, x: 0, y: 0, timer: tuning(s).fruitDelayFrames, spawns: 0 };
  s.phase = "ready";
  s.phaseTimer = READY_FRAMES;
  s.events.push({ type: "ready" });
}

/**
 * Moves an actor `speed` sub-units along the grid. At every tile center `choose`
 * picks the next direction (or NONE to stop). Returns false if the actor stopped.
 */
function advance(a: Actor, speed: number, choose: (tx: number, ty: number) => number) {
  let rem = speed;
  while (rem > 0) {
    if (a.x % U === 0 && a.y % U === 0) {
      const dir = choose(a.x / U, a.y / U);
      if (dir === NONE) return false;
      a.dir = dir;
    }
    const horizontal = DX[a.dir] !== 0;
    const pos = horizontal ? a.x : a.y;
    const r = ((pos % U) + U) % U;
    const forward = DX[a.dir] + DY[a.dir] > 0;
    const dist = r === 0 ? U : forward ? U - r : r;
    const step = Math.min(rem, dist);
    a.x += DX[a.dir] * step;
    a.y += DY[a.dir] * step;
    rem -= step;
    // Tunnel wrap keeps x in [-U/2, W*U - U/2).
    if (a.x < -U / 2) a.x += W * U;
    else if (a.x >= W * U - U / 2) a.x -= W * U;
  }
  return true;
}

function movePacman(s: GameState) {
  const p = s.pac;
  const { isOpen } = maze(s);
  // Reversing is allowed mid-tile, like the arcade.
  if (p.next === opposite(p.dir)) {
    p.dir = p.next;
    p.next = NONE;
  }
  // Late-turn tolerance: a perpendicular press slightly past the junction
  // center still takes the turn (small snap back onto the lane).
  if (p.next !== NONE && p.next !== p.dir) {
    const t = tileOf(p);
    const past = (p.x - t.x * U) * DX[p.dir] + (p.y - t.y * U) * DY[p.dir];
    if (past > 0 && past <= TURN_TOLERANCE && isOpen(t.x + DX[p.next], t.y + DY[p.next])) {
      p.x = wrapX(t.x) * U;
      p.y = t.y * U;
    }
  }
  const speed = s.speedTimer > 0 ? Math.round(tuning(s).pacSpeed * SPEED_MULT) : tuning(s).pacSpeed;
  p.moving = advance(p, speed, (tx, ty) => {
    if (p.next !== NONE && isOpen(tx + DX[p.next], ty + DY[p.next])) {
      const d = p.next;
      p.next = NONE;
      return d;
    }
    return isOpen(tx + DX[p.dir], ty + DY[p.dir]) ? p.dir : NONE;
  });
  // A missed turn must not fire at some far-away junction later.
  if (p.next !== NONE && --p.nextTtl <= 0) p.next = NONE;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function chaseTarget(s: GameState, g: Ghost): Point {
  const def = GHOST_DEFS.find((d) => d.id === g.id)!;
  if (g.state === "eaten") return GHOST_HOME;
  if (s.mode === "scatter") return def.scatter;
  const pt = tileOf(s.pac);
  const ahead = (n: number) => ({
    x: clamp(pt.x + DX[s.pac.dir] * n, 0, W - 1),
    y: clamp(pt.y + DY[s.pac.dir] * n, 0, H - 1),
  });
  switch (g.id) {
    case "blinky":
      return pt;
    case "pinky":
      return ahead(4);
    case "inky": {
      const pivot = ahead(2);
      const b = tileOf(s.ghosts.find((o) => o.id === "blinky") ?? g);
      return { x: clamp(pivot.x * 2 - b.x, 0, W - 1), y: clamp(pivot.y * 2 - b.y, 0, H - 1) };
    }
    case "clyde": {
      const ct = tileOf(g);
      return Math.abs(ct.x - pt.x) + Math.abs(ct.y - pt.y) > 8 ? pt : def.scatter;
    }
  }
}

function ghostSpeed(s: GameState, g: Ghost) {
  const t = tuning(s);
  if (g.state === "eaten") return EATEN_SPEED;
  if (g.frightened) return t.frightSpeed;
  const tile = tileOf(g);
  if (maze(s).isTunnel(tile.x, tile.y)) return t.tunnelSpeed;
  if (g.id === "blinky") {
    const th = elroyThresholds(s.level, s.pelletsTotal);
    if (s.pelletsLeft <= th.phase2) return Math.round(t.ghostSpeed * t.elroy2);
    if (s.pelletsLeft <= th.phase1) return Math.round(t.ghostSpeed * t.elroy1);
  }
  return t.ghostSpeed;
}

/** Maze walking distance from the nearest source to every tile (tunnels wrap). -1 = unreachable. */
function distField(s: GameState, sources: Point[]) {
  const { isWall } = maze(s);
  const dist = new Int16Array(W * H).fill(-1);
  const queue: number[] = [];
  for (const p of sources) {
    const i = p.y * W + wrapX(p.x);
    if (!isWall(p.x, p.y) && dist[i] < 0) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const x = queue[q] % W;
    const y = (queue[q] - x) / W;
    for (let d = 0; d < 4; d++) {
      const nx = wrapX(x + DX[d]);
      const ny = y + DY[d];
      if (isWall(nx, ny) || dist[ny * W + nx] >= 0) continue;
      dist[ny * W + nx] = dist[queue[q]] + 1;
      queue.push(ny * W + nx);
    }
  }
  return dist;
}

/** Targets can sit in a wall (look-ahead, corners): use the closest open tile instead. */
function openTarget(s: GameState, t: Point): Point {
  const m = maze(s);
  if (m.isOpen(t.x, t.y)) return t;
  let best = m.reachable[0];
  let bestDist = Infinity;
  for (const p of m.reachable) {
    const dist = (p.x - t.x) ** 2 + (p.y - t.y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

function moveGhost(s: GameState, g: Ghost) {
  if (g.state === "house") return;
  const { isOpen } = maze(s);
  advance(g, ghostSpeed(s, g), (tx, ty) => {
    const options: number[] = [];
    for (let d = 0; d < 4; d++) {
      if (d !== opposite(g.dir) && isOpen(tx + DX[d], ty + DY[d])) options.push(d);
    }
    if (options.length === 0) return isOpen(tx + DX[opposite(g.dir)], ty + DY[opposite(g.dir)]) ? opposite(g.dir) : NONE;
    if (options.length === 1) return options[0];
    const at = (field: Int16Array, d: number) => field[(ty + DY[d]) * W + wrapX(tx + DX[d])];
    let cost: (d: number) => number;
    if (g.frightened) {
      if (rand(s) >= tuning(s).fleeChance) return options[randInt(s, options.length)];
      const fromPac = distField(s, [tileOf(s.pac)]);
      cost = (d) => -at(fromPac, d);
    } else {
      const toTarget = distField(s, [openTarget(s, chaseTarget(s, g))]);
      const walk = (d: number) => (at(toTarget, d) < 0 ? 9999 : at(toTarget, d));
      if (g.state === "active" && s.mode === "chase" && g.id !== "blinky") {
        const allies = s.ghosts.filter((o) => o !== g && o.state === "active" && !o.frightened).map(tileOf);
        const fromAllies = distField(s, allies);
        cost = (d) => {
          const ally = at(fromAllies, d);
          return walk(d) + (ally < 0 ? 0 : AMBUSH_WEIGHT * Math.max(0, AMBUSH_RADIUS - ally));
        };
      } else cost = walk;
    }
    let best = options[0];
    let bestCost = Infinity;
    for (const d of options) {
      const c = cost(d);
      if (c < bestCost) {
        bestCost = c;
        best = d;
      }
    }
    return best;
  });
  const t = tileOf(g);
  if (g.state === "eaten" && t.x === GHOST_HOME.x && t.y === GHOST_HOME.y) g.state = "active";
}

function addScore(s: GameState, points: number) {
  // Score Surge doubles everything Kasman eats while active.
  s.score += s.surgeTimer > 0 ? points * SURGE_MULT : points;
  while (s.score >= s.nextBonus) {
    s.lives++;
    s.nextBonus += BONUS_LIFE_STEP;
    s.events.push({ type: "extraLife" });
  }
}

function reverseActiveGhosts(s: GameState) {
  for (const g of s.ghosts) if (g.state === "active") g.dir = opposite(g.dir);
}

function updateModes(s: GameState) {
  if (s.frightTimer > 0) {
    if (--s.frightTimer === 0) {
      for (const g of s.ghosts) g.frightened = false;
      s.eatChain = 0;
    }
    return; // scatter/chase clock pauses while frightened
  }
  const schedule = modeSchedule(s.level);
  if (++s.modeFrame >= schedule[s.modeIndex].frames && s.modeIndex < schedule.length - 1) {
    s.modeIndex++;
    s.modeFrame = 0;
    s.mode = schedule[s.modeIndex].mode;
    reverseActiveGhosts(s);
  }
}

function releaseGhosts(s: GameState) {
  for (const g of s.ghosts) {
    if (g.state !== "house") continue;
    const def = GHOST_DEFS.find((d) => d.id === g.id)!;
    if (s.dotsThisRound >= def.releaseDots || s.roundFrame >= def.releaseFrames || s.roundFrame >= FORCE_RELEASE_FRAMES) {
      g.state = "active";
    }
  }
}

function consumePelletAt(s: GameState, i: number) {
  const p = s.pellets[i];
  if (!p) return;
  s.pellets[i] = 0;
  s.pelletsLeft--;
  s.dotsThisRound++;
  if (p === POWER) {
    addScore(s, SCORE_POWER);
    s.frightTimer = tuning(s).frightFrames;
    s.eatChain = 0;
    for (const g of s.ghosts) {
      if (g.state !== "active") continue;
      g.frightened = true;
      g.dir = opposite(g.dir);
    }
    s.events.push({ type: "power" });
  } else {
    addScore(s, SCORE_PELLET);
    s.events.push({ type: "pellet" });
  }
}

/** Ghost Magnet: also pulls in every pellet within MAGNET_RADIUS tiles of Kasman. */
function magnetPull(s: GameState, t: Point) {
  for (let dy = -MAGNET_RADIUS; dy <= MAGNET_RADIUS; dy++) {
    const y = t.y + dy;
    if (y < 0 || y >= H) continue;
    for (let dx = -MAGNET_RADIUS; dx <= MAGNET_RADIUS; dx++) {
      if (dx === 0 && dy === 0) continue; // the tile Kasman is on is handled by eat() itself
      consumePelletAt(s, y * W + wrapX(t.x + dx));
    }
  }
}

function checkShard(s: GameState, t: Point) {
  for (const shard of s.shards) {
    if (!shard.active || t.x !== shard.x || t.y !== shard.y) continue;
    shard.active = false;
    shard.collected = true;
    s.shardsCollected++;
    s.events.push({ type: "shardCollected", x: t.x, y: t.y });
  }
}

function eat(s: GameState) {
  const t = tileOf(s.pac);
  consumePelletAt(s, t.y * W + t.x);
  checkShard(s, t);
  if (s.magnetTimer > 0) magnetPull(s, t);
}

function updateFruit(s: GameState) {
  const f = s.fruit;
  const t = tuning(s);
  const pt = tileOf(s.pac);
  // Ghost Magnet also reaches the fruit, not just pac-dots.
  const reach = s.magnetTimer > 0 ? MAGNET_RADIUS : 0;
  if (f.active && Math.max(Math.abs(pt.x - f.x), Math.abs(pt.y - f.y)) <= reach) {
    const points = fruitForLevel(s.level).points;
    addScore(s, points);
    s.events.push({ type: "fruit", x: f.x, y: f.y, points });
    f.active = false;
    f.timer = t.fruitDelayFrames;
    return;
  }
  if (--f.timer > 0) return;
  if (f.active) {
    f.active = false;
    f.timer = t.fruitDelayFrames;
  } else if (f.spawns < 2) {
    const m = maze(s);
    const candidates = m.reachable.filter(
      (p) => Math.abs(p.x - pt.x) + Math.abs(p.y - pt.y) >= MIN_FRUIT_DISTANCE && !m.isTunnel(p.x, p.y),
    );
    const spot = candidates[randInt(s, candidates.length)];
    Object.assign(f, { active: true, x: spot.x, y: spot.y, timer: t.fruitVisibleFrames, spawns: f.spawns + 1 });
  }
}

function checkCollisions(s: GameState, pacBefore: Point, ghostsBefore: Point[]) {
  const pt = tileOf(s.pac);
  for (let i = 0; i < s.ghosts.length; i++) {
    const g = s.ghosts[i];
    if (g.state === "eaten") continue;
    const gt = tileOf(g);
    const gb = ghostsBefore[i];
    // Same tile, or swapped tiles this frame (prevents passing through each other).
    const hit = (gt.x === pt.x && gt.y === pt.y) || (gt.x === pacBefore.x && gt.y === pacBefore.y && gb.x === pt.x && gb.y === pt.y);
    if (!hit) continue;
    if (g.frightened) {
      const points = SCORE_GHOST * 2 ** s.eatChain;
      s.eatChain = Math.min(s.eatChain + 1, MAX_GHOST_CHAIN);
      addScore(s, points);
      g.state = "eaten";
      g.frightened = false;
      s.events.push({ type: "ghostEaten", x: gt.x, y: gt.y, points });
    } else if (s.shieldTimer > 0) {
      continue; // Ghost Shield: passes through unharmed
    } else {
      s.lives--;
      s.phase = "dying";
      s.phaseTimer = DYING_FRAMES;
      s.events.push({ type: "death" });
      return;
    }
  }
}

/** Advances the simulation one frame. `input` is a newly pressed direction, a special input (BUY_LIFE, USE_SHIELD, USE_FREEZE, USE_SURGE, USE_SPEED, USE_MAGNET, USE_GHOSTHUNT) or NONE. */
export function step(s: GameState, input: number = NONE) {
  s.events.length = 0;
  if (s.phase === "gameover") return;
  s.frame++;
  if (input === BUY_LIFE) {
    // Also works while dying on the last life, which acts as a continue.
    if (s.livesBought < MAX_BOUGHT_LIVES) {
      s.livesBought++;
      s.lives++;
      s.events.push({ type: "extraLife" });
    }
  } else if (input === USE_SHIELD) {
    if (s.phase === "playing" && s.shieldBought < MAX_SHIELD_PER_LEVEL) {
      s.shieldBought++;
      s.shieldTimer = SHIELD_FRAMES;
      s.events.push({ type: "shield" });
    }
  } else if (input === USE_FREEZE) {
    if (s.phase === "playing" && s.freezeBought < MAX_FREEZE_PER_LEVEL) {
      s.freezeBought++;
      s.freezeTimer = FREEZE_FRAMES;
      s.events.push({ type: "freeze" });
    }
  } else if (input === USE_SURGE) {
    if (s.phase === "playing" && s.surgeBought < MAX_SURGE_PER_LEVEL) {
      s.surgeBought++;
      s.surgeTimer = SURGE_FRAMES;
      s.events.push({ type: "surge" });
    }
  } else if (input === USE_SPEED) {
    if (s.phase === "playing" && s.speedBought < MAX_SPEED_PER_LEVEL) {
      s.speedBought++;
      s.speedTimer = SPEED_FRAMES;
      s.events.push({ type: "speed" });
    }
  } else if (input === USE_MAGNET) {
    if (s.phase === "playing" && s.magnetBought < MAX_MAGNET_PER_LEVEL) {
      s.magnetBought++;
      s.magnetTimer = MAGNET_FRAMES;
      s.events.push({ type: "magnet" });
    }
  } else if (input === USE_GHOSTHUNT) {
    if (s.phase === "playing" && s.ghosthuntBought < MAX_GHOSTHUNT_PER_LEVEL) {
      s.ghosthuntBought++;
      // Same frightened state a power pellet triggers (blue, eatable, same chain scoring),
      // just a fixed 6s instead of the level-tuned frightFrames, and no points for using it.
      s.frightTimer = GHOSTHUNT_FRAMES;
      s.eatChain = 0;
      for (const g of s.ghosts) {
        if (g.state !== "active") continue;
        g.frightened = true;
        g.dir = opposite(g.dir);
      }
      s.events.push({ type: "ghosthunt" });
    }
  } else if (input !== NONE) {
    s.pac.next = input;
    s.pac.nextTtl = TURN_BUFFER_FRAMES;
  }

  if (s.phase !== "playing") {
    if (--s.phaseTimer > 0) return;
    if (s.phase === "ready") s.phase = "playing";
    else if (s.phase === "dying") {
      if (s.lives <= 0) {
        s.phase = "gameover";
        s.events.push({ type: "gameOver" });
      } else {
        s.life++;
        resetRound(s);
      }
    } else if (s.phase === "levelclear") {
      if (s.level >= MAZE_COUNT) {
        s.won = true;
        s.phase = "gameover";
        s.events.push({ type: "gameOver" });
      } else {
        s.level++;
        resetLevel(s);
      }
    }
    return;
  }

  s.roundFrame++;
  const pacBefore = tileOf(s.pac);
  const ghostsBefore = s.ghosts.map(tileOf);
  const frozen = s.freezeTimer > 0;
  if (s.freezeTimer > 0) s.freezeTimer--;
  if (s.shieldTimer > 0) s.shieldTimer--;
  if (s.surgeTimer > 0) s.surgeTimer--;
  if (s.speedTimer > 0) s.speedTimer--;
  if (s.magnetTimer > 0) s.magnetTimer--;

  movePacman(s);
  eat(s);
  updateModes(s);
  releaseGhosts(s);
  updateFruit(s);
  if (!frozen) for (const g of s.ghosts) moveGhost(s, g);
  checkCollisions(s, pacBefore, ghostsBefore);

  if (s.phase === "playing" && s.pelletsLeft === 0) {
    s.phase = "levelclear";
    s.phaseTimer = LEVEL_CLEAR_FRAMES;
    s.fruit.active = false;
    s.events.push({ type: "levelClear" });
  }
}

export const isFrightFlashing = (s: GameState, flashFrames: number) =>
  s.frightTimer > 0 && s.frightTimer < flashFrames && Math.floor(s.frightTimer / 12) % 2 === 0;

