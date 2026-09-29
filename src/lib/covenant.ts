// Byte-level encoding of the Kasman covenants (contracts/*.sil), shared by the web, the Worker
// and the tests. Pure: no SDK, no DOM. Layouts match silverscript 3ed9733 (checked against
// vectors from contracts/tool in covenant.test.ts):
// - contract state inside the redeem script: fixed-width pushes (bool/byte `01 x`,
//   byte[32] `20 ..`, int `08 <int64 LE>`), between a template prefix and suffix;
// - entry / covenant-function arguments: minimal pushes (numbers as script numbers), then
//   the 4-byte selector, then the redeem script.
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import onchain from "./onchain.json";

export { bytesToHex, hexToBytes };
export const config = onchain;

export const ROOT = 0;
export const FREE = 1;
export const LOCKED = 2;
export const LISTED = 3;

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
export { concat };

// ---------- script pushes ----------

/** Push of raw data, as rusty-kaspa's ScriptBuilder.add_data does for data longer than 1 byte. */
export function pushData(data: Uint8Array): Uint8Array {
  const n = data.length;
  if (n === 0) return new Uint8Array([0x00]);
  if (n <= 75) return concat(new Uint8Array([n]), data);
  if (n <= 0xff) return concat(new Uint8Array([0x4c, n]), data);
  if (n <= 0xffff) return concat(new Uint8Array([0x4d, n & 0xff, n >> 8]), data);
  return concat(new Uint8Array([0x4e, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]), data);
}

/** Minimal script number (little endian, sign bit in the top byte). */
export function scriptNum(value: bigint | number): Uint8Array {
  let v = BigInt(value);
  if (v === 0n) return new Uint8Array();
  const negative = v < 0n;
  if (negative) v = -v;
  const bytes: number[] = [];
  while (v > 0n) {
    bytes.push(Number(v & 0xffn));
    v >>= 8n;
  }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(negative ? 0x80 : 0);
  else if (negative) bytes[bytes.length - 1] |= 0x80;
  return new Uint8Array(bytes);
}

/** Push of a number: OP_0, OP_1NEGATE, OP_1..OP_16 or a minimal script number. */
export function pushInt(value: bigint | number): Uint8Array {
  const v = BigInt(value);
  if (v === 0n) return new Uint8Array([0x00]);
  if (v === -1n) return new Uint8Array([0x4f]);
  if (v >= 1n && v <= 16n) return new Uint8Array([0x50 + Number(v)]);
  return pushData(scriptNum(v));
}

export const pushBool = (b: boolean) => pushInt(b ? 1 : 0);

/** Data pushes of a script, in order (non-push opcodes skipped). */
export function pushes(script: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let i = 0;
  while (i < script.length) {
    const op = script[i++];
    let n = -1;
    if (op >= 1 && op <= 75) n = op;
    else if (op === 0x4c) n = script[i++];
    else if (op === 0x4d) {
      n = script[i] | (script[i + 1] << 8);
      i += 2;
    } else if (op === 0x4e) {
      n = script[i] | (script[i + 1] << 8) | (script[i + 2] << 16) | (script[i + 3] << 24);
      i += 4;
    }
    if (n >= 0) {
      out.push(script.slice(i, i + n));
      i += n;
    }
  }
  return out;
}

// ---------- state fields (inside redeem scripts) ----------

const stateBool = (b: boolean) => new Uint8Array([0x01, b ? 1 : 0]);
const stateByte = (b: number) => new Uint8Array([0x01, b]);
const stateBytes32 = (b: Uint8Array) => {
  if (b.length !== 32) throw new Error("expected 32 bytes");
  return concat(new Uint8Array([0x20]), b);
};
const int64 = (v: bigint | number) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, BigInt(v), true);
  return out;
};
const stateInt = (v: bigint | number) => concat(new Uint8Array([0x08]), int64(v));

export interface Template {
  prefix: string;
  suffix: string;
}

export const redeemScript = (t: Template, state: Uint8Array) => concat(hexToBytes(t.prefix), state, hexToBytes(t.suffix));

export interface Nft {
  tokenId: number;
  owner: Uint8Array;
  mode: number;
  price: bigint;
}
export const nftState = (n: Nft) => concat(stateInt(n.tokenId), stateBytes32(n.owner), stateInt(n.mode), stateInt(n.price));

export interface Record {
  root: boolean;
  owner: Uint8Array;
  points: number;
  lastClaimDaa: bigint;
}
export const recordState = (r: Record) => concat(stateBool(r.root), stateBytes32(r.owner), stateInt(r.points), stateInt(r.lastClaimDaa));

export interface MinterState {
  kcc20Covid: Uint8Array;
  amount: bigint;
  initialized: boolean;
}
export const minterState = (m: MinterState) => concat(stateBytes32(m.kcc20Covid), stateInt(m.amount), stateBool(m.initialized));

