import { useState } from "react";
import { setXHandle } from "../lib/leaderboard";
import { X_HANDLE_RE } from "../lib/prices";
import { useStore } from "../store";

/**
 * Registers or updates the connected wallet's X (Twitter) handle, required before playing or
 * claiming quests. The server enforces it's unique, case-insensitively (worker/index.ts), and
 * surfaces that as `error` here. `current` prefills it for a "change handle" flow instead of
 * first-time registration; `onCancel` adds a Cancel button next to Save, for use inside a modal.
 */
export default function XHandleForm({ current, onDone, onCancel }: { current?: string | null; onDone?: () => void; onCancel?: () => void }) {
  const syncAccount = useStore((s) => s.syncAccount);
  const [value, setValue] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const handle = value.trim().replace(/^@/, "");
    if (!X_HANDLE_RE.test(handle)) {
      setError("Enter a valid X handle: up to 15 letters, digits or underscores, no spaces.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      syncAccount(await setXHandle(handle));
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your X handle");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col items-center gap-3">
      <label htmlFor="x-handle" className="text-sm text-white/70">
        {current ? "Update your X (Twitter) handle" : "Register your X (Twitter) handle to play"}
      </label>
      <div className="flex w-full items-center gap-2 rounded-lg border border-white/20 bg-black/40 px-3 py-2 focus-within:border-kas">
        <span className="text-white/40">@</span>
        <input
          id="x-handle"
          required
          autoFocus
          maxLength={15}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\w]/g, ""))}
          placeholder="username"
          className="w-full bg-transparent text-center outline-none"
        />
      </div>
      <p className="text-center text-xs leading-relaxed text-yellow-300/90">
        ⚠️ Your X handle must be real and reachable. Winners will be contacted directly via DM to this profile before sending out the Monthly Prize
        Pool or matching NFTs. Fake or unreachable handles will forfeit their rewards.
        <br />
        <span className="text-white/40">(Staking $KASM rewards can still be claimed either way.)</span>
      </p>
      <div className="flex w-full gap-3">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className="flex-1 rounded-lg border border-white/15 px-4 py-3 text-sm text-white/70 hover:bg-white/5 disabled:opacity-40">
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!value.trim() || saving}
          className="font-arcade flex-1 rounded-lg bg-kas px-6 py-3 text-sm text-black shadow-[0_0_24px] shadow-kas/60 hover:brightness-110 disabled:opacity-60"
        >
          {saving ? "SAVING..." : current ? "SAVE CHANGES" : "SAVE X HANDLE"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
