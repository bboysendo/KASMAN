import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as kaspa from "kaspa-wasm";
import {
  addressPubkey,
  bytesToHex,
  concat,
  config,
  entrySigscript,
  hexToBytes,
  kcc20State,
  kcc20TransferSigscript,
  minterClaimSigscript,
  minterState,
  nftRedeem,
  nftState,
  p2shAddress,
  p2shScript,
  parseNft,
  parsePayload,
  payloadText,
  pushData,
  pushInt,
  pushes,
  recordState,
  schnorrAddress,
} from "../src/lib/covenant";

// Vectors printed by silverscript 3ed9733 (contracts/tool) for the same values.
const b = (byte: number) => new Uint8Array(32).fill(byte);
const h = (byte: string) => byte.repeat(32);
const withoutRedeem = (script: Uint8Array, redeem: Uint8Array) => bytesToHex(script.slice(0, script.length - pushData(redeem).length));

describe("covenant encoding", () => {
  it("encodes contract state like the compiler", () => {
    expect(bytesToHex(recordState({ root: false, owner: b(9), points: 0, lastClaimDaa: 0n }))).toBe(`010020${h("09")}080000000000000000080000000000000000`);
    expect(bytesToHex(recordState({ root: true, owner: b(9), points: 130, lastClaimDaa: 123_456_789_012n }))).toBe(
      `010120${h("09")}088200000000000000${"08141a99be1c000000"}`,
    );
    expect(bytesToHex(nftState({ tokenId: 2900, owner: b(9), mode: 2, price: 0n }))).toBe(`08540b00000000000020${h("09")}0802000000000000000800000000${"00000000"}`);
    expect(bytesToHex(minterState({ kcc20Covid: b(6), amount: 1_000_000n, initialized: true }))).toBe(`20${h("06")}0840420f00000000000101`);
    expect(bytesToHex(kcc20State({ owner: b(4), identifierType: 2, amount: 0n, isMinter: true }))).toBe(`20${h("04")}0102080000000000000000${"0101"}`);
  });

  it("encodes entry and covenant-function arguments like the compiler", () => {
    const r = config.rewards.entries;
    const args = (list: Uint8Array[], selector: string) => bytesToHex(concat(...list, pushData(hexToBytes(selector))));
    expect(args([pushInt(1), pushInt(2), pushInt(202610)], r.play)).toBe("515203721703040f3da679");
    expect(args([pushInt(3), pushInt(8_640_000), pushInt(-1)], r.claim)).toBe("530400d683004f044fa04f46");
    expect(args([pushData(b(9)), pushInt(2), pushInt(202610)], r.open)).toBe(`20${h("09")}52037217030411ec35b9`);

    const redeem = new Uint8Array(300).fill(7);
    const claim = minterClaimSigscript(
      { kcc20Covid: b(6), amount: 999_000n, initialized: true },
      2,
      8_640_000n,
      { owner: b(4), identifierType: 2, amount: 0n, isMinter: true },
      redeem,
    );
    expect(withoutRedeem(claim, redeem)).toBe(`20${h("06")}03583e0f51520400d6830020${h("04")}5200510467c0e413`);
    const transfer = kcc20TransferSigscript(
      [
        { owner: b(4), identifierType: 2, amount: 0n, isMinter: true },
        { owner: b(9), identifierType: 0, amount: 777n, isMinter: false },
      ],
      redeem,
    );
    expect(withoutRedeem(transfer, redeem)).toBe(`40${h("04")}${h("09")}0202001000000000000000000903000000000000020100${"41" + "00".repeat(65)}000425061d6e`);
    expect(bytesToHex(pushes(transfer).at(-1)!)).toBe(bytesToHex(redeem));
    expect(bytesToHex(entrySigscript([pushInt(1)], "0f3da679", redeem)).endsWith(bytesToHex(pushData(redeem)))).toBe(true);
  });

  it("reads an NFT back from its redeem script", () => {
    const nft = { tokenId: 2900, owner: b(9), mode: 2, price: 0n };
    expect(parseNft(config.nft.template, nftRedeem(nft))).toEqual(nft);
    expect(parseNft(config.rewards.template, nftRedeem(nft))).toBeNull();
  });

  it("builds addresses and scripts like the Kaspa SDK", () => {
    kaspa.initSync({ module: readFileSync(new URL("../vendor/kaspa/kaspa_bg.wasm", import.meta.url)) });
    const redeem = nftRedeem({ tokenId: 1, owner: b(9), mode: 1, price: 0n });
    const spk = kaspa.payToScriptHashScript(redeem);
    expect(spk.script).toBe(bytesToHex(p2shScript(redeem)));
    expect(kaspa.addressFromScriptPublicKey(spk, "testnet-10")!.toString()).toBe(p2shAddress("kaspatest", redeem));
    const key = new kaspa.PrivateKey("1b".repeat(32));
    const address = key.toKeypair().toAddress("testnet-10").toString();
    const xOnly = hexToBytes(key.toKeypair().xOnlyPublicKey as string);
    expect(schnorrAddress("kaspatest", xOnly)).toBe(address);
    expect(bytesToHex(addressPubkey(address))).toBe(bytesToHex(xOnly));
  });

  it("round-trips payloads", () => {
    const text = payloadText("ab12", { r: [20, 5n], n: [2900, 2], m: 99n, t: 1n });
    expect(parsePayload(text)).toEqual({ orderId: "ab12", r: [20, 5n], n: [2900, 2], m: 99n, t: 1n });
    expect(parsePayload("kasman:ab12")).toEqual({ orderId: "ab12" });
    expect(parsePayload("other")).toBeNull();
  });
});
