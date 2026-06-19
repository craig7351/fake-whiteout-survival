-- 雪地肉舖後端 D1 結構（排行榜 + 統計 + 在線 + 留言）
-- 套用：wrangler d1 execute fake-whiteout-survival-db --file=./schema.sql --remote

-- 排行榜：每場結算（撐到第幾波、賺多少）
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT,
  name TEXT,
  wave INTEGER DEFAULT 0,
  money INTEGER DEFAULT 0,
  won INTEGER DEFAULT 0,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_runs_wave ON runs (wave DESC, money DESC);

-- 全服累計統計（單列 id=1）
CREATE TABLE IF NOT EXISTS stats (
  id INTEGER PRIMARY KEY,
  total_money INTEGER NOT NULL DEFAULT 0,
  total_cows INTEGER NOT NULL DEFAULT 0,
  total_monsters INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO stats (id) VALUES (1);

-- 在線（心跳）：近 90 秒活躍人數
CREATE TABLE IF NOT EXISTS presence (
  device_id TEXT PRIMARY KEY,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presence_seen ON presence (last_seen);

-- 留言板
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  text TEXT,
  device_id TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_id ON messages (id DESC);

-- 速率限制：key（action:ip）最後一次寫入時間
CREATE TABLE IF NOT EXISTS rate (
  k TEXT PRIMARY KEY,
  last_at INTEGER NOT NULL
);
