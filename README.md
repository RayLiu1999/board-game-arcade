# 棋聚 QIJU

繁體中文棋類遊戲大全，提供八款可玩的遊戲、AI／同機／線上對戰與手機版排版。兩人棋類也支援競技私人房及公開配對。

## 啟動

需要 Node.js 22 或更新版本，以及 pnpm 10.16.0。在此資料夾執行：

```sh
pnpm install
pnpm start
```

開啟 **http://localhost:3000**。如需其他連接埠：

```sh
PORT=8080 pnpm start
```

本機、Docker、CI 與正式線上部署統一使用 pnpm，`pnpm-lock.yaml` 是唯一的依賴鎖檔，避免不同環境的套件版本漂移。專案會自動載入根目錄的 `.env`。第一次設定可參考 `.env.example`；請把實際的 PostgreSQL 連線字串填入 `.env`，不要提交該檔案。`DATABASE_URL` 用於正式啟動時保存房間 snapshot、玩家偏好、對局結果與最小事件，`QIJU_TEST_DATABASE_URL` 用於 PostgreSQL 整合測試，應指向獨立的測試資料庫：

```sh
# .env
DATABASE_URL='postgresql://user:password@host:5432/qiju'
QIJU_TEST_DATABASE_URL='postgresql://user:password@host:5432/qiju_test'
```

需要只套用 migration 時執行 `pnpm run migrate`。如果要清空目前 `DATABASE_URL` 中的 `qiju_*` 資料表並完整重建，執行 `pnpm run refresh`，互動時輸入 `REFRESH` 確認；非互動環境可用 `pnpm run refresh -- --yes`。refresh 會在同一個 transaction 內刪除並重建，migration 失敗時會 rollback；正式環境預設禁止執行，必須額外加上 `--allow-production`。

`pnpm run dev` 會在伺服器檔案變更時重新啟動。前端為原生 ES modules，伺服器與共用棋規以 TypeScript 維護，啟動與測試由 `tsx` 執行。日麻 Worker 與共用棋規 bundle 可由 `pnpm run build` 產生；安裝依賴後，執行時不載入 CDN 或外部服務。

### Docker Compose

需要 Docker Desktop 或其他相容 Docker Compose 的環境。Compose 會先啟動一次性的 `migrate` service，使用 `DATABASE_URL` 連線到外部 PostgreSQL 並執行 migration；成功後才啟動 Node.js 應用程式。Docker 內也使用 pnpm，與本機、CI 和線上部署一致：

```sh
cp .env.docker.example .env.docker
# 編輯 .env.docker，填入線上 PostgreSQL 的 DATABASE_URL
docker compose --env-file .env.docker up --build -d
```

開啟 **http://localhost:3000**。若要使用其他對外連接埠，將 `.env.docker` 的 `QIJU_PORT` 改成例如 `8080`。常用管理指令如下：

```sh
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --timestamps migrate
docker compose --env-file .env.docker logs --timestamps -f app
docker compose --env-file .env.docker down
```

如果已經在根目錄 `.env` 設定 `DATABASE_URL`，也可以直接執行 `docker compose up --build -d`。Compose 不會建立或管理 PostgreSQL volume；資料庫生命週期與備份由線上 PostgreSQL 服務負責。

如果 migration 失敗，`app` 不會啟動；可先查看 `migrate` log，修正資料庫連線或權限後重新執行 `docker compose --env-file .env.docker up --build -d`。app 啟動時仍會再次執行同一組可重複 migration，作為啟動時的安全檢查。

伺服器程式本身會以 UTC ISO 8601 格式為啟動與初始化錯誤加上時間戳，例如 `[2026-09-22T01:23:45.000Z]`。Docker 使用 `json-file` 保存容器 log，單一檔案上限 10 MB、最多保留 5 個檔案；`docker compose logs --timestamps` 會顯示 Docker 收集的時間。

### GitHub Container Registry

`.github/workflows/publish-image.yml` 會在 Pull Request 建置 image 但不發布；推送到 `main` 或 `v1.2.3` 格式的版本 tag 時，會自動發布：

```text
ghcr.io/rayliu1999/board-game-arcade:latest
```

`main` 會產生 `latest`、`main` 與 `sha-*` tags；版本 tag 會產生 `1.2.3`、`1.2`、`v1.2.3` 與 `sha-*` tags。要使用 GHCR image，先在 GitHub Actions 完成一次發布，再以現有 `.env` 的 `DATABASE_URL` 啟動：

