// Wallet sign-in: checks a KasWare `signMessage` (Schnorr) signature and that the public
// key belongs to the claimed address. Same scheme as rusty-kaspa wallet/core/src/message.rs.
import { schnorr } from "@noble/curves/secp256k1.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { schnorrAddress } from "../src/lib/covenant";

export { schnorrAddress };

/** BLAKE2b-256 keyed with "PersonalMessageSigningHash", the digest Kaspa wallets sign. */
const messageDigest = (message: string) =>
  blake2b(new TextEncoder().encode(message), { key: new TextEncoder().encode("PersonalMessageSigningHash"), dkLen: 32 });

/**
 * True when `signatureHex` is a Schnorr signature of `message` by `publicKeyHex`
 * (33-byte compressed or 32-byte x-only, as KasWare `getPublicKey` returns) and that
 * key is `address`.
 */
export function verifyWalletSignature(address: string, message: string, publicKeyHex: string, signatureHex: string) {
  try {
    const key = hexToBytes(publicKeyHex);
    const xOnly = key.length === 33 ? key.slice(1) : key;
    if (xOnly.length !== 32) return false;
    const prefix = address.split(":")[0];
    if (schnorrAddress(prefix, xOnly) !== address) return false;
    return schnorr.verify(hexToBytes(signatureHex), messageDigest(message), xOnly);
  } catch {
    return false;
  }
}
