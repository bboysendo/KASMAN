import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureWalletAccount } from "./wallet";

const ME = "kaspatest:qme";

function mockWallet(getAccounts: () => Promise<string[]>, requestAccounts: () => Promise<string[]>) {
  const wallet = { getAccounts: vi.fn(getAccounts), requestAccounts: vi.fn(requestAccounts) };
  vi.stubGlobal("window", { kasware: wallet });
  return wallet;
}

afterEach(() => vi.unstubAllGlobals());

describe("ensureWalletAccount", () => {
  it("does nothing when the wallet already exposes the signed-in account", async () => {
    const w = mockWallet(async () => [ME], async () => [ME]);
    await ensureWalletAccount(ME);
    expect(w.requestAccounts).not.toHaveBeenCalled();
  });

  it("opens KasWare's unlock window when it is locked, then carries on", async () => {
    const w = mockWallet(async () => [], async () => [ME]);
    await expect(ensureWalletAccount(ME)).resolves.toBeUndefined();
    expect(w.requestAccounts).toHaveBeenCalledOnce();
  });

  it("also recovers when getAccounts itself throws (dropped connection)", async () => {
    const w = mockWallet(async () => { throw new Error("WebSocket is not connected"); }, async () => [ME]);
    await expect(ensureWalletAccount(ME)).resolves.toBeUndefined();
    expect(w.requestAccounts).toHaveBeenCalledOnce();
  });

  it("asks for an unlock but reports a clean message if the player dismisses it", async () => {
    mockWallet(async () => [], async () => { throw new Error("User rejected the request"); });
    await expect(ensureWalletAccount(ME)).rejects.toThrow("Unlock KasWare to continue");
  });

  it("still refuses a wallet that really is on another account", async () => {
    mockWallet(async () => ["kaspatest:qother"], async () => ["kaspatest:qother"]);
    await expect(ensureWalletAccount(ME)).rejects.toThrow("KasWare switched account");
  });

  it("needs a signed-in address", async () => {
    mockWallet(async () => [ME], async () => [ME]);
    await expect(ensureWalletAccount("")).rejects.toThrow("Connect your wallet first");
  });
});
