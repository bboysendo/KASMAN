import { useEffect, useRef, useState } from "react";
import { pauseMusic, playMusic, playSfx, setAudio, setMusicLevel, stopMusic, unlockAudio, type Sfx } from "../game/audio";
import {
  BUY_LIFE, DOWN, FPS, LEFT, MAX_BOUGHT_LIVES, MAX_FREEZE_PER_LEVEL, MAX_GHOSTHUNT_PER_LEVEL, MAX_MAGNET_PER_LEVEL, MAX_SHIELD_PER_LEVEL,
  MAX_SPEED_PER_LEVEL, MAX_SURGE_PER_LEVEL, NONE, RIGHT, UP, USE_FREEZE, USE_GHOSTHUNT, USE_MAGNET, USE_SHIELD, USE_SPEED, USE_SURGE,
} from "../game/engine/constants";
import { createGame, step, type GameState, type Phase } from "../game/engine/game";
import { createRecorder, simulateReplay, type Replay } from "../game/engine/replay";
import { createInput, type Input } from "../game/input";
import { PixiRenderer, snapshot } from "../game/render/PixiRenderer";
import { getSkin } from "../game/render/skins";
import { useIsTouchDevice } from "../lib/device";
import { POTIONS, type PotionId } from "../lib/prices";
import KasmanIcon from "./KasmanIcon";
import PotionIcon from "./PotionIcon";
import { useStore } from "../store";

const POTION_INPUT: Record<PotionId, number> = {
  shield: USE_SHIELD, freeze: USE_FREEZE, surge: USE_SURGE, speed: USE_SPEED, magnet: USE_MAGNET, ghosthunt: USE_GHOSTHUNT,
};
const POTION_CAP: Record<PotionId, number> = {
  shield: MAX_SHIELD_PER_LEVEL, freeze: MAX_FREEZE_PER_LEVEL, surge: MAX_SURGE_PER_LEVEL,
  speed: MAX_SPEED_PER_LEVEL, magnet: MAX_MAGNET_PER_LEVEL, ghosthunt: MAX_GHOSTHUNT_PER_LEVEL,
};
const EMPTY_POTION_COUNTS: Record<PotionId, number> = { shield: 0, freeze: 0, surge: 0, speed: 0, magnet: 0, ghosthunt: 0 };
/** How many of `id` were already used this level, from the engine's per-potion *Bought counters (reset on every level clear). */
const usedOf = (hud: Hud, id: PotionId) =>
  ({ shield: hud.shieldBought, freeze: hud.freezeBought, surge: hud.surgeBought, speed: hud.speedBought, magnet: hud.magnetBought, ghosthunt: hud.ghosthuntBought }[id]);
/** Short label for a KeyboardEvent.code, for the HUD's key hints. */
const keyLabel = (code: string) => code.replace(/^Digit|^Key/, "").replace(/^Arrow/, "").replace(/^Numpad/, "PAD");

export interface GameResult {
  score: number;
  level: number;
  /** Cleared every level. */
  won: boolean;
  /** Simulation frames played (60 per second). */
  frames: number;
  /** Total Puzzle Shards picked up this game, across every level; the server credits that many on submit. */
  shardsCollected: number;
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

interface Hud {
  score: number;
  lives: number;
  livesBought: number;
  level: number;
  phase: Phase;
  shieldBought: number;
  freezeBought: number;
  surgeBought: number;
  speedBought: number;
  magnetBought: number;
  ghosthuntBought: number;
  shieldTimer: number;
  freezeTimer: number;
  surgeTimer: number;
  speedTimer: number;
  magnetTimer: number;
}

const FRAME_MS = 1000 / FPS;
const EVENT_SFX: Partial<Record<string, Sfx>> = {
  pellet: "pellet", power: "power", ghostEaten: "ghostEaten", fruit: "fruit", death: "death", gameOver: "gameOver",
  levelClear: "levelClear", extraLife: "extraLife", ready: "ready", shield: "shield", freeze: "freeze", surge: "surge",
  speed: "speed", magnet: "magnet", ghosthunt: "ghosthunt", shardCollected: "shardCollected",
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
  /** Potions waiting to be fed to the engine, one input queued per type. */
  const potionQueueRef = useRef<Record<PotionId, number>>({ ...EMPTY_POTION_COUNTS });

  const [hud, setHud] = useState<Hud>({
    score: 0, lives: 3, livesBought: 0, level: 1, phase: "ready",
    shieldBought: 0, freezeBought: 0, surgeBought: 0, speedBought: 0, magnetBought: 0, ghosthuntBought: 0,
    shieldTimer: 0, freezeTimer: 0, surgeTimer: 0, speedTimer: 0, magnetTimer: 0,
  });
  const [paused, setPaused] = useState(!!resume);
  const [announcement, setAnnouncement] = useState("");
  const isTouch = useIsTouchDevice();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const skinId = useStore((s) => s.equippedSkin);
  const extraLives = useStore((s) => s.extraLives);
  const consumeExtraLife = useStore((s) => s.consumeExtraLife);
  const ownedPotions = useStore((s) => s.ownedPotions);
  const consumePotion = useStore((s) => s.consumePotion);
  const hudRef = useRef(hud);

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    setAnnouncement(pausedRef.current ? "Paused" : "Resumed");
    if (!replay) (pausedRef.current ? pauseMusic : playMusic)();
  };

