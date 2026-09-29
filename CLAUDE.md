# Kasman

Pac-Man-style game site on Kaspa: Home, Play, Marketplace, Inventory. 10 KAS entry fee, monthly prize pool paid to leaderboard #1. Daily KASMAN rewards, recorded and minted on chain (pay an entry or check in with a staked NFT); staked Kasman NFT (50 KAS) adds free games, a multiplier and shorter claim waits by rarity. Leaderboard = one row per player (wallet address) per month: total points of every submitted game + time to clear all levels (Play page tabs: Game / Leaderboard, `?tab=leaderboard`).

## Kaspa / backend

- Game runs off-chain. **Cloudflare Worker, Free plan** (`worker/index.ts`, D1 `worker/schema.sql`) serves `/api/*` next to the Vite build (`wrangler.jsonc`, `@cloudflare/vite-plugin`, so `pnpm dev` runs it too). Every Worker request must stay under 10 ms CPU: replay re-simulation runs in the `Verifier` Durable Object (`worker/verifier.ts`, 30 s CPU per request, pool of 4 instances). Never add heavy work to the Worker itself.
- Client API = `src/lib/leaderboard.ts`; wallet = `src/lib/wallet.ts` (KasWare), `src/lib/useWallet.ts`, header `WalletButton`. **Wallet connection is required** to pay and play: sign-in = KasWare `signMessage` (Schnorr, hex) of a server nonce, checked in `worker/auth.ts` (Kaspa personal-message BLAKE2b digest + pubkey must derive the address). Session = HttpOnly cookie. Payments must come from the connected address.
- All KAS (entries, lives, skins) goes to the month's **KasmanPool covenant** (`contracts/KasmanPool.sil`, Silverscript, Toccata L1): one P2SH address per month (`worker/pools.json`; wallet network follows its `network`). No time lock: only one output, to the address the owner's oracle key signed with the leaderboard root. The Worker holds no keys.
- Payment flow: `/api/order` (price from `src/lib/prices.ts` / `SKINS`; returns pool address + `month`) → wallet pays with payload `kasman:<orderId>[|...]` → `/api/pay` checks the tx on the Kaspa REST API (`KASPA_API`): payload order id, amount to the pool, one input from the connected address. Entries go through `src/lib/chain.ts` `payEntry` (covenant tx with the player's rewards record, see below); lives/skins through KasWare `sendKaspa`.
- Anti-cheat: server seed per game (`/api/game/start` uses one of today's free games (D1 `free_games`, granted by `/api/free {txId}` from an accepted on-chain check-in where the player's genuine LOCKED NFT takes part through `stakeUse`) or burns a ticket), `/api/score` re-simulates in the DO, checks seed, one submit per game (submit token), bought lives owned, wall time ≥ run length.
- D1 free-plan budget: leaderboard reads only `monthly` (1 row per player per month, updated in the submit batch); replays are verified on submit and **never stored** (user's choice: no replay on the leaderboard; the player can only watch / save a video of their own run on the Game Over screen, locally); `/api/leaderboard` and `/api/pool` edge-cached 30 s (custom domain only).
- **Payout is manual**: owner fetches `/api/month/:m/settlement` (any time; winner + root = sha256 of `/api/month/:m/export`, results only) and runs `contracts/tool` (Rust, `kasman-pool payout`) locally with `ORACLE_KEY`; it checks every input with the real script engine before broadcasting. Oracle keys in `.secrets/` (testnet key there now; generate a fresh one for mainnet).
- New month addresses: `kasman-pool pools <oracle-pubkey> <network> <YYYY-MM> <months> > worker/pools.json` (changing the oracle key changes every address).

## NFT collection + KASMAN rewards (on chain, testnet only; not deployed yet)

- Contracts in `contracts/`: `KCC20.sil` (verbatim copy of silverscript's example at 3ed9733, never edit), `KasmanNFT.sil` (3,000 NFTs, ROOT/FREE/LOCKED/LISTED modes, 50 KAS mint to treasury, 5% resale royalty; LOCKED = staked, `stakeUse` once per 24 h), `KasmanRewards.sil` (on-chain rewards ledger: one covenant, one record UTXO per player; `open`/`play` count a day when paying an entry to a KasmanPool, whose address it rebuilds from the month; `checkIn` with staked NFT counts the day at the rarity multiplier; `claim` after the rarity wait), `DailyMinter.sil` (KCC20 controller: mints a record's points × 100 KASMAN on its claim, cap 100 B; admin key only for `init`), `Treasury.sil` (mint + royalty KAS, owner withdraws any time).
- **User's rule: registration and payout of rewards are on-chain contracts only**: no Worker registry of stakes or balances, no keys in the Worker, no operator tool that mints. The Worker only reads the chain (payments, check-ins for free games). Rarity ranges/multipliers/waits live in `KasmanRewards.sil` and are mirrored in `rarityRules` (`src/lib/covenant.ts`) and `RARITIES` (`src/lib/prices.ts`, UI + free games): change all three.
- Deploy once per network: `kasman-pool deploy <net> <api> <oracle-pubkey> <treasury-owner-pubkey> > src/lib/onchain.json` (env `DEPLOY_KEY`, funds ≥ ~25 KAS) writes `deploy-txs.json`; broadcast with `node scripts/broadcast.mjs deploy-txs.json testnet-10`. `--dry-run` = same templates, fake covenant IDs, `deployed: false` (the committed `onchain.json` is a dry run: the web shows the NFT/rewards as "not live"). Genesis/roots/minter UTXOs hold 5 KAS, each player record/NFT/token UTXO 2 KAS: covenant outputs weigh 4 storage-mass units, smaller values push the claim tx over the 100k standard mass (`worker/chain.test.ts` checks every tx type with the SDK).
- KASMAN has **7 decimals** (int64 limit). Record points are tenths of the 1,000 KASMAN daily reward.
- Ownership (NFT, rewards record) = the transaction spends a P2PK UTXO of the owner's wallet (`ownerInput` arg, `tx.inputs[i].scriptPubKey == P2PK(owner)`), never `checkSig` on the covenant input. Reason: KasWare `signPskt({txJsonString, options: {signInputs: [{index, sighashType: 1}]}})` signs only the wallet's own inputs (SIGHASH_ALL covers the whole tx); dApps fill covenant sigscripts themselves (pattern used live by kas-odds with Rusty Kaspa WASM SDK v2.0.1 SafeJSON). Treasury and pool payout keep `checkSig`/`checkMsgSig` (operator keys).
- Builders + flow tests: `contracts/tool/src/collection.rs` (`cargo test`); every negative test must fail by a script rule (`by_script`). `compute_budgets` prints each input's compute budget (inputs use 20, wallet P2PK 10).
- Web side: `src/lib/covenant.ts` = pure byte encoding (state `01 x` / `20 ..` / `08 <i64 LE>` between template prefix/suffix; entry args as minimal pushes + 4-byte selector + redeem push; KCC20 arrays pushed column by column), addresses, payloads; vectors from the Rust compiler in `worker/covenant.test.ts`. `src/lib/chain.ts` = Kaspa SDK (`kaspa-wasm`, vendored v2.0.1 web build in `vendor/kaspa`, lazy-loaded ≈11.5 MB wasm), wRPC via public `Resolver` (REST cannot submit covenant txs on testnet-10), REST for history, pure tx drafts (`openDraft`, `playDraft`, `checkInDraft`, `claimDraft`, `mintDraft`, `stakeDraft`), `fund` (coin selection + SDK fee), `send` (KasWare `signPskt` on wallet inputs only, rejects any other change, submits, waits).
- Covenant states are found through tx payloads (`kasman:<orderId>|r=<points>,<lastClaimDaa>|n=<tokenId>,<mode>|m=<remaining>|t=<minted>`), always checked against the output address. Minter found via the KCC20 branch (constant state = constant address); NFT root via binary search on `transactions-count` of root addresses.

UI text in English. Talk to the user in Spanish.

**`DESPLIEGUE.md`** (Spanish) is the deployment guide: contracts, Worker, D1, keys, monthly payout, mainnet checklist, warnings. Keep it in sync whenever commands, config, contracts or limits change.

## Commands

Use **pnpm**, never npm.

```bash
pnpm dev            # Vite dev server (5173, usually already running by the user; use another port for temp checks)
pnpm exec tsc -b    # typecheck
pnpm lint           # oxlint
pnpm test           # vitest (engine + worker tests; worker tests run D1 on node:sqlite)
pnpm build          # tsc -b && vite build
python scripts/bake-kasman.py   # regenerate recolored Kasman sprites per skin
pnpm exec wrangler d1 execute kasman --local --file worker/schema.sql   # local DB (--remote for prod)
cd contracts/tool && cargo test  # covenant tests (compile + script engine), then `cargo run -- ...`
node scripts/broadcast.mjs <txs.json> testnet-10   # send signed txs (deploy, treasury, payout fallback) through a public node; resumable
# kasman-pool: keygen | pools | payout | deploy | treasury <net> <api> <to>  (env TREASURY_KEY: withdraw mint/royalty KAS)
```

Run tsc + lint + test + build after changes.

## Stack

Vite 8, React 19, TypeScript 6 (`erasableSyntaxOnly`: no parameter properties/enums), Tailwind v4, react-router, zustand (`persist`, key `kasman.store.v1`), PixiJS v8 + pixi-filters, vitest.

## Architecture

- `src/game/engine/` pure TS, no DOM/Pixi. Deterministic: fixed 60 Hz `step(state, input)`, 120 sub-units per tile, seeded RNG. **Replay = seed + `[frame, input]` pairs**; re-simulating verifies a score (future anti-cheat on server). Any physics change breaks old replays and saved sessions.
  - One maze per level (`map.ts` `MAZES`, `mazeFor(level)`). 9 levels (`MAZE_COUNT`): clearing the last sets `won` and ends the game ("YOU WIN!" box in `Play.tsx`). Each level must be harder than the previous in every way: fewer junctions, no more tunnels/power pellets, faster ghosts, shorter fright, less scatter (`levelTuning`, `modeSchedule`; enforced by tests). Level 1 layout must never change. Bump `Replay.v` on any simulation change (old saved runs are then dropped).
  - Ghost AI (`moveGhost`): arcade targets (`chaseTarget`) but steering by BFS maze distance (`distField`), chasing ghosts other than Blinky avoid routes near allies (`AMBUSH_*`), frightened ghosts flee Kasman with `levelTuning().fleeChance` (else random).
  - Special input `BUY_LIFE` (recorded like a key press), capped by `MAX_BOUGHT_LIVES` per game.
  - Turn feel tuned by `TURN_TOLERANCE` (late-turn snap) and `TURN_BUFFER_FRAMES` (buffered turn expiry).
- `src/game/render/`
  - `PixiRenderer.ts` reads state only; maze + backdrop cached to a texture.
  - `skins.ts` skin data (colors, ghost/pellet/fruit/backdrop styles, `pacHat` = Kasman accessory).
  - `sprites.ts` all themed drawing through `Pen` (subset of Pixi Graphics API; `CanvasPen` implements it for Canvas 2D), so the game, Marketplace previews (`SkinPreview`) and life icons (`KasmanIcon`) share one drawing code.
  - `video.ts` "Save video" on Game Over: re-simulates the replay offscreen and encodes MP4 (mediabunny/WebCodecs, lazy-loaded chunk), faster than real time, no audio.
- `src/components/GameCanvas.tsx` rAF loop with accumulator, input, audio, HUD. Unfinished run is saved as a Replay in the store (`activeGame`) on unmount/pagehide and resumed paused.
- Extra lives: bought only in Marketplace (Lives tab), spent in-game via "+1 LIFE" (pauses the game).
- Inventory reads the chain (`holdings`): "NFT" lists the wallet's NFTs (art = Kasman png for now) with Stake/Unstake and Daily check-in; "Rewards" shows KASMAN to claim, multiplier, KASMAN received, Claim with countdown. Marketplace "NFT" tab (`?tab=nft`): rarity table + Mint (50 KAS to the treasury). All disabled while `onchain.json` has `deployed: false`.
- Tickets, lives, owned skins and today's free games are server-owned (`/api/me`, `syncAccount` in the store); the store only caches them. Unfinished run keeps its server `activeGameId`.

## Kasman (player character)

- Bitmap, not vector: `src/assets/kasman.png` (head cut from the user's art). Per-skin recolors `kasman-<skinId>.png` are generated by `scripts/bake-kasman.py` (edit its table, rerun). `kasmanUrl(skinId)` falls back to the green original.
- Accessories (`drawKasmanGear`) are vector, drawn over the sprite; landmarks documented in `sprites.ts`.
- Kasman never rotates: mirrored when facing left, bobs while moving, spins/shrinks on death.
- Keep him Pac-Man sized (`KASMAN_SIZE`). User rejected a bigger/hand-drawn version.
- No glow circles/halos around characters, fruit or power pellets (user asked to remove them).

## Skins

Ids are persisted (owned/equipped): never rename an id. `kaspa-neon` = default "Kaspa" (free), `inferno` = "Hell". Unknown ids fall back to the default skin.

## Visual checks

Chrome extension may be offline. Use headless Chrome screenshots of a temp HTML page served by Vite on a spare port (e.g. 5199), then delete the temp page and kill the server:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=880,620 --screenshot=out.png --virtual-time-budget=10000 http://localhost:5199/check.html
```

`Assets.load` resolves late under virtual time: render in a rAF loop, not once.

Phone sizes: headless `--window-size` has a ~500px minimum width and browser chrome eats height. Load the page in an `<iframe width=W height=H>` inside a big window and crop. Touch devices: `--blink-settings=primaryPointerType=2,availablePointerTypes=2` (makes `pointer-coarse:` match).
