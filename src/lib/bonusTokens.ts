import onchain from "./onchain.json";
import { currentMonth, PRIZE_SPLIT, prizeSplit } from "./prices";

/**
 * Bonus tokens added to a month's prize pool on top of the KAS pool (e.g. KASPI, a meme coin).
 * Owner's config: edit `BONUS_TOKENS` below, rebuild and deploy. Display only, like `PRIZE_SPLIT`:
 * nothing on chain or in the Worker holds these amounts, so the owner funds and pays them out by hand.
 */
export interface BonusToken {
  /** Ticker shown next to the amount, e.g. "KASPI". */
  symbol: string;
  /** Optional long name, shown as a tooltip. */
  name?: string;
  /** Whole amount of the token to distribute among the top 3 that month. */
  amount: number;
  /** Optional image URL (or a path under `public/`). Without it, the symbol's first letter is shown. */
  icon?: string;
  /** Optional on-chain token id (kept for the owner's payout reference; not displayed). */
  tokenId?: string;
}

/** Internal id of the main token. Stored/compared as-is; the UI shows `kasTicker` instead. */
export const KAS_SYMBOL = "KAS";

/** `TKAS` while the chain config is a testnet (no confusion with real KAS for users), `KAS` on mainnet. */
export const KAS_TICKER = onchain.network.startsWith("testnet") ? "TKAS" : KAS_SYMBOL;

/** Ticker to show for a prize token: the main token gets `KAS_TICKER`, bonus tokens keep their symbol. */
export const displaySymbol = (token: BonusToken) => (token.symbol === KAS_SYMBOL ? KAS_TICKER : token.symbol);

/** Bonus tokens per month (`YYYY-MM`). Empty until the owner lists a month here. */
export const BONUS_TOKENS: Record<string, BonusToken[]> = {
  "2026-10": [
    { symbol: "KASPI", amount: 2000, icon: "/assets/kaspi.png", tokenId: "2629ae955c5874c80d90526ba91f40a4ee52e427494fdd5e45a5d8ee9eb0c33a" },
    { symbol: "KASDIA", amount: 500, icon: "/assets/kasdia.png", tokenId: "77e9fa3da69ce63302accbc28814d9de155dcfe03bb97cc0f2dd3d2ccebfce0" },
  ],
};

/** Bonus tokens of a month (defaults to the current one). Unlisted months have none. */
export function bonusTokensFor(month = currentMonth(), table: Record<string, BonusToken[]> = BONUS_TOKENS): BonusToken[] {
  return table[month] ?? [];
}

/** KAS first (the live pool balance), then this month's bonus tokens. */
export function prizeTokensFor(pool: number, month = currentMonth(), table?: Record<string, BonusToken[]>): BonusToken[] {
  return [{ symbol: KAS_SYMBOL, amount: pool }, ...bonusTokensFor(month, table)];
}

/**
 * Top-3 amounts of one prize token. KAS keeps the treasury cut (`prizeSplit`); bonus tokens are
 * split in full with the same 50/30/20 shares.
 */
export function rankAmounts(token: BonusToken) {
  if (token.symbol === KAS_SYMBOL) {
    const { first, second, third } = prizeSplit(token.amount);
    return { first, second, third };
  }
  return {
    first: token.amount * PRIZE_SPLIT.first,
    second: token.amount * PRIZE_SPLIT.second,
    third: token.amount * PRIZE_SPLIT.third,
  };
}

/** Compact number for the prize cards: up to 2 decimals, grouped thousands. */
export const formatTokenAmount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