  /** Spends one life bought in the Shop on the current game. Reads hudRef (not hud) so it stays
   * correct when called from the long-lived keymap handler, not just the always-fresh button. */
  const addLife = () => {
    if (hudRef.current.livesBought + lifeQueueRef.current >= MAX_BOUGHT_LIVES) return;
    if (hudRef.current.phase === "gameover") return;
    if (!consumeExtraLife()) return;
    lifeQueueRef.current++;
    // Stay paused until the player resumes.
    if (!pausedRef.current) togglePause();
  };

  /** Spends one potion bought in the Shop right away; takes effect the next frame. */
  const spendPotion = (id: PotionId) => {
    if (usedOf(hudRef.current, id) + potionQueueRef.current[id] >= POTION_CAP[id]) return;
    if (!consumePotion(id)) return;
    potionQueueRef.current = { ...potionQueueRef.current, [id]: potionQueueRef.current[id] + 1 };
  };

  /** Routes a keymap action press: a potion id spends that potion, "life" spends a bought extra life. */
  const handleAction = (action: PotionId | "life") => (action === "life" ? addLife() : spendPotion(action));

  useEffect(
    () => setAudio({ musicVolume: settings.musicVolume, sfxVolume: settings.sfxVolume, musicMuted: settings.musicMuted, muted: settings.muted }),
    [settings.musicVolume, settings.sfxVolume, settings.musicMuted, settings.muted],
  );
  useEffect(() => rendererRef.current?.setSkin(getSkin(skinId)), [skinId]);
  useEffect(() => {
    if (rendererRef.current) rendererRef.current.reducedMotion = settings.reducedMotion;
  }, [settings.reducedMotion]);

