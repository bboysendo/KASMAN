// KasWare browser wallet (https://docs.kasware.xyz). The only wallet code in the app.
interface KasWare {
  requestAccounts(): Promise<string[]>;
  getAccounts(): Promise<string[]>;
  getNetwork(): Promise<string>;
  switchNetwork(network: string): Promise<string>;
  getPublicKey(): Promise<string>;
  signMessage(text: string, options?: { type?: "schnorr" | "ecdsa" }): Promise<string>;
  sendKaspa(to: string, sompi: number, options?: { priorityFee?: number; payload?: string }): Promise<string>;
  signPskt(request: { txJsonString: string; options?: { signInputs?: { index: number; sighashType: number }[] } }): Promise<string>;
  on(event: "accountsChanged", handler: (accounts?: string[]) => void): void;
}

declare global {
  interface Window {
    kasware?: KasWare;
  }
}

function kasware() {
  if (!window.kasware) throw new Error("Install the KasWare wallet extension to play");
  return window.kasware;
}

/** KasWare's own RPC socket to a Kaspa node can drop after the tab sits idle; it has no public reconnect call. */
const isDeadRpc = (e: unknown) => e instanceof Error && /websocket|rpc server/i.test(e.message);

/**
 * KasWare refuses to build a new transaction while it still has an incoming or pending one
 * unconfirmed (its own "Incoming/Pending transaction" state, from UTXOs it won't spend yet).
 * Its raw error for that is not user-facing; replace it with a clear one. Not retried
 * automatically: the wallet needs the pending transaction to confirm first, which nothing here
 * can speed up.
 */
const isPendingTx = (e: unknown) => e instanceof Error && /pending|mempool|unconfirmed|in.?progress/i.test(e.message);

function rethrowWalletError(e: unknown): never {
  if (isPendingTx(e)) throw new Error("KasWare is still processing a pending transaction on Testnet. Wait for it to confirm in your wallet and try again.");
  throw e;
}

/**
 * Runs a KasWare call that needs its node RPC (sending, signing). If the RPC socket died, KasWare
 * throws "WebSocket is not connected" instead of reconnecting on its own; switching network to the
 * one it's already on makes it rebuild that connection, so retry once after nudging it that way.
 */
async function withRpcRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isDeadRpc(e)) throw e;
    const wallet = kasware();
    await wallet.switchNetwork(await wallet.getNetwork()).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    try {
      return await run();
    } catch {
      throw new Error("KasWare lost its connection to the Kaspa network. Try again in a moment.");
    }
  }
}

/** Asks KasWare for its account and checks it is on the network the game uses ("kaspa" or "kaspatest" prefix). */
export async function walletAccount(prefix: string) {
  const wallet = kasware();
  const [address] = await wallet.requestAccounts();
  const network = prefix === "kaspatest" ? "kaspa_testnet" : "kaspa_mainnet";
  if (!address || !(await wallet.getNetwork()).startsWith(network)) throw new Error(`Switch KasWare to ${network.replace("_", " ")}`);
  return address;
}

/** Signs `message` with the current account (Schnorr). Returns the public key and the signature, both hex. */
export async function signWithWallet(message: string) {
  const wallet = kasware();
  return { publicKey: await wallet.getPublicKey(), signature: await wallet.signMessage(message, { type: "schnorr" }) };
}

/**
 * Makes sure KasWare is unlocked and exposing `from` (the signed-in account) before anything is sent.
 * A locked or disconnected wallet answers `getAccounts()` with an empty list, and KasWare often drops
 * into that state in the background between games; `requestAccounts()` then opens its unlock / connect
 * window, so the player fixes it right there and the payment carries on, instead of an error. Only a
 * wallet that is really on a different account fails.
 */
export async function ensureWalletAccount(from: string): Promise<void> {
  if (!from) throw new Error("Connect your wallet first");
  const wallet = kasware();
  let [current] = await wallet.getAccounts().catch(() => [] as string[]);
  if (current !== from) {
    try {
      [current] = await wallet.requestAccounts();
    } catch {
      throw new Error("Unlock KasWare to continue");
    }
  }
  if (current !== from) throw new Error("KasWare switched account: connect this wallet again");
}

/** Sends `sompi` to `to` from `from` (the connected account) with `payload` attached. Returns the transaction id. */
export async function sendKaspa(from: string, to: string, sompi: number, payload: string): Promise<string> {
  const wallet = kasware();
  await ensureWalletAccount(from);
  try {
    const tx = JSON.parse(await withRpcRetry(() => wallet.sendKaspa(to, sompi, { payload }))) as { id: string };
    return tx.id;
  } catch (e) {
    rethrowWalletError(e);
  }
}

/**
 * Has KasWare sign the wallet's own inputs (`inputs`, SIGHASH_ALL) of a transaction the app
 * built (Safe JSON), and returns it signed. Covenant inputs already carry their sigscripts;
 * KasWare never signs those.
 */
export async function signWalletInputs(from: string, txJson: string, inputs: number[]): Promise<string> {
  const wallet = kasware();
  await ensureWalletAccount(from);
  try {
    return await withRpcRetry(() => wallet.signPskt({ txJsonString: txJson, options: { signInputs: inputs.map((index) => ({ index, sighashType: 1 })) } }));
  } catch (e) {
    rethrowWalletError(e);
  }
}

/** Calls `handler` with the accounts KasWare now exposes (empty when locked) when the user switches or locks it. */
export const onWalletChange = (handler: (accounts?: string[]) => void) => window.kasware?.on("accountsChanged", handler);
