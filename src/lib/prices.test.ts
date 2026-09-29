import { expect, it } from "vitest";
import { rarityOf } from "./prices";

it("maps token ids to rarity ranges 50/30/15/5 %", () => {
  const r = (id: number | null) => rarityOf(id).id;
  expect([null, 1, 1500, 1501, 2400, 2401, 2850, 2851, 3000].map(r)).toEqual([
    "none", "common", "common", "rare", "rare", "epic", "epic", "legendary", "legendary",
  ]);
});
