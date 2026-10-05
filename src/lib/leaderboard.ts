// Client for the Kasman API (worker/index.ts). Payments go from the player's wallet
// straight to the month's prize pool covenant; the server verifies them on chain and
// re-simulates every submitted replay before it counts.
import { FPS } from "../game/engine/constants";
import pools from "../../worker/pools.json";
import { onchainReady, payEntry } from "./chain";
import { ensureWalletAccount, sendKaspa, signWithWallet, walletAccount } from "./wallet";

export { ENTRY_FEE_KAS, LIFE_PACKS, POTIONS, currentMonth } from "./prices";

/** Owned potions not yet used, by id. */
export interface Potions { shield: number; freeze: number; surge: number; speed: number; magnet: number; ghosthunt: number }

/** One player's month: points summed over every submitted game. */
export interface PlayerEntry {
  address: string;
  name: string;
  /** X (Twitter) handle, no leading '@'; shown instead of `name` when set. */
  xHandle: string | null;
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
  /** X (Twitter) handle, no leading '@'; null until registered with `setXHandle`. */
  xHandle: string | null;
  tickets: number;
  lives: number;
  skins: string[];
  /** Free games left today from a staked NFT's on-chain check-in (`requestFreeGames`). */
  freeGamesLeft: number;
  potions: Potions;
  /** Ids of Social Quests already claimed by this wallet. */
  quests: string[];
  /** Puzzle Shards owned, spent crafting Chests (Shop "Chests" tab). */
  shards: number;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A stalled connection (dead wallet popup, flaky network) aborts instead of hanging the caller forever. */
const API_TIMEOUT_MS = 15_000;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      signal: controller.signal,
    });
  } catch (e) {
    // Status 0: the request itself never came back (dead connection), as opposed to a real HTTP error.
    throw e instanceof DOMException && e.name === "AbortError" ? new ApiError(0, "Request timed out") : e;
  } finally {
    clearTimeout(timer);
  }
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

/** How long `pay` keeps retrying the pending-acceptance check before giving up (testnet-10 indexing can lag). */
const PAY_CONFIRM_TIMEOUT_MS = 3 * 60_000;

/**
 * Buys an entry, a lives pack, a potion (`qty` units) or a skin: the connected wallet (`from`)
 * pays the pool covenant, then the server is asked to credit the order until the transaction is
 * accepted on chain. `onWaiting(elapsedMs)` fires on every retry so the caller can show that
 * confirmation is still in progress (accepting a transaction on chain can take longer than a
 * single request's timeout).
 */
export async function pay(
  from: string,
  kind: "entry" | "lives" | "skin" | "potion",
  item?: string | number,
  qty?: number,
  onWaiting?: (elapsedMs: number) => void,
): Promise<Account> {
  // First thing, right on the click: if KasWare locked or dropped in the background this opens its
  // unlock window now (not after the order round trip), and no order is created for a payment that can't start.
  await ensureWalletAccount(from);
  const order = await api<{ orderId: string; address: string; sompi: number; month: string; payload: string }>("/order", {
    kind,
    item: item === undefined ? undefined : String(item),
    qty,
  });
  // Entries also count the day in the player's on-chain rewards record (KasmanRewards).
  const txId = kind === "entry" && onchainReady ? await payEntry(from, order) : await sendKaspa(from, order.address, order.sompi, order.payload);
  console.info("[pay] broadcast", { kind, orderId: order.orderId, txId });
  const startedAt = Date.now();
  for (;;) {
    try {
      return await api<Account>("/pay", { orderId: order.orderId, txId });
    } catch (e) {
      const elapsed = Date.now() - startedAt;
      console.warn("[pay] /pay not accepted yet", { orderId: order.orderId, txId, elapsed, error: e instanceof Error ? { status: (e as ApiError).status, message: e.message } : e });
      if (!(e instanceof ApiError && (e.status === 202 || e.status === 0)) || elapsed >= PAY_CONFIRM_TIMEOUT_MS) throw e;
      onWaiting?.(elapsed);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

/** Uses one entry. The server picks the seed, so a run cannot be chosen in advance. */
/** Grants today's free games from an accepted on-chain check-in transaction. */
export const requestFreeGames = (txId: string) => api<Account>("/free", { txId });

export const startGame = () => api<{ gameId: string; seed: number }>("/game/start", {});

/** Registers (or updates) the connected wallet's X handle; rejected if another wallet already has it. */
export const setXHandle = (handle: string) => api<Account>("/x-handle", { handle });

/** Claims a Social Quest's one-time reward; requires an X handle to already be registered. */
export const claimQuest = (questId: string) => api<Account>("/quest/claim", { quest: questId });

/** Crafts a chest: spends its Puzzle Shard cost, credits its potions instantly. No KAS involved. */
export const craftChest = (chestId: string) => api<Account>("/chest/craft", { chest: chestId });

/** The server re-simulates the replay and adds the score to the player's monthly total. */
export const submitScore = (gameId: string, encodedReplay: string, score: number) =>
  api<{ score: number; month: string }>("/score", { gameId, replay: encodedReplay, score });

/** `fresh` skips the 30 s edge cache (right after the player's own submit). `month` defaults to the current one. */
export const getMonthlyLeaderboard = (fresh = false, month?: string) => {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  if (fresh) params.set("t", String(Date.now()));
  const qs = params.toString();
  return api<PlayerEntry[]>(`/leaderboard${qs ? `?${qs}` : ""}`);
};

export const getPrizePool = () => api<{ kas: number }>("/pool").then((r) => r.kas);

/** A month's pool balance and paid-entry progress toward `GAMES_GOAL` (prices.ts). */
export interface PoolStatus { kas: number; paidGames: number; gamesGoal: number }
export const getPoolStatus = (month?: string) => api<PoolStatus>(`/pool${month ? `?month=${month}` : ""}`);

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
