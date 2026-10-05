import { useState } from "react";
import { KAS_SYMBOL, type BonusToken } from "../lib/bonusTokens";

/**
 * Round icon of a prize token: its image when one is configured and loads, otherwise the symbol's
 * first letter on a dark disc (KAS always uses the letter, it has no image yet).
 */
export default function TokenBadge({ token, className = "" }: { token: BonusToken; className?: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = !!token.icon && token.symbol !== KAS_SYMBOL && !failed;

  if (showImage) {
    return (
      <img
        src={token.icon}
        alt={token.symbol}
        title={token.name ?? token.symbol}
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      title={token.name ?? token.symbol}
      className={`font-arcade flex shrink-0 items-center justify-center rounded-full border border-kas/50 bg-black text-[10px] text-kas ${className}`}
    >
      {token.symbol.charAt(0)}
    </span>
  );
}
