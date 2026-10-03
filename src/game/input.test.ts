import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOWN, NONE, UP } from "./engine/constants";
import { createInput } from "./input";
import { DEFAULT_KEYMAP, type Keymap } from "../store";

// Minimal DOM stand-ins: createInput only needs window listeners and a surface with listeners.
class HTMLInputElement {}
class HTMLSelectElement {}

type Listener = (e: unknown) => void;
let listeners: Record<string, Listener[]> = {};

function press(code: string) {
  const e = { code, repeat: false, target: {}, preventDefault: () => {} };
  for (const l of listeners.keydown ?? []) l(e);
}
function release(code: string) {
  for (const l of listeners.keyup ?? []) l({ code });
}

beforeEach(() => {
  listeners = {};
  vi.stubGlobal("HTMLInputElement", HTMLInputElement);
  vi.stubGlobal("HTMLSelectElement", HTMLSelectElement);
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: Listener) => ((listeners[type] ??= []).push(fn)),
    removeEventListener: () => {},
  });
});
afterEach(() => vi.unstubAllGlobals());

const surface = { addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;

describe("createInput keybindings", () => {
  it("applies a rebound movement key without recreating the input", () => {
    const keymap: Keymap = { ...DEFAULT_KEYMAP, up: "KeyI" };
    const input = createInput(surface, { onPause: () => {}, gamepadPauseButton: 9, getKeymap: () => keymap });

    press("KeyI");
    expect(input.poll()).toBe(UP);

    // Settings changed mid-run: the new key works, the old custom one stops being a binding.
    keymap.up = "KeyK";
    press("KeyK");
    expect(input.poll()).toBe(UP);
    press("KeyI");
    expect(input.poll()).toBe(NONE);

    keymap.down = "KeyJ";
    press("KeyJ");
    expect(input.poll()).toBe(DOWN);
    input.dispose();
  });

  it("applies a rebound action key without recreating the input", () => {
    const keymap: Keymap = { ...DEFAULT_KEYMAP };
    const onAction = vi.fn();
    const input = createInput(surface, { onPause: () => {}, gamepadPauseButton: 9, getKeymap: () => keymap, onAction });

    press("Digit1");
    expect(onAction).toHaveBeenLastCalledWith("shield");

    keymap.shield = "KeyQ";
    onAction.mockClear();
    press("Digit1");
    expect(onAction).not.toHaveBeenCalled();
    press("KeyQ");
    expect(onAction).toHaveBeenCalledWith("shield");
    input.dispose();
  });

  it("keeps WASD and arrows moving after a rebind", () => {
    const keymap: Keymap = { ...DEFAULT_KEYMAP, up: "KeyI" };
    const input = createInput(surface, { onPause: () => {}, gamepadPauseButton: 9, getKeymap: () => keymap });

    press("ArrowUp");
    expect(input.poll()).toBe(UP);
    press("KeyS");
    expect(input.poll()).toBe(DOWN);
    release("KeyS");
    input.dispose();
  });
});
