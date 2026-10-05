-- Apply: pnpm exec wrangler d1 execute kasman --file worker/schema.sql [--local|--remote]
CREATE TABLE IF NOT EXISTS players (
  address TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Anonymous',
  -- X (Twitter) handle, no leading '@'. One handle per wallet; unique case-insensitively.
  x_handle TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_x_handle ON players (x_handle COLLATE NOCASE) WHERE x_handle IS NOT NULL;
-- Wallet sign-in challenges; single use, 5 minutes.
CREATE TABLE IF NOT EXISTS nonces (
  nonce TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- One row per purchase. `pool` is the month's covenant address the payment must reach.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  kind TEXT NOT NULL,          -- entry | lives | skin | potion
  item TEXT NOT NULL,          -- lives count, skin id or potion id ('' for entry)
  qty INTEGER NOT NULL DEFAULT 1, -- units bought; only potions use more than 1
  sompi INTEGER NOT NULL,
  pool TEXT NOT NULL,
  month TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  tx_id TEXT UNIQUE,
  paid_at INTEGER
);
-- Counts paid entries per month for the Leaderboard's games-goal progress (worker/index.ts paidGamesCount).
CREATE INDEX IF NOT EXISTS orders_month_kind ON orders (month, kind, paid_at);
-- Tickets, lives and shards (Puzzle Shards, spent crafting Chests) are counters; skins are rows
-- with qty 1; potions are counters by item (one row per potion id). Nothing grants shards yet.
CREATE TABLE IF NOT EXISTS inventory (
  address TEXT NOT NULL,
  kind TEXT NOT NULL,          -- ticket | lives | skin | potion | shard
  item TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (address, kind, item)
);
-- Every game's verified result. Replays are checked on submit and never stored.
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  seed INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  submitted_at INTEGER,
  submit_token TEXT,
  month TEXT,
  score INTEGER,
  level INTEGER,
  frames INTEGER,
  won INTEGER
);
CREATE INDEX IF NOT EXISTS games_month ON games (month, address);
-- Leaderboard: one row per player per month, updated with each submitted game.
CREATE TABLE IF NOT EXISTS monthly (
  month TEXT NOT NULL,
  address TEXT NOT NULL,
  total INTEGER NOT NULL,
  games INTEGER NOT NULL,
  best_score INTEGER NOT NULL,
  best_level INTEGER NOT NULL,
  best_frames INTEGER,         -- fastest clear of all levels; NULL until the player wins once
  best_score_frames INTEGER NOT NULL,
  PRIMARY KEY (month, address)
);
-- Free games of today from a staked Kasman NFT, granted by /api/free from that day's on-chain
-- check-in transaction (KasmanRewards/KasmanNFT). Rewards themselves live on chain only.
CREATE TABLE IF NOT EXISTS free_games (
  address TEXT PRIMARY KEY,
  day TEXT NOT NULL,           -- UTC day of the grant
  granted INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
-- Social Quests: one-time reward per wallet per quest (worker/index.ts QUESTS list, from
-- src/lib/prices.ts). Self-reported (claim after visiting the link); no X API check yet.
CREATE TABLE IF NOT EXISTS quest_claims (
  address TEXT NOT NULL,
  quest TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (address, quest)
);
-- Replaced by on-chain contracts (KasmanRewards): drop the old off-chain tables if present.
DROP TABLE IF EXISTS stakes;
DROP TABLE IF EXISTS rewards;
