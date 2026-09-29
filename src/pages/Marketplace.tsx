import { useState } from "react";
import SkinPreview from "../components/SkinPreview";
import { MAX_BOUGHT_LIVES } from "../game/engine/constants";
import KasmanIcon from "../components/KasmanIcon";
import { SKINS, getSkin } from "../game/render/skins";
import { LIFE_PACKS, pay } from "../lib/leaderboard";
import { useWallet } from "../lib/useWallet";
import { useStore } from "../store";

type Tab = "lives" | "skins";
/** What the confirmation dialog is about to buy; `to` says where the KAS goes (default: the prize pool). */
type Pending = { title: string; price: number; to?: string; buy: () => Promise<void> | void };
const livesLabel = (n: number) => `${n} extra ${n === 1 ? "life" : "lives"}`;

export default function Marketplace() {
  const owned = useStore((s) => s.ownedSkins);
  const equipped = useStore((s) => s.equippedSkin);
  const equipSkin = useStore((s) => s.equipSkin);
  const syncAccount = useStore((s) => s.syncAccount);
  const [tab, setTab] = useState<Tab>("lives");
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");

  const wallet = useWallet();

  /** Buying needs a connected wallet: connect first, then show the confirmation. */
  const ask = async (pending: Pending) => {
    setError("");
    if (!wallet.address && !(await wallet.connect())) return;
    setConfirming(pending);
  };

  const confirm = async () => {
    if (!confirming) return;
    setPaying(true);
    setError("");
    try {
      await confirming.buy();
      setConfirming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  };

  const tabClass = (t: Tab) =>
    `rounded-lg px-4 py-2 text-sm ${tab === t ? "bg-kas text-black font-semibold" : "border border-white/15 text-white/70 hover:text-white"}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="font-arcade text-xl text-yellow-300 sm:text-2xl">MARKETPLACE</h1>

      {wallet.error && <p role="alert" className="mt-4 text-sm text-red-400">{wallet.error}</p>}
      {!wallet.address && <p className="mt-2 text-sm text-white/50">Connect your KasWare wallet to buy. Items belong to that wallet.</p>}

      <div role="tablist" aria-label="Categories" className="mt-6 flex gap-2">
        <button type="button" role="tab" aria-selected={tab === "lives"} onClick={() => setTab("lives")} className={tabClass("lives")}>Lives</button>
        <button type="button" role="tab" aria-selected={tab === "skins"} onClick={() => setTab("skins")} className={tabClass("skins")}>Skins</button>
      </div>

      {tab === "lives" && (
        <section role="tabpanel" aria-label="Lives">
          <p className="mt-4 text-white/60">
            Extra lives. Use them any time during a game with the +1 LIFE button, up to {MAX_BOUGHT_LIVES} per game.
            Lives can only be bought here, not during a game. KAS spent on lives goes to the monthly prize pool.
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {LIFE_PACKS.map((pack) => (
              <li key={pack.lives} className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-center">
                <span aria-hidden="true"><KasmanIcon skin={getSkin(equipped)} size={44} /></span>
                <h2 className="font-semibold">{pack.lives} lives</h2>
                <button
                  type="button"
                  onClick={() =>
                    ask({
                      title: livesLabel(pack.lives),
                      price: pack.price,
                      buy: async () => syncAccount(await pay(useStore.getState().address ?? "", "lives", pack.lives)),
                    })
                  }
                  className="w-full rounded-lg bg-kas py-2 text-sm font-semibold text-black hover:brightness-110"
                >
                  Buy for {pack.price} KAS
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "skins" && (
      <section role="tabpanel" aria-label="Skins">
      <p className="mt-4 text-white/60">
        Cosmetic skins change how the maze, Pac-Man and the ghosts look. They never change gameplay.
      </p>

      <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {SKINS.map((skin) => {
          const isOwned = owned.includes(skin.id);
          const isEquipped = equipped === skin.id;
          return (
            <li key={skin.id} className={`flex flex-col gap-3 rounded-xl border p-4 ${isEquipped ? "border-kas bg-kas/5" : "border-white/10 bg-white/[0.03]"}`}>
              <SkinPreview skin={skin} />
              <h2 className="text-center font-semibold">{skin.name}</h2>
              {isEquipped ? (
                <span className="rounded-lg bg-kas/20 py-2 text-center text-sm text-kas">Equipped</span>
              ) : isOwned ? (
                <button type="button" onClick={() => equipSkin(skin.id)} className="rounded-lg border border-kas/50 py-2 text-sm hover:bg-kas/10">Equip</button>
              ) : (
                <button type="button" onClick={() =>
                    ask({
                      title: skin.name,
                      price: skin.price,
                      buy: async () => {
                        syncAccount(await pay(useStore.getState().address ?? "", "skin", skin.id));
                        equipSkin(skin.id);
                      },
                    })
                  } className="rounded-lg bg-kas py-2 text-sm font-semibold text-black hover:brightness-110">
                  Buy for {skin.price} KAS
                </button>
              )}
            </li>
          );
        })}
      </ul>
      </section>
      )}

      {confirming && (
        <div role="dialog" aria-modal="true" aria-labelledby="buy-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-kas/40 bg-[#0a1118] p-6">
            <h2 id="buy-title" className="font-semibold">Buy {confirming.title}?</h2>
            <p className="mt-2 text-sm text-white/60">{confirming.price} KAS, paid with KasWare to {confirming.to ?? "this month's prize pool contract"}.</p>
            {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" disabled={paying} onClick={() => setConfirming(null)} className="rounded-lg px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-40">Cancel</button>
              <button type="button" autoFocus disabled={paying} onClick={confirm} className="rounded-lg bg-kas px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
                {paying ? "Confirming..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
