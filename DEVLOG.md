# 開發筆記 DEVLOG

記錄重要變更與「踩雷點」(gotchas),方便日後維護。線上版:https://fake-whiteout-survival.pages.dev

---

## 🍎 iOS 雙擊放大(最棘手,務必看)

**問題**:iPhone Safari 雙擊畫面(尤其搖桿)會放大,且回不去。

**無效的方法**(iOS 都不理會):
- viewport meta 的 `user-scalable=no` / `maximum-scale=1`
- `touch-action: none` 或 `touch-action: manipulation`
- 改 viewport meta 想「縮回 1」—— iOS 縮放是單向(只放大、不程式縮小)
- 頁內元素的「雙擊還原」—— 遊戲頁是 `overflow-hidden` 固定版面,iOS 沒有可縮放回去的內容塊

**有效解**(`src/main.ts`):在 **`touchstart`** 攔截「**350ms 內的第二次快速點擊**(單指)」並 `preventDefault`,從源頭阻止瀏覽器啟動雙擊縮放。排除 `button/input/select/textarea/a/.overflow-y-auto` 以免影響操作與捲動。
> 重點:`touchstart` 攔截有效,`touchend` 無效。另保留 `gesturestart` preventDefault 擋雙指頁面縮放(不影響 Babylon 鏡頭)。

---

## 🌲 樹木(thin-instance 的雷)

- 樹只剩一棵在原點的真正主因:`scatterNature()` 移除 `await` 後變同步,在 `TREE_MAX`/`treeField` 宣告**之前**就被呼叫 → TDZ `ReferenceError` 中止。解法:呼叫點移到相關宣告之後。
- thin-instance 對「自建 mesh(MergeMeshes / VertexData)」未正確生效 → 改用 `InstancedMesh`(`createInstance`),且**逐棵視錐剔除**(鏡頭外不畫),比 thin-instance 更省。
- 現況:真實 `Pine Tree.glb`,**5 種固定佈局**(環形/雙層環/左右/上下/四角)+ 下拉選單,預設**四角**;size 26 放大棵。
- 草素材、牧場旁北極熊裝飾已移除。

## ⚡ 效能

- 殭屍同屏池:測試曾拉到 250,正式回到 **73**(basic30/skel24/chubby16/boss3);且**開啟塔防時才建池**(進場載入更快)。
- 畫質改**手動下拉**(高/標準/流暢/省電 = hardwareScalingLevel 1/1.5/2/2.5),記 localStorage。
- 傷害數字/火花每幀上限 4;殭屍血條只在受傷時顯示;靜態物件(地面/磚牆/柵欄/樹)freezeWorldMatrix。
- 背肉/金條是 thin-instance(固定數),疊高**不影響 FPS**;視覺上限 200 層。

## 🎮 玩法

- **取消房子**:改「殭屍攻入基地」判定 —— 越過圍欄(紅色警戒線)累計 **10 隻**即遊戲結束;撐過 **30 波**通關。
- 開啟塔防:**不扣錢**,身上需 **$5000** 門檻 → 跳說明視窗,確認後 **1 分鐘**第一波。
- 塔:🏹機槍 / 💣砲 / ❄️緩速(發射藍色炸彈+冰霜爆裂+音效);高等級多發;緩速塔在房屋兩側。
- 取消玩家血量與受傷特效。
- 地上功能框加「名稱+效果」與靠近說明卡。

## 🏠 首頁 / 社群

- 改名 **偽寒冰啟示錄**,冰封深色 UI(極光 + 飄雪 + 毛玻璃)。
- 排行榜/成就/留言板做成按鈕→彈窗;留言板**回覆功能**、名字在板內輸入;版主刪除碼提示「8bytes生日」。
- 粉絲團按鈕(首頁 + 通關/失敗彈窗)。

## ☁️ 後端

- Cloudflare Pages Functions + D1;安全加固見 `BACKEND.md`(速率限制/髒話過濾/排行榜合理性/版主刪除)。

## 🛠️ 慣用流程

```bash
npm run build
npx wrangler pages deploy dist --project-name=fake-whiteout-survival --branch=main --commit-dirty=true
```
改完一律先 `npx vue-tsc --noEmit` 型別檢查再 build。
