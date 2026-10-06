# crhhaa-mods

在 Claude Code 輸入框上方放一條**股票看板**：台股時段顯示台股、美股時段顯示美股，紅漲綠跌（台股）／綠漲紅跌（美股），價格自動更新（台股延遲數秒到 30 秒左右，詳見[報價來源](#4-報價來源)），不花任何模型 token。

> 本專案 fork 自 [darrell-tw/darrelltw-mods](https://github.com/darrell-tw/darrelltw-mods)（MIT 授權），原作者 Darrell Wang。
> 這個版本多了：雙欄也顯示**漲跌金額（變更$）**與**成交量（量）**、台股預設走**證交所 MIS 報價**（不用帳號，延遲只有幾秒到 30 秒，Yahoo 則是 20 分鐘）、`/stock` **側欄模式**，以及兩個新 mod。

這個 repo 有四個 mod，可以分開裝：

| mod | 做什麼 |
| --- | --- |
| `tw-stock-mod` | 股票看板（本文第 1～6 節） |
| `ai-news-ticker` | AI 新聞跑馬燈，見[第 7 節](#7-ai-新聞跑馬燈ai-news-ticker) |
| `token-usage` | token 用量卡畫在 `/stock` 側欄，側欄關著時改印在狀態列，見[第 8 節](#8-token-用量token-usage) |
| `change-card` | 改動卡：Claude 改了哪些檔、子代理有沒有卡住，畫在 `/stock` 側欄看板下方，見[第 9 節](#9-改動卡change-card) |

```
 台股 ▾  ☀ 盤中 09:00-13:30                                     [趨勢圖] [收起 30分]
 代號                                             價格      變更$   ↓變更%        量
 ───────────────────────────────────────────────────────────────────────────────────
 2317    鴻海                                   212.50      +4.50 ▲ +2.16%    48,213
 2882    國泰金                                  71.30      +0.70 ▲ +0.99%    15,872
 2412    中華電                                 131.50      +0.50 ▲ +0.38%     6,120
 1301    台塑                                    45.85      -0.55 ▼ -1.19%    11,207
 2603    長榮                                   188.00      -2.50 ▼ -1.31%     9,342
 加權 46,051.32 ▲ +188.80 +0.41%     13:12:25 ● 證交所 延遲 · v0.13.4-crhhaa.4 · crhhaa
```

（示意圖，數字為虛構）

---

## 1. 安裝

### 需求

- **Claude Code 2.1.269 以上**（`claude --version` 查）
- **一般終端機**：macOS 的 iTerm2、Terminal.app 都可以。`claude -p`、桌面版、手機版**不會顯示**
- 不用帳號、不用 API 金鑰

### 步驟

**① 打開 function hooks**：編輯 `~/.claude/settings.json`，加入下面這段（如果已經有 `env`，就把這一行合併進去）：

```json
{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
```

**② 安裝**：在終端機執行：

```sh
claude plugin marketplace add crhhaa/crhhaa-mods
claude plugin install tw-stock-mod@crhhaa-mods --scope user

# 選用
claude plugin install ai-news-ticker@crhhaa-mods --scope user
claude plugin install token-usage@crhhaa-mods --scope user
claude plugin install change-card@crhhaa-mods --scope user
```

**③ 完全關掉 Claude Code 再重開**，輸入框上方就會出現看板。

> 沒設自選股之前，會先顯示內建的台股／美股各 20 檔。

---

## 2. 設定自選股

有兩種方法，選一個就好。

### 方法 A：讓 Claude 幫你設（最簡單）

在 Claude Code 裡輸入：

```
/tw-stock-mod:stock-band-setup
```

告訴它你要哪些股票，它會先**逐檔確認代號查得到報價**、自動判斷上市或上櫃，再幫你寫好設定檔。

### 方法 B：自己寫設定檔

建立（或編輯）`~/.claude/stock-band.json`：

```json
{
  "tw": [
    { "code": "2330" },
    { "code": "2454" },
    { "code": "0050" },
    { "code": "6488", "ex": "otc" }
  ],
  "us": [
    { "code": "NVDA", "name": "NVIDIA" },
    { "code": "AAPL", "name": "Apple" },
    { "code": "QQQ",  "name": "Invesco QQQ" }
  ]
}
```

存檔後幾秒內就會更新，沒變的話在 Claude Code 裡執行 `/reload-plugins`。

#### 欄位說明

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `code` | ✅ | 股票代號。台股寫數字（`2330`），美股寫英文代號（`NVDA`） |
| `name` | | 顯示的名稱。**台股可以不寫**，會自動用證交所回傳的中文名；美股建議寫，不寫就只顯示代號 |
| `ex` | 上櫃必填 | **上櫃股票一定要加 `"ex": "otc"`**（例如 6488 環球晶），不然會一直沒有價格。上市股票不用寫 |

#### 小提醒

- **每個市場最多 20 檔**，超過的會被忽略
- `tw` 和 `us` 是分開的兩份清單，**只寫其中一份也可以**，沒寫的那份會用內建清單
- 不知道某檔是上市還是上櫃？用方法 A，Claude 會幫你查
- 還有一份加密貨幣清單（`"crypto": [{ "code": "BTC" }, …]`，報價來自 Pionex），用法一樣

---

## 3. 看板怎麼用

### 版面會隨終端機寬度改變

```
終端機寬度        顯示方式
──────────────────────────────────────────────────────────────
≥ 119 欄         雙欄：一頁 10 檔，每檔都有 價格／變更$／變更%／量
< 119 欄         單欄：一頁 5 檔，超過的每 10 秒自動翻頁
很窄的時候        單欄，先拿掉「量」，再拿掉名稱
```

在終端機輸入 `tput cols` 可以查目前寬度。

### 欄位

| 欄位 | 意思 |
| --- | --- |
| 價格 | 最新成交價 |
| 變更$ | 跟昨天收盤比漲跌多少錢 |
| 變更% | 漲跌幅，預設照這欄排序（`↓` 代表正在用它排序） |
| 量 | 今天累積成交量。台股單位是**張**；美股是**股**，用 K／M 縮寫（35.0M = 3,500 萬股）。加密貨幣顯示的是 24 小時成交額（標題寫「額」） |

### 按鈕

- **`台股 ▾` / `美股 ▾`**：切換市場。平常會自動依時間切換：台股開盤顯示台股，美股開盤顯示美股
- **`翻頁`**：自選股超過一頁時才會出現
- **`趨勢圖`**：把表格換成單一股票的 5 分 K 線，用 `◀ 上一檔` / `下一檔 ▶` 切換股票，`回清單` 回到表格
- **`收起 30分`**：暫時把看板收起來 30 分鐘

### footer 右下角

```
13:12:25 ● 證交所 延遲 · v0.13.4-crhhaa.4 · crhhaa
   │     │      │              │
   │     │      │              └─ 版本號：確認自己跑的是哪一版
   │     │      └─ 報價來源：證交所 延遲／Yahoo 延遲／Yahoo 即時（美股），見下一節
   │     └─ 每收到一次新報價會閃一下
   └─ 交易所時間（收盤後顯示「收盤 13:30」）
```

如果 footer 寫的是 **`示範資料（未接 API）`**，代表抓不到報價，畫面上的數字是假的。

### footer 左下角的指數

每張卡片顯示 指數值、漲跌點數、漲跌幅，例如 `加權 48,407.44 ▲ +53.95 +0.11%`。

台股預設有 4 個指數：加權、半導體、金融、航運。**寬度放得下就全部並排顯示，放不下就每 5 秒輪流翻一個**。想改成自己要的，在 `~/.claude/stock-band.json` 加 `twIndices`：

```json
{
  "twIndices": [
    { "code": "t00" },
    { "code": "TXF", "ex": "futures" }
  ]
}
```

上面這個設定會同時顯示加權指數和台指期：

```
加權 48,453.27 ▲ +99.78 +0.21%   台指期 48,775.00 ▲ +77.00 +0.16%
```

並排的時候，右邊的時間、版本號會先讓出空間，只保留報價來源。常用代號：

| code | 指數 | 備註 |
| --- | --- | --- |
| `t00` | 加權指數 | |
| `t24` | 半導體類 | |
| `t17` | 金融保險類 | |
| `t15` | 航運類 | |
| `o00` | 櫃買指數 | 要加 `"ex": "otc"` |
| `TXF` | 台指期（近月） | 要加 `"ex": "futures"`，資料來自期交所 |

**台指期**有夜盤（15:00～隔天 05:00），所以台股收盤後它還會繼續跳動，晚上可以看出市場對隔天的預期。交易時段內跟著看板一起更新；不在交易時段時，每 10 分鐘確認一次收盤價。台指期固定排在最後。

名稱不寫的話會用上表的中文名（加權、半導體、金融、航運、台指期），想自訂就加 `"name": "…"`。

---

## 4. 報價來源

| 市場 | 來源 | footer 顯示 | 大約落後多久 |
| --- | --- | --- | --- |
| 台股 | 證交所 MIS（預設） | `證交所 延遲` | **幾秒到 30 秒左右** |
| 台股 | Yahoo（MIS 沒回應時自動改用） | `Yahoo 延遲` | 約 20 分鐘 |
| 美股 | Yahoo | `Yahoo 即時` | 幾秒到 30 秒左右 |
| 加密貨幣 | Pionex | `Pionex 即時` | 幾秒到 30 秒左右 |

### 為什麼證交所也不是即時？

```
證交所撮合 ──▶ MIS 網頁資料 ──▶ 看板去抓 ──▶ 畫面
              約每 5 秒更新      每 30 秒抓一次
```

證交所的 MIS 是公開的看盤網頁資料，本身大約每 5 秒更新一次；看板再每 30 秒去抓一次，**所以畫面上的價格會落後幾秒到 30 秒左右**（footer 的 `· 10s` 是距離下次抓取的倒數）。這對「瞄一眼看漲跌」夠用，但**不適合拿來搶短線進出**。

抓取間隔不能再調短：證交所對太頻繁的請求會封鎖 IP，原作者把下限設在 15 秒就是為了避免這個問題。

### 想要真正的即時（逐筆）：接券商 API

要拿到真正即時的報價，要透過券商的 API。這個看板內建支援兩家：

| 券商 | 系統 | footer 顯示 |
| --- | --- | --- |
| 永豐金證券（Shioaji） | macOS／Linux | `永豐 即時` |
| 群益證券（Capital） | Windows | `群益 即時` |

以 Mac 常用的永豐為例，你需要：

1. **永豐金證券帳戶**
2. 在永豐官網**申請開通 API**，取得 API Key 和 Secret Key
3. 到永豐的**簽署中心通過「Python API 測試」**（沒通過的話，登入時會出現 HTTP 406）
4. 電腦上要有 **Python 3.12 或 3.13**，並安裝 `shioaji` 套件

都準備好之後，在 Claude Code 裡說「**我要接永豐**」，Claude 會一步步帶你設定（金鑰放在哪裡、怎麼測試、怎麼寫進設定檔）。詳細技術說明見 [quote-sources.md](mods/tw-stock-mod/references/quote-sources.md)。

> 註：看板預設每 10 秒向永豐取一次快照（可以調整），所以畫面上不會每一筆成交都跳動，但資料本身是即時的，不會像 MIS 那樣多一層網頁更新的延遲。

### 斷網的時候

抓不到報價時，看板會保留最後一次的價格，過一陣子改顯示 `示範資料`，網路回來後自動恢復。斷網類的錯誤（DNS 查不到、連不上）**不會在對話裡印 log**，其他錯誤（例如 HTTP 429）還是會顯示。

---

## 5. 庫存損益（選用）

在 `~/.claude/stock-band.json` 加一個 `holdings` 區塊，市場按鈕的循環就會多出「台股庫存」這一站，顯示每檔的損益：

```json
{
  "tw": [ { "code": "2330" } ],
  "holdings": {
    "tw": [ { "code": "2330", "name": "台積電", "qty": 1000, "cost": 1800 } ],
    "us": []
  }
}
```

`qty` 是**股數**（1 張 = 1000 股），`cost` 是每股成本。

---

## 6. 側欄模式（`/stock`）

在 Claude Code 裡輸入 `/stock`，看板會從輸入框上方移到對話旁邊的側欄；再輸入一次 `/stock`（或按側欄的關閉）就移回輸入框上方。

- 側欄會依高度一頁排滿自選股，不用一直翻頁
- 開關狀態會記住，下次開 Claude Code 會自動打開側欄
- 有裝 `ai-news-ticker`、`token-usage`、`change-card` 的話，它們會疊在側欄裡：

```
┌ 股票 ──────────────────────┐
│ AI 新聞卡（ai-news-ticker） │
│ TOKEN USAGE（token-usage）  │
│ 股票看板                    │
│ 改動（change-card）         │
└────────────────────────────┘
```

**只想在側欄看：** 在 `~/.claude/stock-band.json` 加 `"band": false`，側欄關著時輸入框上方就不畫看板，也不畫 AI 新聞；要看就打 `/stock`。

```json
{
  "band": false
}
```

---

## 7. AI 新聞跑馬燈（ai-news-ticker）

每 15 分鐘抓一次 Google 新聞的 AI 新聞（近 24 小時、繁中），每 20 秒換一則，可以按按鈕在瀏覽器開啟原文。

- `/stock` 側欄開著：畫在側欄最上面
- 側欄沒開：畫在輸入框上方（`~/.claude/stock-band.json` 寫 `"band": false` 就不畫，見第 6 節）

不用帳號、不用設定。

---

## 8. token 用量（token-usage）

`/stock` 側欄開著時，在看板上方畫一張用量卡：

```
TOKEN USAGE                                    13:05
▶ claude    5h  ●●○○○○○○○○  18% @ 17:00  3h55m
            7d  ●○○○○○○○○○   9% @ 10/13 06:00  6d17h
            ctx ●●●○○○○○○○  31%  62k/200k  $1.20
  claude-b  5h  ●●●●●●●○○○  72% @ 15:30  2h25m
            7d  ●●●○○○○○○○  30% @ 10/11 22:00  5d9h
```

（示意圖，數字為虛構）

| 行 | 意思 |
| --- | --- |
| `5h`／`7d` | 5 小時、7 天額度用了幾 %，`@` 後面是重置時間，最後是倒數 |
| `ctx` | 這個對話的 context 用量，後面是花費（有的話） |

顏色：90% 以上紅、70% 以上亮黃，其他是淡紫。

**側欄關著時改畫在狀態列（選用）：** mod 附一支 `statusline.mjs`，照 claude-hud 的寫法把 Context 和每個帳號的用量排成一張對齊的表：

```
Context    ■■■■■■■■■■  12%
▶claude    ■■■■■■■■■■  18% (3h 55m / 5h)   ■■■■■■■■■■   9% (6d 17h / 7d)
claude-b   ■■■■■■■■■■  72% (2h 25m / 5h)   ■■■■■■■■■■  30% (5d 9h / 7d)
```

長條 10 格，亮的是用掉的、深灰的是剩的。正在用的帳號（和 Context）是淡紫色，別的帳號是灰色；70% 以上黃、90% 以上紅。

在你的 statusLine 腳本裡把 Claude Code 給的 stdin 轉給它（Context 從 stdin 讀；需要 Node）：

```bash
input=$(cat)
printf '%s' "$input" | node "$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/crhhaa-mods/token-usage/*/statusline.mjs | sort -V | tail -1)"
```

要「側欄開著就不畫」的話，從 statusLine 的 stdin 取 `session_id`，看 `~/.claude/stock-band/pane/<session_id>` 的內容：tw-stock-mod 在側欄開著時寫 `1`，關掉寫 `0`。狀態列平常只在有新訊息時重畫，在 statusLine 設定加 `"refreshInterval": 2` 才會在開關側欄後馬上跟上。

**數字從哪來、誰看得到：**

- 數字跟 Claude Code 狀態列是同一份（Claude Code 本機提供），**不打任何 API、不連網**
- 只存在你自己電腦的 `~/.claude/token-usage/`，不會進 repo，別人裝這個 mod 只會看到**他自己的**用量
- 唯一會「被看到」的情況是你分享螢幕或截圖時，卡片或狀態列正好在畫面上

**多個帳號：** 如果你用 `CLAUDE_CONFIG_DIR` 開第二個帳號（例如 `~/.claude-b`），兩邊各裝一份，卡片和狀態列都會把兩個帳號列出來，目前這個 Claude 用的那個標橘色 `▶`。

---

## 9. 改動卡（change-card）

回答兩件事：**Claude 這個 session 改了哪些檔**（主對話和子代理都算），**派出去的子代理有沒有卡住**。在 `/stock` 側欄的看板**下方**只佔一行：

```
● 2 進行中 ⚠ 1 卡住 · [ 改動 5 檔 › ]
  ⚠ Explore#2 同一個 Grep 重複 3 次
```

（示意圖）

- 沒有子代理在跑時，只剩 `[ 改動 N 檔 › ]`；什麼都沒改、也沒有子代理時不畫
- 卡住的子代理才會多列一行。算卡住的情況：同一個工具＋同樣參數連續 3 次、工具連續失敗 3 次、超過 3 分鐘沒有新動作（有工具正在跑時不算）
- 按 `[ 改動 N 檔 › ]` 開一個寬的「改動」Pane：
  - 上面是檔案清單，標出誰改的（`主對話`、`Explore#2`…）和 `+/-` 行數，按檔名切換
  - 下面是那個檔的內容，有兩種看法：`[ 差異 ]` 只列改到的地方和前後兩行，`[ 全文 ]` 列出整份檔案、改到的行標紅綠；都有行號。內容超出時，聚焦 Pane 後可以捲動
  - 最下面是子代理樹：誰派了誰、在做什麼、用了幾次工具、跑多久
- diff 是「第一次改這個檔之前」對比「現在」，所以你自己後來手動改的也會算進去
- Write／Edit／MultiEdit／NotebookEdit 直接記。**用 Bash 改的檔**（`sed -i`、`mv`、程式產生的檔…）靠每次 Bash 前後各看一次 git 工作目錄補抓，所以：只在 git repo 裡有效；Bash 之前就沒 commit 的檔，diff 會跟 HEAD 比（連你自己之前的改動一起算）；同時跑的 Bash 可能互相算到對方頭上；沒 commit 的檔超過 500 個就不補抓
- 只記這個 session；hot reload 或 resume 會接回來
- 不打 API、不連網、不花 token

子代理的部分改自 [OneWave-AI/claude-code-mods](https://github.com/OneWave-AI/claude-code-mods) 的 `swarm`（MIT），只留派生樹，拿掉了時間軸、訊息連線和活動紀錄。

---

## 10. 更新與移除

**更新到最新版：**

```sh
claude plugin marketplace update crhhaa-mods
claude plugin update tw-stock-mod@crhhaa-mods
claude plugin update ai-news-ticker@crhhaa-mods   # 有裝才需要
claude plugin update token-usage@crhhaa-mods      # 有裝才需要
claude plugin update change-card@crhhaa-mods       # 有裝才需要
```

更新完要重開 Claude Code，看 footer 的版本號有沒有變。

**移除：**

```sh
claude plugin uninstall tw-stock-mod@crhhaa-mods --scope user
claude plugin uninstall ai-news-ticker@crhhaa-mods --scope user
claude plugin uninstall token-usage@crhhaa-mods --scope user
claude plugin uninstall change-card@crhhaa-mods --scope user
claude plugin marketplace remove crhhaa-mods
```

---

## 11. 看不到看板？

依序檢查這四項（它們的症狀一模一樣：沒有看板，也沒有任何錯誤訊息）：

1. `claude --version` 要 **2.1.269 以上**
2. 在 Claude Code 裡輸入 `! echo $CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`，要印出 **`1`**。印出空白的話，回去做安裝步驟 ①
3. 改完 `settings.json` 要**完全關掉 Claude Code 再開**，`/reload-plugins` 不會重新讀取 `env`
4. 確認用的是一般終端機，不是 `claude -p`、桌面版或 VS Code 內建終端機（VS Code 尚未測試）

---

## 給開發者

```
.claude-plugin/marketplace.json   讓這個 repo 可以當 marketplace 安裝
mods/tw-stock-mod/                股票看板本體
  .claude-plugin/plugin.json      版本號在這裡，改 code 後記得 +1
  hooks/register.tsx              資料：報價、設定、分頁
  hooks/board.tsx                 畫面：表格版面
  scripts/dev/run-checks.sh       全部檢查，改完跑一次
  README.md                       完整技術文件（英文，原作者撰寫）
mods/ai-news-ticker/hooks/        AI 新聞跑馬燈
mods/token-usage/                 token 用量：hooks/ 畫側欄卡，statusline.mjs 印狀態列
mods/change-card/hooks/           改動卡
```

每個 mod 的版本號都在自己的 `.claude-plugin/plugin.json`。`hooks/register.test.ts` 要在 Claude Code 的測試環境（`claude-code/testing`）裡跑，直接用 `bun test` 會找不到模組。

```sh
bash mods/tw-stock-mod/scripts/dev/run-checks.sh   # 全部要 PASS
```

合併原作者的更新：

```sh
git fetch upstream
git merge upstream/main
```

## 致謝與授權

原作者 **Darrell Wang**（[@darrell_tw_](https://x.com/darrell_tw_)／[GitHub](https://github.com/darrell-tw)），這個看板的設計與絕大部分程式碼都出自他的 [darrelltw-mods](https://github.com/darrell-tw/darrelltw-mods)。

`change-card` 的子代理部分改自 [OneWave-AI/claude-code-mods](https://github.com/OneWave-AI/claude-code-mods) 的 `swarm`（MIT，原授權見 `mods/change-card/LICENSE`）。

[MIT](LICENSE) 授權。
