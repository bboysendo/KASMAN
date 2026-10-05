import { BUY_LIFE, NONE, USE_FREEZE, USE_GHOSTHUNT, USE_MAGNET, USE_SHIELD, USE_SPEED, USE_SURGE } from "./constants";
import { createGame, step, type GameState } from "./game";

/** Everything needed to re-simulate a run: seed plus every direction press and its frame. Bump `v` when the simulation changes. */
export interface Replay {
  v: 15;
  seed: number;
  inputs: [frame: number, dir: number][];
  frames: number;
}

const MAX_FRAMES = 60 * 60 * 60 * 3; // 3 hours of play

/** Pass `from` to keep recording a run restored with `simulateReplay(from)`. */
export function createRecorder(seed: number, from?: Replay) {
  const replay: Replay = from ? { ...from, inputs: [...from.inputs] } : { v: 15, seed, inputs: [], frames: 0 };
  return {
    replay,
    /** Call right before each `step(state, input)`. */
    record(state: GameState, input: number) {
      if (state.phase === "gameover") return;
      if (input !== NONE) replay.inputs.push([state.frame, input]);
      replay.frames = state.frame + 1;
    },
  };
}

/** Re-runs a replay from scratch. Returns the final state (score, level, phase). */
export function simulateReplay(replay: Replay, maxFrames = MAX_FRAMES): GameState {
  const s = createGame(replay.seed);
  let i = 0;
  const end = Math.min(replay.frames, maxFrames);
  while (s.frame < end && s.phase !== "gameover") {
    let input = NONE;
    // Inputs are recorded with the frame number *before* the step that consumed them.
    while (i < replay.inputs.length && replay.inputs[i][0] === s.frame) input = replay.inputs[i++][1];
    step(s, input);
  }
  return s;
}

export const encodeReplay = (r: Replay) => btoa(JSON.stringify(r)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function decodeReplay(text: string): Replay | null {
  try {
    const r = JSON.parse(atob(text.replace(/-/g, "+").replace(/_/g, "/")));
    const valid =
      r?.v === 15 &&
      Number.isInteger(r.seed) &&
      Number.isInteger(r.frames) &&
      Array.isArray(r.inputs) &&
      r.inputs.every(
        (e: unknown) =>
          Array.isArray(e) &&
          Number.isInteger(e[0]) &&
          [0, 1, 2, 3, BUY_LIFE, USE_SHIELD, USE_FREEZE, USE_SURGE, USE_SPEED, USE_MAGNET, USE_GHOSTHUNT].includes(e[1] as number),
      );
    return valid ? r : null;
  } catch {
    return null;
  }
}
