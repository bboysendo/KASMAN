import { useEffect, useState } from "react";
import { Link } from "react-router";
import kasmanPng from "../assets/kasman.png";
import { checkIn, claim, daaToMs, holdings, onchainReady, rewardTimes, setStaked, virtualDaa, type Holdings, type Owned } from "../lib/chain";
import { LOCKED, config, type Nft } from "../lib/covenant";
import { requestFreeGames } from "../lib/leaderboard";
import { DAILY_REWARD, ENTRY_FEE_KAS, NFT_PRICE_KAS, RARITIES, rarityOf } from "../lib/prices";
import { useWallet } from "../lib/useWallet";
import { useStore } from "../store";

const button = "rounded-lg bg-kas px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50";
const outline = "rounded-lg border border-kas/50 px-4 py-2 text-sm hover:bg-kas/10 disabled:opacity-50";
const KASPACOM_URL = "https://kaspa.com";

/** KASMAN (whole tokens) a record's points are worth: points are tenths of the daily reward. */
const pointsToKasman = (points: number) => (points * DAILY_REWARD) / 10;

/** Milliseconds to a zero-padded "HH:MM:SS" countdown. */
function formatCountdown(ms: number) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatWait(ms: number) {
  const hours = Math.ceil(ms / 3_600_000);
  return hours > 48 ? `${Math.ceil(hours / 24)} days` : `${hours} h`;
}

