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

## 安全性加固（已上線）

公開寫入端點都加了防濫用機制：

| 防護 | 說明 |
|---|---|
| **速率限制** | 依來源 IP（`CF-Connecting-IP`）限流：留言 8s、結算 4s、統計 2.5s／次，超過回 `429`。狀態存 D1 `rate` 表。 |
| **髒話/廣告過濾** | 留言/暱稱命中黑名單（`_lib.ts` 的 `BAD_WORDS`）回 `422`。 |
| **排行榜合理性** | `run` 波數上限＝破關波數（30），且未達 30 波宣稱通關一律記為未通關，擋洗榜。 |
| **留言刪除（版主）** | `DELETE /api/messages`（body：`{id,key}`）需 `ADMIN_KEY` 相符；首頁每則留言的 ✕ 會提示輸入刪除碼並記住。 |
| **既有防護** | SQL 全參數化（無注入）、輸出由 Vue 跳脫 + 伺服器去 `<>`（無 XSS）、無祕密入庫。 |

### 設定 / 輪替版主刪除碼

```bash
# 設定（會提示或可用管線輸入）；存為 Pages production 環境的 Secret
echo "你的新刪除碼" | npx wrangler pages secret put ADMIN_KEY --project-name=fake-whiteout-survival
```

> 進一步防護（選用，dashboard 設定）：Cloudflare **WAF Rate Limiting Rule** 或 **Turnstile** 人機驗證，可在不改碼的情況下再擋大量腳本流量。

## 本機測試（含 Functions / D1）

```bash
npm run build
npx wrangler d1 execute fake-whiteout-survival-db --file=./schema.sql --local
npx wrangler pages dev dist     # 提供 /api/* 與本機 D1
```

（一般 `npm run dev` 不會有 `/api`，前端自動回退 localStorage，仍可正常開發遊戲。）
