import { useState } from "react";
import { useStore } from "../store";
import { connectWallet, disconnectWallet, type Account } from "./leaderboard";

const SIGNED_OUT: Account = { address: null, name: "", tickets: 0, lives: 0, skins: [], freeGamesLeft: 0 };

/** Connected wallet address plus connect / disconnect actions with their own busy and error state. */
export function useWallet() {
  const address = useStore((s) => s.address);
  const syncAccount = useStore((s) => s.syncAccount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      syncAccount(await connectWallet());
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect the wallet");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => syncAccount(await disconnectWallet().catch(() => SIGNED_OUT));

  return { address, connect, disconnect, busy, error };
}

/** kaspa:qr…6q2fjpa */
export const shortAddress = (address: string) => `${address.slice(0, address.indexOf(":") + 3)}…${address.slice(-6)}`;
