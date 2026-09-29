import { useEffect, useState } from "react";
import { Link } from "react-router";
import KasmanIcon from "../components/KasmanIcon";
import PrizePool from "../components/PrizePool";
import SkinPreview from "../components/SkinPreview";
import { SKINS, getSkin } from "../game/render/skins";
import { claim, daaToMs, holdings, onchainReady, rewardTimes, virtualDaa, type Holdings } from "../lib/chain";
import { rarityRules } from "../lib/covenant";
import { getAccount, msUntilPayout } from "../lib/leaderboard";
import { DAILY_REWARD } from "../lib/prices";
import { shortAddress } from "../lib/useWallet";
import { useLeaderboard } from "../lib/useLeaderboard";
import { useStore } from "../store";

const section = "flex items-center gap-3 font-semibold after:h-px after:flex-1 after:bg-linear-to-r after:from-kas/60 after:to-transparent";
const button = "rounded-lg bg-kas px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50";

/** KASMAN (whole tokens) a record's points are worth: points are tenths of the daily reward. */
const pointsToKasman = (points: number) => (points * DAILY_REWARD) / 10;

export default function Inventory() {
  const owned = useStore((s) => s.ownedSkins);
  const equipped = useStore((s) => s.equippedSkin);
  const equipSkin = useStore((s) => s.equipSkin);
  const extraLives = useStore((s) => s.extraLives);
  const tickets = useStore((s) => s.tickets);
  const freeGames = useStore((s) => s.freeGames);
  const address = useStore((s) => s.address);
  const syncAccount = useStore((s) => s.syncAccount);
  const skins = SKINS.filter((s) => owned.includes(s.id));
  const { entries: topEntries, pool } = useLeaderboard(1);
  const leader = topEntries[0] ?? null;
  const isLeader = !!address && !!leader && leader.address === address;

  const [chain, setChain] = useState<{ h: Holdings; daa: bigint } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /** Bumped after each on-chain action to read the chain again. */
  const [reads, setReads] = useState(0);

  useEffect(() => {
    void getAccount().then(syncAccount, () => {});
    if (!address || !onchainReady) return;
    let live = true;
    Promise.all([holdings(address), virtualDaa()]).then(
      ([h, daa]) => live && setChain({ h, daa }),
      (e) => live && setError(e instanceof Error ? e.message : "Could not read the Kaspa network"),
    );
    return () => {
      live = false;
    };
  }, [address, syncAccount, reads]);

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

  const t = chain ? rewardTimes(chain.h, chain.daa) : null;
  const record = chain?.h.record ?? null;
  const dayReady = !!t && !!record && t.daa >= t.nextDay;
  const claimReady = !!t && !!record && record.state.points > 0 && t.daa >= t.nextClaim;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="font-arcade text-xl text-yellow-300 sm:text-2xl">INVENTORY</h1>

      <h2 className={`mt-8 ${section}`}>Info</h2>
      <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <li className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <span aria-hidden="true"><KasmanIcon skin={getSkin(equipped)} size={44} /></span>
          <div>
            <p className="font-arcade text-yellow-300">{extraLives}</p>
            <p className="text-sm text-white/60">Extra {extraLives === 1 ? "life" : "lives"}</p>
          </div>
        </li>
        <li className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="font-arcade text-yellow-300">{tickets}</p>
          <p className="text-sm text-white/60">Unused game {tickets === 1 ? "entry" : "entries"}</p>
        </li>
        <li className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="font-arcade text-yellow-300">{freeGames}</p>
          <p className="text-sm text-white/60">Free {freeGames === 1 ? "game" : "games"} left today</p>
        </li>
      </ul>
      {extraLives === 0 && (
        <p className="mt-3 text-sm text-white/50">
          No extra lives. <Link to="/marketplace" className="text-kas hover:underline">Buy some in the Marketplace</Link>.
        </p>
      )}

      {(error || notice) && (
        <p role={error ? "alert" : "status"} className={`mt-6 text-sm ${error ? "text-red-400" : "text-kas"}`}>{error || notice}</p>
      )}

      <h2 className={`mt-10 ${section}`}>Prize pool</h2>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <PrizePool pool={pool} />
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-widest text-white/50">#1 this month</p>
          <p className="font-arcade mt-2 text-2xl text-kas">{leader ? leader.name || shortAddress(leader.address) : "—"}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-white/50">
        {isLeader
          ? "You're #1 right now — the whole pool is paid to you after the month closes."
          : "The whole pool goes to whoever is #1 when the month closes."}{" "}
        Payout is done by hand by the Kasman owner, not automatically. Month closes in {formatWait(msUntilPayout())}.
      </p>

      <h2 className={`mt-10 ${section}`}>Rewards</h2>
      {!onchainReady ? (
        <p className="mt-4 text-sm text-white/50">KASMAN rewards start when the rewards contract goes live.</p>
      ) : !address ? (
        <p className="mt-4 text-sm text-white/50">Connect your wallet to see your rewards.</p>
      ) : !chain ? null : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div>
              <p className="font-arcade text-yellow-300">{pointsToKasman(record?.state.points ?? 0).toLocaleString("en-US")}</p>
              <p className="text-sm text-white/60">KASMAN to claim</p>
            </div>
            <div>
              <p className="font-arcade text-kas">{(rarityRules(t?.best?.state.tokenId ?? null).mult / 10).toFixed(1)}x</p>
              <p className="text-sm text-white/60">Check-in multiplier</p>
            </div>
            <div>
              <p className="font-arcade text-white/80">{chain.h.claimed.toLocaleString("en-US")}</p>
              <p className="text-sm text-white/60">KASMAN received</p>
            </div>
            <button
              type="button"
              disabled={!!busy || !claimReady}
              onClick={() => act("claim", async () => `Claimed ${(await claim(address)).tokens.toLocaleString("en-US")} KASMAN.`)}
              className={`ml-auto ${button}`}
            >
              {busy === "claim"
                ? "Confirming..."
                : claimReady || !t || !record || record.state.points === 0
                  ? "Claim"
                  : `Claim in ${formatWait(daaToMs(t.nextClaim, t.daa))}`}
            </button>
          </div>
          <p className="mt-3 text-sm text-white/50">
            {!record
              ? `Pay a game entry to open your rewards record on chain. Every day you pay an entry (or check in with a staked NFT) earns ${DAILY_REWARD.toLocaleString("en-US")} KASMAN × your multiplier.`
              : dayReady
                ? <>Today's day is not counted yet: pay an entry or do a daily <Link to="/staking" className="text-kas hover:underline">check-in with a staked NFT</Link>.</>
                : `Today's day is counted. The next one counts in ${formatWait(daaToMs(t!.nextDay, t!.daa))}.`}{" "}
            You can claim every {formatWait(t!.waitDays * 86_400_000)}. The contract pays the KASMAN; nobody else can.
          </p>
        </>
      )}

      <h2 className={`mt-10 ${section}`}>Skins</h2>
      <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {skins.map((skin) => {
          const isEquipped = equipped === skin.id;
          return (
            <li key={skin.id} className={`flex flex-col gap-3 rounded-xl border p-4 ${isEquipped ? "border-kas bg-kas/5" : "border-white/10 bg-white/[0.03]"}`}>
              <SkinPreview skin={skin} />
              <h3 className="text-center font-semibold">{skin.name}</h3>
              {isEquipped ? (
                <span className="rounded-lg bg-kas/20 py-2 text-center text-sm text-kas">Equipped</span>
              ) : (
                <button type="button" onClick={() => equipSkin(skin.id)} className="rounded-lg border border-kas/50 py-2 text-sm hover:bg-kas/10">Equip</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatWait(ms: number) {
  const hours = Math.ceil(ms / 3_600_000);
  return hours > 48 ? `${Math.ceil(hours / 24)} days` : `${hours} h`;
}
