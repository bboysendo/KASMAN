import { useEffect, useState, type CSSProperties } from "react";
import type { Account } from "../lib/leaderboard";
import { CHESTS, POTIONS, type ChestId } from "../lib/prices";
import { getSkin } from "../game/render/skins";
import { useStore } from "../store";
import KasmanIcon from "./KasmanIcon";
import PotionIcon from "./PotionIcon";

const CHEST_COLOR: Record<ChestId, string> = { copper: "#e08a4a", silver: "#e2e8f0", gold: "#ffd700" };
const CHEST_IMAGE: Record<ChestId, string> = {
  copper: "/assets/chests/chest-copper.png",
  silver: "/assets/chests/chest-silver.png",
  gold: "/assets/chests/chest-gold.png",
};

const SPARK_COUNT = 14;
/** A fixed fan of outward directions for the burst sparks, computed once (not per render). */
const SPARKS = Array.from({ length: SPARK_COUNT }, (_, i) => {
  const angle = (i / SPARK_COUNT) * Math.PI * 2;
  const dist = 64 + (i % 3) * 16;
  return { tx: Math.cos(angle) * dist, ty: Math.sin(angle) * dist, delay: (i % 5) * 0.03 };
});

interface Props {
  chestId: ChestId;
  /** Set once the craft request succeeds; the reveal waits for this even if the shake/burst already finished. */
  result: Account | null;
  /** Set if the craft request fails; shown instead of the reward reveal. */
  error: string | null;
  onClose: () => void;
}

/**
 * Chest-opening popup (Shop "Chests" tab): the chest shakes with a glow for 1.5s, bursts into
 * sparks, then the potions + extra lives it grants rise into view one by one, ending on a
 * COLLECT button. Reward contents come straight from `CHESTS` (crafting is deterministic, not a
 * loot roll) so the reveal can start as soon as the animation and the network request are both
 * done — never before the request actually succeeds, so a slow or failed craft never shows a
 * false reward.
 */
export default function ChestOpenModal({ chestId, result, error, onClose }: Props) {
  const chest = CHESTS.find((c) => c.id === chestId)!;
  const skin = useStore((s) => getSkin(s.equippedSkin));
  const [shakeDone, setShakeDone] = useState(false);
  const [burstDone, setBurstDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShakeDone(true), 1500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!shakeDone) return;
    const t = setTimeout(() => setBurstDone(true), 650);
    return () => clearTimeout(t);
  }, [shakeDone]);

  const stage = error ? "error" : !shakeDone ? "shake" : !burstDone || !result ? "burst" : "reveal";
  const color = CHEST_COLOR[chestId];

  return (
    <div role="dialog" aria-modal="true" aria-label={`Opening ${chest.name}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="relative flex w-full max-w-sm flex-col items-center gap-5 py-6">
        <h2 className="font-arcade text-sm uppercase" style={{ color }}>{chest.name}</h2>

        <div className="relative flex h-40 w-40 items-center justify-center">
          {stage === "burst" && (
            <div className="pointer-events-none absolute inset-0">
              {SPARKS.map((s, i) => (
                <span
                  key={i}
                  className="absolute left-1/2 top-1/2 size-1.5 rounded-full"
                  style={
                    {
                      background: color,
                      boxShadow: `0 0 6px ${color}`,
                      "--tx": `${s.tx}px`,
                      "--ty": `${s.ty}px`,
                      animation: `spark-fly 0.7s ease-out ${s.delay}s forwards`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          )}
          {stage !== "reveal" && (
            <img
              src={CHEST_IMAGE[chestId]}
              alt=""
              className="h-32 w-32 object-contain"
              style={{
                color,
                animation:
                  stage === "shake"
                    ? "chest-shake 0.15s ease-in-out infinite, chest-glow 0.9s ease-in-out infinite"
                    : "chest-pop 0.5s ease-in forwards",
              }}
            />
          )}
        </div>

        {stage === "error" && (
          <>
            <p role="alert" className="text-center text-sm text-red-400">{error}</p>
            <button type="button" onClick={onClose} className="rounded-lg border border-white/20 px-6 py-2 text-sm hover:bg-white/5">
              Close
            </button>
          </>
        )}

        {stage === "reveal" && (
          <>
            <p className="font-arcade text-xs text-white/70">You got:</p>
            <ul className="grid grid-cols-4 gap-3">
              {POTIONS.map((p, i) => {
                const hex = `#${p.color.toString(16).padStart(6, "0")}`;
                return (
                  <li
                    key={p.id}
                    className="flex flex-col items-center gap-1 opacity-0"
                    style={{ animation: `reward-pop 0.4s ease-out ${i * 0.06}s forwards` }}
                  >
                    <span style={{ filter: `drop-shadow(0 0 8px ${hex}aa)` }}>
                      <PotionIcon color={p.color} size={28} />
                    </span>
                    <span className="font-arcade text-[10px] text-white">+{chest.perPotion}</span>
                  </li>
                );
              })}
              <li
                className="flex flex-col items-center gap-1 opacity-0"
                style={{ animation: `reward-pop 0.4s ease-out ${POTIONS.length * 0.06}s forwards` }}
              >
                <KasmanIcon skin={skin} size={28} />
                <span className="font-arcade text-[10px] text-white">+{chest.lives}</span>
              </li>
            </ul>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-lg bg-emerald-500 px-8 py-2.5 text-sm font-bold text-black opacity-0 hover:brightness-110"
              style={{ animation: `reward-pop 0.4s ease-out ${(POTIONS.length + 1) * 0.06}s forwards` }}
            >
              COLLECT
            </button>
          </>
        )}
      </div>
    </div>
  );
}
