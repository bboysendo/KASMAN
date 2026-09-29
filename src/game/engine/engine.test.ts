import { describe, expect, it } from "vitest";
import {
  BUY_LIFE, GHOST_DEFS, GHOST_HOME, LEFT, MAX_BOUGHT_LIVES, NONE, PAC_START, RIGHT, TURN_BUFFER_FRAMES, U, UP, levelTuning, modeSchedule,
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
    expect(decodeReplay(btoa(JSON.stringify({ v: 6, seed: 1, frames: 1, inputs: [[0, 9]] })))).toBeNull();
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
      const input = i % 50 === 0 ? BUY_LIFE : NONE;
      rec.record(s, input);
      step(s, input);
    }
    expect(s.livesBought).toBe(MAX_BOUGHT_LIVES);
    expect(s.lives).toBe(3 + MAX_BOUGHT_LIVES);
    const re = simulateReplay(decodeReplay(encodeReplay(rec.replay))!);
    expect(re.lives).toBe(s.lives);
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