export const IDENTIFIER_PUBKEY = 0x00;
export const IDENTIFIER_COVENANT_ID = 0x02;
export interface Kcc20State {
  owner: Uint8Array;
  identifierType: number;
  amount: bigint;
  isMinter: boolean;
}
export const kcc20State = (k: Kcc20State) => concat(stateBytes32(k.owner), stateByte(k.identifierType), stateInt(k.amount), stateBool(k.isMinter));

/** Reads a state back from a redeem script of template `t`, or null if it is another script. */
function readState(t: Template, redeem: Uint8Array, stateLength: number): DataView | null {
  const prefix = hexToBytes(t.prefix);
  const suffix = hexToBytes(t.suffix);
  if (redeem.length !== prefix.length + stateLength + suffix.length) return null;
  if (bytesToHex(redeem.slice(0, prefix.length)) !== t.prefix) return null;
  if (bytesToHex(redeem.slice(prefix.length + stateLength)) !== t.suffix) return null;
  return new DataView(redeem.buffer, redeem.byteOffset + prefix.length, stateLength);
}

export function parseNft(t: Template, redeem: Uint8Array): Nft | null {
  const v = readState(t, redeem, 9 + 33 + 9 + 9);
  if (!v) return null;
  return {
    tokenId: Number(v.getBigInt64(1, true)),
    owner: new Uint8Array(v.buffer, v.byteOffset + 10, 32).slice(),
    mode: Number(v.getBigInt64(43, true)),
    price: v.getBigInt64(52, true),
  };
}

// ---------- scripts and addresses ----------

/** P2SH script public key (version 0) of a redeem script: OP_BLAKE2B <hash> OP_EQUAL. */
export const p2shScript = (redeem: Uint8Array) => concat(new Uint8Array([0xaa, 0x20]), blake2b(redeem, { dkLen: 32 }), new Uint8Array([0x87]));

/** P2PK (Schnorr) script public key: <x-only pubkey> OP_CHECKSIG. */
export const p2pkScript = (xOnly: Uint8Array) => concat(new Uint8Array([0x20]), xOnly, new Uint8Array([0xac]));

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]) {
  let c = 1n;
  for (const d of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    if (c0 & 1n) c ^= 0x98f2bc8e61n;
    if (c0 & 2n) c ^= 0x79b76d99e2n;
    if (c0 & 4n) c ^= 0xf33e5fb3c4n;
    if (c0 & 8n) c ^= 0xae2eabe2a8n;
    if (c0 & 16n) c ^= 0x1e4f43e470n;
  }
  return c ^ 1n;
}

function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean) {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    acc = (acc << from) | data[i];
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & max);
  return out;
}

const ADDRESS_VERSION = { pubkey: 0, scriptHash: 8 } as const;

/** Kaspa address: version 0 = Schnorr x-only pubkey, 8 = P2SH script hash. */
export function kaspaAddress(prefix: string, version: number, payload: Uint8Array) {
  const data = convertBits([version, ...payload], 8, 5, true);
  const checksum = polymod([...[...prefix].map((c) => c.charCodeAt(0) & 31), 0, ...data, 0, 0, 0, 0, 0, 0, 0, 0]);
  const checksumBytes = new Uint8Array(5).map((_, i) => Number((checksum >> BigInt(8 * (4 - i))) & 0xffn));
  return `${prefix}:${[...data, ...convertBits(checksumBytes, 8, 5, true)].map((d) => CHARSET[d]).join("")}`;
}

export const schnorrAddress = (prefix: string, xOnly: Uint8Array) => kaspaAddress(prefix, ADDRESS_VERSION.pubkey, xOnly);
export const p2shAddress = (prefix: string, redeem: Uint8Array) => kaspaAddress(prefix, ADDRESS_VERSION.scriptHash, blake2b(redeem, { dkLen: 32 }));

/** Script public key (version 0) paying to a Schnorr or P2SH Kaspa address. */
export function addressScript(address: string): Uint8Array {
  const data = [...address.split(":")[1]].map((c) => CHARSET.indexOf(c));
  const [version, ...payload] = convertBits(data.slice(0, -8), 5, 8, false);
  if (version === ADDRESS_VERSION.pubkey && payload.length === 32) return p2pkScript(new Uint8Array(payload));
  if (version === ADDRESS_VERSION.scriptHash && payload.length === 32) return concat(new Uint8Array([0xaa, 0x20]), new Uint8Array(payload), new Uint8Array([0x87]));
  throw new Error(`Unsupported address ${address}`);
}

/** X-only public key of a Schnorr (version 0) Kaspa address. */
export function addressPubkey(address: string): Uint8Array {
  const data = [...address.split(":")[1]].map((c) => CHARSET.indexOf(c));
  const bytes = convertBits(data.slice(0, -8), 5, 8, false);
  if (bytes[0] !== ADDRESS_VERSION.pubkey || bytes.length !== 33) throw new Error("Use a Schnorr wallet address");
  return new Uint8Array(bytes.slice(1));
}

