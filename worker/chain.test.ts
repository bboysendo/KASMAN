import { readFileSync } from "node:fs";
import * as kaspa from "kaspa-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { claimDraft, checkInDraft, entryDraft, fund, mintDraft, openDraft, playDraft, stakeDraft, type Draft, type Utxo } from "../src/lib/chain";
import {
  LOCKED,
  ROOT_RECORD,
  branchState,
  config,
  hexToBytes,
  kcc20Redeem,
  minterRedeem,
  nftRedeem,
  p2pkScript,
  p2shAddress,
  p2shScript,
  parsePayload,
  recordRedeem,
  type Nft,
  type Record,
} from "../src/lib/covenant";
import pools from "./pools.json";

const owner = new Uint8Array(32).fill(9);
const KAS = 100_000_000n;
const GLOBAL = BigInt(config.globalValue);
const PLAYER = BigInt(config.covValue);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
let n = 0;
const utxo = (script: Uint8Array, amount: bigint, covenantId?: string): Utxo => ({
  txid: (++n).toString(16).padStart(64, "0"),
  index: 0,
  amount,
  script: hex(script),
  daa: 1_000n,
  covenantId,
});
const wallet = () => [utxo(p2pkScript(owner), 100n * KAS), utxo(p2pkScript(owner), 3n * KAS)];
const order = { orderId: "ab12cd34", address: (pools.pools as { [m: string]: string })["2026-10"], sompi: 10 * 100_000_000, month: "2026-10" };

const record = (points: number): { state: Record; utxo: Utxo } => {
  const state: Record = { root: false, owner, points, lastClaimDaa: 0n };
  return { state, utxo: utxo(p2shScript(recordRedeem(state)), PLAYER, config.rewards.covid) };
};
const staked = (tokenId: number): { state: Nft; utxo: Utxo } => {
  const state: Nft = { tokenId, owner, mode: LOCKED, price: 0n };
  return { state, utxo: utxo(p2shScript(nftRedeem(state)), PLAYER, config.nft.covid) };
};

/** Funds and prices `draft` with the SDK, then reads the result back. */
function priced(draft: Draft) {
  const { txJson, walletInputs, fee } = fund(kaspa, draft, wallet(), owner);
  const tx = kaspa.Transaction.deserializeFromSafeJSON(txJson);
  return { json: JSON.parse(txJson), walletInputs, fee, mass: kaspa.calculateTransactionMass(config.network, tx, 1) };
}

describe("covenant transactions the web builds", () => {
  beforeAll(() => {
    kaspa.initSync({ module: readFileSync(new URL("../vendor/kaspa/kaspa_bg.wasm", import.meta.url)) });
  });

  it("stay under the standard mass and pay at least the minimum fee", () => {
    const rootUtxo = utxo(p2shScript(recordRedeem(ROOT_RECORD)), GLOBAL, config.rewards.covid);
    const minterState = { kcc20Covid: hexToBytes(config.kcc20.covid), amount: BigInt(config.maxTokenSupply), initialized: true };
    const m = {
      state: minterState,
      utxo: utxo(p2shScript(minterRedeem(minterState)), GLOBAL, config.minter.covid),
      branch: utxo(p2shScript(kcc20Redeem(branchState())), GLOBAL, config.kcc20.covid),
    };
    const nftRoot = { tokenId: 7, utxo: utxo(p2shScript(nftRedeem({ tokenId: 7, owner: hexToBytes(config.rootOwner), mode: 0, price: 0n })), GLOBAL, config.nft.covid) };
    const drafts: [string, Draft][] = [
      ["open", openDraft(owner, rootUtxo, order)],
      ["play", playDraft(record(10), order)],
      ["entry", entryDraft(order)],
      ["checkIn", checkInDraft(record(10), staked(2900))],
      ["claim", claimDraft(record(30), m, 600_000_000n).draft],
      ["claim + NFT", claimDraft(record(30), m, 600_000_000n, staked(2900)).draft],
      ["mint", mintDraft(owner, nftRoot)],
      ["stake", stakeDraft(staked(5), false)],
    ];
    const max = kaspa.maximumStandardTransactionMass();
    for (const [name, draft] of drafts) {
      const p = priced(draft);
      expect(p.mass, name).toBeLessThanOrEqual(max);
      expect(p.fee, name).toBeGreaterThanOrEqual(kaspa.calculateTransactionFee(config.network, kaspa.Transaction.deserializeFromSafeJSON(JSON.stringify(p.json)), 1)!);
      // Wallet inputs come after the covenant inputs and are left for KasWare to sign.
      expect(p.walletInputs[0], name).toBe(draft.covenantInputs.length);
      expect(p.json.inputs[p.walletInputs[0]].signatureScript, name).toBe("");
      // The last output is the change, back to the owner.
      expect(p.json.outputs.at(-1).scriptPublicKey, name).toBe(`0000${hex(p2pkScript(owner))}`);
    }
  });

  it("carries the new states in the payload, matching the covenant outputs", () => {
    const { json } = priced(checkInDraft(record(10), staked(2900)));
    const payload = parsePayload(Buffer.from(json.payload, "hex").toString())!;
    expect(payload.r).toEqual([30, 0n]);
    const next: Record = { root: false, owner, points: 30, lastClaimDaa: 0n };
    expect(json.outputs[0].scriptPublicKey).toBe(`0000${hex(p2shScript(recordRedeem(next)))}`);
    expect(json.outputs[0].covenant).toEqual({ authorizingInput: 0, covenantId: config.rewards.covid });
    expect(json.outputs[1].covenant).toEqual({ authorizingInput: 1, covenantId: config.nft.covid });
    expect(p2shAddress(config.addressPrefix, recordRedeem(next))).toMatch(/^kaspatest:p/);
    // Relative locks: the record and the NFT must be a day old.
    expect(json.inputs[0].sequence).toBe(String(config.daaPerDay));
    expect(json.inputs[1].sequence).toBe(String(config.daaPerDay));
  });

  it("claims at most the remaining supply, with the claim DAA as lock time", () => {
    const minterState = { kcc20Covid: hexToBytes(config.kcc20.covid), amount: 5n, initialized: true };
    const m = {
      state: minterState,
      utxo: utxo(p2shScript(minterRedeem(minterState)), GLOBAL, config.minter.covid),
      branch: utxo(p2shScript(kcc20Redeem(branchState())), GLOBAL, config.kcc20.covid),
    };
    const { draft, minted } = claimDraft(record(30), m, 123_456n);
    expect(minted).toBe(5n);
    expect(draft.lockTime).toBe(123_456n);
    expect(parsePayload(draft.payload)).toMatchObject({ m: 0n, t: 5n, r: [0, 123_456n] });
  });
});
