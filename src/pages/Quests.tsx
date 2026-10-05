import { useState } from "react";
import XHandleForm from "../components/XHandleForm";
import { QUESTS } from "../lib/prices";
import { claimQuest } from "../lib/leaderboard";
import { useWallet } from "../lib/useWallet";
import { useStore } from "../store";

export default function Quests() {
  const wallet = useWallet();
  const xHandle = useStore((s) => s.xHandle);
  const claimed = useStore((s) => s.claimedQuests);
  const syncAccount = useStore((s) => s.syncAccount);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const claim = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      syncAccount(await claimQuest(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not claim this quest");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="font-arcade text-xl text-yellow-300 sm:text-2xl">QUESTS</h1>
      <p className="mt-4 text-white/60">Simple social tasks. Each one pays out once per wallet, after you've registered your X handle.</p>

      {!wallet.address ? (
        <div className="mt-8 flex items-center gap-3">
          <p className="text-sm text-white/50">Connect your wallet to see and claim quests.</p>
          <button
            type="button"
            disabled={wallet.busy}
            onClick={() => void wallet.connect()}
            className="rounded-lg border border-kas/50 px-4 py-2 text-sm hover:bg-kas/10 disabled:opacity-50"
          >
            {wallet.busy ? "Connecting..." : "Connect wallet"}
          </button>
        </div>
      ) : !xHandle ? (
        <div className="mt-8 flex justify-center">
          <XHandleForm />
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUESTS.map((quest) => {
            const done = claimed.includes(quest.id);
            return (
              <li key={quest.id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <h2 className="font-semibold">{quest.title}</h2>
                <p className="text-xs text-white/60">{quest.desc}</p>
                <p className="text-xs text-kas">Reward: {quest.rewardLabel}</p>
                <a
                  href={quest.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-white/20 py-2 text-center text-sm hover:bg-white/5"
                >
                  Open
                </a>
                <button
                  type="button"
                  disabled={done || busy === quest.id}
                  onClick={() => claim(quest.id)}
                  className="rounded-lg bg-kas py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50"
                >
                  {done ? "Claimed" : busy === quest.id ? "Claiming..." : "Claim reward"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
