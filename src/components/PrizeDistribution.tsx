import NftThumb from "./NftThumb";
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

      <div className={`flex items-center rounded-lg border border-yellow-300/30 bg-[radial-gradient(ellipse_at_top_left,rgba(253,224,71,0.12),transparent_70%)] ${compact ? "mt-1.5 gap-2 p-1.5" : "mt-4 gap-3 p-3"}`}>
        <NftThumb className={compact ? "size-7" : "size-12"} />
        <div className="min-w-0 flex-1">
          <p className={`font-semibold text-yellow-300 ${compact ? "text-[10px]" : "text-xs"}`}>1st Place Bonus</p>
          <p className={`truncate text-white/60 ${compact ? "text-[10px]" : "text-xs"}`}>{FIRST_PLACE_NFT.name}</p>
        </div>
      </div>
      {!compact && (
        <a
          href={FIRST_PLACE_NFT.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block rounded-lg border border-white/20 py-2 text-center text-xs hover:bg-white/5"
        >
          View on KaspaCom
        </a>
      )}
    </div>
  );
}
