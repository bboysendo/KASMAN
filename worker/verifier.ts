// Replay re-simulation runs here, not in the Worker: on Workers Free a request gets 10 ms of
// CPU, a Durable Object request gets 30 s (a normal game takes 0.5-2 s, a 3 h run ~12 s).
import { DurableObject } from "cloudflare:workers";
import { BUY_LIFE, USE_FREEZE, USE_GHOSTHUNT, USE_MAGNET, USE_SHIELD, USE_SPEED, USE_SURGE } from "../src/game/engine/constants";
import { decodeReplay, simulateReplay } from "../src/game/engine/replay";

export interface Verified {
  seed: number;
  /** Frames the client says it played; the wall-time check uses it. */
  frames: number;
  boughtLives: number;
  shieldUsed: number;
  freezeUsed: number;
  surgeUsed: number;
  speedUsed: number;
  magnetUsed: number;
  ghosthuntUsed: number;
  /** Puzzle Shards picked up this game, across every level. */
  shardsCollected: number;
  score: number;
  level: number;
  /** Frame the simulation ended on. */
  frame: number;
  won: boolean;
}

/** Re-simulates an encoded replay. Null when it cannot be decoded. */
export function verifyReplay(encoded: string): Verified | null {
  const replay = decodeReplay(encoded);
  if (!replay) return null;
  const s = simulateReplay(replay);
  const count = (input: number) => replay.inputs.filter(([, i]) => i === input).length;
  return {
    seed: replay.seed,
    frames: replay.frames,
    boughtLives: count(BUY_LIFE),
    shieldUsed: count(USE_SHIELD),
    freezeUsed: count(USE_FREEZE),
    surgeUsed: count(USE_SURGE),
    speedUsed: count(USE_SPEED),
    magnetUsed: count(USE_MAGNET),
    ghosthuntUsed: count(USE_GHOSTHUNT),
    shardsCollected: s.shardsCollected,
    score: s.score,
    level: s.level,
    frame: s.frame,
    won: s.won,
  };
}

export class Verifier extends DurableObject {
  verify(encoded: string) {
    return verifyReplay(encoded);
  }
}