```sh
docker pull ghcr.io/rayliu1999/board-game-arcade:latest
docker run --rm --name qiju \
  --env-file .env \
  -p 127.0.0.1:3000:3000 \
  ghcr.io/rayliu1999/board-game-arcade:latest
```

若 GHCR package 設為 private，部署主機需先以具有 `read:packages` 權限的 GitHub token 登入 `ghcr.io`；公開 package 則可直接 pull。Workflow 使用 GitHub Actions 內建的 `GITHUB_TOKEN` 與 `packages: write`，不需要把 registry token 寫進 repository。

正式啟動時若設定 `DATABASE_URL`，線上房間與產品化對局資料會使用 PostgreSQL；未設定時使用 memory store，適合本機開發。可用 `QIJU_ROOM_STORE=memory` 強制使用 memory store：

```sh
DATABASE_URL='postgresql://user:password@host:5432/qiju' pnpm start
```

PostgreSQL migration 會在伺服器啟動時自動初始化。日麻 live session 會以版本化 snapshot 保存，伺服器重啟後需真人重新連線才會繼續；已完成的一般棋類與日麻對局會另外保存 match、參與者與最小事件。線上模式會自動建立 HttpOnly guest session；也可以使用 `/api/me`、`/api/me/matches`、`/api/me/stats` 查詢自己的資料，或用 `/api/me/claim-room` 把既有 guest seat 綁定到身份。

## 棋種與規則

| 棋種     | 實作                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------- |
| 將棋     | 9×9、持駒打入、成與強制成、二步、無行處打入與打步詰禁止、王手與詰み、四次重複及連續王手千日手            |
| 日式麻將 | 四人立直、25000 起始點、赤寶牌、吃碰明暗加槓、立直、一發、振聽、役種、符番、流局與排名；單局／東風／半莊 |
| 西洋棋   | chess.js 規則，易位、過路兵、四種升變、將死、僵局、子力不足、五十步與三次重複自動和局                    |
| 象棋     | 蹩馬腿、塞象眼、象不過河、九宮、炮架、將帥照面、將死與困斃；三次重複判和                                 |
| 西洋跳棋 | 8×8 英美式，向前移動／跳吃、有吃必吃、強制連跳、升王後結束該回合                                         |
| 五子棋   | 15×15 自由規則，五連以上獲勝，無禁手                                                                     |
| 圍棋     | 9／13／19 路，提子、禁自殺、位置超劫、連續停手、死棋標記、雙方確認面積計分、白貼 6.5                     |
| 黑白棋   | 八方向翻子，無合法走法自動跳過，雙方無步可下後按子數結算                                                 |

將棋不實作入玉宣言及持將棋點數協議。象棋不實作競賽長將／長捉裁定。跳棋採休閒和局規則：80 半回合無吃子或升王、或三次重複局面判和。圍棋死活由玩家標記，不由引擎自動裁定；有爭議可按「繼續對局」，也支援雙活共同空點不計入任一方。這是休閒棋類合集，未宣稱正式比賽裁判相容。

## 對戰模式

- **AI 對戰**：七款棋提供三段難度、可選先後手，AI 在 Web Worker 中執行。西洋棋／象棋／將棋／跳棋／黑白棋使用有搜尋預算的 minimax 與 alpha-beta 剪枝；五子棋使用連線攻防評分；圍棋使用提子、氣與鄰接評分。日麻採用 `@kobalab/majiang-ai` 的獨立日麻策略（固定棋力），你與三位 AI 同桌。不是 Stockfish、Pikafish 或 KataGo，沒有棋力等級保證。AI 圍棋由玩家標記死棋並確認，AI 自動接受此標記。
- **同機模式**：棋類為兩位玩家輪流操作；日麻為四人交接裝置，切換座位前遮住手牌，點擊確認才顯示自己的牌，圍棋數子需先後按黑白雙方確認。
- **線上好友**：建立六碼私人房間，朋友輸入代碼或開啟邀請連結。棋類支援雙人，日麻支援四人（可 AI 補位）。伺服器驗證合法操作，全部真人同意後可再戰；棋類可認輸，日麻離席會暫停，不提供連線悔棋。
- **競技私人房**：七種兩人棋類可建立 rated 房間。伺服器在合法終局後以各棋種獨立的 ELO 分數結算；可透過 `/api/me/ratings` 查看自己的評分與戰績。
- **公開配對**：七種兩人棋類可選 rated 或 casual，依棋種與模式尋找對手。rated 配對會參考雙方分數，並隨等待時間放寬範圍；目前只提供不限時對局。等待 ticket 兩分鐘後到期，也可主動取消。佇列保存在單一伺服器記憶體，重新啟動後需重新排隊。

