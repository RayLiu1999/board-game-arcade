# 棋聚 QIJU：架構、棋種演算法與產品化路線

## 文件目的

本文件整理棋聚 QIJU 目前的技術架構、檔案分層、八種棋類的規則與 AI 演算法，並提出後續的技術優化、可玩性與產品化方向。

目前基準版本：

- Git commit：`91630b1 Initial commit: Qiju board game arcade`
- 測試：`npm test` 通過 46 個測試
- 執行環境：Node.js 22 或更新版本

### TS-first 決策

後續實作採 TypeScript-first，而不是先完成一套 JavaScript 架構再搬遷。所有新的核心程式、伺服器、Worker 與測試優先使用 `.ts`；既有 JavaScript 會依照依賴關係逐層轉換，最後只保留瀏覽器實際載入的建置產物。

目標目錄：

```text
src/
├─ client/       app、AI、UI 與瀏覽器 Worker 原始碼
├─ server/       HTTP、WebSocket、房間服務與協定分派
├─ shared/       一般棋類規則、狀態與通訊型別
└─ types/        第三方套件的最小型別宣告

lib/              可供 Node.js 與日麻 Worker 共用的 session core

scripts/         TypeScript 建置與開發工具
test/            TypeScript 規則、整合與 E2E 測試
public/          HTML、CSS、圖片與瀏覽器建置產物
```

TypeScript 品質門檻：

- `strict: true`
- 不以 `any` 作為未完成型別的暫時替代品
- 外部無型別套件使用明確的 typed facade 或 `unknown` 邊界
- server、client、Worker 與 test 共用明確的 state／message schema
- CI 必須通過 typecheck、lint、format、build 與測試

---

## 1. 專案定位

棋聚是一個使用瀏覽器遊玩的棋類合集，提供：

- 八種棋類：將棋、日式麻將、西洋棋、象棋、西洋跳棋、五子棋、圍棋、黑白棋
- AI 對戰
- 同機對戰
- WebSocket 線上好友房
- 桌面版與手機版介面
- 無 CDN 依賴的本機前端 Worker 與第三方授權檔

整體屬於「原生前端 + 共用棋規模組 + Node.js WebSocket 伺服器」的分層單體架構，並不是嚴格的 MVC 或前後端完全分離系統。

---

## 2. 系統架構

```text
瀏覽器
├─ index.html / style.css       畫面骨架與視覺樣式
├─ app.js                       由 src/client/app.ts 建置的前端 bundle
├─ engine.js / shogi.js         一般棋類規則
├─ ai-worker.js → ai.js         一般棋類 AI
└─ riichi-worker.js             由 src/riichi-worker.ts 打包的本機日麻執行環境
          │
          │ WebSocket
          ▼
Node.js src/server/server.ts
├─ http-server.ts：HTTP 靜態檔案服務
├─ websocket-server.ts：連線生命週期、心跳與錯誤邊界
├─ room-manager.ts：房間與日麻 session 生命週期
├─ game-protocol.ts：一般棋類、圍棋、日麻與再戰 command 分派
└─ shared/ + lib/：權威規則與日麻伺服器對局
```

### 2.1 一般棋類的資料流

```text
使用者點擊棋盤
→ public/app.js（來源為 src/client/app.ts）取得操作
→ engine.js 的 legalMoves() 驗證合法走法
→ applyMove() 產生下一個狀態
→ public/app.js 重新 render
→ 若是 AI 回合，交給 ai-worker.js
```

一般棋局以狀態物件表示，包含棋盤、回合、勝負、歷史、重複局面等資訊。`applyMove()` 會複製狀態後再套用操作，避免直接修改上一個局面。

### 2.2 一般棋類的線上資料流

```text
瀏覽器送出 move + ply
→ src/server/server.ts 檢查房間、玩家回合與版本
→ src/server/server.ts 再次執行 applyMove()
→ 更新伺服器狀態
→ broadcast() 傳給所有玩家
```

伺服器是線上對局的權威來源，不信任客戶端傳來的棋局結果。

### 2.3 日麻資料流

日麻不使用一般棋類的 `legalMoves()`／`applyMove()` 流程，而是由 `@kobalab/majiang-core` 推動事件狀態機：

