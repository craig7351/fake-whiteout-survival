# 雪地肉舖 Fake Whiteout Survival — 專案分析（AI 整理）

> 本文件由 AI 閱讀整個程式碼後整理，供開發者快速理解架構與現況。

## 一句話總結

一款用 **Vue 3 + Babylon.js** 寫的 3D 雪地放置經營小遊戲（idle tycoon），模仿買量廣告常見的「雪地賣肉舖」。手機優先、單人前端純客戶端，無後端。

## 技術棧

| 層 | 技術 |
|---|---|
| 框架 | Vue 3（`<script setup>`）、Vite 6、TypeScript（strict） |
| 3D 引擎 | Babylon.js 9（`@babylonjs/core` + `@babylonjs/loaders`） |
| 樣式 | Tailwind CSS 4（`@tailwindcss/vite`） |
| 模型 | GLB + Draco 壓縮（解碼器自帶於 `public/draco/`，不依賴 CDN） |
| 衍生自 | 姊妹專案 `winter`（地形、模型載入、相機、HUD 風格、3D 資產） |

## 架構分層

```
main.ts  ── 設定 Draco 解碼器路徑 → 掛載 App.vue
  └ App.vue  ── landing-screen ↔ game-view 切換（點「立即遊玩」進場）
       └ game-view.vue  ── 持有 <canvas>、joystick、HUD、Debug 面板；橋接 Vue ↔ 遊戲
            └ game.ts  ── 整個遊戲引擎（約 1700 行，核心）
                 ├ config.ts        所有可調參數、升級/武器定義
                 ├ model-loader.ts  GLB 載入＋正規化（角色/牛群/道具三種模式）
                 ├ back-stack.ts    背後肉堆/金條堆（thin-instance）
                 ├ terrain / decals / hp-bar / bubble / sound  輔助模組
```

**關鍵設計**：`game.ts` 是命令式 Babylon 程式，與 Vue 完全解耦——`createGame()` 回傳一個 `GameHandle`（`dispose / setJoystick / setMuted / ...`），透過 `onStats` callback 每 0.1s 把數值推回 Vue 的 reactive `stats`。Vue 只負責 HUD/UI，不碰每幀邏輯。這是很乾淨的邊界。

## 玩法循環（在 `onBeforeRenderObservable` 每幀跑）

```
進牧場 → 自動揮武器打牛 → 牛死爆肉掉地 → 走過自動撿（背後疊高）
   → 回攤位自動擺肉 → 顧客排隊買肉付錢（收銀台堆金條）
   → 走到收銀台收錢（金條飛回背上） → 踩武器框花錢買更強武器
```

## 值得稱讚的工程細節

- **效能導向的實例化**：`InstanceStack`（共用 `InstancedMesh` 池）、`BackStack`（單一 thin-instance mesh + 手寫 matrix buffer）、`FlyPool`（拋物線飛行動畫物件池）。攤位肉/金條只在**數量變動時**才重排（`lastCounterN`/`lastCashN`），避免每幀重建陣列。
- **AssetContainer 複製**：牛群與顧客用 `instantiateModelsToScene` 各自帶骨骼動畫副本，動畫狀態機只在切換時 `start/stop`。
- **載入容錯**：模型載入失敗一律 fallback 到程序化方塊/膠囊，不會白畫面。
- **手機框景**：`FOVMODE_HORIZONTAL_FIXED` 固定水平視野，畫面變高只往上下延伸，配合 safe-area-inset 避開瀏海。

## 現況 / 注意事項

1. **`UPGRADES` 已清空**（`config.ts`），但主 `README.md` 仍寫有 6 種升級項目、`game.ts` 仍保留整套 `UpgradeStation` 與升級迴圈邏輯——**README 與程式碼已不同步**。實際當前只有「武器購買」作為成長系統。
2. **多數上限被改成無限**：`carryCap`/`counterCap` 回傳 `Infinity`、肉品單價/移動速度/攻擊力升級都註解掉了。看起來正從「數值升級型」往「純武器解鎖型」演進中。
3. 非 git 倉庫；`dist/` 已 build（含完整 Babylon chunk）。

## 已知問題與修正紀錄

- **牛重生後仍趴在地上**（已修正，`game.ts` 重生區塊）
  - **根因**：重生重置用 `death.stop()`，但死亡動畫播完一次後 Babylon 已自動設為非 started，`stop()` 變成空操作、不會還原骨架姿勢；`idle.start()` 又只蓋過自己有 keyframe 的骨頭，死亡動畫壓到地面的髖/root 骨頭殘留 → 牛仍趴著。「有的牛」會這樣是因為取決於死亡動畫停在哪一幀。
  - **修正**：重生時先 `c.death?.reset()` 把死亡動畫驅動的所有骨頭強制倒回站姿第一幀，再停掉並重播 idle。
