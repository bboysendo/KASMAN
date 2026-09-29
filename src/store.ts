import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Replay } from "./game/engine/replay";
import type { Account } from "./lib/leaderboard";
import { DEFAULT_SKIN, SKINS } from "./game/render/skins";

export interface Settings {
  volume: number; // 0..1
  muted: boolean;
  music: boolean;
  mobileControls: "swipe" | "buttons";
  reducedMotion: boolean;
  largeHud: boolean;
  gamepadPauseButton: number;
}

interface Store {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  playerName: string;
  setPlayerName: (name: string) => void;
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
        volume: 0.7,
        muted: false,
        music: false,
        mobileControls: "buttons",
        reducedMotion: prefersReducedMotion,
        largeHud: false,
        gamepadPauseButton: 9,
      },
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      playerName: "",
      setPlayerName: (playerName) => set({ playerName: playerName.slice(0, 16) }),
      address: null,
      ownedSkins: FREE_SKINS,
      equippedSkin: DEFAULT_SKIN.id,
      equipSkin: (id) => get().ownedSkins.includes(id) && set({ equippedSkin: id }),
      tickets: 0,
      freeGames: 0,
      extraLives: 0,
      syncAccount: (a) =>
        set((s) => {
          const ownedSkins = [...FREE_SKINS, ...a.skins];
          return {
            address: a.address,
            tickets: a.tickets,
            freeGames: a.freeGamesLeft,
            extraLives: a.lives,
            ownedSkins,
            playerName: s.playerName || a.name,
            equippedSkin: ownedSkins.includes(s.equippedSkin) ? s.equippedSkin : DEFAULT_SKIN.id,
          };
        }),
      consumeExtraLife: () => {
        if (get().extraLives <= 0) return false;
        set((s) => ({ extraLives: s.extraLives - 1 }));
        return true;
      },
      activeGame: null,
      activeGameId: null,
      setActiveGame: (activeGame, gameId) => set((s) => ({ activeGame, activeGameId: activeGame ? (gameId ?? s.activeGameId) : null })),
    }),
    { name: "kasman.store.v1" },
  ),
);
