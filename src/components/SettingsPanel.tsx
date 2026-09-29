import { useStore } from "../store";

export default function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSettings);
  const toggle = (key: "muted" | "music" | "reducedMotion" | "largeHud", label: string) => (
    <label className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <input type="checkbox" className="size-4 accent-kas" checked={settings[key]} onChange={(e) => set({ [key]: e.target.checked })} />
    </label>
  );

  return (
    <details className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
      <summary className="cursor-pointer select-none font-semibold">Settings</summary>
      <div className="mt-4 flex flex-col gap-3">
        <label className="flex items-center justify-between gap-4">
          <span>Volume</span>
          <input
            type="range" min={0} max={1} step={0.05} className="accent-kas"
            value={settings.volume}
            onChange={(e) => set({ volume: Number(e.target.value) })}
          />
        </label>
        {toggle("muted", "Mute")}
        {toggle("music", "Music")}
        {toggle("reducedMotion", "Reduced motion")}
        {toggle("largeHud", "Large HUD text")}
        <label className="flex items-center justify-between gap-4">
          <span>Touch controls</span>
          <select
            className="rounded bg-white/10 px-2 py-1"
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
            type="number" min={0} max={17} className="w-16 rounded bg-white/10 px-2 py-1"
            value={settings.gamepadPauseButton}
            onChange={(e) => set({ gamepadPauseButton: Math.max(0, Math.min(17, Number(e.target.value) || 0)) })}
          />
        </label>
        <p className="text-xs text-white/40">Keys: arrows / WASD to move, P or Esc to pause. Color palettes live in the Marketplace (free).</p>
      </div>
    </details>
  );
}
