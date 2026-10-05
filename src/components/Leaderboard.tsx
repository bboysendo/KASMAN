import { bestTimeFrames, formatRunTime, type PlayerEntry } from "../lib/leaderboard";

interface Props {
  entries: PlayerEntry[];
}

export default function Leaderboard({ entries }: Props) {
  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-white/50">No scores yet this month. Be the first.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-white/40">
            <th scope="col" className="w-8 py-2 font-normal">#</th>
            <th scope="col" className="py-2 font-normal">Name</th>
            <th scope="col" className="hidden py-2 pl-3 text-right font-normal sm:table-cell">Attempts</th>
            <th scope="col" className="py-2 pl-3 text-right font-normal">Total points</th>
            <th scope="col" className="hidden py-2 pl-3 text-right font-normal sm:table-cell">Max level</th>
            <th scope="col" className="py-2 pl-3 text-right font-normal" title="Fastest clear of all levels, or length of the best game until then">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {entries.map((e, i) => (
            <tr key={e.address}>
              <td className={`font-arcade py-2 text-xs ${i === 0 ? "text-yellow-300" : "text-white/40"}`}>{i + 1}</td>
              <td className="min-w-16 max-w-0 truncate py-2">
                {e.xHandle ? (
                  <a
                    href={`https://x.com/${e.xHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-kas hover:underline"
                  >
                    @{e.xHandle}
                  </a>
                ) : (
                  e.name
                )}
              </td>
              <td className="font-arcade hidden py-2 pl-3 text-right text-xs text-white/70 sm:table-cell">{e.games}</td>
              <td className="font-arcade py-2 pl-3 text-right text-[10px] sm:text-xs">{e.totalScore.toLocaleString()}</td>
              <td className="font-arcade hidden py-2 pl-3 text-right text-xs text-white/70 sm:table-cell">{e.bestLevel ?? 1}</td>
              <td
                className={`font-arcade whitespace-nowrap py-2 pl-3 text-right text-[10px] sm:text-xs ${e.bestFrames === null ? "text-white/70" : "text-kas"}`}
                title={e.bestFrames === null ? "Best game length (all levels not cleared yet)" : "Fastest clear of all levels"}
              >
                {formatRunTime(bestTimeFrames(e))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
