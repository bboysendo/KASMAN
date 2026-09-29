import { shortAddress, useWallet } from "../lib/useWallet";

/** Header control: Connect wallet, or the connected address with a Disconnect button. */
export default function WalletButton() {
  const { address, connect, disconnect, busy, error } = useWallet();

  if (address) {
    return (
      <div className="flex shrink-0 items-center gap-2 text-xs">
        <span className="hidden font-mono text-kas sm:inline" title={address}>{shortAddress(address)}</span>
        <button
          type="button"
          onClick={disconnect}
          aria-label={`Disconnect ${address}`}
          className="rounded-lg border border-white/20 px-2 py-1 text-white/70 hover:text-white"
        >
          <span className="font-mono text-kas sm:hidden">…{address.slice(-4)} ✕</span>
          <span className="hidden sm:inline">Disconnect</span>
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <button
        type="button"
        onClick={connect}
        disabled={busy}
        className="shrink-0 rounded-lg bg-kas px-2 py-1.5 text-xs font-semibold text-black hover:brightness-110 disabled:opacity-60 sm:px-3 sm:text-sm"
      >
        {busy ? "Connecting…" : <>Connect<span className="hidden sm:inline"> wallet</span></>}
      </button>
      {error && <p role="alert" className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-red-400/40 bg-night p-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
