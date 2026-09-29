export const FPS = 60;
/** Sub-units per tile. All positions are integers so the simulation is exactly reproducible. */
export const U = 120;

export const msToFrames = (ms: number) => Math.round((ms * FPS) / 1000);

// Order doubles as the ghost tie-break priority (classic: up, left, down, right).
export const UP = 0;
export const LEFT = 1;
export const DOWN = 2;
export const RIGHT = 3;
export const NONE = -1;
/** How far past a junction center (sub-units) a late turn is still accepted. ~2 frames at base speed. */
export const TURN_TOLERANCE = 26;
/** A pressed turn that cannot be taken yet is forgotten after this many frames (~1.5 tiles). */
export const TURN_BUFFER_FRAMES = 16;
/** Special input: use one bought extra life (recorded in the replay like a key press). */
export const BUY_LIFE = 4;
/** Cap on bought lives per game, so paid boosts cannot buy an endless run. */
export const MAX_BOUGHT_LIVES = 3;
export const DX = [0, -1, 0, 1];
export const DY = [-1, 0, 1, 0];
export const opposite = (dir: number) => (dir + 2) % 4;

export type Point = { x: number; y: number };

export const PAC_START: Point = { x: 21, y: 23 };
export const GHOST_HOME: Point = { x: 21, y: 13 };

export type GhostId = "blinky" | "pinky" | "inky" | "clyde";

export const GHOST_DEFS: ReadonlyArray<{
  id: GhostId;
  scatter: Point;
  spawn: Point;
  inHouse: boolean;
  releaseDots: number;
  releaseFrames: number;
}> = [
  { id: "blinky", scatter: { x: 42, y: 1 }, spawn: { x: 21, y: 11 }, inHouse: false, releaseDots: 0, releaseFrames: 0 },
  { id: "pinky", scatter: { x: 1, y: 1 }, spawn: { x: 20, y: 13 }, inHouse: true, releaseDots: 0, releaseFrames: msToFrames(700) },
  { id: "inky", scatter: { x: 42, y: 29 }, spawn: { x: 21, y: 13 }, inHouse: true, releaseDots: 8, releaseFrames: msToFrames(1200) },
  { id: "clyde", scatter: { x: 1, y: 29 }, spawn: { x: 22, y: 13 }, inHouse: true, releaseDots: 16, releaseFrames: msToFrames(2400) },
];
export const FORCE_RELEASE_FRAMES = msToFrames(12000);
/** Chasing ghosts avoid routes within this many tiles of another ghost, so they surround Kasman instead of trailing. */
export const AMBUSH_RADIUS = 4;
export const AMBUSH_WEIGHT = 3;

export const FRUITS = [
  { name: "Cherry", points: 100, color: 0xff2e59 },
  { name: "Strawberry", points: 300, color: 0xff5a7a },
  { name: "Orange", points: 500, color: 0xff9f1a },
  { name: "Apple", points: 700, color: 0x88d43f },
  { name: "Melon", points: 1000, color: 0x4fd1c5 },
  { name: "Galaxian", points: 2000, color: 0x7c83ff },
  { name: "Bell", points: 3000, color: 0xfde047 },
  { name: "Key", points: 5000, color: 0xf8fafc },
] as const;
export const fruitForLevel = (level: number) => FRUITS[Math.min(level, FRUITS.length) - 1];
export const MIN_FRUIT_DISTANCE = 8;

export const SCORE_PELLET = 10;
export const SCORE_POWER = 50;
export const SCORE_GHOST = 200;
export const MAX_GHOST_CHAIN = 3; // 200, 400, 800, 1600
export const STARTING_LIVES = 3;
export const BONUS_LIFE_STEP = 10000;

export const READY_FRAMES = msToFrames(1800);
export const DYING_FRAMES = msToFrames(1500);
export const LEVEL_CLEAR_FRAMES = msToFrames(2000);
export const FRIGHT_FLASH_FRAMES = msToFrames(2200);

// Speeds in sub-units per frame. 13/120 tile per frame = 6.5 tiles/s.
const PAC_BASE_SPEED = 13;
export const EATEN_SPEED = 36;

export function levelTuning(level: number) {
  const l = Math.min(level, 12) - 1;
  const pac = Math.round(PAC_BASE_SPEED * (1 + l * 0.02));
  // Ghosts gain on Kasman every level: level 5 on they are as fast as he is, level 9 faster.
  const ghost = Math.round(PAC_BASE_SPEED * 0.9 * (1 + l * 0.045));
  return {
    pacSpeed: pac,
    ghostSpeed: ghost,
    frightSpeed: Math.round(ghost * 0.55),
    tunnelSpeed: Math.round(ghost * 0.5),
    frightFrames: msToFrames(Math.max(1000, 6800 - (level - 1) * 700)),
    fruitDelayFrames: msToFrames(Math.max(5000, 12000 - (level - 1) * 350)),
    fruitVisibleFrames: msToFrames(Math.max(4200, 10000 - (level - 1) * 220)),
    elroy1: 1.03 + Math.min(0.1, l * 0.01),
    elroy2: 1.08 + Math.min(0.14, l * 0.015),
    /** Chance a frightened ghost flees Kasman at a junction instead of turning at random. */
    fleeChance: Math.min(1, 0.5 + l * 0.0625),
  };
}
export type LevelTuning = ReturnType<typeof levelTuning>;

type ModeStep = { mode: "scatter" | "chase"; frames: number };
const s = (mode: ModeStep["mode"], ms: number): ModeStep => ({ mode, frames: ms === Infinity ? Infinity : msToFrames(ms) });
const SCHEDULE_EARLY = [s("scatter", 7000), s("chase", 20000), s("scatter", 7000), s("chase", 20000), s("scatter", 5000), s("chase", 20000), s("scatter", 5000), s("chase", Infinity)];
const SCHEDULE_MID = [s("scatter", 5000), s("chase", 20000), s("scatter", 5000), s("chase", 20000), s("scatter", 5000), s("chase", Infinity)];
const SCHEDULE_LATE = [s("scatter", 5000), s("chase", 20000), s("scatter", 5000), s("chase", Infinity)];
const SCHEDULE_HARD = [s("scatter", 3000), s("chase", 30000), s("scatter", 1000), s("chase", Infinity)];
const SCHEDULE_FINAL = [s("scatter", 1000), s("chase", Infinity)];
/** Less scatter (ghosts backing off to their corners) every couple of levels. */
export const modeSchedule = (level: number) =>
  level <= 2 ? SCHEDULE_EARLY : level <= 4 ? SCHEDULE_MID : level <= 6 ? SCHEDULE_LATE : level <= 8 ? SCHEDULE_HARD : SCHEDULE_FINAL;

export function elroyThresholds(level: number, totalDots: number) {
  const [p1, p2] = level >= 7 ? [0.38, 0.2] : level >= 3 ? [0.32, 0.16] : [0.24, 0.12];
  return { phase1: Math.max(12, Math.floor(totalDots * p1)), phase2: Math.max(6, Math.floor(totalDots * p2)) };
}
