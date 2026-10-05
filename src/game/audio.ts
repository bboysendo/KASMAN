// SFX are synthesized WebAudio (no files, ported from maze_chase SFX_LIBRARY).
// Background music is the user's own tracks (public/audio/), played through plain HTML5 <audio>
// elements (their own volume/mute), independent of the SFX WebAudio graph: kasmansong.mp3 for
// level 1, KASMAN2.mp3 from level 2 on, crossfading between them when the level changes mid-run.
type Tone = { f: number; d: number; v: number; w: OscillatorType; o?: number };

const SFX = {
  pellet: [{ f: 430, d: 0.04, v: 0.07, w: "square" }],
  pellet2: [{ f: 360, d: 0.04, v: 0.07, w: "square" }],
  power: [{ f: 290, d: 0.07, v: 0.14, w: "square" }, { f: 540, d: 0.08, v: 0.12, w: "triangle", o: 0.07 }],
  fruit: [{ f: 580, d: 0.06, v: 0.12, w: "triangle" }, { f: 760, d: 0.08, v: 0.12, w: "triangle", o: 0.05 }],
  ghostEaten: [{ f: 860, d: 0.05, v: 0.13, w: "square" }, { f: 640, d: 0.07, v: 0.13, w: "square", o: 0.06 }, { f: 1100, d: 0.09, v: 0.1, w: "square", o: 0.12 }],
  death: [{ f: 520, d: 0.11, v: 0.14, w: "sawtooth" }, { f: 330, d: 0.13, v: 0.13, w: "sawtooth", o: 0.1 }, { f: 180, d: 0.3, v: 0.1, w: "triangle", o: 0.2 }],
  gameOver: [
    { f: 392, d: 0.16, v: 0.13, w: "sawtooth" }, { f: 330, d: 0.16, v: 0.13, w: "sawtooth", o: 0.15 },
    { f: 294, d: 0.16, v: 0.12, w: "sawtooth", o: 0.3 }, { f: 196, d: 0.5, v: 0.12, w: "triangle", o: 0.45 },
  ],
  levelClear: [{ f: 520, d: 0.08, v: 0.11, w: "triangle" }, { f: 680, d: 0.08, v: 0.11, w: "triangle", o: 0.08 }, { f: 920, d: 0.16, v: 0.12, w: "triangle", o: 0.16 }],
  extraLife: [{ f: 620, d: 0.08, v: 0.11, w: "triangle" }, { f: 820, d: 0.08, v: 0.11, w: "triangle", o: 0.09 }, { f: 1040, d: 0.12, v: 0.12, w: "triangle", o: 0.18 }],
  shield: [{ f: 220, d: 0.1, v: 0.12, w: "square" }, { f: 440, d: 0.1, v: 0.12, w: "square", o: 0.08 }, { f: 660, d: 0.14, v: 0.1, w: "square", o: 0.16 }],
  freeze: [{ f: 900, d: 0.1, v: 0.1, w: "triangle" }, { f: 600, d: 0.12, v: 0.1, w: "triangle", o: 0.09 }, { f: 300, d: 0.2, v: 0.09, w: "triangle", o: 0.18 }],
  surge: [{ f: 500, d: 0.06, v: 0.12, w: "sawtooth" }, { f: 750, d: 0.07, v: 0.12, w: "sawtooth", o: 0.05 }, { f: 1100, d: 0.1, v: 0.13, w: "sawtooth", o: 0.1 }],
  speed: [{ f: 500, d: 0.05, v: 0.12, w: "square" }, { f: 700, d: 0.06, v: 0.12, w: "square", o: 0.05 }, { f: 950, d: 0.08, v: 0.13, w: "square", o: 0.1 }],
  magnet: [{ f: 300, d: 0.08, v: 0.11, w: "sawtooth" }, { f: 450, d: 0.08, v: 0.11, w: "sawtooth", o: 0.06 }, { f: 200, d: 0.14, v: 0.1, w: "sawtooth", o: 0.14 }],
  ghosthunt: [{ f: 220, d: 0.09, v: 0.13, w: "sawtooth" }, { f: 440, d: 0.11, v: 0.13, w: "sawtooth", o: 0.08 }, { f: 220, d: 0.09, v: 0.12, w: "sawtooth", o: 0.18 }, { f: 440, d: 0.16, v: 0.13, w: "sawtooth", o: 0.26 }],
  shardCollected: [
    { f: 660, d: 0.06, v: 0.1, w: "triangle" }, { f: 880, d: 0.06, v: 0.11, w: "triangle", o: 0.06 },
    { f: 1180, d: 0.08, v: 0.12, w: "triangle", o: 0.12 }, { f: 1480, d: 0.16, v: 0.13, w: "triangle", o: 0.2 },
  ],
  ready: [{ f: 392, d: 0.12, v: 0.08, w: "triangle" }, { f: 523, d: 0.12, v: 0.08, w: "triangle", o: 0.14 }, { f: 659, d: 0.2, v: 0.09, w: "triangle", o: 0.28 }],
  ui: [{ f: 460, d: 0.04, v: 0.08, w: "square" }],
} satisfies Record<string, Tone[]>;
export type Sfx = keyof typeof SFX;

