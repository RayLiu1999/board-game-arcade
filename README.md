# 棋聚 QIJU

繁體中文棋類遊戲大全，提供八款可玩的遊戲、三種對戰模式與手機版排版。

## 啟動

需要 Node.js 22 或更新版本。在此資料夾執行：

```sh
npm ci
npm start
```

開啟 **http://localhost:3000**。如需其他連接埠：

```sh
PORT=8080 npm start
```

`npm run dev` 會在伺服器檔案變更時重新啟動。前端為原生 ES modules，伺服器與共用棋規以 TypeScript 維護，啟動與測試由 `tsx` 執行。日麻 Worker 與共用棋規 bundle 可由 `npm run build` 產生；安裝依賴後，執行時不載入 CDN 或外部服務。

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

棋類 AI 與同機對局自動保存在瀏覽器，回大廳可繼續。悔棋快照只保留於本次對局記憶體，重新整理後不能回溯先前手數。

## 邀請朋友

### 同一個 Wi-Fi／區域網路

伺服器監聽 `0.0.0.0`。兩台裝置都使用伺服器電腦的區網網址，例如 `http://192.168.1.10:3000`；再建立／加入房間。防火牆需允許該連接埠。

`localhost` 只指向自己，不能直接把 localhost 連結分享給另一台裝置。請從區網網址開啟後再複製邀請連結。

### 不同網路

將整個 Node.js 專案部署到支援長連線 WebSocket 的主機，以 HTTPS 網址存取，反向代理需轉送 WebSocket Upgrade。無法只上傳 `public/` 到純靜態主機就獲得連線對戰。

房間目前存在單一 Node 程序記憶體，伺服器重啟即清除，不支援跨多個實例同步。所有真人皆離線後 30 分鐘清理。相同分頁重新整理或暫時斷線，會用 sessionStorage 的座位 token 重連；不要分享 token。主動按「返回大廳」離開會清除該分頁的重連資訊，已佔用的席位仍保留，需重新建立房間才能換人。

尚未包含帳號、排行榜、公開配對、觀戰或對局時鐘。七種棋為兩人棋；日麻為四人桌，可混合真人與 AI。

## 日式麻將

- 使用 MIT 授權的 [majiang-core](https://github.com/kobalab/majiang-core) 1.4.1 與 [majiang-ai](https://github.com/kobalab/majiang-ai) 1.2.0。
- 玩法：點手牌直接打牌；立直用對應「立直」按鈕指定捨牌。吃／碰／槓／榮和／自摸只有合法時才顯示。有反應機會時必須作出操作或按「跳過」。
- 計分與順位由規則引擎處理。開啟赤寶牌、食斷、一發、裏寶牌、槓寶牌、雙響、三家和流局、途中流局、流局聽牌罰符、聽牌連莊與飛人；不延長至下一場。單局練習在一次和牌或流局結算後結束；東風／半莊依莊家連莊與終局規則進行。
- 線上四人房滿員自動開局，或由第一位房主按「以 AI 補齊並開局」。開局後不能替換 AI 座位。所有真人同意才會再戰。
- 伺服器保存完整牌山，各瀏覽器只收到自己的暗牌、各家公開副露／牌河／分數、合法選項與依法公開的和牌／聽牌結果；不傳送其他人的暗牌或牌山。
- 任一真人斷線會暫停整桌，原分頁用座位 token 重連後恢復。房間仍不持久化，伺服器重啟會清除。
- 本機日麻由專用 Web Worker 執行，不提供悔棋或重新整理續局。離開本機牌桌前會提醒。
- 同機遮罩防止一般交接時看到他人的手牌，並非同一裝置上的防作弊安全機制。

日麻 Worker 已打包在 `public/riichi-worker.js`。修改 `lib/riichi-session.js`、`src/riichi-worker.ts`、`src/shared/` 或更新套件後執行 `npm run build`。不需 CDN。

## 測試

```sh
npm test
```

Node 內建測試執行器：棋規（含將棋打入／升變／打步詰）、日麻合法選項／無役與振聽／符番／結算／暗牌隔離、AI 合法走法、WebSocket 兩端同步、非法／過期落子、滿房、斷線重連、認輸、再戰與 HTTP 檔案邊界。整合測試會在本機開啟隨機連接埠。

## 程式結構

```text
src/server/server.ts     HTTP 靜態檔案與權威 WebSocket 房間
src/shared/engine.ts     一般棋類共用規則與狀態轉移
src/shared/shogi.ts      將棋規則與持駒
src/shared/protocol.ts   WebSocket 訊息型別與 runtime parser
src/shared/game-types.ts 共用 state、move 與 scoring 型別
public/index.html        大廳、設定及對局畫面
public/style.css         桌機與手機排版
public/app.js            棋盤互動、儲存、AI 與房間生命週期
public/engine.js         由 src/shared/engine.ts 產生的瀏覽器 bundle
public/shogi.js          由 src/shared/shogi.ts 產生的瀏覽器 bundle
lib/riichi-session.js    日麻權威對局、合法選項與各座位私密視圖
lib/riichi-session.d.ts  日麻 JS 核心的 typed facade
public/riichi-ui.js      日麻牌桌、手牌、交接遮罩及結算
src/riichi-worker.ts     本機日麻 Worker 來源
public/riichi-worker.js  已打包的日麻 Worker
scripts/build.ts         建置 shared bundle、日麻 Worker 與第三方授權
public/ai.js             各棋種 AI 策略
public/ai-worker.js      背景 AI 訊息介面
public/vendor/chess.js   鎖定的 chess.js 1.4.0 瀏覽器模組
public/vendor/CHESS-LICENSE
test/                   棋規與真實 WebSocket 整合測試
```

chess.js 的瀏覽器版本已附於專案內（BSD-2-Clause 授權亦附上）。更新 npm 中的 chess.js 時，請同步更新 `public/vendor/chess.js` 與授權，並執行測試。依賴與 API 參考：[chess.js](https://github.com/jhlywa/chess.js)、[ws](https://github.com/websockets/ws)。
