// Renders a replay to an MP4 file, frame by frame and faster than real time
// (re-simulated with the engine, drawn by PixiRenderer, encoded with WebCodecs).
import { Assets } from "pixi.js";
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeVideo } from "mediabunny";
import { FPS, NONE } from "../engine/constants";
import { createGame, step } from "../engine/game";
import type { Replay } from "../engine/replay";
import { PixiRenderer, snapshot } from "./PixiRenderer";
import { hex, type Skin } from "./skins";
import { kasmanUrl } from "./sprites";

const GAME_W = 880; // maze aspect, 44 x 31 tiles
const GAME_H = 620;
const HUD_H = 48;
/** Seconds the final frame stays on screen with "GAME OVER". */
const OUTRO = 2;

export async function renderReplayVideo(replay: Replay, skin: Skin, onProgress: (done: number) => void): Promise<Blob> {
  if (!(await canEncodeVideo("avc", { width: GAME_W, height: GAME_H + HUD_H }))) throw new Error("This browser cannot encode MP4 video");
  // Pixi sizes itself to its host, so the host needs real layout, just off screen.
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${GAME_W}px;height:${GAME_H}px`;
  document.body.appendChild(host);
  const renderer = await PixiRenderer.create(host, skin);
  try {
    await Assets.load(kasmanUrl(skin.id));
    await new Promise((r) => setTimeout(r)); // let setSkin assign the loaded texture

    const frame = document.createElement("canvas");
    frame.width = GAME_W;
    frame.height = GAME_H + HUD_H;
    const ctx = frame.getContext("2d")!;
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const source = new CanvasSource(frame, { codec: "avc", quality: QUALITY_HIGH });
    output.addVideoTrack(source, { frameRate: FPS });
    await output.start();

    const state = createGame(replay.seed);
    const inputs = new Map(replay.inputs);
    const draw = async (n: number, overText?: string) => {
      ctx.fillStyle = hex(skin.background);
      ctx.fillRect(0, 0, frame.width, frame.height);
      ctx.drawImage(renderer.canvas, 0, HUD_H, GAME_W, GAME_H);
      ctx.font = '16px "Press Start 2P", monospace';
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.fillText(`SCORE ${state.score}`, 16, HUD_H / 2);
      ctx.textAlign = "right";
      ctx.fillText(`LEVEL ${state.level}  LIVES ${state.lives}`, GAME_W - 16, HUD_H / 2);
      if (overText) {
        ctx.textAlign = "center";
        ctx.font = '40px "Press Start 2P", monospace';
        ctx.fillStyle = "#ff4757";
        ctx.fillText(overText, GAME_W / 2, HUD_H + GAME_H / 2);
      }
      await source.add(n / FPS, 1 / FPS);
    };

    let n = 0;
    while (state.frame < replay.frames && state.phase !== "gameover") {
      const prev = snapshot(state);
      step(state, inputs.get(state.frame) ?? NONE);
      renderer.handleEvents(state.events);
      renderer.render(state, prev, 1);
      await draw(n++);
      if (n % FPS === 0) {
        onProgress(state.frame / replay.frames);
        await new Promise((r) => setTimeout(r)); // let the page repaint
      }
    }
    for (let i = 0; i < OUTRO * FPS; i++) await draw(n++, "GAME OVER");

    await output.finalize();
    onProgress(1);
    return new Blob([output.target.buffer!], { type: "video/mp4" });
  } finally {
    renderer.destroy();
    host.remove();
  }
}
