import { expect, it } from "vitest";
import { bonusTokensFor, prizeTokensFor, rankAmounts, type BonusToken } from "./bonusTokens";

const TABLE: Record<string, BonusToken[]> = {
  "2026-11": [
    { symbol: "KASPI", amount: 1000 },
    { symbol: "MEME", amount: 200 },
  ],
};

it("lists no bonus tokens for a month without config", () => {
  expect(bonusTokensFor("2026-12", TABLE)).toEqual([]);
  expect(prizeTokensFor(5, "2026-12", TABLE)).toEqual([{ symbol: "KAS", amount: 5 }]);
});

it("puts KAS first, then the month's bonus tokens", () => {
  expect(prizeTokensFor(5, "2026-11", TABLE).map((t) => t.symbol)).toEqual(["KAS", "KASPI", "MEME"]);
});

it("splits a bonus token in full 50/30/20 among the top 3", () => {
  const { first, second, third } = rankAmounts({ symbol: "KASPI", amount: 1000 });
  expect([first, second, third]).toEqual([500, 300, 200]);
});

it("keeps KAS's treasury cut before splitting 50/30/20", () => {
  const { first, second, third } = rankAmounts({ symbol: "KAS", amount: 100 });
  expect([first, second, third]).toEqual([45, 27, 18]);
});
