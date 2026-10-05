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
}

export const KAS_SYMBOL = "KAS";

/** Bonus tokens per month (`YYYY-MM`). Empty until the owner lists a month here. */
export const BONUS_TOKENS: Record<string, BonusToken[]> = {
  // "2026-11": [
  //   { symbol: "KASPI", name: "Kaspi", amount: 1000, icon: "/assets/tokens/kaspi.png" },
  //   { symbol: "MEME", name: "Kasman Meme", amount: 5000000 },
  // ],
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