// ---------- sigscripts ----------

const selectorPush = (selector: string) => pushData(hexToBytes(selector));

/** Sigscript of an `entry`: arguments (already pushed), selector, redeem script. */
export const entrySigscript = (args: Uint8Array[], selector: string, redeem: Uint8Array) => concat(...args, selectorPush(selector), pushData(redeem));

/** DailyMinter `claim(prevState, newState, recordIdx, now, minterKcc20NewState)` (leader). */
export function minterClaimSigscript(next: MinterState, recordIdx: number, now: bigint, branch: Kcc20State, redeem: Uint8Array) {
  return concat(
    pushData(next.kcc20Covid),
    pushInt(next.amount),
    pushBool(next.initialized),
    pushInt(recordIdx),
    pushInt(now),
    pushData(branch.owner),
    pushInt(branch.identifierType),
    pushInt(branch.amount),
    pushBool(branch.isMinter),
    selectorPush(config.minter.claim),
    pushData(redeem),
  );
}

/** KCC20 `transfer(outputStates, sig, sigType)` (leader): arrays of structs are pushed column by column. */
export function kcc20TransferSigscript(outputs: Kcc20State[], redeem: Uint8Array) {
  return concat(
    pushData(concat(...outputs.map((o) => o.owner))),
    pushData(new Uint8Array(outputs.map((o) => o.identifierType))),
    pushData(concat(...outputs.map((o) => int64(o.amount)))),
    pushData(new Uint8Array(outputs.map((o) => (o.isMinter ? 1 : 0)))),
    pushData(new Uint8Array(65)),
    pushInt(0),
    selectorPush(config.kcc20.transfer),
    pushData(redeem),
  );
}

// ---------- the game's covenants ----------

export const nftRedeem = (n: Nft) => redeemScript(config.nft.template, nftState(n));
export const recordRedeem = (r: Record) => redeemScript(config.rewards.template, recordState(r));
export const minterRedeem = (m: MinterState) => redeemScript(config.minter.template, minterState(m));
export const kcc20Redeem = (k: Kcc20State) => redeemScript(config.kcc20.template, kcc20State(k));

/** The KCC20 branch the minter owns: its state never changes, so neither does its address. */
export const branchState = (): Kcc20State => ({
  owner: hexToBytes(config.minter.covid),
  identifierType: IDENTIFIER_COVENANT_ID,
  amount: 0n,
  isMinter: true,
});

export const ROOT_RECORD: Record = { root: true, owner: new Uint8Array(32), points: 0, lastClaimDaa: 0n };

/** Rarity by token id, as KasmanRewards.sil computes it: multiplier in tenths and claim wait in days. */
export function rarityRules(tokenId: number | null) {
  if (!tokenId) return { mult: 10, waitDays: 7 };
  if (tokenId > 2850) return { mult: 20, waitDays: 1 };
  if (tokenId > 2400) return { mult: 16, waitDays: 2 };
  if (tokenId > 1500) return { mult: 13, waitDays: 3 };
  return { mult: 11, waitDays: 5 };
}

/** Pool month id as KasmanPool/KasmanRewards use it: YYYYMM. */
export const monthId = (month: string) => Number(month.replace("-", ""));

// ---------- payloads ----------

/**
 * Every transaction the web builds carries its new covenant states in the payload, so the web
 * can find them again: `kasman:<orderId>|r=<points>,<lastClaimDaa>|n=<tokenId>,<mode>|m=<remaining>|t=<minted>`.
 * They are only hints: every state read back is checked against the output's address.
 */
export function payloadText(orderId: string, fields: Partial<{ r: [number, bigint]; n: [number, number]; m: bigint; t: bigint }>) {
  const parts = [`kasman:${orderId}`];
  if (fields.r) parts.push(`r=${fields.r[0]},${fields.r[1]}`);
  if (fields.n) parts.push(`n=${fields.n[0]},${fields.n[1]}`);
  if (fields.m !== undefined) parts.push(`m=${fields.m}`);
  if (fields.t !== undefined) parts.push(`t=${fields.t}`);
  return parts.join("|");
}

export function parsePayload(text: string) {
  if (!text.startsWith("kasman:")) return null;
  const [head, ...rest] = text.split("|");
  const fields: { orderId: string; r?: [number, bigint]; n?: [number, number]; m?: bigint; t?: bigint } = { orderId: head.slice(7) };
  for (const part of rest) {
    const [key, value] = part.split("=");
    const nums = value?.split(",") ?? [];
    if (key === "r" && nums.length === 2) fields.r = [Number(nums[0]), BigInt(nums[1])];
    if (key === "n" && nums.length === 2) fields.n = [Number(nums[0]), Number(nums[1])];
    if (key === "m") fields.m = BigInt(value);
    if (key === "t") fields.t = BigInt(value);
  }
  return fields;
}
