import { useEffect, useState } from "react";
import { getMonthlyLeaderboard, getPrizePool, type PlayerEntry } from "./leaderboard";

/** Monthly top players + prize pool. Bump `refreshKey` to reload after a submit. */
export function useLeaderboard(limit: number, refreshKey = 0) {
  const [entries, setEntries] = useState<PlayerEntry[]>([]);
  const [pool, setPool] = useState(0);
  useEffect(() => {
    void getMonthlyLeaderboard(refreshKey > 0).then((rows) => setEntries(rows.slice(0, limit)), () => setEntries([]));
    void getPrizePool().then(setPool, () => {});
  }, [limit, refreshKey]);
  return { entries, pool };
}