```text
majiang-core 推進牌局事件
→ RiichiSession 產生每個座位的合法選項
→ 真人選擇 action ID，AI 由 majiang-ai 回應
→ session 驗證座位與 action 是否有效
→ 回傳每個座位的私有 view
```

日麻的暗牌只會出現在對應座位的 view 中，不會把完整 `Game.model` 傳給瀏覽器。

---

## 3. 檔案分層與用途

### `public/`：瀏覽器可直接載入的檔案

- `index.html`：頁面骨架、大廳、棋盤與日麻牌桌容器
- `style.css`：桌面版、手機版與所有視覺樣式
- `src/client/app.ts`：前端應用流程、模式切換、狀態管理與 WebSocket 原始碼
- `app.js`：由 `src/client/app.ts` 建置出的瀏覽器 bundle
- `engine.js`：由 `src/shared/engine.ts` 建置出的瀏覽器規則 bundle
- `shogi.js`：由 `src/shared/shogi.ts` 建置出的將棋 bundle
- `ai.js`：一般棋類 AI 決策
- `ai-worker.js`：由 `src/client/ai-worker.ts` 建置的一般棋類 AI 背景執行介面
- `riichi-ui.js`：由 `src/client/riichi-ui.ts` 建置出的日麻 UI 渲染 bundle
- `riichi-worker.js`：由 `src/riichi-worker.ts` 打包產生的瀏覽器成品
- `vendor/`：瀏覽器端第三方檔案與授權檔

`public/` 是瀏覽器可直接載入的成品。伺服器不再反向載入 `public/`，而是直接使用 `src/shared/`；因此 `public/` 的 bundle 可以被清除後重新產生，不是規則原始碼的唯一來源。

### `lib/`：可被多個執行環境使用的核心模組

`lib/riichi-session.ts` 包裝日麻核心引擎，會被：

- Node.js 線上伺服器使用
- `src/riichi-worker.ts` 引用並打包到瀏覽器 Worker

因此它不是純粹的 server-only 程式，而是共享的日麻 session 核心。

### `src/`：需要建置或由 `tsx` 執行的來源碼

`src/shared/` 放置前後端共用的狀態、訊息型別與棋規；`src/server/` 由 `server.ts` 組裝 HTTP、WebSocket、房間與 command protocol 模組。`src/riichi-worker.ts` 是本機日麻 Worker 的來源檔，仍使用 npm 套件，必須先由 esbuild 打包才能在瀏覽器執行。

```text
src/shared/engine.ts ─┐
src/shared/shogi.ts  ├─ npm run build
src/riichi-worker.ts ┘
        ↓ npm run build
public/engine.js / public/shogi.js / public/riichi-worker.js
```

修改日麻 Worker 時應修改 `src`，不要直接修改打包後的 `public/riichi-worker.js`。

### `scripts/`：建置工具

`scripts/build.ts` 只在開發或部署時執行，負責：

- 打包 shared 與 client TypeScript bundle
- 打包日麻 Worker
- 將 npm 依賴轉成瀏覽器可執行格式
- 複製第三方授權檔

### `test/`：規則與整合測試

- `engine.test.ts`：一般棋類共用規則
- `shogi.test.ts`：將棋特殊規則
- `riichi.test.ts`：日麻合法選項、計分與暗牌隔離
- `riichi-worker.test.ts`：本機日麻 Worker
- `server.test.ts`：HTTP、WebSocket 房間、重連與權威驗證

---

## 4. 各棋種的遊玩與 AI 演算法

### 4.1 將棋

#### 遊玩規則

- 使用 `9 × 9` 一維陣列保存棋盤
- 正負號代表兩方
- `hands` 保存被吃棋子形成的持駒
- `attacks()` 產生棋子的移動範圍
- `shogiMoves()` 產生棋盤移動與持駒打入
- 套用走法前檢查不能讓自己的玉被將軍
- 處理升變、二步、無行處打入與打步詰
- 四次重複局面判定千日手
- 連續王手的千日手判定王手方負

#### AI

使用自製 minimax + alpha-beta pruning。

評估因素：

- 各棋種子力
- 棋子位置與中心控制
- 持駒價值
- 勝負終局分數

目前沒有使用專業將棋引擎、定跡庫、置換表或深度學習模型。

