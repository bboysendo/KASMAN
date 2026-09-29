// Client for the Kasman API (worker/index.ts). Payments go from the player's wallet
// straight to the month's prize pool covenant; the server verifies them on chain and
// re-simulates every submitted replay before it counts.
import { FPS } from "../game/engine/constants";
import pools from "../../worker/pools.json";
import { onchainReady, payEntry } from "./chain";
import { sendKaspa, signWithWallet, walletAccount } from "./wallet";

export { ENTRY_FEE_KAS, LIFE_PACKS, currentMonth } from "./prices";

/** One player's month: points summed over every submitted game. */
export interface PlayerEntry {
  address: string;
  name: string;
  totalScore: number;
  /** Every submitted game, finished or not. */
  games: number;
  bestScore: number;
  /** Highest level reached in any game. */
  bestLevel: number;
  /** Fastest clear of all levels, in simulation frames (60 per second). Null until the player wins once. */
  bestFrames: number | null;
  /** Length of the best-scoring game, in frames. */
  bestScoreFrames: number;
}

/** What the server knows about this browser's player. */
export interface Account {
  address: string | null;
  name: string;
  tickets: number;
  lives: number;
  skins: string[];
  /** Free games left today from a staked NFT's on-chain check-in (`requestFreeGames`). */
  freeGamesLeft: number;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
  if (!res.ok || res.status === 202) throw new ApiError(res.status, data.error ?? `Server error ${res.status}`);
  return data as T;
}

export const getAccount = () => api<Account>("/me");

/** The network the Worker's pool addresses are on; the wallet must use it too. */
const ADDRESS_PREFIX = pools.network === "mainnet" ? "kaspa" : "kaspatest";

/** Connects KasWare and signs in: the server checks the wallet signs for its address. */
export async function connectWallet(): Promise<Account> {
  const address = await walletAccount(ADDRESS_PREFIX);
  const { nonce, message } = await api<{ nonce: string; message: string }>("/auth/nonce", { address });
  const { publicKey, signature } = await signWithWallet(message);
  return api<Account>("/auth/verify", { address, nonce, publicKey, signature });
}

export const disconnectWallet = () => api<Account>("/auth/logout", {});

/**
 * Buys an entry, a lives pack or a skin: the connected wallet (`from`) pays the pool covenant,
 * then the server is asked to credit the order until the transaction is accepted on chain.
 */
export async function pay(from: string, kind: "entry" | "lives" | "skin", item?: string | number): Promise<Account> {
  const order = await api<{ orderId: string; address: string; sompi: number; month: string; payload: string }>("/order", { kind, item: item === undefined ? undefined : String(item) });
  // Entries also count the day in the player's on-chain rewards record (KasmanRewards).
  const txId = kind === "entry" && onchainReady ? await payEntry(from, order) : await sendKaspa(from, order.address, order.sompi, order.payload);
  for (let attempt = 0; ; attempt++) {
    try {
      return await api<Account>("/pay", { orderId: order.orderId, txId });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 202) || attempt >= 40) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

/** Uses one entry. The server picks the seed, so a run cannot be chosen in advance. */
/** Grants today's free games from an accepted on-chain check-in transaction. */
export const requestFreeGames = (txId: string) => api<Account>("/free", { txId });

export const startGame = (name: string) => api<{ gameId: string; seed: number }>("/game/start", { name });

/** The server re-simulates the replay and adds the score to the player's monthly total. */
export const submitScore = (gameId: string, encodedReplay: string, score: number) =>
  api<{ score: number; month: string }>("/score", { gameId, replay: encodedReplay, score });

/** `fresh` skips the 30 s edge cache (right after the player's own submit). */
export const getMonthlyLeaderboard = (fresh = false) => api<PlayerEntry[]>(`/leaderboard${fresh ? `?t=${Date.now()}` : ""}`);

export const getPrizePool = () => api<{ kas: number }>("/pool").then((r) => r.kas);

/**
 * Time shown in the Time column: fastest clear of all levels, or, for a player
 * who has not cleared them yet, how long their best-scoring game lasted.
 */
export const bestTimeFrames = (e: PlayerEntry) => e.bestFrames ?? e.bestScoreFrames;

/** Simulation frames to m:ss.cc */
export function formatRunTime(frames: number) {
  const cs = Math.round((frames * 100) / FPS);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Milliseconds until the monthly payout (start of next month, UTC). */
export function msUntilPayout(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return next - now.getTime();
}
