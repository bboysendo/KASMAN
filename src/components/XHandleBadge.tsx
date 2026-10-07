import { useState } from "react";
import { useStore } from "../store";
import XHandleForm from "./XHandleForm";

/**
 * Shows the connected wallet's registered X handle with a "Change" button that opens a modal to
 * update it (same `XHandleForm` used for first-time registration, prefilled with the current
 * handle). Renders nothing until a handle is registered (the game's own flows prompt for that).
 */
export default function XHandleBadge({ onChanged }: { onChanged?: () => void }) {
  const xHandle = useStore((s) => s.xHandle);
  const [editing, setEditing] = useState(false);

  if (!xHandle) return null;

  return (
    <>
      <div className="ml-auto flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] py-1 pl-3 pr-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">X</span>
        <span className="font-mono text-sm text-kas">@{xHandle}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/70 hover:border-white/30 hover:text-white"
        >
          Change
        </button>
      </div>

      {editing && (
        <>
          <div className="fixed inset-0 z-50 bg-black/70" aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="x-handle-title"
            className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-kas/40 bg-[#0a1118] p-6"
          >
            <h2 id="x-handle-title" className="sr-only">Change X handle</h2>
            <XHandleForm
              current={xHandle}
              onDone={() => {
                setEditing(false);
                onChanged?.();
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        </>
      )}
    </>
  );
}