  // Latest props/settings for the game loop without restarting it.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
    onGameOverRef.current = onGameOver;
    hudRef.current = hud;
  });

  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false;
    let raf = 0;
    let saveSession = () => {};
    pausedRef.current = !!resume;
    lifeQueueRef.current = 0;
    potionQueueRef.current = { ...EMPTY_POTION_COUNTS };
    // While a live run is mounted, wallet/session syncs can no longer take its potions away (see store.syncAccount).
    if (!replay) useStore.getState().beginRun(resume ?? null);

    void PixiRenderer.create(host, getSkin(useStore.getState().equippedSkin)).then((renderer) => {
      if (disposed) return renderer.destroy();
      rendererRef.current = renderer;
      renderer.reducedMotion = settingsRef.current.reducedMotion;

      const state: GameState = resume ? simulateReplay(resume) : createGame(seed);
      const recorder = createRecorder(state.seed, resume);
      const input = createInput(renderer.canvas, {
        onPause: togglePause,
        gamepadPauseButton: settingsRef.current.gamepadPauseButton,
        getKeymap: () => settingsRef.current.keymap,
        onAction: replay ? undefined : handleAction,
      });
      inputRef.current = input;
      const replayInputs = new Map(replay?.inputs ?? []);
      if (!replay) {
        setMusicLevel(state.level); // primes the right track (no fade) before the first playMusic()
        if (!pausedRef.current) playMusic();
      }

      let prev = snapshot(state);
      let acc = 0;
      let last = performance.now();
      let lastHud = "";
      let ended = false;
      // Leaving the page (or closing the tab) keeps the run so the player can resume it.
      saveSession = () => {
        if (!replay && !ended) useStore.getState().setActiveGame(recorder.replay, gameId);
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
          const nextPotion = (Object.keys(potionQueueRef.current) as PotionId[]).find((id) => potionQueueRef.current[id] > 0);
          if (replay) dir = replayInputs.get(state.frame) ?? NONE;
          else if (lifeQueueRef.current > 0) {
            lifeQueueRef.current--;
            dir = BUY_LIFE; // the direction press waits one frame
          } else if (nextPotion) {
            potionQueueRef.current = { ...potionQueueRef.current, [nextPotion]: potionQueueRef.current[nextPotion] - 1 };
            dir = POTION_INPUT[nextPotion]; // the direction press waits one frame
          } else {
            dir = pending;
            pending = NONE;
            // Holding a direction keeps asking for that turn until it is taken.
            if (dir === NONE && held !== NONE && held !== state.pac.dir && state.pac.next === NONE) dir = held;
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

          const replayDone = replay && state.frame >= replay.frames;
          if ((state.phase === "gameover" || replayDone) && !ended) {
            ended = true;
            if (!replay) {
              useStore.getState().setActiveGame(null);
              stopMusic();
            }
            onGameOverRef.current({
              score: state.score, level: state.level, won: state.won, frames: state.frame,
              shardsCollected: state.shardsCollected, replay: recorder.replay,
            });
            break;
          }
        }
        // Keep an unconsumed press for the next frame instead of dropping it.
        if (pending !== NONE && !pausedRef.current) input.press(pending);

        renderer.render(state, prev, acc / FRAME_MS);

        const next: Hud = {
          score: state.score,
          lives: state.lives,
          livesBought: state.livesBought,
          level: state.level,
          phase: state.phase,
          shieldBought: state.shieldBought,
          freezeBought: state.freezeBought,
          surgeBought: state.surgeBought,
          speedBought: state.speedBought,
          magnetBought: state.magnetBought,
          ghosthuntBought: state.ghosthuntBought,
          shieldTimer: state.shieldTimer,
          freezeTimer: state.freezeTimer,
          surgeTimer: state.surgeTimer,
          speedTimer: state.speedTimer,
          magnetTimer: state.magnetTimer,
        };
        const key = JSON.stringify(next);
        if (key !== lastHud) {
          if (lastHud) {
            const old = JSON.parse(lastHud) as Hud;
            if (old.phase !== next.phase && PHASE_TEXT[next.phase]) setAnnouncement(PHASE_TEXT[next.phase]!);
            if (old.lives !== next.lives) setAnnouncement(`Lives ${next.lives}`);
            if (old.level !== next.level) {
              setAnnouncement(`Level ${next.level}`);
              if (!replay) setMusicLevel(next.level);
            }
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
      if (!replay) useStore.getState().endRun();
      if (!replay) pauseMusic(); // leaving mid-game: the run is saved paused, so leave the music paused too
    };
    // togglePause, spendPotion and addLife (via handleAction) only touch refs/state setters, so they are safe to omit.
  }, [seed, gameId, replay, resume]);

  const overlay = paused ? "PAUSED" : PHASE_TEXT[hud.phase];
  const hudText = settings.largeHud ? "text-xs sm:text-sm" : "text-[9px] sm:text-[11px]";
  const dpad = !replay && settings.mobileControls === "buttons";
  /** Extra lives already added this game reached the cap: the L shortcut (addLife) is a no-op too, and the button reads MAX LIVES. */
  const livesMaxed = hud.livesBought >= MAX_BOUGHT_LIVES;

  const activeTimers = (
    [
      [hud.shieldTimer, "SHLD", "#3b82f6"], [hud.freezeTimer, "FRZ", "#10b981"], [hud.surgeTimer, "SURGE", "#ef4444"],
      [hud.speedTimer, "SPD", "#eab308"], [hud.magnetTimer, "MAG", "#a855f7"],
    ] as [number, string, string][]
  ).filter(([t]) => t > 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1" onPointerDown={unlockAudio} onKeyDown={unlockAudio}>
      {/* HUD is exactly 2 compact rows, both wrap instead of scrolling — the maze below gets every
       * pixel they don't use. Row 1: game state. Row 2: the 6 potion shortcuts, edge to edge. */}
      <div className={`font-arcade flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-1 ${hudText}`}>
        <span className="shrink-0">SCORE <span className="text-kas">{hud.score}</span></span>
        <span className="shrink-0">LVL <span className="text-kas">{hud.level}</span></span>
        <span aria-label={`${hud.lives} lives`} className="flex shrink-0 items-center">
          {Array.from({ length: Math.min(hud.lives, 6) }, (_, i) => (
            <KasmanIcon key={i} skin={getSkin(skinId)} size={14} />
          ))}
          {hud.lives > 6 && <span className="ml-0.5 text-kas">+{hud.lives - 6}</span>}
        </span>
        {!replay && extraLives > 0 && (
          <button
            type="button"
            onClick={addLife}
            disabled={livesMaxed || hud.phase === "gameover"}
            title={livesMaxed ? `Limit reached: ${MAX_BOUGHT_LIVES} extra lives per game` : `Up to ${MAX_BOUGHT_LIVES} extra lives per game (${hud.livesBought} used)`}
            className="flex shrink-0 items-center gap-1 rounded border border-yellow-300/50 px-1 py-0.5 text-yellow-300 hover:bg-yellow-300/10 disabled:opacity-40"
          >
            {!isTouch && <span className="rounded bg-white/10 px-1 text-white">{keyLabel(settings.keymap.life)}</span>}
            {livesMaxed ? "MAX LIVES" : `+1 (${extraLives})`}
          </button>
        )}
        {activeTimers.map(([t, label, color]) => (
          <span key={label} className="shrink-0" style={{ color }}>{label} {Math.ceil(t / FPS)}s</span>
        ))}
        {!replay && (
          <button
            type="button"
            onClick={() => setSettings({ musicMuted: !settings.musicMuted })}
            title={settings.musicMuted ? "Unmute music" : "Mute music"}
            aria-label={settings.musicMuted ? "Unmute music" : "Mute music"}
            className="ml-auto shrink-0 rounded border border-white/20 p-0.5 hover:border-kas"
          >
            <MusicIcon muted={settings.musicMuted} />
          </button>
        )}
        {!replay && (
          <button type="button" onClick={togglePause} className="shrink-0 rounded border border-white/20 px-1 py-0.5 hover:border-kas">
            {paused ? "RESUME" : "PAUSE"}
          </button>
        )}
      </div>

      {!replay && (
        <div className={`font-arcade grid shrink-0 grid-cols-6 gap-1 px-1 ${hudText}`}>
          {POTIONS.map((p) => {
            const used = usedOf(hud, p.id);
            const owned = ownedPotions[p.id];
            const hex = `#${p.color.toString(16).padStart(6, "0")}`;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => spendPotion(p.id)}
                disabled={hud.phase === "gameover" || owned <= 0 || used >= POTION_CAP[p.id]}
                title={`${p.name}: ${p.desc}`}
                style={{ borderColor: hex, color: hex }}
                className="flex items-center justify-center gap-0.5 rounded border py-0.5 disabled:opacity-30"
              >
                <PotionIcon color={p.color} size={12} />
                {!isTouch && <span className="rounded bg-white/10 px-1 text-white">{keyLabel(settings.keymap[p.id])}</span>}
                {owned}
              </button>
            );
          })}
        </div>
      )}

      {/* The maze gets priority: this fills every pixel the HUD row (above) and D-pad (beside/below)
       * don't need, then letterboxes the fixed 44:31 ratio inside that (width:100% + max-height:100%
       * keeps it proportional) — no guessed height budget, it's simply as big as it can be. */}
      <div className="flex min-h-0 flex-1 flex-col items-stretch gap-2 pointer-coarse:landscape:flex-row">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <div className="relative aspect-[44/31] max-h-full w-full max-w-full overflow-hidden rounded-xl border border-kas/30 shadow-[0_0_40px_-10px] shadow-kas/40">
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
        </div>

        {/* Touch controls live beside/below the maze (never over it, so they never block the view):
         * the joystick flanked by 3 potions on each side when it's on, or all 6 in a row for swipe-only. */}
        {isTouch && !replay && (
          <div className="flex shrink-0 items-center justify-center gap-3">
            {dpad ? (
              <>
                <TouchPotionGroup potions={POTIONS.slice(0, 3)} hud={hud} ownedPotions={ownedPotions} onSpend={spendPotion} />
                <VirtualJoystick onDirChange={(d) => inputRef.current?.setTouchDir(d)} />
                <TouchPotionGroup potions={POTIONS.slice(3)} hud={hud} ownedPotions={ownedPotions} onSpend={spendPotion} />
              </>
            ) : (
              <TouchPotionGroup potions={POTIONS} hud={hud} ownedPotions={ownedPotions} onSpend={spendPotion} />
            )}
          </div>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
}

/** Small speaker icon toggled between on and muted-with-slash. */
function MusicIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5h3.2L10 4v12l-3.8-3.5H3z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M13 6.5l5 7M18 6.5l-5 7" />
      ) : (
        <>
          <path d="M13.2 7.3a3.4 3.4 0 0 1 0 5.4" />
          <path d="M15.4 5.2a6.6 6.6 0 0 1 0 9.6" />
        </>
      )}
    </svg>
  );
}