/** Background tracks, alternated by level parity: odd levels (1, 3, 5...) play the first track, even levels the second. */
const MUSIC_TRACKS = ["/audio/kasmansong.mp3", "/audio/KASMAN2.mp3"] as const;
type TrackUrl = (typeof MUSIC_TRACKS)[number];
const trackForLevel = (level: number): TrackUrl => MUSIC_TRACKS[(level - 1) % MUSIC_TRACKS.length];

/** How long a level's track change takes to cross-fade. */
const CROSSFADE_MS = 800;

let ctx: AudioContext | null = null;
let sfxGain: GainNode | null = null;
const musicElements = new Map<TrackUrl, HTMLAudioElement>(
  MUSIC_TRACKS.map((url) => {
    const el = new Audio(url);
    el.loop = true;
    el.preload = "auto";
    el.volume = 0;
    return [url, el];
  }),
);
let activeTrack: TrackUrl = MUSIC_TRACKS[0];
/** rAF id of an in-progress cross-fade (0 when none); owns both tracks' volume while it runs. */
let fadeHandle = 0;
let musicVolume = 0.5;
let sfxVolume = 0.7;
let musicMuted = false;
let muted = false;

function ensure() {
  if (!ctx) {
    ctx = new AudioContext();
    sfxGain = ctx.createGain();
    sfxGain.connect(ctx.destination);
  }
  if (ctx.state === "suspended") {
    void ctx.resume().then(
      () => console.log("[audio] AudioContext resumed:", ctx!.state),
      (e) => console.error("Audio error: could not resume AudioContext", e),
    );
  }
  sfxGain!.gain.value = muted ? 0 : sfxVolume * 0.8;
  return ctx;
}

const targetMusicVolume = () => (muted || musicMuted ? 0 : musicVolume);

function applyMusicVolume() {
  if (fadeHandle) return; // a cross-fade in progress owns both tracks' volume
  musicElements.get(activeTrack)!.volume = targetMusicVolume();
}

export function setAudio(opts: { musicVolume: number; sfxVolume: number; musicMuted: boolean; muted: boolean }) {
  musicVolume = Math.max(0, Math.min(1, opts.musicVolume));
  sfxVolume = Math.max(0, Math.min(1, opts.sfxVolume));
  musicMuted = opts.musicMuted;
  muted = opts.muted;
  applyMusicVolume();
  if (sfxGain) sfxGain.gain.value = muted ? 0 : sfxVolume * 0.8;
}

/** Fades `activeTrack` out while fading `next` in, both against the live target volume (so a volume/mute change mid-fade still applies). */
function crossfadeTo(next: TrackUrl) {
  cancelAnimationFrame(fadeHandle);
  const from = musicElements.get(activeTrack)!;
  const to = musicElements.get(next)!;
  activeTrack = next;
  to.currentTime = 0;
  to.volume = 0;
  to.play().catch((err) => console.error("Error reproduciendo música:", err));
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / CROSSFADE_MS);
    const target = targetMusicVolume();
    from.volume = target * (1 - t);
    to.volume = target * t;
    if (t < 1) {
      fadeHandle = requestAnimationFrame(step);
      return;
    }
    fadeHandle = 0;
    from.pause();
    from.currentTime = 0;
    applyMusicVolume();
  };
  fadeHandle = requestAnimationFrame(step);
}

/**
 * Switches the track for `level` (`trackForLevel`): cross-fades if one is already audible (a
 * level-up mid-run), or switches silently if nothing is playing yet (priming a fresh or resumed
 * run before the first `playMusic()`, so it starts on the right track with no fade-in from silence).
 */
export function setMusicLevel(level: number) {
  const track = trackForLevel(level);
  if (track === activeTrack) return;
  if (musicElements.get(activeTrack)!.paused) {
    activeTrack = track;
    applyMusicVolume();
  } else {
    crossfadeTo(track);
  }
}

function playTones(tones: Tone[]) {
  if (muted) return;
  const c = ensure();
  for (const t of tones) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const start = c.currentTime + (t.o ?? 0);
    osc.type = t.w;
    osc.frequency.setValueAtTime(t.f, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(t.v, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + t.d);
    osc.connect(gain).connect(sfxGain!);
    osc.start(start);
    osc.stop(start + t.d + 0.02);
  }
}

let waka = false;
export function playSfx(name: Sfx) {
  if (name === "pellet") waka = !waka;
  playTones(SFX[name === "pellet" && waka ? "pellet2" : name]);
}

/** Starts (or resumes) the active level track; a no-op if it's already playing. */
export function playMusic() {
  applyMusicVolume();
  const el = musicElements.get(activeTrack)!;
  console.log("Intentando reproducir música desde:", el.src);
  el.play().catch((err) => console.error("Error reproduciendo música:", err));
}

/** Pauses without losing playback position, so resuming continues where it left off. Pauses both tracks if a cross-fade is mid-flight. */
export function pauseMusic() {
  for (const el of musicElements.values()) if (!el.paused) el.pause();
}

/** Pauses and rewinds every track, for the start of a fresh game; the next one primes back on the level 1 track. */
export function stopMusic() {
  cancelAnimationFrame(fadeHandle);
  fadeHandle = 0;
  for (const el of musicElements.values()) {
    el.pause();
    el.currentTime = 0;
    el.volume = 0;
  }
  activeTrack = MUSIC_TRACKS[0];
}

/** Browsers require a gesture before audio can start. */
export const unlockAudio = () => void ensure();
