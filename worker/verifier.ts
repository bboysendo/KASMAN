// Replay re-simulation runs here, not in the Worker: on Workers Free a request gets 10 ms of
// CPU, a Durable Object request gets 30 s (a normal game takes 0.5-2 s, a 3 h run ~12 s).
import { DurableObject } from "cloudflare:workers";
import { BUY_LIFE } from "../src/game/engine/constants";
import { decodeReplay, simulateReplay } from "../src/game/engine/replay";

export interface Verified {
  seed: number;
  /** Frames the client says it played; the wall-time check uses it. */
  frames: number;
  boughtLives: number;
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
  return {
    seed: replay.seed,
    frames: replay.frames,
    boughtLives: replay.inputs.filter(([, input]) => input === BUY_LIFE).length,
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