### 4.2 日式麻將

#### 遊玩規則

使用 `@kobalab/majiang-core` 處理：

- 配牌、摸牌、捨牌
- 吃、碰、槓
- 立直、榮和、自摸
- 振聽、流局、連莊
- 役種、符番、分數與順位

`RiichiSession` 負責建立四人 session、產生合法 action、驗證座位與 action ID、管理暫停／重連，以及產生各座位的私有視圖。

#### AI

使用外部 `@kobalab/majiang-ai` 的 `MahjongAI`。

本專案沒有重新實作麻將 AI 的牌效演算法，因此不應把它描述成自製 minimax 或 MCTS。專案自行實作的是 session 包裝、操作驗證與資訊隔離。

### 4.3 西洋棋

#### 遊玩規則

使用內嵌的 `chess.js` 處理：

- 合法走法
- 將軍與將死
- 王車易位
- 吃過路兵
- 升變
- 三次重複與五十步和局

局面以 FEN 保存，`engine.js` 將 `chess.js` 的走法轉換成專案自己的走法格式。

#### AI

AI 是自製 minimax + alpha-beta，評估：

- 各棋子子力
- 兵的前進程度
- 非王棋子的中心控制
- 終局勝負

`chess.js` 是規則引擎，不是 AI 引擎。專案沒有使用 Stockfish 或其他專業西洋棋引擎。

### 4.4 象棋

#### 遊玩規則

自行實作偽合法走法與合法性過濾：

- 馬的蹩馬腿
- 象的塞象眼與不能過河
- 炮的炮架
- 九宮限制
- 將帥照面
- 將死與困斃
- 三次重複局面

流程是「先產生基本走法，再模擬移動，最後檢查己方是否被將軍」。

#### AI

使用自製 minimax + alpha-beta，評估：

- 各棋子子力
- 兵／卒前進與過河程度
- 中央控制
- 終局勝負

沒有使用外部象棋引擎。

### 4.5 西洋跳棋

#### 遊玩規則

- 產生普通斜向移動與跳吃
- 有吃子時強制吃子
- 吃子後若仍可跳，保存 `forced` 棋子並繼續連跳
- 抵達底線升王
- 升王後立即結束該回合
- 80 個無吃子或升王的半回合判和

#### AI

使用自製 minimax + alpha-beta，評估：

- 王的價值
- 普通棋子價值
- 接近升王線的程度
- 強制連跳後的局面

AI 的搜尋會呼叫同一套 `applyMove()`，因此能正確處理連跳狀態。

### 4.6 五子棋

#### 遊玩規則

每次落子後，只需要以最後一手為中心，檢查四個方向：

- 垂直
- 水平
- 右下斜線
- 左下斜線

連成五顆以上即勝，棋盤全滿則和局。

#### AI

使用啟發式評分，不使用完整 minimax。

主要方法：

- 第一手偏好中心
- 只考慮現有棋子附近兩格內的位置
- 計算連續棋子數
- 計算連線兩端是否開放
- 同時評估自己的進攻與對手威脅
- 依難度加入隨機噪聲

目前沒有威脅空間搜尋、開局庫或神經網路。

### 4.7 圍棋

#### 遊玩規則

使用群組與氣的走訪演算法：

- `group()` 以 BFS／DFS 找出相連棋群
- 計算棋群的氣
- 落子後檢查相鄰敵方棋群並提子
- 禁止自殺
- 使用盤面 key 防止位置重複
- 連續兩次 pass 後進入數子
- 使用 flood fill 找空區域並進行面積計分

#### AI

使用自製局部啟發式評分 `goRank()`，考慮：

- 提子數量
- 是否救到只剩一口氣的己方棋群
- 新棋群的氣
- 是否造成自殺風險
- 周圍敵我棋子
- 中央位置
- 後期是否應該 pass

目前不是 KataGo、AlphaGo、Monte Carlo Tree Search 或神經網路圍棋 AI，因此全局棋力有限。

### 4.8 黑白棋

#### 遊玩規則

`flips()` 從落點往八個方向搜尋：

```text
自己的棋子 → 連續對手棋子 → 自己的棋子
```

符合條件時，將中間棋子全部翻面。無合法走法時自動跳過，雙方都無法落子時結束。

