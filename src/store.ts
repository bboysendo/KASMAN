import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Replay } from "./game/engine/replay";
import type { Account, Potions } from "./lib/leaderboard";
import { NO_POTIONS, spentLives, spentPotions, subtractPotions } from "./lib/potions";
import type { PotionId } from "./lib/prices";
import { DEFAULT_SKIN, SKINS } from "./game/render/skins";

/** Rebindable keys, as KeyboardEvent.code. Movement also always accepts WASD and arrows either way. */
export interface Keymap {
  up: string;
  down: string;
  left: string;
  right: string;
  shield: string;
  freeze: string;
  surge: string;
  speed: string;
  magnet: string;
  ghosthunt: string;
  life: string;
}
export const DEFAULT_KEYMAP: Keymap = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  shield: "Digit1",
  freeze: "Digit2",
  surge: "Digit3",
  speed: "Digit4",
  magnet: "Digit5",
  ghosthunt: "Digit6",
  life: "KeyL",
};

export interface Settings {
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  /** Quick mute for music only (HUD icon), independent of musicVolume and the global `muted`. */
  musicMuted: boolean;
  muted: boolean;
  mobileControls: "swipe" | "buttons";
  reducedMotion: boolean;
  largeHud: boolean;
  gamepadPauseButton: number;
  keymap: Keymap;
}

interface Store {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  /** X (Twitter) handle registered with the server for the connected wallet, no leading '@'. */
  xHandle: string | null;
  /** Ids of Social Quests already claimed by the connected wallet. */
  claimedQuests: string[];
  /** Wallet address the server knows this browser as (set by the first payment). */
  address: string | null;
  ownedSkins: string[];
  equippedSkin: string;
  equipSkin: (id: string) => void;
  /** Paid entries not yet used. One ticket = one game. */
  tickets: number;
  /** Free games left today from a staked NFT's check-in. */
  freeGames: number;
  /** Bought extra lives not yet used in a game. */
  extraLives: number;
  consumeExtraLife: () => boolean;
  /** Bought potions not yet used, by id. Spending one only ever touches this local copy, never the wallet or the server. */
  ownedPotions: Potions;
  consumePotion: (id: PotionId) => boolean;
  /** Last known potion inventory per wallet address (persisted), so a dropped session never leaves a run without its potions. */
  potionBackup: Record<string, Potions>;
  /** True while a live (non-replay) run is mounted. Not persisted. */
  runActive: boolean;
  /** Potions the live run has spent; the server debits them only when the score is submitted. Not persisted. */
  potionsSpentInRun: Potions;
  /** Extra lives the live run has added (same idea as `potionsSpentInRun`). Not persisted. */
  livesSpentInRun: number;
  /** Call when a run mounts; `resumed` is the saved replay it continues from, if any. */
  beginRun: (resumed: Replay | null) => void;
  endRun: () => void;
  /** Puzzle Shards owned, spent crafting Chests. */
  shards: number;
  /** Copies what the server owns for this player (tickets, lives, skins); the server is the source of truth. */
  syncAccount: (account: Account) => void;
  /** Unfinished game, stored as its replay so it can be re-simulated and resumed. */
  activeGame: Replay | null;
  /** Server id of that game, needed to submit it. */
  activeGameId: string | null;
  setActiveGame: (replay: Replay | null, gameId?: string) => void;
}

const FREE_SKINS = SKINS.filter((s) => s.price === 0).map((s) => s.id);

const prefersReducedMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      settings: {
        musicVolume: 0.5,
        sfxVolume: 0.7,
        musicMuted: false,
        muted: false,
        mobileControls: "buttons",
        reducedMotion: prefersReducedMotion,
        largeHud: false,
        gamepadPauseButton: 9,
        keymap: DEFAULT_KEYMAP,
      },
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      xHandle: null,
      claimedQuests: [],
      address: null,
      ownedSkins: FREE_SKINS,
      equippedSkin: DEFAULT_SKIN.id,
      equipSkin: (id) => get().ownedSkins.includes(id) && set({ equippedSkin: id }),
      tickets: 0,
      freeGames: 0,
      extraLives: 0,
      ownedPotions: NO_POTIONS,
      potionBackup: {},
      runActive: false,
      potionsSpentInRun: NO_POTIONS,
      livesSpentInRun: 0,
      beginRun: (resumed) => set({ runActive: true, potionsSpentInRun: spentPotions(resumed), livesSpentInRun: spentLives(resumed) }),
      endRun: () => set({ runActive: false, potionsSpentInRun: NO_POTIONS, livesSpentInRun: 0 }),
      shards: 0,
      syncAccount: (a) =>
        set((s) => {
          const ownedSkins = [...FREE_SKINS, ...a.skins];
          // The server only debits a run's potions when its score is submitted, so while one is live
          // (or saved, waiting to be resumed) its spent potions are still in the server's count.
          const spent = s.runActive ? s.potionsSpentInRun : spentPotions(s.activeGame);
          const unfinishedRun = s.runActive || s.activeGameId !== null;
          // A signed-out answer (wallet/session dropped) must not take the potions away from a run in
          // progress; the next sign-in reconciles with the server again.
          const ownedPotions = a.address
            ? subtractPotions(a.potions, spent)
            : unfinishedRun
              ? (s.address ? s.potionBackup[s.address] : undefined) ?? s.ownedPotions
              : a.potions;
          const livesSpent = s.runActive ? s.livesSpentInRun : spentLives(s.activeGame);
          const extraLives = a.address ? Math.max(0, a.lives - livesSpent) : unfinishedRun ? s.extraLives : a.lives;
          return {
            address: a.address,
            tickets: a.tickets,
            freeGames: a.freeGamesLeft,
            extraLives,
            ownedPotions,
            potionBackup: a.address ? { ...s.potionBackup, [a.address]: ownedPotions } : s.potionBackup,
            ownedSkins,
            xHandle: a.xHandle,
            claimedQuests: a.quests,
            shards: a.shards,
            equippedSkin: ownedSkins.includes(s.equippedSkin) ? s.equippedSkin : DEFAULT_SKIN.id,
          };
        }),
      consumeExtraLife: () => {
        if (get().extraLives <= 0) return false;
        set((s) => ({ extraLives: s.extraLives - 1, livesSpentInRun: s.livesSpentInRun + 1 }));
        return true;
      },
      consumePotion: (id) => {
        if (get().ownedPotions[id] <= 0) return false;
        set((s) => {
          const ownedPotions = { ...s.ownedPotions, [id]: s.ownedPotions[id] - 1 };
          return {
            ownedPotions,
            potionsSpentInRun: { ...s.potionsSpentInRun, [id]: s.potionsSpentInRun[id] + 1 },
            potionBackup: s.address ? { ...s.potionBackup, [s.address]: ownedPotions } : s.potionBackup,
          };
        });
        return true;
      },
      activeGame: null,
      activeGameId: null,
      setActiveGame: (activeGame, gameId) => set((s) => ({ activeGame, activeGameId: activeGame ? (gameId ?? s.activeGameId) : null })),
    }),
    {
      name: "kasman.store.v1",
      // A persisted `settings` (or its nested `keymap`) from before a new field existed would
      // otherwise replace the whole object and drop it; merge one level into each.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Store>;
        const keymap = { ...DEFAULT_KEYMAP, ...p.settings?.keymap };
        // runActive / potionsSpentInRun describe a mounted run: never restore them from a previous page load.
        return { ...current, ...p, runActive: false, potionsSpentInRun: NO_POTIONS, livesSpentInRun: 0, settings: { ...current.settings, ...p.settings, keymap } };
      },
    },
  ),
);
