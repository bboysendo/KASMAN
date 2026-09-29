// On-chain side of the game, in the browser: finds the player's reward record, NFTs, the minter
// and the covenant roots on Kaspa, builds the covenant transactions (contracts/*.sil), has
// KasWare sign the wallet's own inputs (signPskt) and broadcasts them through a public node
// (Kaspa SDK wRPC: the REST API cannot submit covenant transactions).
//
// Covenant states are found through transaction payloads (covenant.ts `payloadText`) and always
// checked against the output's address, so a wrong payload can only hide a state, never fake one.
import type * as Kaspa from "kaspa-wasm";
import {
  FREE,
  LOCKED,
  ROOT,
  ROOT_RECORD,
  addressPubkey,
  addressScript,
  branchState,
  bytesToHex,
  config,
  entrySigscript,
  hexToBytes,
  IDENTIFIER_PUBKEY,
  kcc20Redeem,
  kcc20TransferSigscript,
  minterClaimSigscript,
  minterRedeem,
  monthId,
  nftRedeem,
  p2pkScript,
  p2shAddress,
  p2shScript,
  parsePayload,
  payloadText,
  pushData,
  pushInt,
  rarityRules,
  recordRedeem,
  type MinterState,
  type Nft,
  type Record,
} from "./covenant";
import { signWalletInputs } from "./wallet";

export const onchainReady = config.deployed;
const REST = config.network === "mainnet" ? "https://api.kaspa.org" : "https://api-tn10.kaspa.org";
const DAY = BigInt(config.daaPerDay);
const COV_VALUE = BigInt(config.covValue);
/** Change is never smaller than this: tiny outputs cost a lot of storage mass. */
const MIN_CHANGE = 50_000_000n;
const SOMPI = 100_000_000n;

// ---------- SDK and node ----------

let sdk: Promise<typeof Kaspa> | null = null;
/** The Kaspa SDK (≈11 MB of WASM), loaded on the first on-chain action and cached by the browser. */
export function kaspaSdk(): Promise<typeof Kaspa> {
  sdk ??= (async () => {
    const [k, wasm] = await Promise.all([import("kaspa-wasm"), import("kaspa-wasm/kaspa_bg.wasm?url")]);
    await k.default({ module_or_path: wasm.default });
    return k;
  })();
  return sdk;
}

let node: Promise<Kaspa.RpcClient> | null = null;
async function rpc(): Promise<Kaspa.RpcClient> {
  node ??= (async () => {
    const k = await kaspaSdk();
    const client = new k.RpcClient({ resolver: new k.Resolver(), networkId: config.network });
    await client.connect();
    return client;
  })().catch((e) => {
    node = null;
    throw e;
  });
  return node;
}

export interface Utxo {
  txid: string;
  index: number;
  amount: bigint;
  /** Script public key, without its version. */
  script: string;
  daa: bigint;
  covenantId?: string;
}

async function utxos(addresses: string[]): Promise<Utxo[]> {
  const { entries } = await (await rpc()).getUtxosByAddresses(addresses);
  return entries.map((e) => ({
    txid: e.outpoint.transactionId,
    index: e.outpoint.index,
    amount: BigInt(e.amount),
    script: e.scriptPublicKey.script,
    daa: BigInt(e.blockDaaScore),
    covenantId: e.entry.covenantId?.toString(),
  }));
}

export async function virtualDaa(): Promise<bigint> {
  return BigInt((await (await rpc()).getBlockDagInfo()).virtualDaaScore);
}

interface RestTx {
  transaction_id: string;
  payload: string | null;
  is_accepted: boolean;
  block_time: number;
  outputs: { index: number; amount: number; script_public_key_address: string; covenant_id?: string | null }[] | null;
}

