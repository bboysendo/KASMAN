import { RARITIES } from "../lib/prices";

const section = "flex items-center gap-3 font-semibold after:h-px after:flex-1 after:bg-linear-to-r after:from-kas/60 after:to-transparent";
const card = "rounded-xl border border-white/10 bg-white/[0.03] p-5";

const TOTAL_SUPPLY_KASM = 10_000_000;

const SUPPLY_SLICES = [
  {
    pct: 90,
    title: "Open Market & Free Circulation",
    tag: "Fair Launch",
    color: "bg-kas",
    text: "text-kas",
    desc:
      "Fully in circulation and available to the community via Kron and open DEX trading. No personal developer allocation, no hidden team shares, and no secret treasury funds. Completely decentralized from day one.",
  },
  {
    pct: 10,
    title: "NFT Staking Reserve",
    tag: "Master Team Wallet",
    color: "bg-yellow-300",
    text: "text-yellow-300",
    desc:
      "Safely held in the team's master wallet. This is the only reserved portion, dedicated exclusively to funding and supporting the upcoming KASMAN NFT Staking system, where rewards scale based on NFT rarity. It is an active community resource, not a dev allocation.",
  },
];

const stakingRarities = RARITIES.filter((r) => r.id !== "none");

export default function Tokenomics() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <span className="font-arcade inline-block rounded-full border border-kas/50 bg-kas/10 px-3 py-1 text-[10px] text-kas">
        WHITEPAPER
      </span>
      <h1 className="font-arcade mt-4 text-xl leading-relaxed text-yellow-300 sm:text-2xl">$KASM Tokenomics & Whitepaper</h1>
      <p className="mt-4 max-w-2xl text-white/60">
        Radical transparency is the foundation of our project. Here is the exact breakdown of the $KASM token
        distribution, utility, and economic mechanics for KASMAN.
      </p>

      <h2 className={`mt-12 ${section}`}>Supply Distribution</h2>
      <p className="mt-3 text-sm text-white/50">
        Total Supply: <span className="font-arcade text-kas">{TOTAL_SUPPLY_KASM.toLocaleString("en-US")}</span> $KASM
      </p>

      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full border border-white/10">
        {SUPPLY_SLICES.map((s) => (
          <div key={s.title} className={s.color} style={{ width: `${s.pct}%` }} title={`${s.pct}% — ${s.title}`} />
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {SUPPLY_SLICES.map((s) => (
          <div key={s.title} className={card}>
            <div className="flex items-baseline gap-2">
              <span className={`font-arcade text-2xl ${s.text}`}>{s.pct}%</span>
              <span className="text-xs uppercase tracking-wide text-white/40">{s.tag}</span>
            </div>
            <h3 className="mt-2 font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm text-white/60">{s.desc}</p>
          </div>
        ))}
      </div>

      <h2 className={`mt-12 ${section}`}>Real Token Utility</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className={card}>
          <h3 className="font-semibold">In-Game Shop Purchases</h3>
          <p className="mt-2 text-sm text-white/60">
            Players can spend $KASM tokens to acquire boosters, potions, and advantages inside the KASMAN
            ecosystem/games.
          </p>
        </div>

        <div className={card}>
          <h3 className="font-semibold">Deflationary & Reward Mechanism</h3>
          <p className="mt-2 text-sm text-white/60">Every $KASM spent in the in-game shop is split 50 / 50:</p>
          <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full border border-white/10">
            <div className="bg-red-400" style={{ width: "50%" }} title="50% — Burned" />
            <div className="bg-kas" style={{ width: "50%" }} title="50% — Redistributed to stakers" />
          </div>
          <ul className="mt-3 space-y-1.5 text-sm text-white/60">
            <li className="flex items-center gap-2">
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-red-400" />
              <span><span className="font-semibold text-red-300">50%</span> is permanently burned, reducing the total circulating supply.</span>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-kas" />
              <span><span className="font-semibold text-kas">50%</span> is redistributed directly to KASMAN NFT stakers.</span>
            </li>
          </ul>
        </div>

        <div className={`${card} sm:col-span-2`}>
          <h3 className="font-semibold">NFT Staking</h3>
          <p className="mt-2 text-sm text-white/60">
            Holding and staking KASMAN NFTs grants regular $KASM yields scaled proportionally by rarity.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stakingRarities.map((r) => (
              <div key={r.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-center">
                <p className="font-arcade text-[10px] text-yellow-300">{r.name}</p>
                <p className="mt-2 font-arcade text-lg text-kas">{(r.mult / 10).toFixed(1)}x</p>
                <p className="mt-1 text-[11px] text-white/40">$KASM yield</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <h2 className={`mt-12 ${section}`}>Game Sustainability & PvP</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className={card}>
          <h3 className="font-semibold">Prize Pools</h3>
          <p className="mt-2 text-sm text-white/60">
            Competitive PvP modes and tournaments operate with a modest operational fee (
            <span className="text-kas">10%</span> of the KAS played), strictly used to maintain server
            infrastructure and community events.
          </p>
        </div>
        <div className={card}>
          <h3 className="font-semibold">Independence</h3>
          <p className="mt-2 text-sm text-white/60">
            The $KASM token functions autonomously connected to the shop and staking, while the KASMAN ecosystem
            thrives on delivering fun and rewarding gameplay.
          </p>
        </div>
      </div>
    </div>
  );
}
