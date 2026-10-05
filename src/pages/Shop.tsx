import { useState } from "react";
import ChestOpenModal from "../components/ChestOpenModal";
import PotionIcon from "../components/PotionIcon";
import SkinPreview from "../components/SkinPreview";
import { SKINS } from "../game/render/skins";
import { craftChest, POTIONS, pay, type Account } from "../lib/leaderboard";
import {
  CHESTS, chestPotionCount, KASM_DISCOUNT_RATE, KASM_PAYMENT_ENABLED, KASM_TICKER, MAX_POTION_ORDER_QTY, kasmPrice,
  type ChestId, type PotionId,
} from "../lib/prices";
import { KAS_TICKER } from "../lib/bonusTokens";
import { useWallet } from "../lib/useWallet";
import { useStore } from "../store";

type Tab = "potions" | "skins" | "chests";
/** What the confirmation dialog is about to buy; `to` says where the KAS goes (default: the prize pool). */
type Pending = { title: string; price: number; to?: string; buy: () => Promise<void> | void };

const CHEST_COLOR: Record<ChestId, string> = { copper: "#e08a4a", silver: "#e2e8f0", gold: "#ffd700" };
/** The user's own chest art (public/images/chest1-3.jpg, background removed), one per tier. */
const CHEST_IMAGE: Record<ChestId, string> = {
  copper: "/assets/chests/chest-copper.png",
  silver: "/assets/chests/chest-silver.png",
  gold: "/assets/chests/chest-gold.png",
};

