import { useSearchParams } from "react-router";
import { RARITIES } from "../lib/prices";

const section = "flex items-center gap-3 font-semibold after:h-px after:flex-1 after:bg-linear-to-r after:from-kas/60 after:to-transparent";
const card = "rounded-xl border border-white/10 bg-white/[0.03] p-5";

type Tab = "tokenomics" | "whitepaper";

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
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "whitepaper" ? "whitepaper" : "tokenomics";
  const showTab = (t: Tab) => setParams(t === "tokenomics" ? {} : { tab: t }, { replace: true });
  const tabClass = (t: Tab) =>
    `rounded-lg px-4 py-2 text-sm ${tab === t ? "bg-kas text-black font-semibold" : "border border-white/15 text-white/70 hover:text-white"}`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <span className="font-arcade inline-block rounded-full border border-kas/50 bg-kas/10 px-3 py-1 text-[10px] text-kas">
        WHITEPAPER
      </span>

      <div role="tablist" aria-label="Tokenomics sections" className="mt-4 flex items-center gap-2">
        <button type="button" role="tab" aria-selected={tab === "tokenomics"} onClick={() => showTab("tokenomics")} className={tabClass("tokenomics")}>
          Tokenomics
        </button>
        <button type="button" role="tab" aria-selected={tab === "whitepaper"} onClick={() => showTab("whitepaper")} className={tabClass("whitepaper")}>
          Whitepaper
        </button>
      </div>

      {tab === "whitepaper" ? <WhitepaperTab /> : <TokenomicsTab />}
    </div>
  );
}

const table = "w-full border-collapse text-left text-sm";
const th = "border-b border-white/10 px-3 py-2 font-semibold text-white/80";
const td = "border-b border-white/5 px-3 py-2 text-white/60";

