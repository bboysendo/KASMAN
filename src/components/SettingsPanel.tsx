import { useEffect, useState } from "react";
import { DEFAULT_KEYMAP, type Keymap } from "../store";
import { useStore } from "../store";

const KEY_LABELS: [key: keyof Keymap, label: string][] = [
  ["up", "Up"], ["down", "Down"], ["left", "Left"], ["right", "Right"],
  ["shield", "Ghost Shield"], ["freeze", "Ghost Freeze"], ["surge", "Score Surge"],
  ["speed", "Speed Coffee"], ["magnet", "Ghost Magnet"], ["ghosthunt", "Ghost Hunt"],
  ["life", "+1 Life"],
];
/** "ArrowUp" -> "Arrow Up", "KeyW" -> "W", "Digit1" -> "1", "Numpad1" -> "PAD1" */
const keyText = (code: string) =>
  code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "PAD").replace(/([a-z])([A-Z])/g, "$1 $2");

/** `compact` shrinks it (single-column keybindings, no secondary copy) so it fits a narrow sidebar without horizontal overflow. */
export default function SettingsPanel({ compact = false }: { compact?: boolean }) {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSettings);
  const [listening, setListening] = useState<keyof Keymap | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === "Escape") return setListening(null);
      const taken = (Object.keys(settings.keymap) as (keyof Keymap)[]).find((k) => k !== listening && settings.keymap[k] === e.code);
      if (!taken) set({ keymap: { ...settings.keymap, [listening]: e.code } });
      setListening(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening, settings.keymap, set]);

  const toggle = (key: "muted" | "reducedMotion" | "largeHud", label: string) => (
    <label className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <input type="checkbox" className="size-4 accent-kas" checked={settings[key]} onChange={(e) => set({ [key]: e.target.checked })} />
    </label>
  );

  return (
    <details className={`min-w-0 rounded-xl border border-white/10 bg-white/[0.03] ${compact ? "p-2 text-xs" : "p-4 text-sm"}`}>
      <summary className="cursor-pointer select-none font-semibold">Settings</summary>
      <div className={`flex min-w-0 flex-col ${compact ? "mt-2 gap-2" : "mt-4 gap-3"}`}>
        <label className="flex items-center justify-between gap-4">
          <span>Music volume</span>
          <input
            type="range" min={0} max={1} step={0.05} className="accent-kas"
            value={settings.musicVolume}
            onChange={(e) => set({ musicVolume: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>SFX volume</span>
          <input
            type="range" min={0} max={1} step={0.05} className="accent-kas"
            value={settings.sfxVolume}
            onChange={(e) => set({ sfxVolume: Number(e.target.value) })}
          />
        </label>
        {toggle("muted", "Mute all")}
        {toggle("reducedMotion", "Reduced motion")}
        {toggle("largeHud", "Large HUD text")}
        <label className="flex items-center justify-between gap-4">
          <span>Touch controls</span>
          <select
            className={`min-w-0 rounded bg-white/10 ${compact ? "px-1 py-0.5" : "px-2 py-1"}`}
            value={settings.mobileControls}
            onChange={(e) => set({ mobileControls: e.target.value as "swipe" | "buttons" })}
          >
            <option value="buttons">D-pad + swipe</option>
            <option value="swipe">Swipe only</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>Gamepad pause button</span>
          <input
            type="number" min={0} max={17} className={`w-14 rounded bg-white/10 ${compact ? "px-1 py-0.5" : "px-2 py-1"}`}
            value={settings.gamepadPauseButton}
            onChange={(e) => set({ gamepadPauseButton: Math.max(0, Math.min(17, Number(e.target.value) || 0)) })}
          />
        </label>
        <div className="min-w-0">
          <div className="flex items-center justify-between">
            <span>Keybindings</span>
            {listening && <span className={`text-kas ${compact ? "" : "text-xs"}`}>Press a key... (Esc to cancel)</span>}
          </div>
          {!compact && <p className="mt-1 text-xs text-white/40">Arrows and WASD always move; this adds one more key per action.</p>}
          <ul className={`grid ${compact ? "mt-1 grid-cols-1 gap-1" : "mt-2 grid-cols-2 gap-1.5"}`}>
            {KEY_LABELS.map(([key, label]) => (
              <li key={key} className={`flex min-w-0 items-center justify-between gap-2 rounded bg-white/5 ${compact ? "px-1.5 py-0.5" : "px-2 py-1"}`}>
                <span className="truncate text-white/70">{label}</span>
                <button
                  type="button"
                  onClick={() => setListening(key)}
                  className={`shrink-0 rounded border font-mono ${compact ? "px-1 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"} ${listening === key ? "border-kas text-kas" : "border-white/20 hover:border-kas/60"}`}
                >
                  {keyText(settings.keymap[key])}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => set({ keymap: DEFAULT_KEYMAP })} className={`mt-1.5 text-white/40 hover:text-kas hover:underline ${compact ? "" : "text-xs"}`}>
            Reset to defaults
          </button>
        </div>
        {!compact && <p className="text-xs text-white/40">P or Esc to pause. Color palettes live in the Shop (free).</p>}
      </div>
    </details>
  );
}
