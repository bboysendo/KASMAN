import { Link } from "react-router";
import FirstPlaceNft from "../components/FirstPlaceNft";
import GamesGoalProgress from "../components/GamesGoalProgress";
import Leaderboard from "../components/Leaderboard";
import PreviousMonthWinners from "../components/PreviousMonthWinners";
import PrizeDistribution from "../components/PrizeDistribution";
import PrizePool from "../components/PrizePool";
import { MAZE_COUNT } from "../game/engine/map";
import { ENTRY_FEE_KAS } from "../lib/leaderboard";
import { useLeaderboard } from "../lib/useLeaderboard";

/** Public leaderboard: readable by anyone, no wallet or entry required. */
export default function LeaderboardPage() {
  const { entries, pool } = useLeaderboard(Infinity);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="font-arcade text-xl text-yellow-300 sm:text-2xl">LEADERBOARD</h1>
      <p className="mt-2 max-w-2xl text-white/60">
        This month's top players, open to everyone. Total points add up every game submitted; time is the fastest clear of all {MAZE_COUNT} levels.
      </p>

      <div className="mt-6 min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <Leaderboard entries={entries} />
      </div>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4">
          <PrizePool pool={pool} />
          <FirstPlaceNft />
        </div>
        <PrizeDistribution pool={pool} className="min-w-0" />
        <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-4 md:col-span-2 xl:col-span-1">
          <GamesGoalProgress embedded />
          <div className="mt-4 border-t border-white/10 pt-4">
            <PreviousMonthWinners embedded />
          </div>
        </div>
        <Link
          to="/play"
          className="font-arcade flex items-center justify-center rounded-lg bg-kas px-6 py-4 text-center text-sm text-black shadow-[0_0_24px] shadow-kas/60 hover:brightness-110 md:col-span-2 xl:col-span-3"
        >
          PLAY NOW ({ENTRY_FEE_KAS} KAS)
        </Link>
      </section>
    </div>
  );
}