#### AI

使用自製 minimax + alpha-beta，評估：

- 角落：高價值
- 邊線：正價值
- 靠近角落但不是角落：負價值
- 中央位置：低正價值

目前沒有完整 mobility、frontier、parity 或終局精確搜尋。

---

## 5. 技術優化路線

### P0 的 TS-first 實作順序

P0 不採取「先把所有檔案改名成 `.ts`，最後才處理型別」的方式，而是先建立可持續的編譯與品質門檻，再依照依賴方向遷移：

```text
TS 工具鏈與 CI
→ shared state／message 型別
→ 一般棋類 domain
→ server 與房間服務
→ AI 與 Worker
→ client UI
→ 測試全部轉 TS
```

預計新增：

- `tsconfig.json`：NodeNext、strict、noImplicitOverride 與 noUncheckedIndexedAccess
- ESLint TypeScript 規則
- `tsx`：開發與 TypeScript 測試執行
- `@types/node`、`@types/ws` 與外部套件的 typed facade
- client／server／Worker 的 esbuild entry points
- CI 的 typecheck、lint、format、build、unit／integration gate

### P0 測試策略

依照風險分層：

| 層級        | 防線                                | 目標                                    |
| ----------- | ----------------------------------- | --------------------------------------- |
| Static      | TypeScript strict、ESLint、Prettier | 捕捉型別、匯入與低階錯誤                |
| Unit        | `node:test`                         | 純棋規、validator、reducer、AI 評分邏輯 |
| Integration | Node/WebSocket 與瀏覽器互動測試     | 驗證狀態流、房間與使用者操作結果        |
| E2E         | Playwright                          | 少量關鍵流程，例如建立房間、對局、重連  |
| Visual      | Playwright screenshot（可選）       | 只在棋盤與響應式版面成為主要風險時啟用  |

核心原則是測可觀察行為，而不是測函式內部實作。例如 UI 測試應驗證玩家點擊合法位置後棋盤、回合提示與歷史紀錄的變化，不應只驗證某個內部變數被設定。

### P0：可靠性與可維護性

#### 5.1 重新整理共享程式

目前已改為 `src/server/game-protocol.ts` 直接引用 `src/shared/engine.ts`，瀏覽器則載入建置後的 `public/engine.js`。`src/server/server.ts` 只負責組裝 HTTP、WebSocket 與房間服務。目錄責任是：

```text
src/
├─ client/
├─ server/
├─ shared/
└─ types/

lib/
└─ riichi-session.ts

public/
└─ build assets
```

將棋規、一般棋規與 state 放入 `shared/`，由 client 與 server 共用；`public/` 只保留瀏覽器成品。

#### 5.2 加入型別與訊息 schema（P0 已落地）

由 `src/shared/protocol.ts` 與 `src/shared/game-types.ts` 明確定義：

- 各棋種的 state
- `move` 格式
- WebSocket message
- 日麻 action
- 房間與玩家資料

#### 5.3 拆分伺服器責任

P0 已完成 `src/server/server.ts` 的 TS 化與訊息邊界驗證，並將原本的單檔房間服務拆成：

```text
src/server/
├─ http-server.ts
├─ websocket-server.ts
├─ room-manager.ts
├─ game-protocol.ts
├─ room-types.ts
└─ server.ts
```

#### 5.4 強化測試品質

目前已有規則與 WebSocket 整合測試，並已支援可注入的 deterministic AI seed；後續可增加：

- 每種棋的規則契約測試
- property-based testing
- AI 必須永遠回傳合法走法
- 隨機局面測試
- 瀏覽器 E2E 測試
- UI visual regression
- CI 自動執行測試與格式檢查

#### 5.5 線上資料持久化

目前房間存在單一 Node 程序記憶體中。若要正式公開，需要考慮：

- Redis 或資料庫保存房間與 session
- 多實例同步
- 伺服器重啟後恢復對局
- 房間 TTL 與清理策略
- WebSocket rate limit 與 abuse protection

### P1：提升 AI 品質

共用 AI 搜尋可以加入：

- iterative deepening
- transposition table
- move ordering
- killer move／history heuristic
- time budget

棋種專屬方向：

