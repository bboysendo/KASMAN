import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import GameCanvas, { type GameResult } from "../components/GameCanvas";
import GamesGoalProgress from "../components/GamesGoalProgress";
import Leaderboard from "../components/Leaderboard";
import PreviousMonthWinners from "../components/PreviousMonthWinners";
import PrizeDistribution from "../components/PrizeDistribution";
import PrizePool from "../components/PrizePool";
import { useLeaderboard } from "../lib/useLeaderboard";
import SettingsPanel from "../components/SettingsPanel";
import { MAZE_COUNT } from "../game/engine/map";
import { encodeReplay, type Replay } from "../game/engine/replay";
import { onchainReady } from "../lib/chain";
import { unlockAudio } from "../game/audio";
import { KAS_TICKER } from "../lib/bonusTokens";
import { ENTRY_FEE_KAS, formatRunTime, pay, startGame, submitScore } from "../lib/leaderboard";
import { getSkin } from "../game/render/skins";
import { useWallet } from "../lib/useWallet";
import { useStore } from "../store";
import XHandleForm from "../components/XHandleForm";
import XHandleBadge from "../components/XHandleBadge";

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
    return active?.v === 15 && activeGameId ? { kind: "playing", gameId: activeGameId, seed: active.seed, resume: active } : { kind: "gate" };
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
    <div className="mx-auto max-w-7xl px-4 py-3">
      <div role="tablist" aria-label="Play sections" className="mb-2 flex items-center gap-2">
        <button type="button" role="tab" aria-selected={tab === "game"} onClick={() => showTab("game")} className={tabClass("game")}>Game</button>
        <button type="button" role="tab" aria-selected={tab === "leaderboard"} onClick={() => showTab("leaderboard")} className={tabClass("leaderboard")}>Leaderboard</button>
        <XHandleBadge onChanged={() => setRefresh((n) => n + 1)} />
      </div>

      {tab === "leaderboard" && (
        <section role="tabpanel" aria-label="Leaderboard" className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="mb-1 font-semibold">Monthly leaderboard</h2>
            <p className="mb-3 text-xs text-white/50">Total points add up every game you submit. Time is your fastest clear of all {MAZE_COUNT} levels.</p>
            <Leaderboard entries={entries} />
          </div>
          <div className="flex flex-col gap-4">
            <PrizePool pool={pool} />
            <GamesGoalProgress />
            <PrizeDistribution pool={pool} />
            <PreviousMonthWinners />
          </div>
        </section>
      )}

      {tab === "game" && (
        <div
          role="tabpanel"
          aria-label="Game"
          // The maze is the priority: at lg+ (desktop) this panel is capped to exactly what's left
          // below the header so nothing scrolls, and the game section gets flex-1 so it claims all
          // of that space the fixed-size sidebar doesn't need. Below lg it's normal scrollable flow.
          className="flex flex-col gap-2 lg:h-[calc(100dvh_-_var(--header-h,4rem)_-_9rem)] lg:flex-row lg:gap-4 lg:overflow-hidden"
        >
          <section className="flex min-h-0 flex-col lg:flex-1">
            {view.kind === "gate" && <Gate onPaid={() => setRefresh((n) => n + 1)} onStart={(gameId, seed) => setView({ kind: "playing", gameId, seed })} />}
            {view.kind === "playing" && (
              <GameCanvas key={view.seed} gameId={view.gameId} seed={view.seed} resume={view.resume} onGameOver={(result) => setView({ kind: "over", gameId: view.gameId, result })} />
            )}
            {view.kind === "replay" && (
              <div className="flex h-full min-h-0 flex-col gap-3">
                <div className="flex shrink-0 items-center justify-between text-sm">
                  <span className="text-white/60">Replay: {view.title}</span>
                  <button type="button" onClick={() => setView({ kind: "gate" })} className="text-kas hover:underline">Close</button>
                </div>
                <div className="min-h-0 flex-1">
                  <GameCanvas seed={view.replay.seed} replay={view.replay} onGameOver={() => {}} />
                </div>
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

          {/* Collapsed (the default) this fits with room to spare; overflow-y-auto is only a safety
           * net for when Settings is expanded, whose full keybinding list is simply too tall to
           * also fit without scrolling — clipping it off with no way to reach it would be worse. */}
          <aside className="flex min-w-0 shrink-0 flex-col gap-2 overflow-x-hidden lg:w-64 lg:overflow-y-auto">
            <PrizePool pool={pool} compact />
            <PrizeDistribution pool={pool} compact />
            <SettingsPanel compact />
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
  const xHandle = useStore((s) => s.xHandle);
  const wallet = useWallet();
  const [paying, setPaying] = useState(false);
  /** True while KasWare is signing/sending the payment, before it's even broadcast: the button
   * shows this distinctly from on-chain confirmation so the player doesn't click again and queue
   * up more wallet popups. */
  const [signing, setSigning] = useState(false);
  const [waitedMs, setWaitedMs] = useState(0);
  const [error, setError] = useState("");

  const buyEntry = async () => {
    if (!wallet.address) return;
    unlockAudio(); // resume the AudioContext now, tied to this click, so music can start later
    setPaying(true);
    setSigning(true);
    setWaitedMs(0);
    setError("");
    try {
      syncAccount(
        await pay(wallet.address, "entry", undefined, undefined, (ms) => {
          setSigning(false); // broadcast went through: now waiting for chain acceptance instead
          setWaitedMs(ms);
        }),
      );
      onPaid();
    } catch (e) {
      console.error("[buyEntry] failed", e);
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setPaying(false);
      setSigning(false);
      setWaitedMs(0);
    }
  };

  const startNow = async () => {
    unlockAudio(); // resume the AudioContext now, tied to this click
    setPaying(true);
    setError("");
    try {
      const game = await startGame();
      // Same order as the server: the staked NFT's free games first.
      useStore.setState((s) => (s.freeGames > 0 ? { freeGames: s.freeGames - 1 } : { tickets: s.tickets - 1 }));
      onStart(game.gameId, game.seed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the game");
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="flex aspect-[44/31] w-full max-h-full flex-col items-center justify-center gap-6 overflow-y-auto rounded-xl border border-kas/30 bg-[radial-gradient(ellipse_at_center,rgba(112,199,186,0.12),transparent_70%)] p-6 text-center">
      <h1 className="font-arcade text-2xl text-yellow-300 sm:text-4xl">KASMAN</h1>
      <p className="max-w-md text-white/70">
        One entry = one game with 3 lives. Every entry adds {ENTRY_FEE_KAS} {KAS_TICKER} to this month&apos;s pool. The top 3 verified scores share it.
      </p>
      {!wallet.address ? (
        <button
          type="button"
          disabled={wallet.busy}
          onClick={() => {
            setError(""); // a previous payment's failure shouldn't linger once reconnecting
            void wallet.connect();
          }}
          className="font-arcade rounded-lg bg-kas px-6 py-4 text-sm text-black shadow-[0_0_24px] shadow-kas/60 hover:brightness-110 disabled:opacity-60"
        >
          {wallet.busy ? "CONNECTING..." : "CONNECT WALLET TO PLAY"}
        </button>
      ) : !xHandle ? (
        <XHandleForm />
      ) : tickets > 0 || freeGames > 0 ? (
        <button
          type="button"
          disabled={paying}
          onClick={startNow}
          className="font-arcade rounded-lg bg-kas px-6 py-4 text-sm text-black shadow-[0_0_24px] shadow-kas/60 hover:brightness-110 disabled:opacity-60"
        >
          {paying ? "STARTING..." : "START GAME"}
        </button>
      ) : (
        <button
          type="button"
          disabled={paying}
          onClick={buyEntry}
          className="font-arcade rounded-lg bg-kas px-6 py-4 text-sm text-black shadow-[0_0_24px] shadow-kas/60 hover:brightness-110 disabled:opacity-60"
        >
          {paying
            ? signing
              ? "CONFIRMING IN KASWARE..."
              : waitedMs > 4000
                ? `CONFIRMING ON CHAIN... (${Math.round(waitedMs / 1000)}s)`
                : "CONFIRMING..."
            : `PAY ${ENTRY_FEE_KAS} ${KAS_TICKER} TO PLAY`}
        </button>
      )}
      <p className="text-xs text-white/40">
        {paying && signing
          ? "Unlock KasWare if it asks, then approve the payment in its popup."
          : paying && waitedMs > 4000
            ? "Waiting for the network to accept the transaction. This can take a bit longer on testnet; the game starts on its own once it's confirmed, no need to reload."
            : !wallet.address
              ? "Connect your KasWare wallet: you pay and play with it, and the prize goes to it."
              : !xHandle
                ? "This is the name shown on the leaderboard, linked to your X profile."
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
  const xHandle = useStore((s) => s.xHandle);
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

  // The X handle was registered before the game: save the result as soon as it ends (once, even under StrictMode).
  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    void submit();
  });

  return (
    <div
      className={`flex aspect-[44/31] w-full max-h-full flex-col items-center justify-center gap-5 overflow-y-auto rounded-xl border p-6 text-center ${
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
      {/* Level N offers N Puzzle Shards, so the total offered through the level reached is N(N+1)/2. */}
      <p className={`text-xs ${result.shardsCollected > 0 ? "text-kas" : "text-white/40"}`}>
        Puzzle Shards Collected: {result.shardsCollected}/{(result.level * (result.level + 1)) / 2}
      </p>
      {status === "saving" && <p className="text-sm text-white/60">Saving score for {xHandle ? `@${xHandle}` : "Anonymous"}...</p>}
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
