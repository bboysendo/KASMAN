import { describe, expect, it } from "vitest";
import { hexToBytes } from "@noble/hashes/utils.js";
import { schnorrAddress, verifyWalletSignature } from "./auth";

// Vectors from rusty-kaspa (wallet/core/src/message.rs test case 0; address from kaspa-addresses).
const PUBKEY = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
const ADDRESS = "kaspa:qrunpzspjfvvxyzfx38ct7ya2g5m2vwggkpklxdsscqlzyauuqm0ju6q2fjpa";
const SIG = "40b9bb2be0ae02607279eda64015a8d86e3763279170340b8243f7ce5344d77aff1191598baf2fd26149cac3b4b12c2c433261c00834db6098cb172aa48ef522";

describe("wallet auth", () => {
  it("derives Kaspa addresses like rusty-kaspa", () => {
    expect(schnorrAddress("kaspa", hexToBytes(PUBKEY))).toBe(ADDRESS);
    expect(schnorrAddress("kaspatest", hexToBytes(PUBKEY))).toBe("kaspatest:qrunpzspjfvvxyzfx38ct7ya2g5m2vwggkpklxdsscqlzyauuqm0jaux3xvse");
  });

  it("accepts the reference signature and rejects anything changed", () => {
    expect(verifyWalletSignature(ADDRESS, "Hello Kaspa!", PUBKEY, SIG)).toBe(true);
    expect(verifyWalletSignature(ADDRESS, "Hello Kaspa!", `02${PUBKEY}`, SIG)).toBe(true);
    expect(verifyWalletSignature(ADDRESS, "Hello Kaspa?", PUBKEY, SIG)).toBe(false);
    expect(verifyWalletSignature("kaspa:qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn5ckw8x9", "Hello Kaspa!", PUBKEY, SIG)).toBe(false);
    expect(verifyWalletSignature(ADDRESS, "Hello Kaspa!", PUBKEY, "00")).toBe(false);
  });
});
