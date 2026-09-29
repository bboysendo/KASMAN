import { useEffect, useState } from "react";
import { Link } from "react-router";
import kasmanPng from "../assets/kasman.png";
import { checkIn, holdings, mintNft, onchainReady, rewardTimes, setStaked, virtualDaa, type Holdings, type Owned } from "../lib/chain";
import { LOCKED, config, type Nft } from "../lib/covenant";
import { requestFreeGames } from "../lib/leaderboard";
import { ENTRY_FEE_KAS, NFT_PRICE_KAS, RARITIES, rarityOf } from "../lib/prices";
import { useWallet } from "../lib/useWallet";
import { useStore } from "../store";

const button = "rounded-lg bg-kas px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50";
const outline = "rounded-lg border border-kas/50 px-4 py-2 text-sm hover:bg-kas/10 disabled:opacity-50";

export default function Staking() {
  const wallet = useWallet();
  const syncAccount = useStore((s) => s.syncAccount);

  const [chain, setChain] = useState<{ h: Holdings; daa: bigint } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [minted, setMinted] = useState<number | null>(null);
  const [minting, setMinting] = useState(false);

  /** Bumped after each on-chain action to read the chain again. */
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!wallet.address || !onchainReady) return;
    let live = true;
    Promise.all([holdings(wallet.address), virtualDaa()]).then(
      ([h, daa]) => live && setChain({ h, daa }),
      (e) => live && setError(e instanceof Error ? e.message : "Could not read the Kaspa network"),
    );
    return () => {
      live = false;
    };
  }, [wallet.address, reads]);

  /** Runs an on-chain action (KasWare asks to sign), then reloads the chain state. */
  const act = async (label: string, run: () => Promise<string>) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      setNotice(await run());
      setReads((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setBusy("");
    }
  };

  const mint = async () => {
    setError("");
    if (!wallet.address && !(await wallet.connect())) return;
    setMinting(true);
    try {
      setMinted((await mintNft(wallet.address ?? useStore.getState().address ?? "")).tokenId);
      setReads((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setMinting(false);
    }
  };

  const nftReady = (n: Owned<Nft>) => !!chain && chain.daa - n.utxo.daa >= BigInt(config.daaPerDay);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="font-arcade text-xl text-yellow-300 sm:text-2xl">STAKING</h1>
      <p className="mt-4 text-white/60">
        Stake your Kasman NFT to get free games every day, a bigger KASMAN multiplier and shorter waits between reward
        claims. Every player earns KASMAN for each day they play; a staked NFT boosts it by rarity.
      </p>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex w-full max-w-56 shrink-0 flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex aspect-square items-center justify-center rounded-lg bg-linear-to-br from-kas/30 via-black to-purple-900/40">
            <img src={kasmanPng} alt="Kasman NFT" className="w-1/2" />
          </div>
          <h2 className="font-semibold">Kasman NFT</h2>
          <p className="text-xs text-white/60">3,000 NFTs. Rarity is set by the NFT number.</p>
          <button type="button" disabled={!onchainReady || minting} onClick={mint} className={button}>
            {!onchainReady ? `Mint for ${NFT_PRICE_KAS} KAS · Soon` : minting ? "Confirming..." : `Mint for ${NFT_PRICE_KAS} KAS`}
          </button>
          {minted !== null && (
            <p role="status" className="text-xs text-kas">
              Kasman #{minted} ({rarityOf(minted).name}) is yours. Stake it below.
            </p>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-white/50">
              <tr>
                <th className="py-2 pr-4 font-normal">Rarity</th>
                <th className="py-2 pr-4 font-normal">NFT #</th>
                <th className="py-2 pr-4 font-normal">Free games / day</th>
                <th className="py-2 pr-4 font-normal">Token multiplier</th>
                <th className="py-2 font-normal">Claim every</th>
              </tr>
            </thead>
            <tbody>
              {RARITIES.map((r, i) => (
                <tr key={r.id} className="border-t border-white/10">
                  <td className="py-2 pr-4 font-semibold">{r.name}</td>
                  <td className="py-2 pr-4 text-white/60">{i === 0 ? "-" : `${RARITIES[i - 1].maxTokenId + 1}-${r.maxTokenId}`}</td>
                  <td className="py-2 pr-4">{r.freeGames === 0 ? `0 (pay ${ENTRY_FEE_KAS} KAS)` : r.freeGames}</td>
                  <td className="py-2 pr-4 text-kas">{(r.mult / 10).toFixed(1)}x</td>
                  <td className="py-2">{r.claimEveryHours > 48 ? `${r.claimEveryHours / 24} days` : `${r.claimEveryHours} h`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(error || notice) && (
        <p role={error ? "alert" : "status"} className={`mt-6 text-sm ${error ? "text-red-400" : "text-kas"}`}>{error || notice}</p>
      )}

      <h2 className="mt-10 flex items-center gap-3 font-semibold after:h-px after:flex-1 after:bg-linear-to-r after:from-kas/60 after:to-transparent">
        Your NFTs
      </h2>
      {!onchainReady ? (
        <p className="mt-4 text-sm text-white/50">The Kasman NFT collection is not live yet.</p>
      ) : !wallet.address ? (
        <div className="mt-4 flex items-center gap-3">
          <p className="text-sm text-white/50">Connect your wallet to see your NFTs and their active perks.</p>
          <button type="button" disabled={wallet.busy} onClick={() => void wallet.connect()} className={outline}>
            {wallet.busy ? "Connecting..." : "Connect wallet"}
          </button>
        </div>
      ) : !chain ? (
        <p className="mt-4 text-sm text-white/50">{error ? "" : "Reading the Kaspa network..."}</p>
      ) : chain.h.nfts.length === 0 ? (
        <p className="mt-4 text-sm text-white/50">
          No Kasman NFT yet. Mint one above and stake it for free daily games and bigger rewards.{" "}
          <Link to="/inventory" className="text-kas hover:underline">See your rewards in Inventory</Link>.
        </p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-4">
          {chain.h.nfts.map((n) => {
            const rarity = rarityOf(n.state.tokenId);
            const isStaked = n.state.mode === LOCKED;
            const t = rewardTimes(chain.h, chain.daa);
            const dayReady = !!t && !!chain.h.record && chain.daa >= t.nextDay;
            return (
              <li key={n.state.tokenId} className={`flex w-56 flex-col gap-2 rounded-xl border p-3 ${isStaked ? "border-kas bg-kas/5" : "border-white/10 bg-white/[0.03]"}`}>
                <div className="flex aspect-square items-center justify-center rounded-lg bg-linear-to-br from-kas/30 via-black to-purple-900/40">
                  <img src={kasmanPng} alt={`Kasman #${n.state.tokenId}`} className="w-1/2" />
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">Kasman #{n.state.tokenId}</h3>
                  <span className="font-arcade text-[10px] text-yellow-300">{rarity.name}</span>
                </div>
                <p className="text-xs text-white/60">
                  {isStaked ? "Staked" : "Not staked"} · {rarity.freeGames} free/day · {(rarity.mult / 10).toFixed(1)}x ·
                  {" "}claim every {rarity.claimEveryHours > 48 ? `${rarity.claimEveryHours / 24}d` : `${rarity.claimEveryHours}h`}
                </p>
                {isStaked && (
                  <button
                    type="button"
                    disabled={!!busy || !dayReady || !nftReady(n)}
                    onClick={() =>
                      act(`check-in-${n.state.tokenId}`, async () => {
                        const txid = await checkIn(wallet.address!, n);
                        syncAccount(await requestFreeGames(txid));
                        return `Day counted at ${(rarity.mult / 10).toFixed(1)}x. ${rarity.freeGames} free ${rarity.freeGames === 1 ? "game" : "games"} today.`;
                      })
                    }
                    className={button}
                  >
                    {busy === `check-in-${n.state.tokenId}` ? "Confirming..." : "Daily check-in"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => act(`stake-${n.state.tokenId}`, async () => (await setStaked(wallet.address!, n, !isStaked), isStaked ? "NFT unstaked." : "NFT staked."))}
                  className={outline}
                >
                  {busy === `stake-${n.state.tokenId}` ? "Confirming..." : isStaked ? "Unstake" : "Stake"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