/**
 * A column of up to 3 floating potion buttons for touch play, sized for a thumb. Lives beside the
 * joystick (or alone, in a row, for swipe-only) instead of over the maze, so it never blocks the view.
 */
function TouchPotionGroup({
  potions, hud, ownedPotions, onSpend,
}: {
  potions: readonly (typeof POTIONS)[number][];
  hud: Hud;
  ownedPotions: Record<PotionId, number>;
  onSpend: (id: PotionId) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      {potions.map((p) => {
        const used = usedOf(hud, p.id);
        const owned = ownedPotions[p.id];
        const hex = `#${p.color.toString(16).padStart(6, "0")}`;
        const disabled = hud.phase === "gameover" || owned <= 0 || used >= POTION_CAP[p.id];
        return (
          <button
            key={p.id}
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              onSpend(p.id);
            }}
            disabled={disabled}
            aria-label={`${p.name} (${owned} left)`}
            style={{ borderColor: hex, color: hex }}
            className="font-arcade flex size-10 shrink-0 touch-none select-none flex-col items-center justify-center gap-0.5 rounded-full border bg-black/60 text-[9px] backdrop-blur-sm active:bg-black/80 disabled:opacity-30"
          >
            <PotionIcon color={p.color} size={14} />
            <span className="text-white">{owned}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Radius (px) the knob can travel from center before clamping. */
const JOYSTICK_RADIUS = 36;
/** Minimum drag distance before a direction registers, so small thumb tremor near center doesn't turn Kasman. */
const JOYSTICK_DEADZONE = 10;

/**
 * Fluid virtual joystick: the knob follows the thumb anywhere inside (and clamped at the edge of) the
 * base, and the nearest of the 4 cardinal directions is reported continuously — like a held key — so
 * Kasman keeps retrying the turn at the next junction instead of needing a fresh tap per direction.
 */
function VirtualJoystick({ onDirChange }: { onDirChange: (dir: number) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dirRef = useRef(NONE);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const updateFromPoint = (clientX: number, clientY: number) => {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, JOYSTICK_RADIUS);
    setKnob(dist > 0 ? { x: (dx / dist) * clamped, y: (dy / dist) * clamped } : { x: 0, y: 0 });

    const dir = dist < JOYSTICK_DEADZONE ? NONE : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : dy > 0 ? DOWN : UP;
    if (dir !== dirRef.current) {
      dirRef.current = dir;
      onDirChange(dir);
    }
  };

  const release = () => {
    draggingRef.current = false;
    setDragging(false);
    setKnob({ x: 0, y: 0 });
    if (dirRef.current !== NONE) {
      dirRef.current = NONE;
      onDirChange(NONE);
    }
  };

  return (
    <div
      ref={baseRef}
      role="group"
      aria-label="Movement joystick"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        draggingRef.current = true;
        setDragging(true);
        updateFromPoint(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current) return;
        updateFromPoint(e.clientX, e.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      className="relative hidden size-24 shrink-0 touch-none select-none items-center justify-center rounded-full border border-kas/40 bg-white/5 pointer-coarse:flex sm:size-28"
    >
      <div
        className="pointer-events-none size-11 rounded-full bg-kas/70 shadow-[0_0_14px_2px] shadow-kas/50 sm:size-12"
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)`, transition: dragging ? "none" : "transform 120ms ease-out" }}
      />
    </div>
  );
}
