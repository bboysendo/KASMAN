// Shared by the UI and the Worker (worker/index.ts), which charges these prices.
import {
  MAGNET_RADIUS, MAX_FREEZE_PER_LEVEL, MAX_GHOSTHUNT_PER_LEVEL, MAX_MAGNET_PER_LEVEL, MAX_SHIELD_PER_LEVEL, MAX_SPEED_PER_LEVEL, MAX_SURGE_PER_LEVEL,
  SPEED_MULT, SURGE_MULT,
} from "../game/engine/constants";

export const ENTRY_FEE_KAS = 1;
/** Boost packs sold in the Shop: multiples of 3 lives up to 50, 10 KAS per 3 lives. */
export const LIFE_PACKS = Array.from({ length: Math.floor(50 / 3) }, (_, i) => ({ lives: 3 * (i + 1), price: 10 * (i + 1) }));

/** Unified per-unit price for every potion (Shop quantity selector buys N at this price). */
export const POTION_PRICE = 0.3;
/** Upper bound on the Shop's quantity selector, and on how many units one order can buy. */
export const MAX_POTION_ORDER_QTY = 20;

/**
 * $KASM is a display ticker for the same on-chain KASMAN token (`contracts/DailyMinter.sil`,
 * 100B cap, 7 decimals) — not a second token, so there's no separate supply constant here.
 * Paying with it isn't live: no burn/staking-pool contract exists yet, so `KASM_PAYMENT_ENABLED`
 * stays false and the Shop only previews the option (disabled) until a real payment rail and
 * contract exist. When it launches, the deflationary split (buy-with-$KASM: 50% burned, 50% to
 * a staking rewards pool) belongs in that contract, not in the Worker (no off-chain balances).
 */
export const KASM_TICKER = "$KASM";
export const KASM_DISCOUNT_RATE = 0.1;
export const KASM_PAYMENT_ENABLED = false;
/** $KASM-equivalent price for a KAS amount, once $KASM payments launch. */
export const kasmPrice = (kas: number) => Number((kas * (1 - KASM_DISCOUNT_RATE)).toFixed(4));

/**
 * Consumable potions sold in the Shop: bought as inventory, spent in-game with a key press
 * (`src/game/engine/constants.ts` USE_SHIELD/USE_FREEZE/USE_SURGE/USE_SPEED/USE_MAGNET/USE_GHOSTHUNT, capped per level there too — the cap renews on every level clear).
 */
export const POTIONS = [
  { id: "shield", name: "Ghost Shield", color: 0x3b82f6, price: POTION_PRICE, maxPerLevel: MAX_SHIELD_PER_LEVEL, desc: "Immune to ghosts for 5s." },
  { id: "freeze", name: "Ghost Freeze", color: 0x10b981, price: POTION_PRICE, maxPerLevel: MAX_FREEZE_PER_LEVEL, desc: "Freezes every ghost for 5s." },
  {
    id: "surge",
    name: "Score Surge",
    color: 0xef4444,
    price: POTION_PRICE,
    maxPerLevel: MAX_SURGE_PER_LEVEL,
    desc: `${SURGE_MULT}x points from everything you eat for 8s.`,
  },
  {
    id: "speed",
    name: "Speed Coffee",
    color: 0xeab308,
    price: POTION_PRICE,
    maxPerLevel: MAX_SPEED_PER_LEVEL,
    desc: `Increases Kasman movement speed by +${Math.round((SPEED_MULT - 1) * 100)}% for 8s.`,
  },
  {
    id: "magnet",
    name: "Ghost Magnet",
    color: 0xa855f7,
    price: POTION_PRICE,
    maxPerLevel: MAX_MAGNET_PER_LEVEL,
    desc: `Attracts pac-dots and fruit within ${MAGNET_RADIUS} tiles towards Kasman for 8s.`,
  },
  {
    id: "ghosthunt",
    name: "Ghost Hunt",
    color: 0xf97316,
    price: POTION_PRICE,
    maxPerLevel: MAX_GHOSTHUNT_PER_LEVEL,
    desc: "Turns all ghosts blue & vulnerable to be eaten for 6s.",
  },
] as const;
export type PotionId = (typeof POTIONS)[number]["id"];
export const potionOf = (id: string) => POTIONS.find((p) => p.id === id);

export const currentMonth = (d = new Date()) => d.toISOString().slice(0, 7);
export const previousMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);

/**
 * Monthly target of paid entries (1 KAS each) before the pool is considered unlocked for payout;
 * short of it, the shortfall is meant to roll into next month's pool. Advisory only — the
 * covenant itself has no notion of this goal, and payout stays a manual owner decision
 * (`worker/index.ts` surfaces `paidGames`/`goalReached` on `/api/pool` and `/api/month/:m/settlement`).
 */
export const GAMES_GOAL = 300;

/** Kasman NFT (contracts/KasmanNFT.sil): 350 NFTs, minted externally on KaspaCom at this price. */
export const NFT_PRICE_KAS = 50;
/** KASMAN every player earns for each UTC day with at least one verified game, at 1.0x. */
export const DAILY_REWARD = 1000;