const hexText = (hex: string | null) => new TextDecoder().decode(hexToBytes(hex ?? ""));

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${REST}${path}`);
  if (!res.ok) throw new Error(`Kaspa API error ${res.status}`);
  return res.json() as Promise<T>;
}

/** The address's recent accepted transactions with a Kasman payload, newest first. */
async function history(address: string) {
  const txs = await rest<RestTx[]>(`/addresses/${address}/full-transactions?limit=200&resolve_previous_outpoints=no`);
  return txs
    .filter((t) => t.is_accepted)
    .sort((a, b) => b.block_time - a.block_time)
    .map((t) => ({ tx: t, payload: parsePayload(hexText(t.payload)) }))
    .filter((t) => t.payload !== null);
}

/** The unspent output `covenant` holds at `address`, created by one of `txids`. */
async function unspentAt(address: string, covenant: string, txid?: string) {
  return (await utxos([address])).find((u) => u.covenantId === covenant && (!txid || u.txid === txid)) ?? null;
}

// ---------- the player's covenants ----------

export interface Owned<T> {
  state: T;
  utxo: Utxo;
}

export interface Holdings {
  record: Owned<Record> | null;
  nfts: Owned<Nft>[];
  /** KASMAN (whole tokens) minted to this wallet by claims. */
  claimed: number;
}

/** The player's reward record and NFTs, from their wallet's history. */
export async function holdings(wallet: string): Promise<Holdings> {
  const owner = addressPubkey(wallet);
  const txs = await history(wallet);
  let record: Owned<Record> | null = null;
  const nfts = new Map<number, Owned<Nft> | null>();
  let claimed = 0n;
  for (const { tx, payload } of txs) {
    if (payload!.t) claimed += payload!.t;
    if (!record && payload!.r) {
      const state: Record = { root: false, owner, points: payload!.r[0], lastClaimDaa: payload!.r[1] };
      const address = p2shAddress(config.addressPrefix, recordRedeem(state));
      if (tx.outputs?.some((o) => o.script_public_key_address === address && o.covenant_id === config.rewards.covid)) {
        const utxo = await unspentAt(address, config.rewards.covid, tx.transaction_id);
        if (utxo) record = { state, utxo };
      }
    }
    if (payload!.n && !nfts.has(payload!.n[0])) {
      const state: Nft = { tokenId: payload!.n[0], owner, mode: payload!.n[1], price: 0n };
      const address = p2shAddress(config.addressPrefix, nftRedeem(state));
      if (tx.outputs?.some((o) => o.script_public_key_address === address && o.covenant_id === config.nft.covid)) {
        const utxo = await unspentAt(address, config.nft.covid, tx.transaction_id);
        nfts.set(state.tokenId, utxo ? { state, utxo } : null);
      }
    }
  }
  return { record, nfts: [...nfts.values()].filter((n): n is Owned<Nft> => n !== null), claimed: Number(claimed / BigInt(config.tokenUnit)) };
}

const ageOf = (u: Utxo, daa: bigint) => daa - u.daa;

/** When the record can next count a day and next claim, in DAA scores, for the UI. */
export function rewardTimes(h: Holdings, daa: bigint) {
  const staked = h.nfts.filter((n) => n.state.mode === LOCKED);
  const best = staked.reduce<Owned<Nft> | null>((a, n) => (!a || rarityRules(n.state.tokenId).waitDays < rarityRules(a.state.tokenId).waitDays ? n : a), null);
  const waitDays = rarityRules(best?.state.tokenId ?? null).waitDays;
  const nextDay = h.record ? h.record.utxo.daa + DAY : daa;
  const nextClaim = h.record ? (h.record.state.lastClaimDaa === 0n ? daa : h.record.state.lastClaimDaa + BigInt(waitDays) * DAY) : daa;
  return { staked, best, waitDays, nextDay, nextClaim, daa };
}

/** DAA score to milliseconds from now (10 DAA per second). */
export const daaToMs = (target: bigint, daa: bigint) => Math.max(0, Number(target - daa) * 100);

// ---------- global covenants ----------

async function rewardsRoot(): Promise<Utxo> {
  const root = await unspentAt(p2shAddress(config.addressPrefix, recordRedeem(ROOT_RECORD)), config.rewards.covid);
  if (!root) throw new Error("Rewards contract not found on chain");
  return root;
}

async function minter(): Promise<MinterUtxos> {
  const branch = await unspentAt(p2shAddress(config.addressPrefix, kcc20Redeem(branchState())), config.kcc20.covid);
  if (!branch) throw new Error("Busy: another claim is in progress, try again in a few seconds");
  let amount = BigInt(config.maxTokenSupply);
  if (branch.txid !== config.kcc20.genesis.txid) {
    const tx = await rest<RestTx>(`/transactions/${branch.txid}`);
    const m = parsePayload(hexText(tx.payload))?.m;
    if (m === undefined) throw new Error("Cannot read the token minter state");
    amount = m;
  }
  const state: MinterState = { kcc20Covid: hexToBytes(config.kcc20.covid), amount, initialized: true };
  const utxo = await unspentAt(p2shAddress(config.addressPrefix, minterRedeem(state)), config.minter.covid, branch.txid);
  if (!utxo) throw new Error("Cannot find the token minter");
  return { state, utxo, branch };
}

const nftRoot = (tokenId: number): Nft => ({ tokenId, owner: hexToBytes(config.rootOwner), mode: ROOT, price: 0n });

/** The collection root: next token id and its UTXO (null when sold out). */
export async function nextNft(): Promise<{ tokenId: number; utxo: Utxo } | null> {
  const used = async (id: number) =>
    (await rest<{ total: number }>(`/addresses/${p2shAddress(config.addressPrefix, nftRedeem(nftRoot(id)))}/transactions-count`)).total > 0;
  // Root k exists once k-1 NFTs are minted: binary search for the last address with activity.
  let lo = 1;
  let hi = config.maxSupply + 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (await used(mid)) lo = mid;
    else hi = mid - 1;
  }
  if (lo > config.maxSupply) return null;
  const utxo = await unspentAt(p2shAddress(config.addressPrefix, nftRedeem(nftRoot(lo))), config.nft.covid);
  if (!utxo) throw new Error("Busy: another mint is in progress, try again in a few seconds");
  return { tokenId: lo, utxo };
}

// ---------- building and sending ----------

export interface CovenantInput {
  utxo: Utxo;
  /** Sigscript, given the index of the owner's first wallet input. */
  sigscript: (ownerInput: number) => Uint8Array;
  /** Relative lock: the UTXO must be at least this many DAA old. */
  sequence?: bigint;
}

export interface Output {
  value: bigint;
  script: Uint8Array;
  covenant?: { authorizingInput: number; covenantId: string };
}

export interface Draft {
  covenantInputs: CovenantInput[];
  outputs: Output[];
  payload: string;
  lockTime?: bigint;
}

const spkJson = (script: Uint8Array | string) => `0000${typeof script === "string" ? script : bytesToHex(script)}`;

/** Safe JSON of `draft` funded by `wallet` UTXOs (change back to `owner`), for fee `fee`. */
function safeJson(draft: Draft, wallet: Utxo[], owner: Uint8Array, fee: bigint) {
  const ownerInput = draft.covenantInputs.length;
  const totalIn = [...draft.covenantInputs.map((c) => c.utxo), ...wallet].reduce((s, u) => s + u.amount, 0n);
  const totalOut = draft.outputs.reduce((s, o) => s + o.value, 0n);
  const change = totalIn - totalOut - fee;
  const input = (u: Utxo, sigscript: string, sequence: bigint, budget: number) => ({
    transactionId: u.txid,
    index: u.index,
    sequence: sequence.toString(),
    sigOpCount: 0,
    computeBudget: budget,
    signatureScript: sigscript,
    utxo: { amount: u.amount.toString(), scriptPublicKey: spkJson(u.script), blockDaaScore: u.daa.toString(), isCoinbase: false, covenantId: u.covenantId ?? null },
  });
  return {
    change,
    json: JSON.stringify({
      id: "00".repeat(32),
      version: 1,
      inputs: [
        ...draft.covenantInputs.map((c) => input(c.utxo, bytesToHex(c.sigscript(ownerInput)), c.sequence ?? 0n, config.covenantBudget)),
        ...wallet.map((u) => input(u, "", 0n, config.walletBudget)),
      ],
      outputs: [...draft.outputs, { value: change, script: p2pkScript(owner) }].map((o) => ({
        value: o.value.toString(),
        scriptPublicKey: spkJson(o.script),
        covenant: "covenant" in o && o.covenant ? o.covenant : null,
      })),
      subnetworkId: "00".repeat(20),
      lockTime: (draft.lockTime ?? 0n).toString(),
      gas: "0",
      storageMass: "0",
      payload: bytesToHex(new TextEncoder().encode(draft.payload)),
    }),
  };
}

/**
 * Funds `draft` from `walletUtxos` and prices it with the SDK. Returns the transaction ready
 * for KasWare (Safe JSON, id computed) and which inputs are the wallet's.
 */
export function fund(k: typeof Kaspa, draft: Draft, walletUtxos: Utxo[], owner: Uint8Array) {
  const coins = walletUtxos.filter((u) => !u.covenantId).sort((a, b) => (a.amount < b.amount ? 1 : -1));
  const need = draft.outputs.reduce((s, o) => s + o.value, 0n) - draft.covenantInputs.reduce((s, c) => s + c.utxo.amount, 0n);
  let fee = 20_000_000n;
  for (let round = 0; round < 3; round++) {
    const picked: Utxo[] = [];
    let sum = 0n;
    for (const c of coins) {
      if (sum >= need + fee + MIN_CHANGE) break;
      picked.push(c);
      sum += c.amount;
    }
    if (sum < need + fee + MIN_CHANGE || picked.length === 0) {
      throw new Error(`Not enough KAS in your wallet: this needs about ${Number((need + fee + MIN_CHANGE) / 1_000_000n) / 100} KAS`);
    }
    const { json } = safeJson(draft, picked, owner, fee);
    const tx = k.Transaction.deserializeFromSafeJSON(json);
    tx.finalize();
    const minimum = k.calculateTransactionFee(config.network, tx, 1);
    if (minimum === undefined) throw new Error("Transaction too large for the network");
    if (minimum <= fee) {
      return { txJson: tx.serializeToSafeJSON(), walletInputs: picked.map((_, i) => draft.covenantInputs.length + i), fee };
    }
    fee = minimum + minimum / 10n;
  }
  throw new Error("Could not price the transaction");
}

/** Waits until the node lists `txid`'s output at `address` (accepted in a block). */
async function accepted(address: string, txid: string) {
  for (let i = 0; i < 90; i++) {
    if ((await utxos([address])).some((u) => u.txid === txid)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The transaction is taking long to confirm: check your wallet and reload");
}

/** Builds, has KasWare sign the wallet inputs, checks nothing else changed, broadcasts and waits for it. */
async function send(wallet: string, draft: Draft): Promise<string> {
  const k = await kaspaSdk();
  const owner = addressPubkey(wallet);
  const { txJson, walletInputs } = fund(k, draft, await utxos([wallet]), owner);
  const signed = k.Transaction.deserializeFromSafeJSON(await signWalletInputs(wallet, txJson, walletInputs));
  const before = JSON.parse(txJson);
  const after = JSON.parse(signed.serializeToSafeJSON());
  const strip = (t: { inputs: { signatureScript: string }[] }, keep: (i: number) => boolean) =>
    JSON.stringify({ ...t, inputs: t.inputs.map((input, i) => (keep(i) ? input : { ...input, signatureScript: "" })) });
  const isCovenant = (i: number) => i < draft.covenantInputs.length;
  if (strip(before, isCovenant) !== strip(after, isCovenant)) throw new Error("The wallet changed the transaction: not sent");
  if (walletInputs.some((i) => !after.inputs[i].signatureScript)) throw new Error("The wallet did not sign the transaction");
  const { transactionId } = await (await rpc()).submitTransaction({ transaction: signed, allowOrphan: false });
  await accepted(wallet, transactionId);
  return transactionId;
}

const covenantOut = (value: bigint, redeem: Uint8Array, authorizingInput: number, covenantId: string): Output => ({
  value,
  script: p2shScript(redeem),
  covenant: { authorizingInput, covenantId },
});

// ---------- transactions (pure: the flows below find the inputs) ----------

const recordOut = (r: Record, value: bigint, authorizingInput: number) => covenantOut(value, recordRedeem(r), authorizingInput, config.rewards.covid);
const nftOut = (n: Nft, value: bigint, authorizingInput: number) => covenantOut(value, nftRedeem(n), authorizingInput, config.nft.covid);
const nftPayload = (n: Nft): [number, number] => [n.tokenId, n.mode];

export interface EntryOrder {
  orderId: string;
  /** Pool address of `month`. */
  address: string;
  sompi: number;
  month: string;
}

/** First entry: the rewards root opens the player's record (day 1) while the entry goes to the pool. */
export function openDraft(owner: Uint8Array, root: Utxo, order: EntryOrder): Draft {
  const record: Record = { root: false, owner, points: 10, lastClaimDaa: 0n };
  return {
    covenantInputs: [
      { utxo: root, sigscript: () => entrySigscript([pushData(owner), pushInt(2), pushInt(monthId(order.month))], config.rewards.entries.open, recordRedeem(ROOT_RECORD)) },
    ],
    outputs: [recordOut(ROOT_RECORD, root.amount, 0), recordOut(record, COV_VALUE, 0), { value: BigInt(order.sompi), script: addressScript(order.address) }],
    payload: payloadText(order.orderId, { r: [record.points, record.lastClaimDaa] }),
  };
}

/** Entry that counts a day (record untouched for 24 h). */
export function playDraft(rec: Owned<Record>, order: EntryOrder): Draft {
  const next: Record = { ...rec.state, points: rec.state.points + 10 };
  return {
    covenantInputs: [
      {
        utxo: rec.utxo,
        sequence: DAY,
        sigscript: (o) => entrySigscript([pushInt(o), pushInt(1), pushInt(monthId(order.month))], config.rewards.entries.play, recordRedeem(rec.state)),
      },
    ],
    outputs: [recordOut(next, rec.utxo.amount, 0), { value: BigInt(order.sompi), script: addressScript(order.address) }],
    payload: payloadText(order.orderId, { r: [next.points, next.lastClaimDaa] }),
  };
}

/** Entry that does not count a day (plain payment). */
export const entryDraft = (order: EntryOrder): Draft => ({
  covenantInputs: [],
  outputs: [{ value: BigInt(order.sompi), script: addressScript(order.address) }],
  payload: payloadText(order.orderId, {}),
});

const stakeUse = (n: Owned<Nft>): CovenantInput => ({
  utxo: n.utxo,
  sequence: DAY,
  sigscript: (o) => entrySigscript([pushInt(o)], config.nft.entries.stakeUse, nftRedeem(n.state)),
});

export function checkInDraft(rec: Owned<Record>, nft: Owned<Nft>): Draft {
  const next: Record = { ...rec.state, points: rec.state.points + rarityRules(nft.state.tokenId).mult };
  return {
    covenantInputs: [
      { utxo: rec.utxo, sequence: DAY, sigscript: (o) => entrySigscript([pushInt(o), pushInt(1)], config.rewards.entries.checkIn, recordRedeem(rec.state)) },
      stakeUse(nft),
    ],
    outputs: [recordOut(next, rec.utxo.amount, 0), nftOut(nft.state, nft.utxo.amount, 1)],
    payload: payloadText("", { r: [next.points, next.lastClaimDaa], n: nftPayload(nft.state) }),
  };
}

export interface MinterUtxos {
  state: MinterState;
  utxo: Utxo;
  branch: Utxo;
}

/** Claim at DAA `now`: the minter mints the record's points to its owner; a staked NFT shortens the wait. */
export function claimDraft(rec: Owned<Record>, m: MinterUtxos, now: bigint, nft?: Owned<Nft>): { draft: Draft; minted: bigint } {
  let minted = BigInt(rec.state.points) * BigInt(config.tokensPerPoint);
  if (minted > m.state.amount) minted = m.state.amount;
  const next: MinterState = { ...m.state, amount: m.state.amount - minted };
  const branch = branchState();
  const tokens = { owner: rec.state.owner, identifierType: IDENTIFIER_PUBKEY, amount: minted, isMinter: false };
  const after: Record = { ...rec.state, points: 0, lastClaimDaa: now };
  const covenantInputs: CovenantInput[] = [
    { utxo: m.branch, sigscript: () => kcc20TransferSigscript([branch, tokens], kcc20Redeem(branch)) },
    { utxo: m.utxo, sigscript: () => minterClaimSigscript(next, 2, now, branch, minterRedeem(m.state)) },
    { utxo: rec.utxo, sigscript: (o) => entrySigscript([pushInt(o), pushInt(now), pushInt(nft ? 3 : -1)], config.rewards.entries.claim, recordRedeem(rec.state)) },
  ];
  const outputs: Output[] = [
    covenantOut(m.branch.amount, kcc20Redeem(branch), 0, config.kcc20.covid),
    covenantOut(COV_VALUE, kcc20Redeem(tokens), 0, config.kcc20.covid),
    covenantOut(m.utxo.amount, minterRedeem(next), 1, config.minter.covid),
    recordOut(after, rec.utxo.amount, 2),
  ];
  if (nft) {
    covenantInputs.push(stakeUse(nft));
    outputs.push(nftOut(nft.state, nft.utxo.amount, 3));
  }
  const payload = payloadText("", { r: [0, now], m: next.amount, t: minted, ...(nft ? { n: nftPayload(nft.state) } : {}) });
  return { draft: { covenantInputs, outputs, lockTime: now, payload }, minted };
}

export function mintDraft(owner: Uint8Array, root: { tokenId: number; utxo: Utxo }): Draft {
  const nft: Nft = { tokenId: root.tokenId, owner, mode: FREE, price: 0n };
  return {
    covenantInputs: [{ utxo: root.utxo, sigscript: () => entrySigscript([pushData(owner), pushInt(2)], config.nft.entries.mint, nftRedeem(nftRoot(root.tokenId))) }],
    outputs: [
      nftOut(nftRoot(root.tokenId + 1), root.utxo.amount, 0),
      nftOut(nft, COV_VALUE, 0),
      { value: BigInt(config.mintPrice), script: hexToBytes(config.treasurySpk) },
    ],
    payload: payloadText("", { n: nftPayload(nft) }),
  };
}

export function stakeDraft(nft: Owned<Nft>, staked: boolean): Draft {
  const next: Nft = { ...nft.state, mode: staked ? LOCKED : FREE };
  const entry = staked ? config.nft.entries.lock : config.nft.entries.unlock;
  return {
    covenantInputs: [{ utxo: nft.utxo, sigscript: (o) => entrySigscript([pushInt(o)], entry, nftRedeem(nft.state)) }],
    outputs: [nftOut(next, nft.utxo.amount, 0)],
    payload: payloadText("", { n: nftPayload(next) }),
  };
}

// ---------- flows ----------

/**
 * Pays a game entry to the month's pool. With the reward record in the same transaction the
 * day counts on chain (first entry opens the record); within 24 h of the last counted day the
 * entry is a plain payment. Returns the transaction id; `/api/pay` credits the ticket.
 */
export async function payEntry(wallet: string, order: EntryOrder): Promise<string> {
  const [h, daa] = await Promise.all([holdings(wallet), virtualDaa()]);
  if (!h.record) return send(wallet, openDraft(addressPubkey(wallet), await rewardsRoot(), order));
  if (ageOf(h.record.utxo, daa) >= DAY) return send(wallet, playDraft(h.record, order));
  return send(wallet, entryDraft(order));
}

/** Daily check-in with a staked NFT: counts the day at its rarity's multiplier. Returns the transaction id. */
export async function checkIn(wallet: string, nft: Owned<Nft>): Promise<string> {
  const [h, daa] = await Promise.all([holdings(wallet), virtualDaa()]);
  if (!h.record) throw new Error("Pay one game entry first: it opens your rewards record");
  if (ageOf(h.record.utxo, daa) < DAY) throw new Error("Today's day is already counted");
  if (ageOf(nft.utxo, daa) < DAY) throw new Error("This NFT was used less than 24 h ago");
  return send(wallet, checkInDraft(h.record, nft));
}

/** Claims the record's points: DailyMinter mints them as KASMAN to the wallet. */
export async function claim(wallet: string): Promise<{ txid: string; tokens: number }> {
  const [h, daa, m] = await Promise.all([holdings(wallet), virtualDaa(), minter()]);
  const rec = h.record;
  if (!rec || rec.state.points === 0) throw new Error("No rewards to claim yet");
  // A staked NFT shortens the wait if it can take part (used more than 24 h ago).
  const nft = h.nfts
    .filter((n) => n.state.mode === LOCKED && ageOf(n.utxo, daa) >= DAY)
    .sort((a, b) => rarityRules(a.state.tokenId).waitDays - rarityRules(b.state.tokenId).waitDays)[0];
  const now = daa - 600n;
  if (now < rec.state.lastClaimDaa + BigInt(rarityRules(nft?.state.tokenId ?? null).waitDays) * DAY) throw new Error("Your next claim is not ready yet");
  if (m.state.amount === 0n) throw new Error("All KASMAN has been minted");
  const { draft, minted } = claimDraft(rec, m, now, nft);
  return { txid: await send(wallet, draft), tokens: Number(minted / BigInt(config.tokenUnit)) };
}

/** Mints the next NFT of the collection to the wallet, paying the mint price to the treasury. */
export async function mintNft(wallet: string): Promise<{ txid: string; tokenId: number }> {
  const root = await nextNft();
  if (!root) throw new Error("Sold out");
  return { txid: await send(wallet, mintDraft(addressPubkey(wallet), root)), tokenId: root.tokenId };
}

/** Stakes (locks) or unstakes (unlocks) an NFT. */
export const setStaked = (wallet: string, nft: Owned<Nft>, staked: boolean) => send(wallet, stakeDraft(nft, staked));

export const kasFromSompi = (sompi: bigint | number) => Number(BigInt(sompi) / (SOMPI / 100n)) / 100;