棋類 AI 與同機對局自動保存在瀏覽器，回大廳可繼續。悔棋快照只保留於本次對局記憶體，重新整理後不能回溯先前手數。

## 邀請朋友

### 同一個 Wi-Fi／區域網路

伺服器監聽 `0.0.0.0`。兩台裝置都使用伺服器電腦的區網網址，例如 `http://192.168.1.10:3000`；再建立／加入房間。防火牆需允許該連接埠。

`localhost` 只指向自己，不能直接把 localhost 連結分享給另一台裝置。請從區網網址開啟後再複製邀請連結。

### 不同網路

將整個 Node.js 專案部署到支援長連線 WebSocket 的主機，以 HTTPS 網址存取，反向代理需轉送 WebSocket Upgrade。無法只上傳 `public/` 到純靜態主機就獲得連線對戰。

有設定 `DATABASE_URL` 時，一般棋類房間與日麻 live session 都會保存於 PostgreSQL；伺服器重啟後，玩家需以原本的 room code 與座位 token 重新連線。所有真人皆離線後 30 分鐘清理。相同分頁重新整理或暫時斷線，會用 sessionStorage 的座位 token 重連；伺服器資料庫只保存 token hash，不要分享 token。主動按「返回大廳」離開會清除該分頁的重連資訊，已佔用的席位仍保留，需重新建立房間才能換人。

目前使用自動建立的 guest 身份，尚未提供正式帳號登入、排行榜、觀戰或對局時鐘。七種棋為兩人棋；日麻為四人桌，可混合真人與 AI。

## 日式麻將

