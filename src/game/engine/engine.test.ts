import { describe, expect, it } from "vitest";
import {
  BUY_LIFE, GHOST_DEFS, GHOST_HOME, LEFT, MAGNET_RADIUS, MAX_BOUGHT_LIVES, MAX_SHIELD_PER_LEVEL, NONE, PAC_START, RIGHT,
  SCORE_GHOST, SCORE_PELLET, SPEED_MULT, SURGE_MULT, TURN_BUFFER_FRAMES, U, UP, USE_FREEZE, USE_GHOSTHUNT, USE_MAGNET, USE_SHIELD, USE_SPEED,
  USE_SURGE, levelTuning, modeSchedule,
} from "./constants";
import { createGame, step, tileOf, type GameState } from "./game";
import { H, MAZE_COUNT, POWER, W, mazeFor } from "./map";

const { isOpen } = mazeFor(1);
import { createRecorder, decodeReplay, encodeReplay, simulateReplay } from "./replay";

/** Plays with pseudo-random presses from its own LCG, recording a replay. */
function autoplay(seed: number, maxFrames: number) {
  const s = createGame(seed);
  const rec = createRecorder(seed);
  let r = 987654;
  while (s.frame < maxFrames && s.phase !== "gameover") {
    r = (r * 48271) % 2147483647;
    const input = r % 20 === 0 ? r % 4 : NONE;
    rec.record(s, input);
    step(s, input);
  }
  return { s, replay: rec.replay };
}

const runUntil = (s: GameState, cond: () => boolean, max = 20000) => {
  for (let i = 0; i < max && !cond(); i++) step(s);
};

/** Walks Blinky onto Kasman and waits out the life, then the ready timer for the next one. */
const loseLife = (s: GameState) => {
  const blinky = s.ghosts[0];
  blinky.x = s.pac.x + U / 4;
  blinky.y = s.pac.y;
  blinky.dir = LEFT;
  runUntil(s, () => s.phase === "dying", 60);
  runUntil(s, () => s.phase === "playing", 200);
};

