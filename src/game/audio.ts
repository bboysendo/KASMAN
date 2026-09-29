// Synthesized WebAudio SFX, ported from maze_chase SFX_LIBRARY. No audio files needed.
type Tone = { f: number; d: number; v: number; w: OscillatorType; o?: number };

const SFX = {
  pellet: [{ f: 430, d: 0.04, v: 0.07, w: "square" }],
  pellet2: [{ f: 360, d: 0.04, v: 0.07, w: "square" }],
  power: [{ f: 290, d: 0.07, v: 0.14, w: "square" }, { f: 540, d: 0.08, v: 0.12, w: "triangle", o: 0.07 }],
  fruit: [{ f: 580, d: 0.06, v: 0.12, w: "triangle" }, { f: 760, d: 0.08, v: 0.12, w: "triangle", o: 0.05 }],
  ghostEaten: [{ f: 860, d: 0.05, v: 0.13, w: "square" }, { f: 640, d: 0.07, v: 0.13, w: "square", o: 0.06 }, { f: 1100, d: 0.09, v: 0.1, w: "square", o: 0.12 }],
  death: [{ f: 520, d: 0.11, v: 0.14, w: "sawtooth" }, { f: 330, d: 0.13, v: 0.13, w: "sawtooth", o: 0.1 }, { f: 180, d: 0.3, v: 0.1, w: "triangle", o: 0.2 }],
  levelClear: [{ f: 520, d: 0.08, v: 0.11, w: "triangle" }, { f: 680, d: 0.08, v: 0.11, w: "triangle", o: 0.08 }, { f: 920, d: 0.16, v: 0.12, w: "triangle", o: 0.16 }],
  extraLife: [{ f: 620, d: 0.08, v: 0.11, w: "triangle" }, { f: 820, d: 0.08, v: 0.11, w: "triangle", o: 0.09 }, { f: 1040, d: 0.12, v: 0.12, w: "triangle", o: 0.18 }],
  ready: [{ f: 392, d: 0.12, v: 0.08, w: "triangle" }, { f: 523, d: 0.12, v: 0.08, w: "triangle", o: 0.14 }, { f: 659, d: 0.2, v: 0.09, w: "triangle", o: 0.28 }],
  ui: [{ f: 460, d: 0.04, v: 0.08, w: "square" }],
} satisfies Record<string, Tone[]>;
export type Sfx = keyof typeof SFX;

const MUSIC: Tone[] = [262, 330, 392, 523, 392, 330].map((f) => ({ f, d: 0.18, v: 0.05, w: "triangle" }));

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.7;
let muted = false;

function ensure() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  master!.gain.value = muted ? 0 : volume * 0.8;
  return ctx;
}

export function setAudio(opts: { volume: number; muted: boolean }) {
  volume = Math.max(0, Math.min(1, opts.volume));
  muted = opts.muted;
  if (master) master.gain.value = muted ? 0 : volume * 0.8;
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
    osc.connect(gain).connect(master!);
    osc.start(start);
    osc.stop(start + t.d + 0.02);
  }
}

let waka = false;
export function playSfx(name: Sfx) {
  if (name === "pellet") waka = !waka;
  playTones(SFX[name === "pellet" && waka ? "pellet2" : name]);
}

let musicStep = 0;
/** Call every ~250ms while playing. */
export function playMusicStep() {
  playTones([MUSIC[musicStep++ % MUSIC.length]]);
}

/** Browsers require a gesture before audio can start. */
export const unlockAudio = () => void ensure();
