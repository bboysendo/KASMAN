import { useEffect, useRef, useState } from "react";
import { playMusicStep, playSfx, setAudio, unlockAudio, type Sfx } from "../game/audio";
import { BUY_LIFE, DOWN, FPS, LEFT, MAX_BOUGHT_LIVES, NONE, RIGHT, UP } from "../game/engine/constants";
import { createGame, step, type GameState, type Phase } from "../game/engine/game";
import { createRecorder, simulateReplay, type Replay } from "../game/engine/replay";
import { createInput, type Input } from "../game/input";
import { PixiRenderer, snapshot } from "../game/render/PixiRenderer";
import { getSkin } from "../game/render/skins";
import KasmanIcon from "./KasmanIcon";
import { useStore } from "../store";

export interface GameResult {
  score: number;
  level: number;
  /** Cleared every level. */
  won: boolean;
  /** Simulation frames played (60 per second). */
  frames: number;
  replay: Replay;
}

interface Props {
  seed: number;
  /** Server id of the game being played; saved with the unfinished run so it can still be submitted. */
  gameId?: string;
  /** When set, plays this replay back instead of reading player input. */
  replay?: Replay;
  /** Unfinished run to restore. It starts paused. */
  resume?: Replay;
  onGameOver: (result: GameResult) => void;
}

interface Hud { score: number; lives: number; livesBought: number; level: number; phase: Phase }

const FRAME_MS = 1000 / FPS;
const EVENT_SFX: Partial<Record<string, Sfx>> = {
  pellet: "pellet", power: "power", ghostEaten: "ghostEaten", fruit: "fruit", death: "death",
  levelClear: "levelClear", extraLife: "extraLife", ready: "ready",
};
const PHASE_TEXT: Partial<Record<Phase, string>> = { ready: "READY!", levelclear: "LEVEL CLEAR" };