describe("engine", () => {
  it("every maze: pellets reachable, tunnels wrap, actors start on open tiles", () => {
    let prevPower = Infinity;
    let prevTunnels = Infinity;
    let prevJunctions = Infinity;
    for (let level = 1; level <= MAZE_COUNT; level++) {
      const m = mazeFor(level);
      expect(m.rows.length).toBe(H);
      m.rows.forEach((row) => expect(row.length).toBe(W));
      const reachable = new Set(m.reachable.map((p) => p.y * W + p.x));
      const pellets = m.createPellets();
      pellets.forEach((p, i) => p && expect(reachable.has(i)).toBe(true));
      for (const y of m.tunnels) expect(reachable.has(y * W) && reachable.has(y * W + W - 1)).toBe(true);
      for (const p of [PAC_START, GHOST_HOME, ...GHOST_DEFS.map((d) => d.spawn)]) expect(reachable.has(p.y * W + p.x)).toBe(true);
      const power = pellets.filter((p) => p === POWER).length;
      expect(power).toBeLessThanOrEqual(prevPower);
      prevPower = power;
      expect(m.tunnels.length).toBeLessThanOrEqual(prevTunnels);
      prevTunnels = m.tunnels.length;
      // Harder = fewer places to change direction.
      const junctions = m.reachable.filter((p) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => m.isOpen(p.x + dx, p.y + dy)).length >= 3).length;
      expect(junctions, `level ${level} junctions`).toBeLessThan(prevJunctions);
      prevJunctions = junctions;
      // Level 1 is the legacy layout; newer mazes have no dead ends.
      if (level > 1) {
        for (const p of m.reachable) {
          const exits = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => m.isOpen(p.x + dx, p.y + dy)).length;
          expect(exits, `dead end at ${p.x},${p.y} (level ${level})`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("ghosts get faster and more aggressive every level", () => {
    const scatterFrames = (level: number) =>
      modeSchedule(level).filter((m) => m.mode === "scatter").reduce((n, m) => n + m.frames, 0);
    for (let level = 2; level <= MAZE_COUNT; level++) {
      const [a, b] = [levelTuning(level - 1), levelTuning(level)];
      expect(b.ghostSpeed / b.pacSpeed).toBeGreaterThanOrEqual(a.ghostSpeed / a.pacSpeed);
      expect(b.frightFrames, `level ${level} fright`).toBeLessThan(a.frightFrames);
      expect(b.elroy2).toBeGreaterThan(a.elroy2);
      expect(b.fleeChance).toBeGreaterThan(a.fleeChance);
      expect(scatterFrames(level)).toBeLessThanOrEqual(scatterFrames(level - 1));
    }
    const last = levelTuning(MAZE_COUNT);
    expect(last.ghostSpeed).toBeGreaterThan(last.pacSpeed);
  });

  it("is deterministic: same seed and inputs give identical state", () => {
    const a = autoplay(42, 30000).s;
    const b = autoplay(42, 30000).s;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.score).toBeGreaterThan(0);
  });

  it("replay re-simulates to the same score after an encode/decode round trip", () => {
    const { s, replay } = autoplay(7, 40000);
    const decoded = decodeReplay(encodeReplay(replay))!;
    expect(decoded).not.toBeNull();
    const re = simulateReplay(decoded);
    expect(re.score).toBe(s.score);
    expect(re.frame).toBe(s.frame);
    expect(re.phase).toBe(s.phase);
  });

  it("a run restored from its replay continues identically", () => {
    const full = autoplay(11, 6000);
    const half = autoplay(11, 3000);
    const s = simulateReplay(half.replay);
    const rec = createRecorder(s.seed, half.replay);
    const rest = full.replay.inputs.filter(([f]) => f >= s.frame);
    while (s.frame < full.s.frame && s.phase !== "gameover") {
      const input = rest.find(([f]) => f === s.frame)?.[1] ?? NONE;
      rec.record(s, input);
      step(s, input);
    }
    expect(JSON.stringify(s)).toBe(JSON.stringify(full.s));
    expect(rec.replay.inputs).toEqual(full.replay.inputs);
  });

  it("rejects malformed replays", () => {
    expect(decodeReplay("not base64 json")).toBeNull();
    expect(decodeReplay(btoa(JSON.stringify({ v: 15, seed: 1, frames: 1, inputs: [[0, 11]] })))).toBeNull();
  });

  it("eats pellets while moving", () => {
    const s = createGame(1);
    runUntil(s, () => s.phase === "playing");
    step(s, UP);
    runUntil(s, () => s.score > 0, 200);
    expect(s.score).toBe(10);
    expect(s.pelletsLeft).toBe(s.pelletsTotal - 1);
  });

  it("stops at walls and turns with a buffered input", () => {
    const s = createGame(1);
    runUntil(s, () => s.phase === "playing");
    step(s); // start facing a wall on the left
    expect(s.pac.moving).toBe(false);
    step(s, RIGHT);
    step(s);
    expect(s.pac.moving).toBe(true);
    expect(s.pac.dir).toBe(RIGHT);
  });

  it("takes a turn pressed slightly after passing the junction", () => {
    const s = createGame(1);
    runUntil(s, () => s.phase === "playing");
    step(s, RIGHT);
    // Walk right until just past the center of a tile with an opening upward.
    runUntil(s, () => {
      const t = tileOf(s.pac);
      return s.pac.x > t.x * U && isOpen(t.x, t.y - 1);
    }, 2000);
    const t = tileOf(s.pac);
    step(s, UP);
    expect(s.pac.dir).toBe(UP);
    expect(s.pac.x).toBe(t.x * U);
  });

  it("bought lives are capped per game and replay verbatim", () => {
    const s = createGame(9);
    const rec = createRecorder(s.seed);
    for (let i = 0; i < 300; i++) {
      const input = i % 20 === 0 ? BUY_LIFE : NONE; // 15 attempts, more than the cap
      rec.record(s, input);
      step(s, input);
    }
    expect(MAX_BOUGHT_LIVES).toBe(10);
    expect(s.livesBought).toBe(MAX_BOUGHT_LIVES);
    expect(s.lives).toBe(3 + MAX_BOUGHT_LIVES);
    const re = simulateReplay(decodeReplay(encodeReplay(rec.replay))!);
    expect(re.lives).toBe(s.lives);
  });

  it("potions are capped per level and replay verbatim", () => {
    const s = createGame(9);
    const rec = createRecorder(s.seed);
    for (let i = 0; i < 300; i++) {
      const input =
        i % 50 === 0 ? USE_SHIELD
        : i % 50 === 15 ? USE_SURGE
        : i % 50 === 25 ? USE_FREEZE
        : i % 50 === 30 ? USE_SPEED
        : i % 50 === 35 ? USE_MAGNET
        : i % 50 === 40 ? USE_GHOSTHUNT
        : NONE;
      rec.record(s, input);
      step(s, input);
    }
    expect(s.shieldBought).toBeLessThanOrEqual(MAX_SHIELD_PER_LEVEL);
    expect(s.freezeBought).toBeLessThanOrEqual(MAX_SHIELD_PER_LEVEL);
    const re = simulateReplay(decodeReplay(encodeReplay(rec.replay))!);
    expect(re.shieldBought).toBe(s.shieldBought);
    expect(re.freezeBought).toBe(s.freezeBought);
    expect(re.surgeBought).toBe(s.surgeBought);
    expect(re.speedBought).toBe(s.speedBought);
    expect(re.magnetBought).toBe(s.magnetBought);
    expect(re.ghosthuntBought).toBe(s.ghosthuntBought);
  });

  it("renews each potion's cap when the level clears, but not on death", () => {
    const s = createGame(9);
    runUntil(s, () => s.phase === "playing");
    for (let i = 0; i < MAX_SHIELD_PER_LEVEL; i++) step(s, USE_SHIELD);
    expect(s.shieldBought).toBe(MAX_SHIELD_PER_LEVEL);
    step(s, USE_SHIELD); // already at the cap: has no further effect
    expect(s.shieldBought).toBe(MAX_SHIELD_PER_LEVEL);

    // Losing a life (same level) does not renew the cap.
    s.lives = 2;
    s.phase = "dying";
    s.phaseTimer = 1;
    runUntil(s, () => s.phase === "playing");
    expect(s.shieldBought).toBe(MAX_SHIELD_PER_LEVEL);

    // Clearing the level does renew it.
    s.pelletsLeft = 0;
    runUntil(s, () => s.level === 2);
    expect(s.shieldBought).toBe(0);
    runUntil(s, () => s.phase === "playing");
    step(s, USE_SHIELD);
    expect(s.shieldBought).toBe(1);
  });

  it("Ghost Shield makes Kasman immune to a ghost hit", () => {
    const s = createGame(3);
    runUntil(s, () => s.phase === "playing");
    step(s, USE_SHIELD);
    expect(s.shieldTimer).toBeGreaterThan(0);
    const blinky = s.ghosts[0];
    blinky.x = s.pac.x + U / 4;
    blinky.y = s.pac.y;
    blinky.dir = LEFT;
    const lives = s.lives;
    runUntil(s, () => s.phase === "dying", 60);
    expect(s.lives).toBe(lives);
    expect(s.phase).toBe("playing");
  });

  it("Score Surge doubles points earned while active", () => {
    const s = createGame(1);
    runUntil(s, () => s.phase === "playing");
    step(s, USE_SURGE);
    expect(s.surgeTimer).toBeGreaterThan(0);
    step(s, UP);
    runUntil(s, () => s.score > 0, 200);
    expect(s.score).toBe(SCORE_PELLET * SURGE_MULT);
  });

  it("Ghost Freeze stops every ghost from moving", () => {
    const s = createGame(3);
    runUntil(s, () => s.phase === "playing");
    step(s, USE_FREEZE);
    expect(s.freezeTimer).toBeGreaterThan(0);
    const before = s.ghosts.map((g) => ({ x: g.x, y: g.y }));
    for (let i = 0; i < 30; i++) step(s);
    expect(s.ghosts.map((g) => ({ x: g.x, y: g.y }))).toEqual(before);
  });

  it("Speed Coffee moves Kasman faster while active", () => {
    const boosted = createGame(1);
    runUntil(boosted, () => boosted.phase === "playing");
    step(boosted, USE_SPEED);
    expect(boosted.speedTimer).toBeGreaterThan(0);
    const boostedBefore = boosted.pac.y;
    step(boosted, UP);
    const boostedMoved = boostedBefore - boosted.pac.y;

    const base = createGame(1);
    runUntil(base, () => base.phase === "playing");
    const baseBefore = base.pac.y;
    step(base, UP);
    const baseMoved = baseBefore - base.pac.y;

    expect(boostedMoved).toBeGreaterThan(baseMoved);
    expect(boostedMoved).toBe(Math.round(baseMoved * SPEED_MULT));
  });

  it("Ghost Magnet pulls in pellets within its radius but not beyond it", () => {
    const s = createGame(1);
    runUntil(s, () => s.phase === "playing");
    const t = tileOf(s.pac);
    const near = (t.y - MAGNET_RADIUS) * W + t.x; // just inside radius
    const far = (t.y - MAGNET_RADIUS - 1) * W + t.x; // just outside radius
    s.pellets[near] = 1;
    s.pellets[far] = 1;
    step(s, USE_MAGNET);
    expect(s.magnetTimer).toBeGreaterThan(0);
    expect(s.pellets[near]).toBe(0); // pulled in even though it is not the tile Kasman is on
    expect(s.pellets[far]).toBe(1); // outside the radius: untouched
  });

  it("Ghost Magnet also reaches fruit within its radius", () => {
    const s = createGame(1);
    runUntil(s, () => s.phase === "playing");
    const t = tileOf(s.pac);
    s.fruit = { active: true, x: t.x, y: t.y - MAGNET_RADIUS, timer: 999, spawns: 1 };
    step(s, USE_MAGNET);
    expect(s.magnetTimer).toBeGreaterThan(0);
    expect(s.fruit.active).toBe(false);
  });

  it("Ghost Hunt frightens every active ghost, same as a power pellet, so Kasman can eat them", () => {
    const s = createGame(3);
    runUntil(s, () => s.phase === "playing");
    step(s, USE_GHOSTHUNT);
    expect(s.ghosthuntBought).toBe(1);
    expect(s.frightTimer).toBeGreaterThan(0);
    // Blinky starts active (not in the house), so it's reliably frightened by this same step;
    // a ghost released from the house on this exact frame is a pre-existing corner case shared
    // with power pellets (both frighten before releaseGhosts() runs later in step()).
    expect(s.ghosts[0].frightened).toBe(true);

    const blinky = s.ghosts[0];
    blinky.x = s.pac.x + U / 4;
    blinky.y = s.pac.y;
    blinky.dir = LEFT;
    const before = s.score;
    runUntil(s, () => s.ghosts[0].state === "eaten", 60);
    expect(s.score - before).toBe(SCORE_GHOST);
  });

  it("spawns `level` Puzzle Shards from the start, on reachable tiles", () => {
    const s = createGame(5);
    expect(s.shards).toHaveLength(1); // level 1
    expect(s.shards[0].active).toBe(true);
    const m = mazeFor(1);
    const tiles = new Set<string>();
    for (const shard of s.shards) {
      expect(m.reachable.some((p) => p.x === shard.x && p.y === shard.y)).toBe(true);
      expect(m.isTunnel(shard.x, shard.y)).toBe(false);
      expect(shard.x === PAC_START.x && shard.y === PAC_START.y).toBe(false);
      tiles.add(`${shard.x},${shard.y}`);
    }
    expect(tiles.size).toBe(s.shards.length); // distinct tiles, no overlap
  });

  it("offers 2 Puzzle Shards at level 2, 3 at level 3, and so on", () => {
    const s = createGame(7);
    s.pellets.fill(0);
    s.pelletsLeft = 0;
    runUntil(s, () => s.level === 2);
    expect(s.shards).toHaveLength(2);
    s.pellets.fill(0);
    s.pelletsLeft = 0;
    runUntil(s, () => s.level === 3);
    expect(s.shards).toHaveLength(3);
  });

  it("collecting a Puzzle Shard marks it and stops it from respawning this level", () => {
    const s = createGame(5);
    runUntil(s, () => s.phase === "playing");
    // Teleport Kasman onto the (only, at level 1) shard's tile; eat() picks it up on the very next step.
    s.pac.x = s.shards[0].x * U;
    s.pac.y = s.shards[0].y * U;
    step(s);
    expect(s.shards[0].active).toBe(false);
    expect(s.shards[0].collected).toBe(true);
    expect(s.shardsCollected).toBe(1);
    expect(s.events.some((e) => e.type === "shardCollected")).toBe(true);

    // Losing a life re-rolls an uncollected shard, but not once it's already collected.
    if (s.lives > 1) {
      loseLife(s);
      expect(s.shards[0].active).toBe(false);
    }
  });

  it("replays Puzzle Shard pickups verbatim", () => {
    // Whatever shardsCollected ends up being from real (pseudo-random) play, the replay must
    // reproduce it exactly — teleporting Kasman onto a shard (as the test above does) is not
    // itself a recorded input, so it wouldn't survive an encode/decode round trip.
    const { s, replay } = autoplay(5, 30000);
    const re = simulateReplay(decodeReplay(encodeReplay(replay))!);
    expect(re.shardsCollected).toBe(s.shardsCollected);
  });

  it("re-rolls an uncollected Puzzle Shard on every life, not just once", () => {
    const s = createGame(3);
    runUntil(s, () => s.phase === "playing");
    expect(s.shards[0].active).toBe(true);
    if (s.lives > 1) {
      // Lose that life without collecting it: the next life still gets its own shard,
      // so the player isn't stuck with only one chance.
      loseLife(s);
      expect(s.shardsCollected).toBe(0);
      expect(s.shards[0].active).toBe(true);
    }
  });

  it("forgets a buffered turn that cannot be taken soon", () => {
    const s = createGame(1);
    runUntil(s, () => s.phase === "playing");
    step(s, RIGHT);
    step(s, UP);
    for (let i = 0; i < TURN_BUFFER_FRAMES; i++) step(s);
    expect(s.pac.next === NONE || s.pac.dir === UP).toBe(true);
  });

  it("loses a life on ghost contact and ends the game at zero lives", () => {
    const s = createGame(3);
    runUntil(s, () => s.phase === "playing");
    const blinky = s.ghosts[0];
    blinky.x = s.pac.x + U / 4;
    blinky.y = s.pac.y;
    blinky.dir = LEFT;
    runUntil(s, () => s.phase === "dying", 60);
    expect(s.lives).toBe(2);
    s.lives = 0;
    runUntil(s, () => s.phase === "gameover", 200);
    expect(s.phase).toBe("gameover");
  });

  it("a chasing ghost follows the real maze path to Kasman", () => {
    const s = createGame(3);
    runUntil(s, () => s.phase === "playing");
    const m = mazeFor(1);
    const far = m.reachable[m.reachable.length - 1]; // BFS order: farthest tile from Kasman's start
    const schedule = modeSchedule(1);
    s.modeIndex = schedule.length - 1;
    s.mode = "chase";
    s.ghosts = [{ ...s.ghosts[0], x: far.x * U, y: far.y * U }];
    const tiles = m.reachable.length; // generous bound: a looping ghost would never arrive
    const frames = Math.ceil((tiles * U) / levelTuning(1).ghostSpeed / 4);
    runUntil(s, () => s.phase === "dying", frames);
    expect(s.phase).toBe("dying");
  });

  it("eats frightened ghosts for chained points and sends them home", () => {
    const s = createGame(3);
    runUntil(s, () => s.phase === "playing");
    const g = s.ghosts[0];
    g.frightened = true;
    s.frightTimer = 600;
    g.x = s.pac.x + U / 4;
    g.y = s.pac.y;
    const before = s.score;
    runUntil(s, () => g.state === "eaten", 60);
    expect(s.score - before).toBe(200);
    runUntil(s, () => g.state === "active", 2000);
    expect(tileOf(g)).toEqual(GHOST_HOME);
  });

  it("clears the level and advances when all pellets are eaten", () => {
    const s = createGame(5);
    runUntil(s, () => s.phase === "playing");
    s.pellets.fill(0);
    s.pelletsLeft = 0;
    step(s);
    expect(s.phase).toBe("levelclear");
    runUntil(s, () => s.level === 2, 300);
    expect(s.pelletsLeft).toBe(s.pelletsTotal);
    expect(s.phase).toBe("ready");
    expect(s.pellets).toEqual(mazeFor(2).createPellets());
    expect(s.pellets).not.toEqual(mazeFor(1).createPellets());
  });

  it("clearing the last level wins and ends the game", () => {
    const s = createGame(5);
    for (let level = 1; level <= MAZE_COUNT; level++) {
      runUntil(s, () => s.phase === "playing");
      expect(s.level).toBe(level);
      s.pellets.fill(0);
      s.pelletsLeft = 0;
      step(s);
      runUntil(s, () => s.phase !== "levelclear", 300);
    }
    expect(s.phase).toBe("gameover");
    expect(s.won).toBe(true);
    expect(s.level).toBe(MAZE_COUNT);
  });
});