function WhitepaperTab() {
  return (
    <section role="tabpanel" aria-label="Whitepaper" className="mt-8">
      <h1 className="font-arcade text-xl leading-relaxed text-yellow-300 sm:text-2xl">KASMAN Whitepaper</h1>
      <p className="mt-2 text-sm text-white/40">October 8, 2026</p>

      <h2 className={`mt-12 ${section}`}>1. Introduction &amp; Vision</h2>
      <div className="mt-4 space-y-4 text-sm text-white/60">
        <p>
          KASMAN resurrects the maze-chase arcade classic as a fully on-chain-settled competitive game built on
          Kaspa, the fastest proof-of-work L1 in production. Where the genre has always lived on nostalgia, KASMAN
          gives it genuine economic stakes: every run is an entry into a live, wallet-verified competition, every
          clear can earn a daily token reward, and every top-3 finish is paid out from a trustless, single-purpose
          smart contract rather than a centralized back office.
        </p>
        <p>
          The thesis is simple. Kaspa's BlockDAG architecture delivers the block speed and low fees that a
          real-time, pay-to-play arcade economy needs — something no legacy L1 can offer without pricing players
          out of a 1 KAS entry fee. KASMAN is built to prove that out: a game engine good enough to stand on its
          own, wrapped in mechanics (staking, NFTs, multi-token prize pools, on-chain rewards) that only make sense
          because Kaspa makes them cheap and fast enough to matter.
        </p>
        <p>Three principles hold the design together:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="font-semibold text-white/80">Skill first.</span> The prize pool is split among the
            players with the most points and the fastest clear times, not the biggest wallets. Anti-cheat is
            structural, not cosmetic: every submitted score is re-simulated server-side against a seeded,
            deterministic replay before it counts.
          </li>
          <li>
            <span className="font-semibold text-white/80">The house holds no keys.</span> KAS entries, lives,
            skins and potions settle directly into a monthly covenant address. The backend that runs the game
            cannot move that money — only a signed, auditable payout transaction can.
          </li>
          <li>
            <span className="font-semibold text-white/80">Ownership is portable.</span> The Kasman NFT collection
            and the on-chain KASMAN rewards ledger live entirely in smart contracts, not in a database row the
            team controls. What a player stakes, earns or holds is verifiable on-chain, independent of KASMAN's own
            servers staying online.
          </li>
        </ul>
        <p>
          What follows is the complete mechanical and economic design of KASMAN: how the game plays, how the prize
          pool and multi-token rewards work, how the NFT collection and its collectibles function, and how payouts
          are verified and distributed without requiring trust in a central operator.
        </p>
      </div>

      <h2 className={`mt-12 ${section}`}>2. Gameplay &amp; Mechanics</h2>
      <div className="mt-4 space-y-4 text-sm text-white/60">
        <p>
          <span className="font-semibold text-white/80">Core loop.</span> KASMAN runs a deterministic, fixed-tick
          simulation (60 Hz, 120 sub-units per tile) so every run is fully reproducible from its seed and input log
          — the same foundation that lets the server verify a score without trusting the client. Players clear
          pellets, dodge or hunt ghosts, and chase the fastest possible time across a run of increasingly brutal
          mazes.
        </p>
        <p>
          <span className="font-semibold text-white/80">Level progression.</span> Nine hand-built mazes, each
          strictly harder than the last: fewer junctions to juke through, fewer tunnels and power pellets to lean
          on, faster and more aggressive ghosts, shorter frightened windows, and less scatter time between chase
          phases. Clearing the ninth maze wins the run outright. Ghost AI targets the arcade originals' classic
          behaviors but steers by live maze-distance fields, so chasing ghosts coordinate against the player
          instead of colliding with each other — and frightened ghosts make a genuine effort to flee rather than
          wandering randomly.
        </p>
        <p>
          <span className="font-semibold text-white/80">Controls.</span> Desktop plays on arrow keys or WASD.
          Mobile gets a dedicated touch layer — a virtual joystick for movement and a floating potion HUD for
          power-ups — tuned so neither control scheme ever locks a player out of moving, even with a customized
          keybind. Every action, including power-up use, is rebindable.
        </p>
        <p>
          <span className="font-semibold text-white/80">Power-ups: six potions, one price.</span> Bought in the
          Shop and spent instantly, mid-run, with no pause:
        </p>
        <div className="overflow-x-auto">
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Potion</th>
                <th className={th}>Effect</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className={td}>Ghost Shield</td><td className={td}>Immune to ghost contact for 5s</td></tr>
              <tr><td className={td}>Ghost Freeze</td><td className={td}>Freezes every ghost on the board for 5s</td></tr>
              <tr><td className={td}>Score Surge</td><td className={td}>Multiplies every point earned for 8s</td></tr>
              <tr><td className={td}>Speed Coffee</td><td className={td}>Boosts Kasman's movement speed for 8s</td></tr>
              <tr><td className={td}>Ghost Magnet</td><td className={td}>Pulls in nearby pellets and fruit for 8s</td></tr>
              <tr><td className={td}>Ghost Hunt</td><td className={td}>Turns every ghost vulnerable to being eaten for 6s</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          Each potion is capped per level and the cap resets on every level clear, keeping power-ups a tactical
          choice rather than a way to trivialize a run. The same mechanic powers bought extra lives, capped once
          per game rather than per level.
        </p>
        <p>
          <span className="font-semibold text-white/80">Puzzle Shards.</span> A separate, skill-scaling reward
          track: level <em>N</em> spawns <em>N</em> shards, all reachable from the very first round, so reaching
          deeper levels pays off in more shards up for grabs — not just a harder badge. Shards craft into Chests
          (Copper/Silver/Gold) that convert instantly into bundles of potions and extra lives, no wallet signature
          required.
        </p>
        <p>
          <span className="font-semibold text-white/80">Integrity by construction.</span> Every score submission is
          re-simulated against its own seed and input log in an isolated verifier process before it is accepted —
          the server checks the replay, the inventory spent, and the wall-clock time taken, so no client-side
          score, potion, or shard count is ever taken on faith.
        </p>
      </div>

      <h2 className={`mt-12 ${section}`}>3. Economic Ecosystem &amp; Multi-Token Prize Pool</h2>
      <div className="mt-4 space-y-4 text-sm text-white/60">
        <p>
          <span className="font-semibold text-white/80">Entry and settlement.</span> Every game costs 1 KAS to
          enter. Entries, extra lives, skins and potions all settle into that calendar month's KasmanPool — a
          dedicated P2SH covenant address with no time lock and exactly one spendable output, so the funds it
          holds can only ever leave as a single payout transaction signed for the leaderboard's final standings.
          The game backend never holds a key that can move this pool.
        </p>
        <p>
          <span className="font-semibold text-white/80">Multi-token rewards.</span> KASMAN's prize pool isn't
          KAS-only. Each month the pool can carry bonus tokens on top of the native pool — currently TKAS (KAS
          itself, labeled TKAS while the game runs on testnet), KASPI, KASDIA and KASDISTRO — each contributed as a
          fixed monthly amount and split across the top 3 finishers by the same ranked structure:
        </p>
        <div className="overflow-x-auto">
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Token</th>
                <th className={th}>Monthly amount</th>
                <th className={th}>1st (50%)</th>
                <th className={th}>2nd (30%)</th>
                <th className={th}>3rd (20%)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={td}>TKAS / KAS</td>
                <td className={td}>Live pool balance (10% held back for treasury/upkeep)</td>
                <td className={td}>45% of pool</td>
                <td className={td}>27% of pool</td>
                <td className={td}>18% of pool</td>
              </tr>
              <tr>
                <td className={td}>KASPI</td>
                <td className={td}>2,000 KASPI</td>
                <td className={td}>1,000</td>
                <td className={td}>600</td>
                <td className={td}>400</td>
              </tr>
              <tr>
                <td className={td}>KASDIA</td>
                <td className={td}>500 KASDIA</td>
                <td className={td}>250</td>
                <td className={td}>150</td>
                <td className={td}>100</td>
              </tr>
              <tr>
                <td className={td}>KASDISTRO</td>
                <td className={td}>50 KASDISTRO</td>
                <td className={td}>25</td>
                <td className={td}>15</td>
                <td className={td}>10</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The native KAS pool keeps a 10% treasury share before splitting the remainder 50/30/20; bonus tokens are
          distributed in full at the same 50/30/20 ratio, with no treasury cut. This structure lets KASMAN layer in
          reward tokens from partner ecosystems without touching the covenant itself — bonus tokens are funded and
          distributed by the game's operator alongside the on-chain KAS payout, keeping every month's total prize
          value diversified across the Kaspa token landscape rather than resting on a single asset.
        </p>
        <p>
          <span className="font-semibold text-white/80">Daily KASMAN rewards.</span> Independent of the monthly
          pool, every player who pays an entry or checks in with a staked Kasman NFT earns KASMAN — 1,000 KASMAN
          per verified day at the base 1.0x rate, scaling up with NFT rarity (see Section 4). KASMAN is minted
          directly on-chain against a player's on-chain rewards record, with a 100 billion supply cap and 7
          decimals of precision. There is no off-chain balance: a player's accrued rewards exist as a UTXO on
          Kaspa, claimable on their own schedule once the rarity-gated wait has elapsed.
        </p>
        <p>
          Together, the monthly multi-token pool and the daily KASMAN stream give KASMAN two independent reward
          loops: one competitive and leaderboard-driven, one passive and participation-driven — both settled
          on-chain, neither custodied by the team.
        </p>
      </div>

      <h2 className={`mt-12 ${section}`}>4. Collectibles &amp; NFTs</h2>
      <div className="mt-4 space-y-4 text-sm text-white/60">
        <p>
          <span className="font-semibold text-white/80">The Kasman NFT collection.</span> 350 NFTs, minted
          externally on KaspaCom for 50 KAS each, with a 5% resale royalty flowing back to the treasury on every
          secondary sale. Each NFT carries a rarity tier derived from its token ID, and staking (locking) one
          unlocks real in-game and reward benefits:
        </p>
        <div className="overflow-x-auto">
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Rarity</th>
                <th className={th}>Free games/day</th>
                <th className={th}>Reward multiplier</th>
                <th className={th}>Claim cooldown</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className={td}>Common</td><td className={td}>1</td><td className={td}>1.1x</td><td className={td}>5 days</td></tr>
              <tr><td className={td}>Rare</td><td className={td}>2</td><td className={td}>1.3x</td><td className={td}>3 days</td></tr>
              <tr><td className={td}>Epic</td><td className={td}>3</td><td className={td}>1.6x</td><td className={td}>48 hours</td></tr>
              <tr><td className={td}>Legendary</td><td className={td}>4</td><td className={td}>2.0x</td><td className={td}>24 hours</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          A staked NFT lets a player check in once every 24 hours to count a day toward their KASMAN rewards at
          their rarity's multiplier — no entry fee required — on top of free games and a faster claim cycle than
          the unstaked 1.0x / 7-day baseline. Only one NFT can be staked at a time per wallet, and every multiplier,
          free-game count and cooldown traces back to the same rarity rules enforced on-chain by the rewards
          covenant, not a value the game's backend can quietly change.
        </p>
        <p>
          <span className="font-semibold text-white/80">Monthly bonus NFT.</span> On top of its share of the KAS
          and bonus-token pool, the leaderboard's 1st place finisher each month also receives an exclusive NFT drop
          — currently a NEURAL KEY Society piece, valued at roughly 2,000 KAS — turning the top leaderboard spot
          into a collectible flex, not just a payout.
        </p>
        <p>
          <span className="font-semibold text-white/80">Upcoming: the KasDistro collection.</span> KASMAN is
          preparing a dedicated NFT collection launch in partnership with KasDistro, extending the collectibles
          layer beyond the core 350-piece Kasman set and deepening the cross-token relationship already reflected
          in the KASDISTRO monthly reward allocation (Section 3). Full collection details, mint mechanics and
          utility will be announced ahead of launch.
        </p>
        <p>
          As with every on-chain mechanic in KASMAN, ownership and staking state for the NFT collection live
          entirely in the <code className="rounded bg-white/10 px-1 py-0.5 text-xs">KasmanNFT</code> and{" "}
          <code className="rounded bg-white/10 px-1 py-0.5 text-xs">KasmanRewards</code> covenants — there is no
          off-chain registry of who holds or has staked what. What a wallet holds on Kaspa is what it holds in
          KASMAN.
        </p>
      </div>

      <h2 className={`mt-12 ${section}`}>5. Distribution &amp; Transparency</h2>
      <div className="mt-4 space-y-4 text-sm text-white/60">
        <p>
          KASMAN treats "the operator can see the leaderboard" and "the operator can move the money" as two
          entirely separate capabilities — the backend has the first and deliberately lacks the second.
        </p>
        <p>
          <span className="font-semibold text-white/80">Settlement, not custody.</span> All KAS flowing through
          KASMAN — entries, lives, skins, potions — lands in the month's KasmanPool covenant the moment it's paid,
          not in a wallet the team controls. The covenant's only rule is structural: it can produce exactly one
          output, to whichever address carries the owner's signature over that month's leaderboard root. No key
          held by KASMAN's infrastructure can redirect, split, or withhold those funds outside that one signed
          statement.
        </p>
        <p>
          <span className="font-semibold text-white/80">A verifiable payout, every month.</span> When a month
          closes, anyone can pull its full, public settlement data: the winning addresses and a{" "}
          <code className="rounded bg-white/10 px-1 py-0.5 text-xs">sha256</code> root computed over the complete,
          exported leaderboard — every player, every score, nothing hidden. The owner then runs a dedicated open
          payout tool locally against that root and an oracle key kept offline; before it ever broadcasts, the tool
          independently re-checks every transaction input against a real Kaspa script engine, the same validation
          logic the network itself enforces. Payout is manual by design: it is never an automated or
          silently-triggered process, so a human always confirms the leaderboard root being paid against before
          funds move.
        </p>
        <p>
          <span className="font-semibold text-white/80">Batch-safe by construction.</span> Because the pool
          covenant accepts only a single, pre-committed output shape, there is no path for a payout transaction to
          quietly split funds across unannounced destinations or short the standings — the script itself rejects
          anything else, independent of operator intent.
        </p>
        <p>
          <span className="font-semibold text-white/80">Fairness upstream of the payout.</span> Transparency starts
          before the money moves. Every submitted score is re-simulated end-to-end from its seed and recorded
          inputs in an isolated verification process, checked against wall-clock time, inventory actually owned,
          and a one-submission-per-game token — so the leaderboard a payout is computed from is itself
          tamper-checked, not merely trusted. Combined with the exported, hashable leaderboard and the
          single-output covenant, the result is a prize pool where every step — who earned what, what got paid,
          and to whom — is independently checkable, by players and third parties alike, without requiring trust in
          KASMAN as an operator.
        </p>
      </div>
    </section>
  );
}

function TokenomicsTab() {
  return (
    <section role="tabpanel" aria-label="Tokenomics">
      <h1 className="font-arcade mt-4 text-xl leading-relaxed text-yellow-300 sm:text-2xl">$KASM Tokenomics</h1>
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
    </section>
  );
}
