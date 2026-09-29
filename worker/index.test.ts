import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { schnorr } from "@noble/curves/secp256k1.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUY_LIFE, NONE } from "../src/game/engine/constants";
import { createGame, step } from "../src/game/engine/game";
import { createRecorder, encodeReplay } from "../src/game/engine/replay";
import { FREE, LOCKED, addressPubkey, config, entrySigscript, nftRedeem, p2shAddress, pushInt } from "../src/lib/covenant";
import { schnorrAddress } from "./auth";
import worker, { orderPayload, type Env } from "./index";
import pools from "./pools.json";
import { verifyReplay } from "./verifier";

/** Just enough of D1 on top of node:sqlite for the Worker's queries. */
function d1(db: DatabaseSync) {
  const exec = (sql: string, args: SQLInputValue[]) => {
    const stmt = db.prepare(sql);
    if (/^\s*SELECT|RETURNING/i.test(sql)) return { results: stmt.all(...args), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(stmt.run(...args).changes) } };
  };
  const statement = (sql: string, args: SQLInputValue[] = []) => ({
    sql,
    args,
    bind: (...a: SQLInputValue[]) => statement(sql, a),
    first: async () => exec(sql, args).results[0] ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: ReturnType<typeof statement>[]) => {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => exec(s.sql, s.args));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}

function play(seed: number, buyLives = 0, frames = 3000) {
  const s = createGame(seed);
  const rec = createRecorder(s.seed);
  let r = seed;
  while (s.frame < frames && s.phase !== "gameover") {
    r = (r * 48271) % 2147483647;
    const input = s.frame < buyLives ? BUY_LIFE : r % 20 === 0 ? r % 4 : NONE;
    rec.record(s, input);
    step(s, input);
  }
  return { score: s.score, replay: encodeReplay(rec.replay) };
}

/** A KasWare-like wallet: signs with the Kaspa personal message digest. */
function wallet() {
  const secret = schnorr.utils.randomSecretKey();
  const publicKey = schnorr.getPublicKey(secret);
  return {
    address: schnorrAddress("kaspatest", publicKey),
    publicKey: bytesToHex(publicKey),
    sign: (message: string) =>
      bytesToHex(
        schnorr.sign(blake2b(new TextEncoder().encode(message), { key: new TextEncoder().encode("PersonalMessageSigningHash"), dkLen: 32 }), secret),
      ),
  };
}

