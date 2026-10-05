-- Migration for production D1 (database "kasman"). Additive only: no DROP, no data rewrites.
-- Run ONCE against the remote database, BEFORE `wrangler deploy` of the Worker that uses these columns:
--   pnpm exec wrangler d1 execute kasman --remote --file worker/migrations/0001_x_handle_qty_quests.sql
--
-- D1 has no "ADD COLUMN IF NOT EXISTS". If a column already exists, the ALTER below fails with
-- "duplicate column name" and D1 stops the file there. That is safe: the statements before it are
-- already applied and the statements after it have not run yet. Check first (read-only):
--   pnpm exec wrangler d1 execute kasman --remote --command "PRAGMA table_info(players);"
--   pnpm exec wrangler d1 execute kasman --remote --command "PRAGMA table_info(orders);"
-- If x_handle / qty are already listed, comment out the matching ALTER below before running the file.

-- 1. Players: X (Twitter) handle for the Quests tab. NULL until the player registers one.
ALTER TABLE players ADD COLUMN x_handle TEXT;

-- 2. Orders: units bought per order (potions can be bought in quantities > 1). Existing rows get 1.
ALTER TABLE orders ADD COLUMN qty INTEGER NOT NULL DEFAULT 1;

-- 3. Indexes and tables that the new code needs. These are idempotent (IF NOT EXISTS).
--    The unique index must come after step 1, because it references players.x_handle.
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_x_handle ON players (x_handle COLLATE NOCASE) WHERE x_handle IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_month_kind ON orders (month, kind, paid_at);
CREATE TABLE IF NOT EXISTS quest_claims (
  address TEXT NOT NULL,
  quest TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (address, quest)
);
