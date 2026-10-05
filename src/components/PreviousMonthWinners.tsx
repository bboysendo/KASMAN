import { useEffect, useState } from "react";
import { getMonthlyLeaderboard, getPoolStatus, type PlayerEntry, type PoolStatus } from "../lib/leaderboard";
import { KAS_TICKER } from "../lib/bonusTokens";
import { previousMonth, prizeSplit } from "../lib/prices";

const MEDALS = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context): nothing else to fall back to.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/60 hover:bg-white/10 hover:text-white"
      title="Copy wallet address"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/**
 * Previous month's Top 3, so the owner can pay them by hand (see `DESPLIEGUE.md` section 7). The
 * KAS amount is an estimate: `KasmanPool.sil` pays the whole pool to a single address the owner
 * chooses at payout time, so the 50/30/20 split per winner (`prizeSplit`, `PrizeDistribution`)
 * isn't on chain — this reads last month's pool balance, which goes to 0 once it's actually been
 * withdrawn for payout. Mirrors `/api/month/:m/settlement`'s `rollover` rule (worker/index.ts):
 * below the games goal, nothing was meant to be paid out, so no KAS estimate is shown either.
 */
export default function PreviousMonthWinners({ className = "" }: { className?: string }) {
  const month = previousMonth();
  const [rows, setRows] = useState<PlayerEntry[] | null>(null);
  const [status, setStatus] = useState<PoolStatus | null>(null);

  useEffect(() => {
    void getMonthlyLeaderboard(false, month).then(setRows, () => setRows([]));
    void getPoolStatus(month).then(setStatus, () => {});
  }, [month]);

  const goalReached = !!status && status.paidGames >= status.gamesGoal;
  const amounts = prizeSplit(status?.kas ?? 0);
  const shares = [amounts.first, amounts.second, amounts.third];

  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      <p className="text-xs uppercase tracking-widest text-white/50">Last Month&apos;s Winners</p>
      <p className="mt-1 text-[11px] text-white/40">
        {month} &middot; {status && !goalReached ? "games goal not met" : "estimated 50/30/20 split, paid out by hand"}
      </p>

      {rows === null || !status ? (
        <p className="mt-3 text-xs text-white/40">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-white/40">No winners last month.</p>
      ) : (
        <>
          {!goalReached && (
            <p className="mt-3 rounded-lg border border-yellow-300/30 bg-yellow-300/5 p-2.5 text-xs text-yellow-300/90">
              ⚠️ Target of {status.gamesGoal} paid games was not reached last month ({status.paidGames}/{status.gamesGoal}). No prize pool
              distributed. The accumulated pool has been rolled over to this month.
            </p>
          )}
          <ul className="mt-3 flex flex-col gap-3">
            {rows.slice(0, 3).map((r, i) => (
              <li key={r.address} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {MEDALS[i]} {r.xHandle ? `@${r.xHandle}` : r.name || "Anonymous"}
                  </span>
                  {goalReached && <span className="font-arcade shrink-0 text-xs text-kas">{shares[i].toFixed(2)} {KAS_TICKER}</span>}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate text-[10px] text-white/40">{r.address}</code>
                  <CopyAddress address={r.address} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
