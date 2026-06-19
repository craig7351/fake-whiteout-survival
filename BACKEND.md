# 後端：全球排行榜 / 統計 / 留言板 / 線上人數

純前端可正常運作（無 `/api` 時自動回退 localStorage）。要啟用「全球共享」需建立 Cloudflare D1 並部署 Pages（網址：`fake-whiteout-survival.pages.dev`）。

## 架構（同 animal-survivors）

- **Pages Functions**（`functions/api/*.ts`）＝ 同源 `/api/*`，零 CORS。
- **D1**（SQLite）：`runs`（排行榜）、`stats`（累計：賺錢/殺牛/殺怪/場次）、`presence`（在線）、`messages`（留言）。
- 前端 [`src/game/community.ts`](src/game/community.ts) 先打 API，失敗回退本機。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/run` | 送出一場結算（name/wave/money/won） |
| GET | `/api/leaderboard?limit=10` | 全球排行榜（依波數） |
| POST/GET | `/api/totals` | 累加 / 取得全服統計（money/cows/monsters/runs） |
| POST | `/api/heartbeat` | 在線心跳 |
| GET | `/api/online` | 近 90 秒在線人數 |
| GET/POST | `/api/messages` | 留言板 |

## 一次性部署步驟

```bash
# 1) 登入（會開瀏覽器授權）
npx wrangler login

# 2) 建立 D1 資料庫（記下回傳的 database_id）
npx wrangler d1 create fake-whiteout-survival-db

# 3) 把 database_id 填入 wrangler.jsonc 的 d1_databases[0].database_id（取代 REPLACE_WITH_DATABASE_ID）

# 4) 建表（遠端正式庫）
npx wrangler d1 execute fake-whiteout-survival-db --file=./schema.sql --remote

# 5) 建置 + 部署到 Pages
npm run build
npx wrangler pages deploy dist --project-name=fake-whiteout-survival
```

> 若用 Cloudflare 儀表板連 Git 自動部署：到 Pages 專案 → Settings → Functions → D1 bindings，把 `DB` 綁到 `fake-whiteout-survival-db`。

## 本機測試（含 Functions / D1）

```bash
npm run build
npx wrangler d1 execute fake-whiteout-survival-db --file=./schema.sql --local
npx wrangler pages dev dist     # 提供 /api/* 與本機 D1
```

（一般 `npm run dev` 不會有 `/api`，前端自動回退 localStorage，仍可正常開發遊戲。）