const MONTH = "2026-10";
const POOL = (pools.pools as Record<string, string>)[MONTH];
const hex = (text: string) => [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("worker", () => {
  let env: Env;
  let db: DatabaseSync;
  /** Transactions the fake Kaspa API knows, by id. */
  let chain: Map<string, object>;
  let cookie = "";
  let player: ReturnType<typeof wallet>;

  const call = async (path: string, body?: unknown) => {
    const init: RequestInit = { headers: { cookie } };
    if (body !== undefined) Object.assign(init, { method: "POST", body: JSON.stringify(body) });
    const res = await worker.fetch(new Request(`https://kasman.test/api${path}`, init) as never, env, { waitUntil: () => {} } as never);
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: res.status, data: (await res.json()) as Record<string, never> };
  };

  const connect = async (w = player) => {
    const { data } = await call("/auth/nonce", { address: w.address });
    return call("/auth/verify", { address: w.address, nonce: data.nonce, publicKey: w.publicKey, signature: w.sign(data.message) });
  };

  /** Creates an order and puts a matching accepted payment on the fake chain. */
  const buy = async (kind: string, item?: string, tx: { amount?: number; payload?: string; accepted?: boolean; from?: string } = {}) => {
    const { data: order } = await call("/order", { kind, item });
    const txId = crypto.randomUUID().replace(/-/g, "").repeat(2);
    chain.set(txId, {
      is_accepted: tx.accepted ?? true,
      payload: hex(tx.payload ?? orderPayload(order.orderId)),
      inputs: [{ previous_outpoint_address: tx.from ?? player.address }],
      outputs: [{ amount: tx.amount ?? order.sompi, script_public_key_address: order.address }],
    });
    return { order, txId, pay: () => call("/pay", { orderId: order.orderId, txId }) };
  };

  const startedMinutesAgo = (gameId: string, minutes: number) =>
    db.prepare("UPDATE games SET started_at = ? WHERE id = ?").run(Date.now() - minutes * 60_000, gameId);

  /** Starts a paid game, backdates it and submits `run`. */
  const playAndSubmit = async (run: (seed: number) => { score: number; replay: string }) => {
    await (await buy("entry")).pay();
    const { data: game } = await call("/game/start", {});
    startedMinutesAgo(game.gameId, 5);
    const r = run(game.seed);
    return { game, run: r, res: await call("/score", { gameId: game.gameId, replay: r.replay, score: r.score }) };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${MONTH}-15T12:00:00Z`));
    db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
    chain = new Map();
    cookie = "";
    player = wallet();
    env = {
      DB: d1(db),
      KASPA_API: "https://kaspa.test",
      VERIFIER: { idFromName: (n: string) => n, get: () => ({ verify: verifyReplay }) } as never,
    };
    vi.stubGlobal("fetch", async (url: string) => {
      const txId = url.match(/transactions\/([0-9a-f]{64})/)?.[1];
      const tx = txId && chain.get(txId);
      return tx ? Response.json(tx) : new Response("{}", { status: 404 });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("signs in only with a signature from the wallet of that address", async () => {
    expect((await call("/order", { kind: "entry" })).status).toBe(401);
    expect((await call("/auth/nonce", { address: "kaspa:qrunpzspjfvvxyzfx38ct7ya2g5m2vwggkpklxdsscqlzyauuqm0ju6q2fjpa" })).status).toBe(400);

    const other = wallet();
    const { data } = await call("/auth/nonce", { address: player.address });
    const forged = await call("/auth/verify", { address: player.address, nonce: data.nonce, publicKey: other.publicKey, signature: other.sign(data.message) });
    expect(forged.status).toBe(401);
    // The nonce is gone after one attempt.
    const reused = await call("/auth/verify", { address: player.address, nonce: data.nonce, publicKey: player.publicKey, signature: player.sign(data.message) });
    expect(reused.status).toBe(401);

    const ok = await connect();
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ address: player.address, tickets: 0 });
    expect((await call("/me")).data).toMatchObject({ address: player.address });

    await call("/auth/logout", {});
    expect((await call("/me")).data).toMatchObject({ address: null });
  });

  it("credits a payment only from the connected wallet, to the pool, with the order payload and full amount", async () => {
    await connect();
    expect((await buy("entry", undefined, { payload: "kasman:other" }).then((b) => b.pay())).status).toBe(400);
    expect((await buy("entry", undefined, { amount: 1 }).then((b) => b.pay())).data).toMatchObject({ error: "Amount too low" });
    expect((await buy("entry", undefined, { from: wallet().address }).then((b) => b.pay())).data).toMatchObject({ error: "Pay from the connected wallet" });
    expect((await buy("entry", undefined, { accepted: false }).then((b) => b.pay())).status).toBe(202);
    expect((await call("/order", { kind: "skin", item: "no-such-skin" })).status).toBe(400);

    const entry = await buy("entry");
    expect(entry.order.address).toBe(POOL);
    expect((await entry.pay()).data).toMatchObject({ tickets: 1 });
    // Asking again for the same order does not credit twice.
    expect((await entry.pay()).data).toMatchObject({ tickets: 1 });

    // The same transaction cannot pay a second order.
    const other = await buy("entry");
    expect((await call("/pay", { orderId: other.order.orderId, txId: entry.txId })).status).toBe(400);

    // Another player cannot claim this player's order.
    const mine = await buy("lives", "3");
    await connect(wallet());
    expect((await mine.pay()).status).toBe(404);
    await connect();
    await mine.pay();
    await (await buy("skin", "inferno")).pay();
    expect((await call("/me")).data).toMatchObject({ tickets: 1, lives: 3, skins: ["inferno"] });
  });

  it("verifies replays against the server seed before they count", async () => {
    await connect();
    await (await buy("entry")).pay();
    const { data: game } = await call("/game/start", { name: "Neo" });
    expect((await call("/game/start", {})).status).toBe(402);

    const run = play(game.seed);
    const foreign = play(game.seed + 1);
    expect((await call("/score", { gameId: game.gameId, replay: run.replay, score: run.score })).data).toMatchObject({
      error: "Run finished faster than real time",
    });
    startedMinutesAgo(game.gameId, 5);
    expect((await call("/score", { gameId: game.gameId, replay: "garbage", score: 0 })).data).toMatchObject({ error: "Invalid replay" });
    expect((await call("/score", { gameId: game.gameId, replay: foreign.replay, score: foreign.score })).status).toBe(400);
    expect((await call("/score", { gameId: game.gameId, replay: run.replay, score: run.score + 1 })).status).toBe(400);
    expect((await call("/score", { gameId: game.gameId, replay: run.replay, score: run.score })).status).toBe(200);
    expect((await call("/score", { gameId: game.gameId, replay: run.replay, score: run.score })).status).toBe(409);

    const { data: rows } = await call("/leaderboard");
    expect(rows).toMatchObject([{ address: player.address, name: "Neo", totalScore: run.score, games: 1, bestScore: run.score }]);
  });

  it("sums every game into one leaderboard row", async () => {
    await connect();
    const a = await playAndSubmit((seed) => play(seed, 0, 600));
    const b = await playAndSubmit((seed) => play(seed, 0, 3000));
    const c = await playAndSubmit((seed) => play(seed, 0, 100));
    const runs = [a, b, c];
    const best = runs.reduce((x, y) => (y.run.score > x.run.score ? y : x));
    expect(runs.every((r) => r.res.status === 200)).toBe(true);

    const { data: rows } = await call("/leaderboard");
    expect(rows).toMatchObject([
      { totalScore: runs.reduce((sum, r) => sum + r.run.score, 0), games: 3, bestScore: best.run.score },
    ]);
    // Replays are only checked, never stored.
    expect(db.prepare("PRAGMA table_info(games)").all().map((c) => c.name)).not.toContain("replay");
  });

  it("only accepts bought lives the player owns", async () => {
    await connect();
    await (await buy("lives", "3")).pay();
    const greedy = await playAndSubmit((seed) => play(seed, 4));
    expect(greedy.res.data).toMatchObject({ error: "Replay uses more bought lives than owned" });

    const ok = await playAndSubmit((seed) => play(seed, 2));
    expect(ok.res.status).toBe(200);
    expect((await call("/me")).data).toMatchObject({ lives: 1 });
  });

  it("publishes the settlement any time, with a root anyone can recompute", async () => {
    await connect();
    await playAndSubmit((seed) => play(seed));
    const { data: settlement } = await call(`/month/${MONTH}/settlement`);
    expect(settlement).toMatchObject({ month: MONTH, winner: player.address, rollover: false });
    const exported = await worker.fetch(new Request(`https://kasman.test/api/month/${MONTH}/export`) as never, env, {} as never);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(await exported.text()));
    expect(Buffer.from(digest).toString("hex")).toBe(settlement.root);

    // A month without games can be moved into the next month's pool.
    expect((await call("/month/2026-11/settlement")).data).toMatchObject({ rollover: true, winner: (pools.pools as Record<string, string>)["2026-12"] });
  });

  /** An accepted check-in transaction on the fake chain where `owner`'s NFT takes part through stakeUse. */
  const checkInTx = (owner: string, tokenId: number, opts: { mode?: number; keep?: boolean; time?: number } = {}) => {
    const nft = { tokenId, owner: addressPubkey(owner), mode: opts.mode ?? LOCKED, price: 0n };
    const redeem = nftRedeem(nft);
    const txId = crypto.randomUUID().replace(/-/g, "").repeat(2);
    chain.set(txId, {
      is_accepted: true,
      payload: hex("kasman:|r=30,0"),
      block_time: opts.time ?? Date.now(),
      inputs: [
        { previous_outpoint_address: "kaspatest:record", signature_script: "00", covenant_id: config.rewards.covid },
        { previous_outpoint_address: "kaspatest:nft", signature_script: Buffer.from(entrySigscript([pushInt(2)], config.nft.entries.stakeUse, redeem)).toString("hex"), covenant_id: config.nft.covid },
        { previous_outpoint_address: owner, signature_script: "41", covenant_id: null },
      ],
      outputs: [
        { amount: 200000000, script_public_key_address: "kaspatest:record2", covenant_id: config.rewards.covid },
        { amount: 200000000, script_public_key_address: p2shAddress(config.addressPrefix, opts.keep === false ? nftRedeem({ ...nft, mode: FREE }) : redeem), covenant_id: config.nft.covid },
      ],
    });
    return txId;
  };

  it("gives today's free games for a staked NFT's on-chain check-in, by rarity, once a day", async () => {
    await connect();
    expect((await call("/me")).data).toMatchObject({ freeGamesLeft: 0 });
    // Legendary (#2851-3000): 4 free games a day.
    const legendary = checkInTx(player.address, 2900);
    expect((await call("/free", { txId: legendary })).data).toMatchObject({ freeGamesLeft: 4 });
    for (let i = 0; i < 4; i++) {
      const { data: game } = await call("/game/start", {});
      expect(game.gameId).toBeTruthy();
    }
    // Then paid tickets only; a second check-in the same day grants nothing more.
    expect((await call("/game/start", {})).status).toBe(402);
    expect((await call("/free", { txId: checkInTx(player.address, 2900) })).data).toMatchObject({ freeGamesLeft: 0 });

    expect((await call("/free", { txId: checkInTx(wallet().address, 2900) })).data).toMatchObject({ error: "That NFT belongs to another wallet" });
    expect((await call("/free", { txId: checkInTx(player.address, 7, { mode: FREE }) })).status).toBe(400);
    expect((await call("/free", { txId: checkInTx(player.address, 7, { keep: false }) })).data).toMatchObject({ error: "The NFT did not stay staked" });
    expect((await call("/free", { txId: checkInTx(player.address, 7, { time: Date.now() - 86_400_000 }) })).data).toMatchObject({ error: "That check-in is not from today" });

    // Next day: a common NFT's single free game.
    vi.setSystemTime(new Date(`${MONTH}-16T12:00:00Z`));
    expect((await call("/me")).data).toMatchObject({ freeGamesLeft: 0 });
    expect((await call("/free", { txId: checkInTx(player.address, 7) })).data).toMatchObject({ freeGamesLeft: 1 });
  });

  it("accepts an entry paid together with the rewards record (payer in any input)", async () => {
    await connect();
    const { data: order } = await call("/order", { kind: "entry" });
    expect(order.month).toBe(MONTH);
    const txId = crypto.randomUUID().replace(/-/g, "").repeat(2);
    chain.set(txId, {
      is_accepted: true,
      payload: hex(`kasman:${order.orderId}|r=20,0`),
      inputs: [{ previous_outpoint_address: "kaspatest:record" }, { previous_outpoint_address: player.address }],
      outputs: [{ amount: 200000000, script_public_key_address: "kaspatest:record2" }, { amount: order.sompi, script_public_key_address: order.address }],
    });
    expect((await call("/pay", { orderId: order.orderId, txId })).data).toMatchObject({ tickets: 1 });
  });
});
