import { describe, expect, it } from "vitest";
import { bestTimeFrames, formatRunTime, type PlayerEntry } from "./leaderboard";

describe("leaderboard", () => {
  it("formats run time", () => {
    expect(formatRunTime(60 * 83 + 30)).toBe("1:23.50");
  });

  it("shows the fastest clear, else the best game's length", () => {
    const e = { bestFrames: null, bestScoreFrames: 900 } as PlayerEntry;
    expect(bestTimeFrames(e)).toBe(900);
    expect(bestTimeFrames({ ...e, bestFrames: 600 })).toBe(600);
  });
});
