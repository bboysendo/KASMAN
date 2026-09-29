// KasWare browser wallet (https://docs.kasware.xyz). The only wallet code in the app.
interface KasWare {
  requestAccounts(): Promise<string[]>;
  getAccounts(): Promise<string[]>;
  getNetwork(): Promise<string>;
  getPublicKey(): Promise<string>;
  signMessage(text: string, options?: { type?: "schnorr" | "ecdsa" }): Promise<string>;
  sendKaspa(to: string, sompi: number, options?: { priorityFee?: number; payload?: string }): Promise<string>;
  signPskt(request: { txJsonString: string; options?: { signInputs?: { index: number; sighashType: number }[] } }): Promise<string>;
  on(event: "accountsChanged", handler: (accounts: string[]) => void): void;
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

/** Sends `sompi` to `to` from `from` (the connected account) with `payload` attached. Returns the transaction id. */
export async function sendKaspa(from: string, to: string, sompi: number, payload: string): Promise<string> {
  const wallet = kasware();
  const [current] = await wallet.getAccounts();
  if (current !== from) throw new Error("KasWare switched account: connect this wallet again");
  const tx = JSON.parse(await wallet.sendKaspa(to, sompi, { payload })) as { id: string };
  return tx.id;
}

/**
 * Has KasWare sign the wallet's own inputs (`inputs`, SIGHASH_ALL) of a transaction the app
 * built (Safe JSON), and returns it signed. Covenant inputs already carry their sigscripts;
 * KasWare never signs those.
 */
export async function signWalletInputs(from: string, txJson: string, inputs: number[]): Promise<string> {
  const wallet = kasware();
  const [current] = await wallet.getAccounts();
  if (current !== from) throw new Error("KasWare switched account: connect this wallet again");
  return wallet.signPskt({ txJsonString: txJson, options: { signInputs: inputs.map((index) => ({ index, sighashType: 1 })) } });
}

/** Calls `handler` when the user switches or locks the KasWare account. */
export const onWalletChange = (handler: () => void) => window.kasware?.on("accountsChanged", handler);
