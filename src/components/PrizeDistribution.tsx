import TokenBadge from "./TokenBadge";
import { displaySymbol, formatTokenAmount, KAS_TICKER, prizeTokensFor, rankAmounts } from "../lib/bonusTokens";
import { FIRST_PLACE_NFT, PRIZE_SPLIT } from "../lib/prices";

/**
 * Monthly reward breakdown, computed live from the pool's current KAS balance plus the month's bonus
 * tokens. Every token gets the same top-3 shares (`PRIZE_SPLIT`). Display only: the covenant still
 * pays a single address per month (see `contracts/KasmanPool.sil`); the owner splits 2nd/3rd manually
 * after withdrawing (`rankAmounts` in `src/lib/bonusTokens.ts`).
 */
/** `compact` shrinks it for tight spots (the Play game view's sidebar). */
export default function PrizeDistribution({ pool, className = "", compact = false }: { pool: number; className?: string; compact?: boolean }) {
  const tokens = prizeTokensFor(pool);
  const pct = (share: number) => `${Math.round(share * 100)}%`;

  return (
    <div className={`rounded-xl border border-kas/30 bg-kas/5 ${compact ? "p-2" : "p-4"} ${className}`}>
      <p className={`uppercase tracking-widest text-white/50 ${compact ? "text-[10px]" : "text-xs"}`}>Monthly Rewards</p>
      {!compact && (
        <p className="mt-1 text-[11px] text-white/40">
          Prize distribution · {KAS_TICKER} keeps {pct(PRIZE_SPLIT.treasuryShare)} for game maintenance · bonus tokens split in full
        </p>
      )}
      <p className={`mt-2 inline-block rounded-full border border-yellow-300/40 bg-yellow-300/10 px-2.5 py-1 font-semibold text-yellow-300 ${compact ? "text-[10px]" : "text-[11px] tracking-wide"}`}>
        🏆 1ST PLACE INCLUDES {FIRST_PLACE_NFT.name.toUpperCase()}
      </p>

      <div className={`flex flex-col ${compact ? "mt-1 gap-2" : "mt-3 gap-4"}`}>
        {tokens.map((token) => {
          const amounts = rankAmounts(token);
          return (
            <div key={token.symbol}>
              <div className={`flex items-center gap-1.5 font-semibold ${compact ? "text-[10px]" : "text-xs"}`}>
                <TokenBadge token={token} className={compact ? "size-3.5" : "size-5"} />
                <span className="uppercase tracking-widest text-white/60">{displaySymbol(token)}</span>
              </div>
              <ul className={`flex flex-col ${compact ? "mt-0.5 gap-0.5 text-[11px]" : "mt-1.5 gap-1.5 text-sm"}`}>
                <li className="flex items-center justify-between gap-2 whitespace-nowrap">
                  <span>🥇 1st <span className="text-white/40">({pct(PRIZE_SPLIT.first)})</span></span>
                  <span className={`font-arcade shrink-0 text-kas ${compact ? "" : "text-xs"}`}>{formatTokenAmount(amounts.first)} {displaySymbol(token)}</span>
                </li>
                <li className="flex items-center justify-between gap-2 whitespace-nowrap">
                  <span>🥈 2nd <span className="text-white/40">({pct(PRIZE_SPLIT.second)})</span></span>
                  <span className={`font-arcade shrink-0 text-white/80 ${compact ? "" : "text-xs"}`}>{formatTokenAmount(amounts.second)} {displaySymbol(token)}</span>
                </li>
                <li className="flex items-center justify-between gap-2 whitespace-nowrap">
                  <span>🥉 3rd <span className="text-white/40">({pct(PRIZE_SPLIT.third)})</span></span>
                  <span className={`font-arcade shrink-0 text-white/80 ${compact ? "" : "text-xs"}`}>{formatTokenAmount(amounts.third)} {displaySymbol(token)}</span>
                </li>
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