export default function GameCanvas({ seed, gameId, replay, resume, onGameOver }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiRenderer | null>(null);
  const inputRef = useRef<Input | null>(null);
  const pausedRef = useRef(false);
  const onGameOverRef = useRef(onGameOver);
  /** Extra lives waiting to be fed to the engine as BUY_LIFE inputs. */
  const lifeQueueRef = useRef(0);
  /** Dev only: clear the maze on the next frame to jump to the next level. */
  const skipLevelRef = useRef(false);

  const [hud, setHud] = useState<Hud>({ score: 0, lives: 3, livesBought: 0, level: 1, phase: "ready" });
  const [paused, setPaused] = useState(!!resume);
  const [announcement, setAnnouncement] = useState("");
  const settings = useStore((s) => s.settings);
  const skinId = useStore((s) => s.equippedSkin);
  const extraLives = useStore((s) => s.extraLives);
  const consumeExtraLife = useStore((s) => s.consumeExtraLife);

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    setAnnouncement(pausedRef.current ? "Paused" : "Resumed");
  };

  /** Spends one life bought in the Marketplace on the current game. */
  const addLife = () => {
    if (hud.livesBought + lifeQueueRef.current >= MAX_BOUGHT_LIVES) return;
    if (!consumeExtraLife()) return;
    lifeQueueRef.current++;
    // Stay paused until the player resumes.
    if (!pausedRef.current) togglePause();
  };

  useEffect(() => setAudio({ volume: settings.volume, muted: settings.muted }), [settings.volume, settings.muted]);
  useEffect(() => rendererRef.current?.setSkin(getSkin(skinId)), [skinId]);
  useEffect(() => {
    if (rendererRef.current) rendererRef.current.reducedMotion = settings.reducedMotion;
  }, [settings.reducedMotion]);

  // Latest props/settings for the game loop without restarting it.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
    onGameOverRef.current = onGameOver;
  });

  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false;
    let raf = 0;
    let saveSession = () => {};
    pausedRef.current = !!resume;
    lifeQueueRef.current = 0;
    skipLevelRef.current = false;

    void PixiRenderer.create(host, getSkin(useStore.getState().equippedSkin)).then((renderer) => {
      if (disposed) return renderer.destroy();
      rendererRef.current = renderer;
      renderer.reducedMotion = settingsRef.current.reducedMotion;

      const state: GameState = resume ? simulateReplay(resume) : createGame(seed);
      const recorder = createRecorder(state.seed, resume);
      const input = createInput(renderer.canvas, {
        onPause: togglePause,
        gamepadPauseButton: settingsRef.current.gamepadPauseButton,
      });
      inputRef.current = input;
      const replayInputs = new Map(replay?.inputs ?? []);

      let prev = snapshot(state);
      let acc = 0;
      let last = performance.now();
      let lastHud = "";
      let ended = false;
      // Skipping levels is not in the replay, so a debug run is never saved or resumed.
      let debugged = false;
      // Leaving the page (or closing the tab) keeps the run so the player can resume it.
      saveSession = () => {
        if (!replay && !ended) useStore.getState().setActiveGame(debugged ? null : recorder.replay, gameId);
      };
      addEventListener("pagehide", saveSession);

      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        acc += Math.min(250, now - last); // clamp so a background tab does not fast-forward
        last = now;
        const live = input.poll();
        // While paused, only run the steps that apply queued extra lives.
        if (pausedRef.current || ended) acc = ended ? 0 : lifeQueueRef.current * FRAME_MS;
        let pending = live;
        const held = input.held();

        while (acc >= FRAME_MS) {
          acc -= FRAME_MS;
          let dir: number;
          if (replay) dir = replayInputs.get(state.frame) ?? NONE;
          else if (lifeQueueRef.current > 0) {
            lifeQueueRef.current--;
            dir = BUY_LIFE; // the direction press waits one frame
          } else {
            dir = pending;
            pending = NONE;
            // Holding a direction keeps asking for that turn until it is taken.
            if (dir === NONE && held !== NONE && held !== state.pac.dir && state.pac.next === NONE) dir = held;
          }
          if (skipLevelRef.current && (state.phase === "ready" || state.phase === "playing")) {
            skipLevelRef.current = false;
            debugged = true;
            state.pellets.fill(0);
            state.pelletsLeft = 0;
            if (state.phase === "ready") state.phase = "playing";
          }
          prev = snapshot(state);
          if (!replay) recorder.record(state, dir);
          step(state, dir);

          for (const e of state.events) {
            const sfx = EVENT_SFX[e.type];
            if (sfx) playSfx(sfx);
            if (e.type === "death" || e.type === "ghostEaten") navigator.vibrate?.(e.type === "death" ? 120 : 30);
          }
          renderer.handleEvents(state.events);
          if (settingsRef.current.music && state.phase === "playing" && state.frame % 15 === 0) playMusicStep();

          const replayDone = replay && state.frame >= replay.frames;
          if ((state.phase === "gameover" || replayDone) && !ended) {
            ended = true;
            if (!replay) useStore.getState().setActiveGame(null);
            onGameOverRef.current({ score: state.score, level: state.level, won: state.won, frames: state.frame, replay: recorder.replay });
            break;
          }
        }
        // Keep an unconsumed press for the next frame instead of dropping it.
        if (pending !== NONE && !pausedRef.current) input.press(pending);

        renderer.render(state, prev, acc / FRAME_MS);

        const next: Hud = { score: state.score, lives: state.lives, livesBought: state.livesBought, level: state.level, phase: state.phase };
        const key = JSON.stringify(next);
        if (key !== lastHud) {
          if (lastHud) {
            const old = JSON.parse(lastHud) as Hud;
            if (old.phase !== next.phase && PHASE_TEXT[next.phase]) setAnnouncement(PHASE_TEXT[next.phase]!);
            if (old.lives !== next.lives) setAnnouncement(`Lives ${next.lives}`);
            if (old.level !== next.level) setAnnouncement(`Level ${next.level}`);
          }
          lastHud = key;
          setHud(next);
        }
      };
      raf = requestAnimationFrame(loop);
    });

    return () => {
      disposed = true;
      saveSession();
      removeEventListener("pagehide", saveSession);
      cancelAnimationFrame(raf);
      inputRef.current?.dispose();
      inputRef.current = null;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
    // togglePause only touches refs/state setters, so it is safe to omit.
  }, [seed, gameId, replay, resume]);

  const overlay = paused ? "PAUSED" : PHASE_TEXT[hud.phase];
  const hudText = settings.largeHud ? "text-sm sm:text-base" : "text-[10px] sm:text-xs";
  const dpad = !replay && settings.mobileControls === "buttons";

  // Landscape phones hide the header on scroll (short:static): bring the whole game into view.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <div ref={rootRef} className="flex flex-col gap-2" onPointerDown={unlockAudio} onKeyDown={unlockAudio}>
      <div className={`font-arcade flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 ${hudText}`}>
        <span>SCORE <span className="text-kas">{hud.score}</span></span>
        <span>LEVEL <span className="text-kas">{hud.level}</span></span>
        <span aria-label={`${hud.lives} lives`} className="flex items-center">
          {Array.from({ length: Math.min(hud.lives, 6) }, (_, i) => (
            <KasmanIcon key={i} skin={getSkin(skinId)} size={28} />
          ))}
        </span>
        {!replay && extraLives > 0 && (
          <button
            type="button"
            onClick={addLife}
            disabled={hud.livesBought >= MAX_BOUGHT_LIVES || hud.phase === "gameover"}
            title={`Up to ${MAX_BOUGHT_LIVES} bought lives per game`}
            className="rounded border border-yellow-300/50 px-2 py-1 text-yellow-300 hover:bg-yellow-300/10 disabled:opacity-40"
          >
            +1 LIFE ({extraLives})
          </button>
        )}
        {import.meta.env.DEV && !replay && (
          <button
            type="button"
            onClick={() => (skipLevelRef.current = true)}
            title="Debug: clear the maze and go to the next level (dev builds only, run is not saved)"
            className="rounded border border-red-400/50 px-2 py-1 text-red-400 hover:bg-red-400/10"
          >
            SKIP LVL
          </button>
        )}
        {!replay && (
          <button type="button" onClick={togglePause} className="rounded border border-white/20 px-2 py-1 hover:border-kas">
            {paused ? "RESUME" : "PAUSE"}
          </button>
        )}
      </div>

      {/* Maze width is capped so its height fits the viewport below the header, tabs and HUD (or the D-pad). */}
      <div className="flex flex-col items-center gap-3 pointer-coarse:landscape:flex-row pointer-coarse:landscape:justify-center">
        <div
          className={`relative aspect-[44/31] w-[min(100%,calc((100dvh-12.5rem)*44/31))] overflow-hidden rounded-xl border border-kas/30 shadow-[0_0_40px_-10px] shadow-kas/40 short:w-[min(100%,calc((100dvh-4rem)*44/31))] ${
            dpad ? "pointer-coarse:portrait:w-[min(100%,calc((100dvh-25rem)*44/31))]" : ""
          }`}
        >
          <div ref={hostRef} className="absolute inset-0" />
          {overlay && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="font-arcade animate-pulse text-lg text-yellow-300 drop-shadow-[0_0_8px_rgba(255,225,77,0.8)] sm:text-2xl">
                {overlay}
              </span>
            </div>
          )}
          {replay && <span className="font-arcade absolute left-2 top-2 text-[10px] text-kas">REPLAY</span>}
        </div>

        {dpad && <DPad onPress={(d) => inputRef.current?.press(d)} />}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
}

function DPad({ onPress }: { onPress: (dir: number) => void }) {
  const btn = (dir: number, label: string, area: string) => (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress(dir);
      }}
      className={`${area} flex size-14 touch-none sm:size-16 select-none items-center justify-center rounded-2xl border border-kas/40 bg-white/5 text-2xl active:bg-kas/30`}
    >
      {{ [UP]: "▲", [LEFT]: "◀", [DOWN]: "▼", [RIGHT]: "▶" }[dir]}
    </button>
  );
  return (
    <div className="hidden shrink-0 grid-cols-3 gap-2 pointer-coarse:grid">
      {btn(UP, "Up", "col-start-2 row-start-1")}
      {btn(LEFT, "Left", "col-start-1 row-start-2")}
      {btn(RIGHT, "Right", "col-start-3 row-start-2")}
      {btn(DOWN, "Down", "col-start-2 row-start-3")}
    </div>
  );
}
