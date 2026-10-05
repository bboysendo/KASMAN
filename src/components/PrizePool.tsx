import { formatTokenAmount, prizeTokensFor } from "../lib/bonusTokens";
import TokenBadge from "./TokenBadge";

/**
 * Monthly prize pool card, shared by every page that shows it. KAS comes from the live pool balance;
 * the month's bonus tokens (`src/lib/bonusTokens.ts`) are listed under it.
 * `compact` shrinks it for tight spots (the Play game view's sidebar).
 */
export default function PrizePool({ pool, className = "", compact = false }: { pool: number; className?: string; compact?: boolean }) {
  const tokens = prizeTokensFor(pool);

  return (
    <div className={`rounded-xl border border-kas/30 bg-kas/5 ${compact ? "p-2" : "p-4"} ${className}`}>
      <p className={`uppercase tracking-widest text-white/50 ${compact ? "text-[10px]" : "text-xs"}`}>Prize Pool</p>
      <ul className={`flex flex-col ${compact ? "mt-0.5 gap-0.5" : "mt-2 gap-2"}`}>
        {tokens.map((token, i) => (
          <li key={token.symbol} className="flex items-center gap-2">
            <TokenBadge token={token} className={compact ? "size-4" : "size-6"} />
            <span className={`font-arcade whitespace-nowrap ${i === 0 ? "text-kas" : "text-white"} ${compact ? "text-xs" : i === 0 ? "text-2xl" : "text-sm"}`}>
              {formatTokenAmount(token.amount)} {token.symbol}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