- 使用 MIT 授權的 [majiang-core](https://github.com/kobalab/majiang-core) 1.4.1 與 [majiang-ai](https://github.com/kobalab/majiang-ai) 1.2.0。
- 玩法：點手牌直接打牌；立直用對應「立直」按鈕指定捨牌。吃／碰／槓／榮和／自摸只有合法時才顯示。有反應機會時必須作出操作或按「跳過」。
- 計分與順位由規則引擎處理。開啟赤寶牌、食斷、一發、裏寶牌、槓寶牌、雙響、三家和流局、途中流局、流局聽牌罰符、聽牌連莊與飛人；不延長至下一場。單局練習在一次和牌或流局結算後結束；東風／半莊依莊家連莊與終局規則進行。
- 線上四人房滿員自動開局，或由第一位房主按「以 AI 補齊並開局」。開局後不能替換 AI 座位。所有真人同意才會再戰。
- 伺服器保存完整牌山，各瀏覽器只收到自己的暗牌、各家公開副露／牌河／分數、合法選項與依法公開的和牌／聽牌結果；不傳送其他人的暗牌或牌山。
- 任一真人斷線會暫停整桌，原分頁用座位 token 重連後恢復。使用 PostgreSQL 時，日麻 session 也會保存版本化 snapshot；伺服器重啟後需真人重新連線才會繼續。
- 本機日麻由專用 Web Worker 執行，不提供悔棋或重新整理續局。離開本機牌桌前會提醒。
- 同機遮罩防止一般交接時看到他人的手牌，並非同一裝置上的防作弊安全機制。

日麻 Worker 已打包在 `public/riichi-worker.js`。修改 `lib/riichi-session.ts`、`src/riichi-worker.ts`、`src/shared/` 或更新套件後執行 `pnpm run build`。不需 CDN。

## 測試

```sh
pnpm test
pnpm run test:e2e
pnpm run test:postgres # 需設定 QIJU_TEST_DATABASE_URL
```

`pnpm test` 使用 Node 內建測試執行器，涵蓋棋規（含將棋打入／升變／打步詰）、七種棋的規則契約、可重現走訪、fast-check 合法路徑與 reachable random positions 測試、協定訊息邊界、日麻合法選項／無役與振聽／符番／結算／暗牌隔離、AI 合法走法、WebSocket 兩端同步、非法／過期落子、滿房、斷線重連、認輸、再戰與 HTTP 檔案邊界，也包含 PostgreSQL adapter、identity/session、match event idempotency、guest claim、歷史／統計、評分、公開配對與重啟恢復測試（未設定專用 DB 時各 1 項 skip）。`pnpm run test:postgres` 會執行需要真實 PostgreSQL 的 adapter 與 server restart 測試，請使用獨立測試資料庫設定 `QIJU_TEST_DATABASE_URL`。`pnpm run test:e2e` 會先建置瀏覽器 bundle，再用 Playwright 驗證私人房間與公開配對流程。整合測試會在本機開啟隨機連接埠；E2E 會啟動固定的 4173 連接埠。

## 程式結構

```text
src/server/server.ts     HTTP、WebSocket 與房間模組的組裝入口
src/server/http-server.ts 靜態檔案服務與 port parser
src/server/product-http.ts    guest session、個人資料、歷史與統計 API
src/server/websocket-server.ts WebSocket 連線生命週期與錯誤邊界
src/server/room-manager.ts 房間建立、廣播、日麻啟動與清理
src/server/game-protocol.ts client command 的權威分派
src/server/room-types.ts 房間、socket 與玩家 domain type
src/server/room-store.ts 持久化 snapshot contract 與 memory store
src/server/postgres-room-store.ts PostgreSQL migration、查詢與 revision CAS
src/server/room-store-factory.ts 依環境選擇 PostgreSQL 或 memory store
src/server/postgres-product-store.ts PostgreSQL identity、match、event 與 audit adapter
src/server/product-store.ts       User／Session／Match／Audit abstraction 與 memory adapter
src/server/product-identity.ts    guest identity、session authentication 與撤銷
src/server/product-security.ts    session token 產生、hash 與 constant-time 比對
src/server/postgres-migrations.ts 共用 PostgreSQL migration runner
pnpm-lock.yaml              本機、CI 與線上 pnpm 安裝鎖檔
scripts/migrate.ts         套用可重複執行的 migration
scripts/refresh.ts         清空並在 transaction 內重建 qiju_* 資料表
src/server/migrations/001-room-store.sql 房間與玩家資料表 migration
src/server/migrations/002-riichi-room-store.sql 日麻 snapshot 欄位 migration
src/server/migrations/003-product-foundation.sql identity、match、event 與 audit migration
src/server/migrations/004-user-preferences.sql 個人偏好 migration
src/shared/engine.ts     一般棋類共用規則與狀態轉移
src/shared/shogi.ts      將棋規則與持駒
src/shared/protocol.ts   WebSocket 訊息型別與 runtime parser
src/shared/game-types.ts 共用 state、move 與 scoring 型別
public/index.html        大廳、設定及對局畫面
public/style.css         桌機與手機排版
src/client/app.ts        前端流程、狀態管理與 WebSocket 原始碼
public/app.js            由 src/client/app.ts 產生的瀏覽器 bundle
public/engine.js         由 src/shared/engine.ts 產生的瀏覽器 bundle
public/shogi.js          由 src/shared/shogi.ts 產生的瀏覽器 bundle
lib/riichi-session.ts    日麻權威對局、合法選項與各座位私密視圖
src/types/majiang.d.ts   日麻第三方套件的最小 TypeScript API 宣告
src/client/riichi-ui.ts  日麻 UI renderer 原始碼
public/riichi-ui.js      由 src/client/riichi-ui.ts 產生的 UI bundle
src/riichi-worker.ts     本機日麻 Worker 來源
public/riichi-worker.js  已打包的日麻 Worker
scripts/build.ts         建置 shared/client bundle、日麻 Worker 與第三方授權
src/client/ai.ts         各棋種 AI 策略原始碼
public/ai.js             由 src/client/ai.ts 產生的瀏覽器 bundle
src/client/ai-worker.ts  背景 AI 訊息介面原始碼
public/ai-worker.js      由 src/client/ai-worker.ts 產生的 Worker bundle
public/vendor/chess.js   鎖定的 chess.js 1.4.0 瀏覽器模組
public/vendor/CHESS-LICENSE
test/                   棋規與真實 WebSocket 整合測試
test/e2e/room.spec.ts   Playwright 建立房間、加入房間與落子同步流程
```

chess.js 的瀏覽器版本已附於專案內（BSD-2-Clause 授權亦附上）。更新 chess.js 套件時，請同步更新 `public/vendor/chess.js` 與授權，並執行測試。依賴與 API 參考：[chess.js](https://github.com/jhlywa/chess.js)、[ws](https://github.com/websockets/ws)。
