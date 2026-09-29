// Shared by the UI and the Worker (worker/index.ts), which charges these prices.
export const ENTRY_FEE_KAS = 10;
/** Boost packs sold in the Marketplace: multiples of 3 lives up to 50, 10 KAS per 3 lives. */
export const LIFE_PACKS = Array.from({ length: Math.floor(50 / 3) }, (_, i) => ({ lives: 3 * (i + 1), price: 10 * (i + 1) }));

export const currentMonth = (d = new Date()) => d.toISOString().slice(0, 7);

/** Kasman NFT (contracts/KasmanNFT.sil): 3,000 NFTs sold at this price in the Marketplace. */
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
  { id: "common", name: "Common", maxTokenId: 1500, freeGames: 1, mult: 11, claimEveryHours: 5 * 24 },
  { id: "rare", name: "Rare", maxTokenId: 2400, freeGames: 2, mult: 13, claimEveryHours: 3 * 24 },
  { id: "epic", name: "Epic", maxTokenId: 2850, freeGames: 3, mult: 16, claimEveryHours: 48 },
  { id: "legendary", name: "Legendary", maxTokenId: 3000, freeGames: 4, mult: 20, claimEveryHours: 24 },
] as const;

export type Rarity = (typeof RARITIES)[number];

export const rarityOf = (tokenId: number | null): Rarity =>
  (tokenId && RARITIES.find((r) => r.maxTokenId > 0 && tokenId <= r.maxTokenId)) || RARITIES[0];

export const today = (d = new Date()) => d.toISOString().slice(0, 10);
