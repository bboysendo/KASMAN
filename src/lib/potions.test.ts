import { beforeEach, describe, expect, it } from "vitest";
import { NONE, USE_SHIELD, USE_SURGE } from "../game/engine/constants";
import type { Replay } from "../game/engine/replay";
import { useStore } from "../store";
import type { Account } from "./leaderboard";
import { NO_POTIONS, spentPotions, subtractPotions } from "./potions";

const ADDRESS = "kaspatest:qtest";
const account = (patch: Partial<Account> = {}): Account => ({
  address: ADDRESS, name: "", xHandle: null, tickets: 0, lives: 0, skins: [], freeGamesLeft: 0,
  potions: { ...NO_POTIONS, shield: 3, surge: 1 }, quests: [], shards: 0, ...patch,
});
const SIGNED_OUT = account({ address: null, potions: NO_POTIONS });
const replayWith = (...inputs: number[]): Replay => ({ v: 15, seed: 1, inputs: inputs.map((d, i) => [i * 10, d]), frames: 100 });

describe("spentPotions", () => {
  it("counts only potion inputs", () => {
    expect(spentPotions(replayWith(USE_SHIELD, NONE, USE_SHIELD, USE_SURGE))).toEqual({ ...NO_POTIONS, shield: 2, surge: 1 });
    expect(spentPotions(null)).toEqual(NO_POTIONS);
  });
  it("subtractPotions never goes negative", () => {
    expect(subtractPotions({ ...NO_POTIONS, shield: 1 }, { ...NO_POTIONS, shield: 3 }).shield).toBe(0);
  });
});

describe("potion inventory survives the wallet dropping", () => {
  beforeEach(() => {
    useStore.setState({ address: null, ownedPotions: NO_POTIONS, potionBackup: {}, runActive: false, potionsSpentInRun: NO_POTIONS, activeGame: null, activeGameId: null });
  });

  it("spends from the local copy only, and keeps the per-address backup in step", () => {
    useStore.getState().syncAccount(account());
    expect(useStore.getState().consumePotion("shield")).toBe(true);
    expect(useStore.getState().ownedPotions.shield).toBe(2);
    expect(useStore.getState().potionBackup[ADDRESS]?.shield).toBe(2);
    expect(useStore.getState().consumePotion("freeze")).toBe(false);
  });

  it("a signed-out sync mid-run does not take the potions away", () => {
    useStore.getState().syncAccount(account());
    useStore.getState().beginRun(null);
    useStore.getState().consumePotion("shield");
    useStore.getState().syncAccount(SIGNED_OUT);
    expect(useStore.getState().ownedPotions.shield).toBe(2);
    expect(useStore.getState().consumePotion("shield")).toBe(true);
  });

  it("reconnecting mid-run re-syncs without handing back what the run already spent", () => {
    useStore.getState().syncAccount(account());
    useStore.getState().beginRun(null);
    useStore.getState().consumePotion("shield");
    useStore.getState().consumePotion("surge");
    useStore.getState().syncAccount(SIGNED_OUT);
    // The server has not debited this run yet: it still says 3 shields / 1 surge.
    useStore.getState().syncAccount(account());
    expect(useStore.getState().ownedPotions).toEqual({ ...NO_POTIONS, shield: 2, surge: 0 });
  });

  it("a resumed run's saved potion uses are taken off the server count too", () => {
    useStore.getState().beginRun(replayWith(USE_SHIELD, USE_SHIELD));
    useStore.getState().syncAccount(account());
    expect(useStore.getState().ownedPotions.shield).toBe(1);
  });

  it("extra lives follow the same rules: kept when the session drops, not handed back on reconnect", () => {
    useStore.setState({ extraLives: 0, livesSpentInRun: 0 });
    useStore.getState().syncAccount(account({ lives: 5 }));
    useStore.getState().beginRun(null);
    useStore.getState().consumeExtraLife();
    useStore.getState().consumeExtraLife();
    useStore.getState().syncAccount(SIGNED_OUT);
    expect(useStore.getState().extraLives).toBe(3);
    useStore.getState().syncAccount(account({ lives: 5 })); // server has not debited this run yet
    expect(useStore.getState().extraLives).toBe(3);
  });

  it("outside a run, signing out still clears the potions", () => {
    useStore.getState().syncAccount(account());
    useStore.getState().syncAccount(SIGNED_OUT);
    expect(useStore.getState().ownedPotions).toEqual(NO_POTIONS);
  });
});