/**
 * Perks of the player's staked (locked) NFT, by rarity; rarity comes from the token id.
 * Ranges, multipliers and waits mirror contracts/KasmanRewards.sil and covenant.ts `rarityRules`: change all three.
 * `mult` is in tenths (11 = 1.1x) so rewards stay integers. Index 0 = no staked NFT.
 */
export const RARITIES = [
  { id: "none", name: "No NFT", maxTokenId: 0, freeGames: 0, mult: 10, claimEveryHours: 7 * 24 },
  { id: "common", name: "Common", maxTokenId: 175, freeGames: 1, mult: 11, claimEveryHours: 5 * 24 },
  { id: "rare", name: "Rare", maxTokenId: 280, freeGames: 2, mult: 13, claimEveryHours: 3 * 24 },
  { id: "epic", name: "Epic", maxTokenId: 325, freeGames: 3, mult: 16, claimEveryHours: 48 },
  { id: "legendary", name: "Legendary", maxTokenId: 350, freeGames: 4, mult: 20, claimEveryHours: 24 },
] as const;

export type Rarity = (typeof RARITIES)[number];

export const rarityOf = (tokenId: number | null): Rarity =>
  (tokenId && RARITIES.find((r) => r.maxTokenId > 0 && tokenId <= r.maxTokenId)) || RARITIES[0];

export const today = (d = new Date()) => d.toISOString().slice(0, 10);

/** Kasman's official accounts. Placeholders until the real handles are set. */
export const KASMAN_X_URL = "https://x.com/KasmanGame";
export const KASMAN_TELEGRAM_URL = "https://t.me/KasmanGame";

/** X handle rules: 1-15 letters, digits or underscores, no leading '@'. */
export const X_HANDLE_RE = /^\w{1,15}$/;

/**
 * How the monthly pool is meant to split when the owner pays it out. Display only: the
 * KasmanPool covenant still pays a single address per month (`contracts/KasmanPool.sil`,
 * `tx.outputs.length == 1`), so the owner distributes 2nd/3rd manually after withdrawing.
 */
export const PRIZE_SPLIT = {
  /** Of the total pool, kept for game upkeep. */
  treasuryShare: 0.1,
  /** Of the 90% left after that, by rank. */
  first: 0.5,
  second: 0.3,
  third: 0.2,
} as const;

/** KAS amounts by rank (plus the treasury cut) for a given total pool balance. */
export function prizeSplit(pool: number) {
  const treasury = pool * PRIZE_SPLIT.treasuryShare;
  const distributable = pool - treasury;
  return {
    treasury,
    first: distributable * PRIZE_SPLIT.first,
    second: distributable * PRIZE_SPLIT.second,
    third: distributable * PRIZE_SPLIT.third,
  };
}

/** 1st place's exclusive bonus prize, on top of its KAS share. */
export const FIRST_PLACE_NFT = { name: "Yonatoshi NFT #1594", url: "https://kaspa.com/nft/collections/YONATOSHI/1594" };

/**
 * Social Quests (Play "Quests" tab): simple one-time tasks, rewarded once per wallet after the
 * player registers an X handle. Self-reported for now (no X API to verify follows/reposts).
 */
export const QUESTS = [
  {
    id: "follow-x",
    title: "Follow @KasmanGame on X",
    desc: "Follow the official Kasman account on X.",
    url: KASMAN_X_URL,
    reward: { kind: "potion", item: "shield", qty: 1 },
    rewardLabel: "1 Ghost Shield potion",
  },
  {
    id: "repost-pinned",
    title: "Repost the pinned post",
    desc: "Repost the pinned announcement on the Kasman X account.",
    url: KASMAN_X_URL,
    reward: { kind: "potion", item: "freeze", qty: 1 },
    rewardLabel: "1 Ghost Freeze potion",
  },
  {
    id: "join-telegram",
    title: "Join the Telegram",
    desc: "Join the Kasman community on Telegram.",
    url: KASMAN_TELEGRAM_URL,
    reward: { kind: "ticket", item: "", qty: 1 },
    rewardLabel: "1 free entry ticket",
  },
] as const;
export type QuestId = (typeof QUESTS)[number]["id"];

/**
 * Crafting (Shop "Chests" tab): spend Puzzle Shards for a chest of potions (`perPotion` units of
 * each of the 6 potions) plus `lives` Extra Lives (credited the same way as a bought life pack,
 * `worker/index.ts` craftChest), no KAS involved. Shards are tracked the same way as any other
 * inventory item (`kind: "shard"`), but nothing grants them yet — until an earning source exists,
 * every player's balance stays 0 and chests stay uncraftable.
 */
export const CHESTS = [
  { id: "copper", name: "Copper Chest", cost: 50, perPotion: 2, lives: 5 },
  { id: "silver", name: "Silver Chest", cost: 100, perPotion: 5, lives: 10 },
  { id: "gold", name: "Gold Chest", cost: 200, perPotion: 10, lives: 20 },
] as const;
export type ChestId = (typeof CHESTS)[number]["id"];
export const chestPotionCount = (perPotion: number) => perPotion * POTIONS.length;