export default function Shop() {
  const owned = useStore((s) => s.ownedSkins);
  const ownedPotions = useStore((s) => s.ownedPotions);
  const shards = useStore((s) => s.shards);
  const equipped = useStore((s) => s.equippedSkin);
  const equipSkin = useStore((s) => s.equipSkin);
  const syncAccount = useStore((s) => s.syncAccount);
  const [tab, setTab] = useState<Tab>("potions");
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  /** Quantity picked per potion card, 1 by default. */
  const [qtyById, setQtyById] = useState<Partial<Record<PotionId, number>>>({});
  const setQty = (id: PotionId, n: number) => setQtyById((q) => ({ ...q, [id]: Math.max(1, Math.min(MAX_POTION_ORDER_QTY, Math.trunc(n) || 1)) }));
  /** Drives the chest-opening popup; `result`/`error` fill in once the craft request settles. */
  const [chestModal, setChestModal] = useState<{ id: ChestId; result: Account | null; error: string | null } | null>(null);

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

  /** Crafting spends Puzzle Shards, not KAS: no wallet confirmation needed. The popup opens right
   * away and plays its shake/burst animation while this request is in flight; the reveal still
   * waits on the result, so a slow or failed craft never shows a false reward. */
  const craft = (id: ChestId) => {
    setChestModal({ id, result: null, error: null });
    craftChest(id).then(
      (account) => {
        syncAccount(account);
        setChestModal((m) => (m && m.id === id ? { ...m, result: account } : m));
      },
      (e) => {
        const error = e instanceof Error ? e.message : "Could not craft this chest";
        setChestModal((m) => (m && m.id === id ? { ...m, error } : m));
      },
    );
  };

  const tabClass = (t: Tab) =>
    `rounded-lg px-4 py-2 text-sm ${tab === t ? "bg-kas text-black font-semibold" : "border border-white/15 text-white/70 hover:text-white"}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="font-arcade flex items-center justify-center gap-3 text-3xl text-yellow-300 sm:text-5xl">
        SHOP
        <img src="/assets/icons/shop.png" alt="" className="h-11 w-11 object-contain" />
      </h1>

      {wallet.error && <p role="alert" className="mt-4 text-center text-sm text-red-400">{wallet.error}</p>}
      {!wallet.address && <p className="mt-2 text-center text-sm text-white/50">Connect your KasWare wallet to buy. Items belong to that wallet.</p>}

      <div role="tablist" aria-label="Categories" className="mt-6 flex justify-center gap-2">
        <button type="button" role="tab" aria-selected={tab === "potions"} onClick={() => setTab("potions")} className={tabClass("potions")}>Potions</button>
        <button type="button" role="tab" aria-selected={tab === "chests"} onClick={() => setTab("chests")} className={tabClass("chests")}>Chests</button>
        <button type="button" role="tab" aria-selected={tab === "skins"} onClick={() => setTab("skins")} className={tabClass("skins")}>Skins</button>
      </div>

      {tab === "potions" && (
        <section role="tabpanel" aria-label="Potions">
          <p className="mt-4 text-center text-white/60">
            Retro power-ups. Use them mid-game with the key shown in Settings (1-6 by default) or by tapping their HUD icon.
            {KAS_TICKER} spent on potions goes to the monthly prize pool.
          </p>

          <div role="radiogroup" aria-label="Payment currency" className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              role="radio"
              aria-checked="true"
              className="rounded-lg bg-kas px-4 py-2 text-sm font-semibold text-black"
            >
              Pay with {KAS_TICKER}
            </button>
            <span className="group relative">
              <button
                type="button"
                role="radio"
                aria-checked="false"
                disabled={!KASM_PAYMENT_ENABLED}
                title={`Pay with ${KASM_TICKER} (Unlocks on KRON launch)`}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/40 disabled:cursor-not-allowed"
              >
                Pay with {KASM_TICKER} (-{Math.round(KASM_DISCOUNT_RATE * 100)}% OFF)
              </button>
              {!KASM_PAYMENT_ENABLED && (
                <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 w-max -translate-x-1/2 rounded bg-black/90 px-2 py-1 text-[10px] text-white/70 opacity-0 group-hover:opacity-100">
                  Pay with {KASM_TICKER} (Unlocks on KRON launch)
                </span>
              )}
            </span>
          </div>

          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {POTIONS.map((potion) => {
              const hex = `#${potion.color.toString(16).padStart(6, "0")}`;
              const qty = qtyById[potion.id] ?? 1;
              const total = Number((potion.price * qty).toFixed(2));
              return (
                <li
                  key={potion.id}
                  className="flex flex-col gap-4 rounded-xl border p-4"
                  style={{ borderColor: `${hex}70`, background: `${hex}0d` }}
                  title={`You own ${ownedPotions[potion.id]} · up to ${potion.maxPerLevel} per level`}
                >
                  <div className="flex items-center gap-4">
                    <span className="shrink-0" style={{ filter: `drop-shadow(0 0 10px ${hex}aa)` }}><PotionIcon color={potion.color} size={56} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="font-arcade text-sm uppercase leading-tight" style={{ color: hex }}>{potion.name}</h2>
                        <span className="shrink-0 rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[10px] text-white/60">
                          Owned: {ownedPotions[potion.id]}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-white">{potion.desc}</p>
                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setQty(potion.id, qty - 1)}
                          disabled={qty <= 1}
                          aria-label={`Fewer ${potion.name}`}
                          className="flex size-7 items-center justify-center rounded border border-white/20 text-white/70 hover:border-kas disabled:opacity-30"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={MAX_POTION_ORDER_QTY}
                          value={qty}
                          onChange={(e) => setQty(potion.id, Number(e.target.value))}
                          aria-label={`${potion.name} quantity`}
                          className="w-12 rounded border border-white/20 bg-black/40 py-1 text-center"
                        />
                        <button
                          type="button"
                          onClick={() => setQty(potion.id, qty + 1)}
                          disabled={qty >= MAX_POTION_ORDER_QTY}
                          aria-label={`More ${potion.name}`}
                          className="flex size-7 items-center justify-center rounded border border-white/20 text-white/70 hover:border-kas disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      ask({
                        title: `${qty}x ${potion.name}`,
                        price: total,
                        buy: async () => {
                          syncAccount(await pay(useStore.getState().address ?? "", "potion", potion.id, qty));
                          setQty(potion.id, 1);
                        },
                      })
                    }
                    className="w-full rounded-lg bg-kas py-2 text-sm font-semibold text-black hover:brightness-110"
                  >
                    Buy {qty} for {total} {KAS_TICKER}
                  </button>
                  <p className="text-[11px] text-white/30">or {kasmPrice(total)} {KASM_TICKER} (-{Math.round(KASM_DISCOUNT_RATE * 100)}%, locked)</p>
                </li>
              );
            })}
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
                  Buy for {skin.price} {KAS_TICKER}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      </section>
      )}

      {tab === "chests" && (
        <section role="tabpanel" aria-label="Chests">
          <h2 className="font-arcade mt-6 text-center text-lg text-white sm:text-xl">Chests</h2>
          <p className="mt-2 text-center text-white/60">Collect Puzzle Shards to craft these chests. One piece max per run.</p>
          <p className="mt-3 text-center text-sm text-white/80">Your Puzzle Shards: <span className="font-arcade text-kas">{shards}</span></p>
          <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {CHESTS.map((chest) => {
              const total = chestPotionCount(chest.perPotion);
              const affordable = shards >= chest.cost;
              return (
                <li
                  key={chest.id}
                  className="flex flex-col items-center gap-3 rounded-xl border p-5 text-center"
                  style={{ borderColor: `${CHEST_COLOR[chest.id]}88`, background: `${CHEST_COLOR[chest.id]}0d` }}
                >
                  <img
                    src={CHEST_IMAGE[chest.id]}
                    alt={chest.name}
                    className="h-28 w-28 object-contain"
                    style={{ filter: `drop-shadow(0 0 14px ${CHEST_COLOR[chest.id]}cc)` }}
                  />
                  <h3 className="font-arcade text-base uppercase" style={{ color: CHEST_COLOR[chest.id] }}>{chest.name}</h3>
                  <p className="text-sm text-white/80">Requires {chest.cost} Puzzle Shards.</p>
                  <p className="text-sm text-white/60">
                    Contents: {chest.perPotion} of each Potion ({total} total power-ups) + {chest.lives} Extra Lives.
                  </p>
                  <button
                    type="button"
                    disabled={!wallet.address || !affordable || !!chestModal}
                    onClick={() => craft(chest.id)}
                    className="mt-auto w-full rounded-lg bg-kas py-2 text-sm font-semibold text-black hover:brightness-110 disabled:bg-white/15 disabled:text-white disabled:opacity-60"
                  >
                    {`Craft Chest (${Math.min(shards, chest.cost)}/${chest.cost})`}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {chestModal && (
        <ChestOpenModal
          chestId={chestModal.id}
          result={chestModal.result}
          error={chestModal.error}
          onClose={() => setChestModal(null)}
        />
      )}

      {confirming && (
        <div role="dialog" aria-modal="true" aria-labelledby="buy-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-kas/40 bg-[#0a1118] p-6">
            <h2 id="buy-title" className="font-semibold">Buy {confirming.title}?</h2>
            <p className="mt-2 text-sm text-white/60">{confirming.price} {KAS_TICKER}, paid with KasWare to {confirming.to ?? "this month's prize pool contract"}.</p>
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
