import { useEffect, useState } from "react";
import { getPoolStatus, type PoolStatus } from "../lib/leaderboard";

/**
 * Progress toward this month's paid-games goal (`GAMES_GOAL` in `src/lib/prices.ts`): below it,
 * the pool is shown as locked and the shortfall is meant to carry into next month's pool; at or
 * above it, the pool is shown as unlocked for payout. Advisory only, like `PrizeDistribution` —
 * the covenant itself pays out on the owner's manual decision (`/api/month/:m/settlement`).
 */
export default function GamesGoalProgress({ className = "" }: { className?: string }) {
  const [status, setStatus] = useState<PoolStatus | null>(null);
  useEffect(() => {
    void getPoolStatus().then(setStatus, () => {});
  }, []);

  if (!status) return null;
  const { paidGames, gamesGoal } = status;
  const pct = Math.min(100, (paidGames / gamesGoal) * 100);
  const unlocked = paidGames >= gamesGoal;

  return (
    <div className={`rounded-xl border p-4 ${unlocked ? "border-kas/30 bg-kas/5" : "border-white/10 bg-white/[0.03]"} ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-widest text-white/50">Monthly Games Goal</p>
        <span className={`font-arcade shrink-0 text-[10px] ${unlocked ? "text-kas" : "text-yellow-300/80"}`}>
          {unlocked ? "UNLOCKED" : "LOCKED"}
        </span>
      </div>
      <p className="font-arcade mt-2 text-xl">
        {paidGames.toLocaleString()} <span className="text-sm text-white/40">/ {gamesGoal.toLocaleString()} paid games</span>
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full transition-all ${unlocked ? "bg-kas" : "bg-yellow-300/70"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-white/50">
        {unlocked
          ? "Goal reached — the pool is unlocked for this month's payout."
          : "Below the goal, the pool stays locked and carries over into next month's pool."}
      </p>
    </div>
  );
}
