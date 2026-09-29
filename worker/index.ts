// Kasman API. Serves /api/* next to the static Vite build (wrangler.jsonc). Fits Workers Free:
// every request here stays under 10 ms of CPU; replay re-simulation runs in the Verifier
// Durable Object (verifier.ts).
//
// Money never touches this Worker: players pay from their connected wallet straight to the
// month's KasmanPool covenant address (contracts/KasmanPool.sil, addresses in pools.json). The
// Worker checks those payments on chain and keeps the leaderboard. The owner pays the winner
// manually, whenever they choose, with `kasman-pool payout` (contracts/tool) and the offline
// oracle key, from /api/month/:m/settlement.
import { FPS } from "../src/game/engine/constants";
import { SKINS } from "../src/game/render/skins";
import { LOCKED, config as onchain, hexToBytes, nftRedeem, p2shAddress, parseNft, parsePayload, pushes, schnorrAddress } from "../src/lib/covenant";
import { ENTRY_FEE_KAS, LIFE_PACKS, currentMonth, rarityOf, today } from "../src/lib/prices";
import { verifyWalletSignature } from "./auth";
import pools from "./pools.json";
import type { Verified } from "./verifier";

export { Verifier } from "./verifier";

export interface Env {
  DB: D1Database;
  VERIFIER: DurableObjectNamespace<import("./verifier").Verifier>;
  /** Kaspa REST API matching pools.json's network, e.g. https://api.kaspa.org */
  KASPA_API: string;
}

const SOMPI = 100_000_000;
const SESSION_COOKIE = "kasman_session";
const ADDRESS_PREFIX = pools.network === "mainnet" ? "kaspa" : "kaspatest";
/** An unsubmitted game older than this cannot be submitted any more. */
const GAME_TTL_MS = 24 * 60 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
/** Verifier instances; warm ones are reused across games. */
const VERIFIERS = 4;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { ...init, headers: { "content-type": "application/json", ...init.headers } });

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function poolAddress(month: string) {
  const address = (pools.pools as Record<string, string>)[month];
  if (!address) throw new HttpError(503, `No pool address for ${month}: regenerate worker/pools.json`);
  return address;
}

/** Price of an order in sompi. Prices come from the same tables the UI shows. */
export function price(kind: string, item: string): number {
  if (kind === "entry") return ENTRY_FEE_KAS * SOMPI;
  if (kind === "lives") {
    const pack = LIFE_PACKS.find((p) => String(p.lives) === item);
    if (pack) return pack.price * SOMPI;
  }
  if (kind === "skin") {
    const skin = SKINS.find((s) => s.id === item && s.price > 0);
    if (skin) return skin.price * SOMPI;
  }
  throw new HttpError(400, "Unknown item");
}

/** Text the player's wallet attaches to the payment; binds the transaction to the order. */
export const orderPayload = (orderId: string) => `kasman:${orderId}`;

/** Text the wallet signs to sign in. */
export const signInMessage = (address: string, nonce: string) => `Sign in to Kasman\nAddress: ${address}\nNonce: ${nonce}`;

const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};

