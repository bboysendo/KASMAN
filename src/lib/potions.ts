import { BUY_LIFE, USE_FREEZE, USE_GHOSTHUNT, USE_MAGNET, USE_SHIELD, USE_SPEED, USE_SURGE } from "../game/engine/constants";
import type { Replay } from "../game/engine/replay";
import type { Potions } from "./leaderboard";
import type { PotionId } from "./prices";

export const NO_POTIONS: Potions = { shield: 0, freeze: 0, surge: 0, speed: 0, magnet: 0, ghosthunt: 0 };

const POTION_OF_INPUT: Record<number, PotionId> = {
  [USE_SHIELD]: "shield", [USE_FREEZE]: "freeze", [USE_SURGE]: "surge",
  [USE_SPEED]: "speed", [USE_MAGNET]: "magnet", [USE_GHOSTHUNT]: "ghosthunt",
};

/**
 * Potions a run has spent so far, read off its replay. The server only debits them when the score is
 * submitted, so until then its count still includes them: a sync has to take them off again.
 */
export function spentPotions(replay: Replay | null): Potions {
  const spent = { ...NO_POTIONS };
  for (const [, input] of replay?.inputs ?? []) {
    const id = POTION_OF_INPUT[input];
    if (id) spent[id]++;
  }
  return spent;
}

/** Extra lives (+1 LIFE) a run has added so far; debited by the server on submit, like potions. */
export const spentLives = (replay: Replay | null): number => (replay?.inputs ?? []).filter(([, input]) => input === BUY_LIFE).length;

export const subtractPotions = (have: Potions, spent: Potions): Potions => ({
  shield: Math.max(0, have.shield - spent.shield),
  freeze: Math.max(0, have.freeze - spent.freeze),
  surge: Math.max(0, have.surge - spent.surge),
  speed: Math.max(0, have.speed - spent.speed),
  magnet: Math.max(0, have.magnet - spent.magnet),
  ghosthunt: Math.max(0, have.ghosthunt - spent.ghosthunt),
});
