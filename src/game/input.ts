import { DOWN, LEFT, NONE, RIGHT, UP } from "./engine/constants";

const KEYS: Record<string, number> = {
  ArrowUp: UP, KeyW: UP,
  ArrowLeft: LEFT, KeyA: LEFT,
  ArrowDown: DOWN, KeyS: DOWN,
  ArrowRight: RIGHT, KeyD: RIGHT,
};
const SWIPE_PX = 24;
// Standard gamepad mapping: d-pad buttons 12..15.
const PAD_BUTTONS: [number, number][] = [[12, UP], [14, LEFT], [13, DOWN], [15, RIGHT]];

export interface InputOptions {
  onPause: () => void;
  gamepadPauseButton: number;
}

/**
 * Collects direction presses from keyboard, swipes on `surface` and gamepads.
 * `poll()` returns the latest press since the previous poll, or NONE.
 * `held()` returns the direction currently held down, or NONE.
 */
export function createInput(surface: HTMLElement, opts: InputOptions) {
  let pending = NONE;
  const press = (dir: number) => (pending = dir);

  let heldKeys: number[] = []; // most recent last
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code in KEYS) heldKeys = heldKeys.filter((d) => d !== KEYS[e.code]);
  };
  const onBlur = () => (heldKeys = []);

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code in KEYS) {
      e.preventDefault();
      if (e.repeat) return;
      press(KEYS[e.code]);
      heldKeys = [...heldKeys.filter((d) => d !== KEYS[e.code]), KEYS[e.code]];
    } else if (e.code === "KeyP" || e.code === "Escape") {
      opts.onPause();
    }
  };

  let start: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => (start = { x: e.clientX, y: e.clientY });
  const onMove = (e: PointerEvent) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
    press(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : dy > 0 ? DOWN : UP);
    start = { x: e.clientX, y: e.clientY }; // allow chained swipes without lifting
  };
  const onUp = () => (start = null);

  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  surface.addEventListener("pointerdown", onDown);
  surface.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  let lastPadDir = NONE;
  let lastPause = false;
  function pollGamepad() {
    const pad = navigator.getGamepads?.().find((p) => p);
    if (!pad) return;
    let dir = NONE;
    for (const [button, d] of PAD_BUTTONS) if (pad.buttons[button]?.pressed) dir = d;
    const [ax = 0, ay = 0] = pad.axes;
    if (dir === NONE && Math.max(Math.abs(ax), Math.abs(ay)) > 0.5) {
      dir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? RIGHT : LEFT) : ay > 0 ? DOWN : UP;
    }
    if (dir !== NONE && dir !== lastPadDir) press(dir);
    lastPadDir = dir;
    const pause = !!pad.buttons[opts.gamepadPauseButton]?.pressed;
    if (pause && !lastPause) opts.onPause();
    lastPause = pause;
  }

  return {
    press,
    held: () => heldKeys.at(-1) ?? lastPadDir,
    poll() {
      pollGamepad();
      const dir = pending;
      pending = NONE;
      return dir;
    },
    dispose() {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      surface.removeEventListener("pointerdown", onDown);
      surface.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    },
  };
}
export type Input = ReturnType<typeof createInput>;