const sessionToken = (req: Request) => req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([0-9a-f]+)`))?.[1];

async function sessionAddress(req: Request, env: Env): Promise<string | null> {
  const token = sessionToken(req);
  if (!token) return null;
  const row = await env.DB.prepare("SELECT address FROM sessions WHERE token = ?").bind(token).first<{ address: string }>();
  return row?.address ?? null;
}

async function requireAddress(req: Request, env: Env) {
  const address = await sessionAddress(req, env);
  if (!address) throw new HttpError(401, "Connect your wallet first");
  return address;
}

async function me(env: Env, address: string | null) {
  if (!address) return { address: null, name: "", tickets: 0, lives: 0, skins: [] as string[], freeGamesLeft: 0 };
  const [player, inv, free] = await Promise.all([
    env.DB.prepare("SELECT name FROM players WHERE address = ?").bind(address).first<{ name: string }>(),
    env.DB.prepare("SELECT kind, item, qty FROM inventory WHERE address = ?").bind(address).all<{ kind: string; item: string; qty: number }>(),
    env.DB.prepare("SELECT granted - used AS left FROM free_games WHERE address = ? AND day = ?").bind(address, today()).first<{ left: number }>(),
  ]);
  const qty = (kind: string) => inv.results.find((r) => r.kind === kind)?.qty ?? 0;
  return {
    address,
    name: player?.name ?? "",
    tickets: qty("ticket"),
    lives: qty("lives"),
    skins: inv.results.filter((r) => r.kind === "skin").map((r) => r.item),
    freeGamesLeft: free?.left ?? 0,
  };
}

const addInventory = (env: Env, address: string, kind: string, item: string, qty: number) =>
  env.DB.prepare(
    "INSERT INTO inventory (address, kind, item, qty) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (address, kind, item) DO UPDATE SET qty = qty + ?4",
  ).bind(address, kind, item, qty);

interface KaspaTx {
  is_accepted: boolean;
  payload: string | null;
  block_time: number;
  inputs: { previous_outpoint_address: string | null; signature_script: string; covenant_id?: string | null }[] | null;
  outputs: { amount: number; script_public_key_address: string; covenant_id?: string | null }[] | null;
}

async function kaspaTx(env: Env, txId: string): Promise<KaspaTx> {
  if (!/^[0-9a-f]{64}$/.test(txId)) throw new HttpError(400, "Bad transaction id");
  const res = await fetch(`${env.KASPA_API}/transactions/${txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`);
  if (res.status === 404) throw new HttpError(202, "Transaction not found yet");
  if (!res.ok) throw new HttpError(502, `Kaspa API error ${res.status}`);
  const tx = (await res.json()) as KaspaTx;
  if (!tx.is_accepted) throw new HttpError(202, "Transaction not accepted yet");
  return tx;
}

const hexToText = (hex: string) => new TextDecoder().decode(new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16))));

/**
 * Checks a payment on chain: accepted, paid from the order's (connected) address to the
 * order's pool address, with the order id in the payload and the full amount. Entries may also
 * carry the player's KasmanRewards record (an input from the covenant); a wallet input proves
 * the payer. Throws 202 while the transaction is not accepted yet, so the client can retry.
 */
export async function verifyPayment(env: Env, txId: string, order: { id: string; pool: string; sompi: number; address: string }) {
  const tx = await kaspaTx(env, txId);
  if (parsePayload(hexToText(tx.payload ?? ""))?.orderId !== order.id) throw new HttpError(400, "Transaction is for another order");
  const paid = (tx.outputs ?? []).filter((o) => o.script_public_key_address === order.pool).reduce((sum, o) => sum + Number(o.amount), 0);
  if (paid < order.sompi) throw new HttpError(400, "Amount too low");
  const payers = (tx.inputs ?? []).map((i) => i.previous_outpoint_address);
  if (payers.length === 0 || payers.some((p) => !p)) throw new HttpError(202, "Payer not resolved yet");
  if (!payers.includes(order.address)) throw new HttpError(400, "Pay from the connected wallet");
}

/**
 * Today's free games from a staked NFT: `txId` must be an accepted transaction of today where
 * the player's genuine KasmanNFT (collection covenant ID), staked (LOCKED), takes part through
 * `stakeUse` (spent and recreated unchanged). The NFT's own script allows that once per 24 h.
 */
async function grantFreeGames(env: Env, address: string, txId: string) {
  const tx = await kaspaTx(env, txId);
  if (today(new Date(tx.block_time)) !== today()) throw new HttpError(400, "That check-in is not from today");
  const spent = (tx.inputs ?? []).find((i) => i.covenant_id === onchain.nft.covid);
  const redeem = spent && pushes(hexToBytes(spent.signature_script)).at(-1);
  const nft = redeem ? parseNft(onchain.nft.template, redeem) : null;
  if (!nft || nft.mode !== LOCKED) throw new HttpError(400, "No staked Kasman NFT in that transaction");
  if (schnorrAddress(onchain.addressPrefix, nft.owner) !== address) throw new HttpError(400, "That NFT belongs to another wallet");
  const kept = p2shAddress(onchain.addressPrefix, nftRedeem(nft));
  if (!(tx.outputs ?? []).some((o) => o.covenant_id === onchain.nft.covid && o.script_public_key_address === kept)) {
    throw new HttpError(400, "The NFT did not stay staked");
  }
  // One grant per wallet per day; a later check-in the same day changes nothing.
  await env.DB.prepare(
    `INSERT INTO free_games (address, day, granted, used) VALUES (?1, ?2, ?3, 0)
     ON CONFLICT (address) DO UPDATE SET day = excluded.day, granted = excluded.granted, used = 0 WHERE free_games.day IS NOT excluded.day`,
  ).bind(address, today(), rarityOf(nft.tokenId).freeGames).run();
}

export interface Row {
  address: string;
  name: string;
  totalScore: number;
  games: number;
  bestScore: number;
  bestLevel: number;
  bestFrames: number | null;
  bestScoreFrames: number;
}

/** Ranked by total points; faster full clear breaks ties; address makes the order total. One row read per player. */
export async function leaderboard(env: Env, month: string): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    `SELECT m.address, COALESCE(p.name, 'Anonymous') AS name, m.total AS totalScore, m.games, m.best_score AS bestScore,
       m.best_level AS bestLevel, m.best_frames AS bestFrames, m.best_score_frames AS bestScoreFrames
     FROM monthly m LEFT JOIN players p ON p.address = m.address
     WHERE m.month = ?
     ORDER BY m.total DESC, m.best_frames IS NULL, m.best_frames ASC, m.address ASC`,
  ).bind(month).all<Row>();
  return results;
}

/** The month's ranking and every game's result, exactly as hashed into the payout root. */
async function monthExport(env: Env, month: string) {
  const rows = await leaderboard(env, month);
  const { results: games } = await env.DB.prepare(
    "SELECT id, address, score, level, frames, won FROM games WHERE month = ? AND submitted_at IS NOT NULL ORDER BY id",
  ).bind(month).all();
  return JSON.stringify({ month, pool: poolAddress(month), rows, games });
}

async function signIn(env: Env, body: Record<string, unknown>) {
  const address = String(body.address);
  const nonce = await env.DB.prepare("DELETE FROM nonces WHERE nonce = ? AND address = ? RETURNING created_at")
    .bind(String(body.nonce), address)
    .first<{ created_at: number }>();
  if (!nonce || Date.now() - nonce.created_at > NONCE_TTL_MS) throw new HttpError(401, "Sign-in expired, try again");
  if (!verifyWalletSignature(address, signInMessage(address, String(body.nonce)), String(body.publicKey), String(body.signature))) {
    throw new HttpError(401, "Signature does not match the wallet");
  }
  const token = randomHex(32);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessions (token, address, created_at) VALUES (?, ?, ?)").bind(token, address, Date.now()),
    env.DB.prepare("INSERT OR IGNORE INTO players (address) VALUES (?)").bind(address),
    env.DB.prepare("DELETE FROM nonces WHERE created_at < ?").bind(Date.now() - NONCE_TTL_MS),
  ]);
  return json(await me(env, address), {
    headers: { "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000` },
  });
}

