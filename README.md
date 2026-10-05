# Kasman

Arcade maze chase for the Kaspa community: Home, Play (game + monthly leaderboard), Shop (potions, cosmetic skins, chest crafting), Inventory, Quests and Staking (Kasman NFT).
Every day you play earns KASMAN tokens; a staked Kasman NFT (50 KAS) gives free daily games, a reward multiplier and shorter claim waits by rarity:

| Rarity | NFT # | Free games / day | Multiplier | Claim every |
|---|---|---|---|---|
| No NFT | - | 0 | 1.0x | 7 days |
| Common | 1-175 | 1 | 1.1x | 5 days |
| Rare | 176-280 | 2 | 1.3x | 3 days |
| Epic | 281-325 | 3 | 1.6x | 48 h |
| Legendary | 326-350 | 4 | 2.0x | 24 h |

Base reward: 1,000 KASMAN per day played. Everything happens on Kaspa L1, signed with KasWare; no server keeps balances or can mint:

- Paying a game entry records the day in your rewards record (`KasmanRewards` contract): at most one day per 24 h, at 1.0x. The first entry creates the record (2 KAS deposit kept in it).
- With a staked NFT, the daily check-in records the day at its rarity's multiplier and unlocks that day's free games.
- Claim mints your KASMAN straight from the `DailyMinter` contract, after the rarity's wait.

Rules live in `contracts/KasmanRewards.sil` (mirrored in `src/lib/covenant.ts` and `src/lib/prices.ts`).

Payments go from the player's KasWare wallet to a Kaspa L1 contract; see [DESPLIEGUE.md](DESPLIEGUE.md) (Spanish) to deploy.

```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm test     # engine + Worker tests
pnpm build
```

## Layout

- `src/game/engine/` pure TypeScript simulation. Integer positions, fixed 60 Hz step, seeded RNG:
  the same seed + input log always gives the same score, so a server can re-run a replay to verify a score.
- `src/game/render/` PixiJS v8 renderer and skins.
- `src/game/input.ts`, `src/game/audio.ts` keyboard/swipe/gamepad input and WebAudio SFX.
- `src/lib/leaderboard.ts` client for the Worker API (`worker/index.ts`); `src/lib/wallet.ts` KasWare; `src/lib/prices.ts` prices and NFT rarity perks shared with the Worker.
- `src/lib/covenant.ts` byte encoding of the covenants (state, arguments, addresses); `src/lib/chain.ts` reads the chain and builds, signs (KasWare `signPskt`) and sends covenant transactions with the Kaspa SDK (`vendor/kaspa`, v2.0.1, loaded on the first on-chain action); `src/lib/onchain.json` covenant IDs and templates written by `kasman-pool deploy`.
- `contracts/` Silverscript contracts (monthly pool, NFT collection, rewards ledger, KASMAN token + minter, treasury) and the Rust operator tool (`contracts/tool`, `cargo test`: `keygen`, `pools`, `payout`, `deploy`, `treasury`).
- `scripts/broadcast.mjs` sends signed transactions (deploy, treasury withdrawals) through a public Kaspa node.

Launching the contracts and how everything works once live: [DESPLIEGUE.md §8](DESPLIEGUE.md).
