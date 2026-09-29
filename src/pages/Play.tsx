import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import GameCanvas, { type GameResult } from "../components/GameCanvas";
import Leaderboard from "../components/Leaderboard";
import PrizePool from "../components/PrizePool";
import { useLeaderboard } from "../lib/useLeaderboard";
import SettingsPanel from "../components/SettingsPanel";
import { MAZE_COUNT } from "../game/engine/map";
import { encodeReplay, type Replay } from "../game/engine/replay";
import { onchainReady } from "../lib/chain";
import { ENTRY_FEE_KAS, formatRunTime, pay, startGame, submitScore } from "../lib/leaderboard";
import { getSkin } from "../game/render/skins";
import { useWallet } from "../lib/useWallet";
import { useStore } from "../store";

type View =
  | { kind: "gate" }
  | { kind: "playing"; gameId: string; seed: number; resume?: Replay }
  | { kind: "over"; gameId: string; result: GameResult }
  | { kind: "replay"; replay: Replay; title: string };

type Tab = "game" | "leaderboard";

export default function Play() {
  const [view, setView] = useState<View>(() => {
    const { activeGame: active, activeGameId } = useStore.getState();
    // A run saved by an older engine version would re-simulate differently: drop it.
    return active?.v === 6 && activeGameId ? { kind: "playing", gameId: activeGameId, seed: active.seed, resume: active } : { kind: "gate" };
  });
  const [refresh, setRefresh] = useState(0);
  const { entries, pool } = useLeaderboard(Infinity, refresh);
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "leaderboard" ? "leaderboard" : "game";

  const showTab = (t: Tab) => {
    if (t === tab) return;
    if (t === "game" && view.kind === "playing") {
      // Leaving the Game tab unmounted the run, which saved it: resume that save, paused.
      const { activeGame: active, activeGameId } = useStore.getState();
      setView(active && activeGameId ? { kind: "playing", gameId: activeGameId, seed: active.seed, resume: active } : { kind: "gate" });
    }
    setParams(t === "game" ? {} : { tab: t }, { replace: true });
  };

  const tabClass = (t: Tab) =>
    `rounded-lg px-4 py-2 text-sm ${tab === t ? "bg-kas text-black font-semibold" : "border border-white/15 text-white/70 hover:text-white"}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div role="tablist" aria-label="Play sections" className="mb-4 flex gap-2">
        <button type="button" role="tab" aria-selected={tab === "game"} onClick={() => showTab("game")} className={tabClass("game")}>Game</button>
        <button type="button" role="tab" aria-selected={tab === "leaderboard"} onClick={() => showTab("leaderboard")} className={tabClass("leaderboard")}>Leaderboard</button>
      </div>

      {tab === "leaderboard" && (
        <section role="tabpanel" aria-label="Leaderboard" className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="mb-1 font-semibold">Monthly leaderboard</h2>
            <p className="mb-3 text-xs text-white/50">Total points add up every game you submit. Time is your fastest clear of all {MAZE_COUNT} levels.</p>
            <Leaderboard entries={entries} />
          </div>
          <div><PrizePool pool={pool} /></div>
        </section>
      )}

      {tab === "game" && (
        <div role="tabpanel" aria-label="Game" className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <section className="min-w-0">
            {view.kind === "gate" && <Gate onPaid={() => setRefresh((n) => n + 1)} onStart={(gameId, seed) => setView({ kind: "playing", gameId, seed })} />}
            {view.kind === "playing" && (
              <GameCanvas key={view.seed} gameId={view.gameId} seed={view.seed} resume={view.resume} onGameOver={(result) => setView({ kind: "over", gameId: view.gameId, result })} />
            )}
            {view.kind === "replay" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/60">Replay: {view.title}</span>
                  <button type="button" onClick={() => setView({ kind: "gate" })} className="text-kas hover:underline">Close</button>
                </div>
                <GameCanvas seed={view.replay.seed} replay={view.replay} onGameOver={() => {}} />
              </div>
            )}
            {view.kind === "over" && (
              <GameOver
                gameId={view.gameId}
                result={view.result}
                onSubmitted={() => setRefresh((n) => n + 1)}
                onAgain={() => setView({ kind: "gate" })}
                onReplay={() => setView({ kind: "replay", replay: view.result.replay, title: "Your last run" })}
              />
            )}
          </section>

          <aside className="flex flex-col gap-4">
            <PrizePool pool={pool} />
            <SettingsPanel />
          </aside>
        </div>
      )}
    </div>
  );
}

function Gate({ onStart, onPaid }: { onStart: (gameId: string, seed: number) => void; onPaid: () => void }) {
  const tickets = useStore((s) => s.tickets);
  const freeGames = useStore((s) => s.freeGames);
  const syncAccount = useStore((s) => s.syncAccount);
  const playerName = useStore((s) => s.playerName);
  const setPlayerName = useStore((s) => s.setPlayerName);
  const wallet = useWallet();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");

  const buyEntry = async () => {
    if (!wallet.address) return;
    setPaying(true);
    setError("");
    try {
      syncAccount(await pay(wallet.address, "entry"));
      onPaid();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="flex aspect-[44/31] w-full flex-col items-center justify-center gap-6 rounded-xl border border-kas/30 bg-[radial-gradient(ellipse_at_center,rgba(112,199,186,0.12),transparent_70%)] p-6 text-center">
      <h1 className="font-arcade text-2xl text-yellow-300 sm:text-4xl">KASMAN</h1>
      <p className="max-w-md text-white/70">
        One entry = one game with 3 lives. Every entry adds {ENTRY_FEE_KAS} KAS to this month&apos;s pool. Highest verified score takes it all.
      </p>
      {!wallet.address ? (
        <button
          type="button"
          disabled={wallet.busy}
          onClick={wallet.connect}
          className="font-arcade rounded-lg bg-kas px-6 py-4 text-sm text-black shadow-[0_0_24px] shadow-kas/60 hover:brightness-110 disabled:opacity-60"
        >
          {wallet.busy ? "CONNECTING..." : "CONNECT WALLET TO PLAY"}
        </button>
      ) : tickets > 0 || freeGames > 0 ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPaying(true);
            setError("");
            try {
              const game = await startGame(playerName);
              // Same order as the server: the staked NFT's free games first.
              useStore.setState((s) => (s.freeGames > 0 ? { freeGames: s.freeGames - 1 } : { tickets: s.tickets - 1 }));
              onStart(game.gameId, game.seed);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not start the game");
            } finally {
              setPaying(false);
            }
          }}
          className="flex w-full max-w-sm flex-col items-center gap-3"
        >
          <label className="sr-only" htmlFor="player-name">Name</label>
          <input
            id="player-name"
            required
            autoFocus
            maxLength={16}
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-center"
          />
          <button
            type="submit"
            disabled={!playerName.trim() || paying}
            className="font-arcade rounded-lg bg-kas px-6 py-4 text-sm text-black shadow-[0_0_24px] shadow-kas/60 hover:brightness-110 disabled:opacity-60"
          >
            START GAME
          </button>
        </form>
      ) : (
        <button
          type="button"
          disabled={paying}
          onClick={buyEntry}
          className="font-arcade rounded-lg bg-kas px-6 py-4 text-sm text-black shadow-[0_0_24px] shadow-kas/60 hover:brightness-110 disabled:opacity-60"
        >
          {paying ? "CONFIRMING..." : `PAY ${ENTRY_FEE_KAS} KAS TO PLAY`}
        </button>
      )}
      <p className="text-xs text-white/40">
        {!wallet.address
          ? "Connect your KasWare wallet: you pay and play with it, and the prize goes to it."
          : tickets > 0 || freeGames > 0
            ? [freeGames > 0 && `${freeGames} free game${freeGames === 1 ? "" : "s"} left today`, tickets > 0 && `${tickets} entr${tickets === 1 ? "y" : "ies"} available`]
                .filter(Boolean)
                .join(" · ")
            : "The KAS goes straight from your wallet to this month's prize pool contract. Each day you pay an entry also earns KASMAN."}
      </p>
      {wallet.address && onchainReady && tickets === 0 && freeGames === 0 && (
        <p className="text-xs text-white/40">
          Staked a Kasman NFT? Do your <Link to="/inventory" className="text-kas hover:underline">daily check-in</Link> for free games.
        </p>
      )}
      {(error || wallet.error) && <p role="alert" className="text-sm text-red-400">{error || wallet.error}</p>}
    </div>
  );
}

function GameOver({ gameId, result, onSubmitted, onAgain, onReplay }: {
  gameId: string;
  result: GameResult;
  onSubmitted: () => void;
  onAgain: () => void;
  onReplay: () => void;
}) {
  const playerName = useStore((s) => s.playerName);
  const [status, setStatus] = useState<"saving" | "saved" | "error">("saving");
  const [message, setMessage] = useState("");
  const submitted = useRef(false);

  const submit = async () => {
    setStatus("saving");
    try {
      await submitScore(gameId, encodeReplay(result.replay), result.score);
      setStatus("saved");
      setMessage("Score verified and added to your monthly total.");
      onSubmitted();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not save score");
    }
  };

  // The name was entered before the game: save the result as soon as it ends (once, even under StrictMode).
  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    void submit();
  });

  return (
    <div
      className={`flex aspect-[44/31] w-full flex-col items-center justify-center gap-5 rounded-xl border p-6 text-center ${
        result.won
          ? "border-yellow-300/40 bg-[radial-gradient(ellipse_at_center,rgba(253,224,71,0.14),transparent_70%)]"
          : "border-red-500/30 bg-[radial-gradient(ellipse_at_center,rgba(255,71,87,0.12),transparent_70%)]"
      }`}
    >
      {result.won ? (
        <>
          <h2 className="font-arcade text-2xl text-yellow-300 drop-shadow-[0_0_8px_rgba(255,225,77,0.8)] sm:text-3xl">YOU WIN!</h2>
          <p className="text-white/80">You completed all {MAZE_COUNT} levels in <span className="font-arcade text-kas">{formatRunTime(result.frames)}</span>. There are no more mazes to clear.</p>
        </>
      ) : (
        <h2 className="font-arcade text-2xl text-red-400 sm:text-3xl">GAME OVER</h2>
      )}
      <p className="font-arcade text-lg">
        {result.score.toLocaleString()} <span className="text-xs text-white/50">PTS · LEVEL {result.level}</span>
      </p>
      {status === "saving" && <p className="text-sm text-white/60">Saving score for {playerName.trim() || "Anonymous"}...</p>}
      {status === "error" && (
        <button type="button" onClick={submit} className="rounded-lg bg-kas px-4 py-2 font-semibold text-black">Retry</button>
      )}
      {message && <p className={`text-sm ${status === "error" ? "text-red-400" : "text-kas"}`}>{message}</p>}
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={onAgain} className="rounded-lg border border-kas/50 px-4 py-2 hover:bg-kas/10">Play again</button>
        <button type="button" onClick={onReplay} className="rounded-lg border border-white/20 px-4 py-2 hover:bg-white/5">Watch replay</button>
        <SaveVideo result={result} />
      </div>
    </div>
  );
}

/** Renders the run's replay to an MP4 and downloads it. Hidden where the browser has no WebCodecs. */
function SaveVideo({ result }: { result: GameResult }) {
  const skinId = useStore((s) => s.equippedSkin);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    setProgress(0);
    try {
      // Loaded on demand: the encoder library is big and most runs are never exported.
      const { renderReplayVideo } = await import("../game/render/video");
      const blob = await renderReplayVideo(result.replay, getSkin(skinId), setProgress);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `kasman-${result.score}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the video");
    } finally {
      setProgress(null);
    }
  };

  if (typeof VideoEncoder === "undefined") return null;
  return (
    <>
      <button
        type="button"
        onClick={save}
        disabled={progress !== null}
        className="rounded-lg border border-white/20 px-4 py-2 hover:bg-white/5 disabled:opacity-60"
      >
        {progress === null ? "Save video" : `Saving video... ${Math.round(progress * 100)}%`}
      </button>
      {error && <p className="basis-full text-sm text-red-400">{error}</p>}
    </>
  );
}