async function submitScore(env: Env, address: string, body: Record<string, unknown>) {
  const game = await env.DB.prepare("SELECT id, seed, started_at, submitted_at FROM games WHERE id = ? AND address = ?")
    .bind(String(body.gameId), address)
    .first<{ id: string; seed: number; started_at: number; submitted_at: number | null }>();
  if (!game) throw new HttpError(404, "Unknown game");
  if (game.submitted_at) throw new HttpError(409, "This run was already submitted");
  const now = Date.now();
  if (now - game.started_at > GAME_TTL_MS) throw new HttpError(410, "Game expired");

  const verifier = env.VERIFIER.get(env.VERIFIER.idFromName(`verifier-${parseInt(game.id.slice(0, 8), 16) % VERIFIERS}`));
  const result = (await verifier.verify(String(body.replay))) as Verified | null;
  if (!result) throw new HttpError(400, "Invalid replay");
  if (result.seed !== game.seed) throw new HttpError(400, "Replay is not from this game");
  // Pauses only add wall time, so a real run always took at least this long.
  if (now - game.started_at < (result.frames / FPS) * 1000 * 0.95) throw new HttpError(400, "Run finished faster than real time");
  if (result.score !== body.score) throw new HttpError(400, "Score does not match replay");
  const owned = await env.DB.prepare("SELECT qty FROM inventory WHERE address = ? AND kind = 'lives' AND item = ''").bind(address).first<{ qty: number }>();
  if (result.boughtLives > (owned?.qty ?? 0)) throw new HttpError(400, "Replay uses more bought lives than owned");

  // One transaction. The game update claims the submit with a token; the other statements only
  // act when this request holds it, so a concurrent second submit of the same game does nothing.
  // CHECK (qty >= 0) rolls everything back if the lives were spent meanwhile.
  const month = currentMonth(new Date(now));
  const token = randomHex(8);
  const claimed = "EXISTS (SELECT 1 FROM games WHERE id = ?1 AND submit_token = ?2)";
  const bestFrames = result.won ? result.frame : null;
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE games SET submitted_at = ?, submit_token = ?, month = ?, score = ?, level = ?, frames = ?, won = ? WHERE id = ? AND submitted_at IS NULL",
    ).bind(now, token, month, result.score, result.level, result.frame, result.won ? 1 : 0, game.id),
    env.DB.prepare(`UPDATE inventory SET qty = qty - ?3 WHERE address = ?4 AND kind = 'lives' AND item = '' AND ?3 > 0 AND ${claimed}`)
      .bind(game.id, token, result.boughtLives, address),
    env.DB.prepare(
      `INSERT INTO monthly (month, address, total, games, best_score, best_level, best_frames, best_score_frames)
       SELECT ?3, ?4, ?5, 1, ?5, ?6, ?7, ?8 WHERE ${claimed}
       ON CONFLICT (month, address) DO UPDATE SET
         total = total + excluded.total,
         games = games + 1,
         best_level = MAX(best_level, excluded.best_level),
         best_frames = CASE WHEN excluded.best_frames IS NOT NULL AND (best_frames IS NULL OR excluded.best_frames < best_frames)
           THEN excluded.best_frames ELSE best_frames END,
         best_score_frames = CASE WHEN excluded.best_score > best_score THEN excluded.best_score_frames ELSE best_score_frames END,
         best_score = MAX(best_score, excluded.best_score)`,
    ).bind(game.id, token, month, address, result.score, result.level, bestFrames, result.frame),
  ]).catch(() => {
    throw new HttpError(400, "Replay uses more bought lives than owned");
  });
  if (results[0].meta.changes !== 1) throw new HttpError(409, "This run was already submitted");
  return { score: result.score, month };
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};

  if (path === "/api/me" && req.method === "GET") return json(await me(env, await sessionAddress(req, env)));

  if (path === "/api/auth/nonce" && req.method === "POST") {
    const address = String(body.address);
    if (!new RegExp(`^${ADDRESS_PREFIX}:q[a-z0-9]{60,62}$`).test(address)) throw new HttpError(400, `Use a ${pools.network} wallet address`);
    const nonce = randomHex(16);
    await env.DB.prepare("INSERT INTO nonces (nonce, address, created_at) VALUES (?, ?, ?)").bind(nonce, address, Date.now()).run();
    return json({ nonce, message: signInMessage(address, nonce) });
  }

  if (path === "/api/auth/verify" && req.method === "POST") return signIn(env, body);

  if (path === "/api/auth/logout" && req.method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(sessionToken(req) ?? "").run();
    return json(await me(env, null), { headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` } });
  }

  if (path === "/api/order" && req.method === "POST") {
    const address = await requireAddress(req, env);
    const kind = String(body.kind);
    const item = kind === "entry" ? "" : String(body.item ?? "");
    const sompi = price(kind, item);
    const month = currentMonth();
    const order = { id: randomHex(8), pool: poolAddress(month) };
    await env.DB.prepare("INSERT INTO orders (id, address, kind, item, sompi, pool, month, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(order.id, address, kind, item, sompi, order.pool, month, Date.now())
      .run();
    return json({ orderId: order.id, address: order.pool, sompi, month, payload: orderPayload(order.id) });
  }

  if (path === "/api/pay" && req.method === "POST") {
    const address = await requireAddress(req, env);
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ? AND address = ?")
      .bind(String(body.orderId), address)
      .first<{ id: string; kind: string; item: string; sompi: number; pool: string; address: string; paid_at: number | null }>();
    if (!order) throw new HttpError(404, "Unknown order");
    if (!order.paid_at) {
      const txId = String(body.txId);
      await verifyPayment(env, txId, order);
      const claim = await env.DB.prepare("UPDATE orders SET tx_id = ?, paid_at = ? WHERE id = ? AND paid_at IS NULL")
        .bind(txId, Date.now(), order.id)
        .run()
        .catch(() => {
          throw new HttpError(409, "Transaction already used");
        });
      if (claim.meta.changes === 1) {
        const [kind, item, qty] = order.kind === "entry" ? ["ticket", "", 1] : order.kind === "lives" ? ["lives", "", Number(order.item)] : ["skin", order.item, 1];
        await addInventory(env, address, kind as string, item as string, qty as number).run();
      }
    }
    return json(await me(env, address));
  }

  if (path === "/api/game/start" && req.method === "POST") {
    const address = await requireAddress(req, env);
    const name = String(body.name ?? "").trim().slice(0, 16);
    // Today's free games from a staked NFT go first, then paid tickets.
    const free = await env.DB.prepare("UPDATE free_games SET used = used + 1 WHERE address = ? AND day = ? AND used < granted").bind(address, today()).run();
    if (free.meta.changes !== 1) {
      const used = await env.DB.prepare("UPDATE inventory SET qty = qty - 1 WHERE address = ? AND kind = 'ticket' AND qty > 0").bind(address).run();
      if (used.meta.changes !== 1) throw new HttpError(402, "No entries left");
    }
    const game = { id: randomHex(16), seed: (crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646) + 1 };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO games (id, address, seed, started_at) VALUES (?, ?, ?, ?)").bind(game.id, address, game.seed, Date.now()),
      ...(name ? [env.DB.prepare("UPDATE players SET name = ? WHERE address = ?").bind(name, address)] : []),
    ]);
    return json({ gameId: game.id, seed: game.seed });
  }

  if (path === "/api/free" && req.method === "POST") {
    const address = await requireAddress(req, env);
    await grantFreeGames(env, address, String(body.txId));
    return json(await me(env, address));
  }

  if (path === "/api/score" && req.method === "POST") return json(await submitScore(env, await requireAddress(req, env), body));

  if (path === "/api/leaderboard" && req.method === "GET") {
    return json(await leaderboard(env, url.searchParams.get("month") ?? currentMonth()), { headers: { "cache-control": "public, max-age=30" } });
  }

  if (path === "/api/pool" && req.method === "GET") {
    const month = url.searchParams.get("month") ?? currentMonth();
    const res = await fetch(`${env.KASPA_API}/addresses/${poolAddress(month)}/balance`);
    if (!res.ok) throw new HttpError(502, `Kaspa API error ${res.status}`);
    const { balance } = (await res.json()) as { balance: number };
    return json({ month, address: poolAddress(month), kas: balance / SOMPI }, { headers: { "cache-control": "public, max-age=30" } });
  }

  // Available any time: the owner decides when to pay the winner.
  const month = path.match(/^\/api\/month\/(\d{4}-\d{2})\/(export|settlement)$/);
  if (month && req.method === "GET") {
    const [, m, what] = month;
    const exported = await monthExport(env, m);
    if (what === "export") return new Response(exported, { headers: { "content-type": "application/json" } });
    const winner = (JSON.parse(exported) as { rows: Row[] }).rows[0]?.address;
    // No verified game this month: the pool can be moved into next month's pool.
    return json({ month: m, winner: winner ?? poolAddress(nextMonth(m)), rollover: !winner, root: await sha256Hex(exported) });
  }

  throw new HttpError(404, "Not found");
}

/** Public GETs (leaderboard, pool) are served from the edge cache for 30 s. Needs a custom domain; no-op on workers.dev. */
const CACHED = new Set(["/api/leaderboard", "/api/pool"]);

export default {
  async fetch(req, env, ctx) {
    const cache = typeof caches === "undefined" ? null : caches.default;
    const cacheable = cache && req.method === "GET" && CACHED.has(new URL(req.url).pathname);
    if (cacheable) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    try {
      const res = await handle(req, env);
      if (cacheable && res.ok) ctx.waitUntil(cache.put(req, res.clone()));
      return res;
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
      console.error(e);
      return json({ error: "Server error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
