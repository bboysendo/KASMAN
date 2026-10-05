import { Link } from "react-router";
import Leaderboard from "../components/Leaderboard";
import PrizePool from "../components/PrizePool";
import { useLeaderboard } from "../lib/useLeaderboard";
import SkinPreview from "../components/SkinPreview";
import { DEFAULT_SKIN } from "../game/render/skins";
import { KAS_TICKER } from "../lib/bonusTokens";
import { ENTRY_FEE_KAS } from "../lib/leaderboard";

const STEPS = [
  { title: `Pay ${ENTRY_FEE_KAS} ${KAS_TICKER}`, text: "Connect your KasWare wallet. Each entry buys one game with three lives and feeds the monthly pool." },
  { title: "Chase the high score", text: "Eat pellets, flip the ghosts with power pellets, grab the Kaspa coins." },
  {
    title: "Win the pool",
    text: `All ${KAS_TICKER} sits in a Kaspa contract. The top 3 verified players of the month share the pool when it closes; 1st place also gets a bonus NFT.`,
  },
];

export default function Home() {
  const { entries, pool } = useLeaderboard(10);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="flex flex-col items-center gap-6 py-16 text-center sm:py-24">
        <h1 className="font-arcade text-4xl text-yellow-300 drop-shadow-[0_0_18px_rgba(255,225,77,0.6)] sm:text-6xl">KASMAN</h1>
        <p className="max-w-xl text-lg text-white/70">The arcade Kasman, rebuilt for the Kaspa community. Play, climb the leaderboard, take the monthly pot.</p>
        <div className="w-full max-w-md"><SkinPreview skin={DEFAULT_SKIN} /></div>
        <div className="flex flex-wrap justify-center gap-4">
          <Link to="/play" className="font-arcade rounded-lg bg-kas px-6 py-4 text-sm text-black shadow-[0_0_24px] shadow-kas/60 hover:brightness-110">PLAY NOW</Link>
          <Link to="/shop" className="rounded-lg border border-white/20 px-6 py-4 text-sm hover:border-kas">Browse Shop</Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <span className="font-arcade text-xs text-kas">0{i + 1}</span>
            <h2 className="mt-2 font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm text-white/60">{s.text}</p>
          </div>
        ))}
      </section>

      <section className="my-12 grid gap-4 md:grid-cols-[1fr_2fr]">
        <PrizePool pool={pool} className="flex flex-col justify-center" />
        <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Top players this month</h2>
            <Link to="/play?tab=leaderboard" className="text-sm text-kas hover:underline">Full board</Link>
          </div>
          <Leaderboard entries={entries} />
        </div>
      </section>
    </div>
  );
}