- 西洋棋：quiescence search、開局資料、專業 WASM 分析模式
- 將棋：持駒攻王評估、定跡、將軍強制搜尋
- 象棋：王安全、炮與車的戰術評估
- 跳棋：連跳排序與終局資料
- 五子棋：活三／活四、威脅空間搜尋、禁手選項
- 圍棋：MCTS、劫材、死活與全局領地評估
- 黑白棋：mobility、frontier、parity 與終局精確搜尋
- 日麻：不同 AI 風格、牌效提示與賽後復盤

### P2：遊戲可玩性

#### 5.6 回放與棋譜

增加：

- 上一步／下一步
- 對局時間軸
- 棋譜匯出
- 對局分享連結
- AI 對局回放

可依棋種採用不同格式：

- 西洋棋：PGN
- 圍棋：SGF
- 其他棋種：自訂 JSON replay

#### 5.7 每日挑戰與謎題

- 西洋棋：一步將殺
- 將棋：詰將棋
- 象棋：殘局題
- 圍棋：死活題與手筋題
- 五子棋：唯一防守
- 黑白棋：角落與翻轉題
- 日麻：最佳打牌與牌效題

#### 5.8 AI 人格

除了難度，可以加入：

- 穩健型
- 進攻型
- 防守型
- 冒險型
- 隨機型
- 教學型

每種人格可使用不同的評估權重、搜尋預算與隨機性。

#### 5.9 教學與賽後分析

可以在走法後顯示：

- 被攻擊的棋子
- 目前最大威脅
- 為什麼這一步不理想
- AI 建議的替代走法
- 目前局勢摘要

### P3：產品化

#### 5.10 帳號與社交

- 訪客轉正式帳號
- 好友清單
- 公開配對
- 對局歷史
- ELO／Glicko 評分
- 排行榜
- 觀戰模式
- 比賽房間
- 對局時鐘

#### 5.11 使用體驗

- PWA 安裝與離線模式
- 深色模式
- 音效與落子動畫
- 棋盤與棋子主題
- 鍵盤操作
- 螢幕閱讀器支援
- 多語系

#### 5.12 商業化

較適合的方向：

- 付費棋盤與棋子外觀
- 進階 AI 分析
- 個人戰績頁
- 每日挑戰與賽季
- 主題收藏

應避免販售直接影響勝率的能力，維持線上對戰公平性。

---

## 6. 建議實作順序

### 第一階段：工程基礎

1. 將共享棋規移到明確的 `shared/` 層
2. 建立 state 與 WebSocket message schema
3. 加入 deterministic AI seed（P0 已完成）
4. 增加 CI、格式檢查與 E2E 測試（CI／格式已完成，E2E 待補）
5. 拆分 `src/server/server.ts`（P0 已完成）

### 第二階段：核心可玩性

1. 對局回放
2. 棋譜匯出與分享
3. 每日謎題
4. AI 人格
5. 賽後分析與教學提示

### 第三階段：棋力升級

1. 一般 minimax 加入 iterative deepening 與 transposition table
2. 五子棋加入威脅搜尋
3. 黑白棋加入 mobility 與終局搜尋
4. 圍棋導入 MCTS 類方法
5. 日麻加入策略等級與復盤功能

### 第四階段：正式產品

1. 帳號與登入
2. 對局持久化
3. 公開配對與評分
4. 觀戰與比賽
5. 監控、日誌、限流與多實例部署

---

## 7. 設計原則

後續擴充時建議維持以下原則：

1. 規則驗證永遠由權威核心負責，不能只相信 UI。
2. AI 只負責選擇走法，不能繞過合法走法驗證。
3. 前端畫面不應直接修改棋局狀態，應透過 command 或 reducer 更新。
4. 每個棋種應有獨立的規則契約測試。
5. Worker 與伺服器之間的資料應使用明確格式。
6. 產品化前先補上回放、帳號、持久化與錯誤追蹤。
7. 保留簡單 AI 作為快速模式，再逐步增加高棋力分析模式。

## 8. 最值得優先完成的三項功能

如果只選三項，建議依序實作：

1. 對局回放、棋譜匯出與分享
2. AI 人格、提示與賽後分析
3. 帳號、戰績、公開配對與持久化房間

這三項可以同時提升可玩性、留存率、社群分享能力，以及未來產品化的基礎。