export default function Staking() {
  const wallet = useWallet();
  const syncAccount = useStore((s) => s.syncAccount);

  const [chain, setChain] = useState<{ h: Holdings; daa: bigint; fetchedAt: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [picking, setPicking] = useState(false);

  /** Bumped after each on-chain action to read the chain again. */
  const [reads, setReads] = useState(0);
  /** Ticks every second so the claim cooldown counts down live. */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!wallet.address || !onchainReady) return;
    let live = true;
    Promise.all([holdings(wallet.address), virtualDaa()]).then(
      ([h, daa]) => live && setChain({ h, daa, fetchedAt: Date.now() }),
      (e) => live && setError(e instanceof Error ? e.message : "Could not read the Kaspa network"),
    );
    return () => {
      live = false;
    };
  }, [wallet.address, reads]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /** Runs an on-chain action (KasWare asks to sign), then reloads the chain state. */
  const act = async (label: string, run: () => Promise<string>) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      setNotice(await run());
      setPicking(false);
      setReads((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setBusy("");
    }
  };

  const nftReady = (n: Owned<Nft>) => !!chain && chain.daa - n.utxo.daa >= BigInt(config.daaPerDay);
  const stakedNft = chain?.h.nfts.find((n) => n.state.mode === LOCKED) ?? null;
  const unstakedNfts = chain?.h.nfts.filter((n) => n.state.mode !== LOCKED) ?? [];

  const t = chain ? rewardTimes(chain.h, chain.daa) : null;
  const record = chain?.h.record ?? null;
  const dayReady = !!t && !!record && t.daa >= t.nextDay;
  const claimReady = !!t && !!record && record.state.points > 0 && t.daa >= t.nextClaim;
  const cooldownMs = t && chain ? Math.max(0, chain.fetchedAt + daaToMs(t.nextClaim, t.daa) - now) : 0;

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
          <p className="text-xs text-white/60">Collection size: 350 NFTs. Rarity is determined by the NFT token ID.</p>
          <a href={KASPACOM_URL} target="_blank" rel="noopener noreferrer" className={`${outline} text-center`}>
            Mint for {NFT_PRICE_KAS} KAS on KaspaCom
          </a>
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
        Your Staked NFT
      </h2>
      {!onchainReady ? (
        <p className="mt-4 text-sm text-white/50">The Kasman NFT collection is not live yet.</p>
      ) : !wallet.address ? (
        <div className="mt-4 flex items-center gap-3">
          <p className="text-sm text-white/50">Connect your wallet to see your NFT and its active perks.</p>
          <button type="button" disabled={wallet.busy} onClick={() => void wallet.connect()} className={outline}>
            {wallet.busy ? "Connecting..." : "Connect wallet"}
          </button>
        </div>
      ) : !chain ? (
        <p className="mt-4 text-sm text-white/50">{error ? "" : "Reading the Kaspa network..."}</p>
      ) : chain.h.nfts.length === 0 ? (
        <p className="mt-4 text-sm text-white/50">
          No Kasman NFT yet. Mint one at{" "}
          <a href={KASPACOM_URL} target="_blank" rel="noopener noreferrer" className="text-kas hover:underline">KaspaCom</a>{" "}
          and come back to stake it for free daily games and bigger rewards.
        </p>
      ) : stakedNft ? (
        (() => {
          const rarity = rarityOf(stakedNft.state.tokenId);
          return (
            <div className="mt-4 flex w-56 flex-col gap-2 rounded-xl border border-kas bg-kas/5 p-3">
              <div className="flex aspect-square items-center justify-center rounded-lg bg-linear-to-br from-kas/30 via-black to-purple-900/40">
                <img src={kasmanPng} alt={`Kasman #${stakedNft.state.tokenId}`} className="w-1/2" />
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">Kasman #{stakedNft.state.tokenId}</h3>
                <span className="font-arcade text-[10px] text-yellow-300">{rarity.name}</span>
              </div>
              <p className="text-xs text-white/60">
                Staked · {rarity.freeGames} free/day · {(rarity.mult / 10).toFixed(1)}x multiplier ·{" "}
                claim every {rarity.claimEveryHours > 48 ? `${rarity.claimEveryHours / 24}d` : `${rarity.claimEveryHours}h`}
              </p>
              <button
                type="button"
                disabled={!!busy || !dayReady || !nftReady(stakedNft)}
                onClick={() =>
                  act(`check-in-${stakedNft.state.tokenId}`, async () => {
                    const txid = await checkIn(wallet.address!, stakedNft);
                    syncAccount(await requestFreeGames(txid));
                    return `Day counted at ${(rarity.mult / 10).toFixed(1)}x. ${rarity.freeGames} free ${rarity.freeGames === 1 ? "game" : "games"} today.`;
                  })
                }
                className={button}
              >
                {busy === `check-in-${stakedNft.state.tokenId}` ? "Confirming..." : "Daily check-in"}
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => act(`stake-${stakedNft.state.tokenId}`, async () => (await setStaked(wallet.address!, stakedNft, false), "NFT unstaked."))}
                className={outline}
              >
                {busy === `stake-${stakedNft.state.tokenId}` ? "Confirming..." : "Unstake NFT"}
              </button>
            </div>
          );
        })()
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex w-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center">
            <span aria-hidden="true" className="text-3xl text-white/20">?</span>
            <p className="text-xs text-white/50">No NFT staked. Stake one from your wallet for free daily games and a KASMAN multiplier.</p>
            <button type="button" onClick={() => setPicking((p) => !p)} className={button}>
              Stake an NFT from your Wallet
            </button>
          </div>
          {picking && (
            <ul className="flex flex-wrap gap-4">
              {unstakedNfts.map((n) => {
                const rarity = rarityOf(n.state.tokenId);
                return (
                  <li key={n.state.tokenId} className="flex w-56 flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex aspect-square items-center justify-center rounded-lg bg-linear-to-br from-kas/30 via-black to-purple-900/40">
                      <img src={kasmanPng} alt={`Kasman #${n.state.tokenId}`} className="w-1/2" />
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold">Kasman #{n.state.tokenId}</h3>
                      <span className="font-arcade text-[10px] text-yellow-300">{rarity.name}</span>
                    </div>
                    <p className="text-xs text-white/60">
                      {rarity.freeGames} free/day · {(rarity.mult / 10).toFixed(1)}x
                    </p>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => act(`stake-${n.state.tokenId}`, async () => (await setStaked(wallet.address!, n, true), "NFT staked."))}
                      className={button}
                    >
                      {busy === `stake-${n.state.tokenId}` ? "Confirming..." : "Stake"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <h2 className="mt-10 flex items-center gap-3 font-semibold after:h-px after:flex-1 after:bg-linear-to-r after:from-kas/60 after:to-transparent">
        Pending $KASM Rewards
      </h2>
      {!onchainReady ? (
        <p className="mt-4 text-sm text-white/50">KASMAN rewards start when the rewards contract goes live.</p>
      ) : !wallet.address ? (
        <p className="mt-4 text-sm text-white/50">Connect your wallet to see your pending rewards.</p>
      ) : !chain ? null : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div>
              <p className="font-arcade text-yellow-300">{pointsToKasman(record?.state.points ?? 0).toLocaleString("en-US")}</p>
              <p className="text-sm text-white/60">KASMAN to claim</p>
            </div>
            <div>
              <p className="font-arcade text-kas">{(rarityOf(stakedNft?.state.tokenId ?? null).mult / 10).toFixed(1)}x</p>
              <p className="text-sm text-white/60">Active multiplier</p>
            </div>
            <button
              type="button"
              disabled={!!busy || !claimReady}
              onClick={() => act("claim", async () => `Claimed ${(await claim(wallet.address!)).tokens.toLocaleString("en-US")} KASMAN.`)}
              className={`ml-auto ${button}`}
            >
              {busy === "claim"
                ? "Confirming..."
                : !record || record.state.points === 0
                  ? "Claim $KASM"
                  : claimReady
                    ? "Claim Rewards"
                    : `Cooldown active: ${formatCountdown(cooldownMs)}`}
            </button>
          </div>
          <p className="mt-3 text-sm text-white/50">
            {!record
              ? <>Pay a game entry to open your rewards record on chain, or see it in <Link to="/inventory" className="text-kas hover:underline">Inventory</Link>.</>
              : dayReady
                ? "Today's day is not counted yet: pay an entry or do a daily check-in above with a staked NFT."
                : `Today's day is counted. The next one counts in ${formatWait(daaToMs(t!.nextDay, t!.daa))}.`}
          </p>
        </>
      )}
    </div>
  );
}
