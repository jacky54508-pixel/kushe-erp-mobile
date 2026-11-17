# P40-16AD｜正式 ERP PDF 驗證服務：唯讀架構與資料安全評估

**狀態：設計／測試契約草稿（READ-ONLY）。不可合併、不可部署、不可修改真實資料。**  
基準：正式 `main` = `2ab9c9d5944b1360ba3eebf49695713168caca8a`（2026-11-17）。  
範圍：單筆請款、一般合併請款、跨區合併請款的**對外** PDF；歷史保存版本需獨立隱私驗收。本案不改報價、薪資、應付、銀行、抽成、庫存、資料同步。

## 1. 直接從正式程式確認的現況

| 檔案 | 可核對的事實 | 架構意義 |
|---|---|---|
| `.github/workflows/pages.yml` | `main` / `beta` 對應 GitHub Pages 的靜態網站部署 | repo 沒有現成可作 PDF 驗證的常駐後端 |
| `assets/js/billing-print.js` | 建立單筆對外 view，使用 `JSON → base64 → URL #fragment` 導向 `billing-print.html`，`print=1` 可自動列印 | 文件資料由瀏覽器本機送到列印頁，網址片段**不等於加密**，亦無完成 PDF 後的驗證 |
| `assets/js/billing-bundle-print.js` | 一般合併單也使用 URL fragment，指向 `billing-bundle-print.html` | 不可只改一種列印入口 |
| `assets/js/external-billing-print.js` | 跨區對外列印先讀合併文件資料與原始快照，再轉成既有請款 view；一般目前只顯示選定區，歷史版本另有發票對照處理 | **不得**把 `sourceSnapshots` 或歷史發票對照送進外部列印服務；須明確以一般／歷史版本分流 |
| `billing-print.html` | 人工按鈕 `printDocument()` 和 `?print=1` 使用 `window.print()` | 無內建可驗證 A4 頁數的原生瀏覽器流程；快捷鍵／File → Print 也不能單靠劫持按鈕封鎖 |
| `assets/js/erp-store.js` | 主資料保存在 IndexedDB `KuSheERP25_Core34_DB`／`erp`，搭配 Emergency mirror、交易與復原防護 | 產出 PDF **不得**觸發新的 store 寫入、資料合併或遷移 |
| `assets/js/cloud-sync.js` | 有 `SYNCED / LOCAL_NEWER / REMOTE_NEWER / UNKNOWN_CONFLICT`、信任裝置與臨時裝置機制 | 列印來源版本與同步狀態須明示；**不能**自行把遠端覆蓋本機，也不能拿未核對的舊版當成可信金額 |
| `assets/js/auth-gate.js`、`assets/js/config.js` | 已有 Supabase 使用者登入與 MFA／公司權限框架，公開前端使用 publishable key；正式同步仍由既有程式管理 | 新 PDF 網關須獨立驗證使用者與公司／文件存取權，絕不能以 publishable key 作為授權，也不得把 service-role / secret 放前端 |

**限制：** 以上是 GitHub 原始程式的唯讀檢查；沒有登入正式 Supabase，也未取得正式資料的同步狀態或權限設定。尚不能聲稱正式資料逐筆來源可供後端安全查詢。

## 2. P40-16T～AC 實測提供的邊界

- 使用**原來的靜態請款列印模板＋虛構資料**，部分 18／30 筆中文明細可放入一張 A4；長品名、長備註可以變成 2 頁。
- P40-16AB 證明 DOM 高度未超 A4 時仍可能因 CSS `break-before: page` 變成 2 頁，所以不能拿頁面高度作安全放行。
- P40-16AC 使用**外部 Playwright** 真正產生 PDF bytes、檢查頁數／內容／SHA-256，只交付通過者；這是**隔離技術原型**，無法直接用於現有 GitHub Pages 的一般手機／電腦使用者，也不能防範現有列印路徑直接跳過。
- 既有一般單筆、普通合併、跨區合併、歷史保存版本尚未完成「**同一套受控輸出**」完整端對端驗收。不可直接合併 P40-16T～AC 任一研究分支。

## 3. 技術選擇與結論

| 方案 | 好處 | 主要阻礙 | P40-16AD 決策 |
|---|---|---|---|
| A. 在現有頁面以 DOM 高度判斷後 `window.print()` | 改動小、不傳檔外部 | 已有「高度看似合格但 PDF 2 頁」反例；無法攔截瀏覽器其他列印入口 | **拒絕**作為安全頁數證明 |
| B. 純前端以另一套 PDF 組版工具生成完整文件 | 不需要額外伺服器傳帳務資料 | 必須重建現有 HTML/CSS、計價與章影版型，單筆／合併差異大；測試成本高 | 可作備案，暫不實作 |
| C. **獨立可信 PDF 服務：先 PDF → 後驗證 → 再交付** | 可真正取得最終 PDF bytes、頁數與雜湊；可支援電腦與手機 | 必須先證明**資料授權、資料來源正確、短暫處理、隔離渲染**；不是貼入 GitHub Pages JS 就可完成 | **優先做獨立虛構資料可行性測試**，不代表已核准正式部署 |
| D. 直接送完整 ERP 備份到第三方線上 PDF 轉換器 | 不需自建服務 | 備份可能含完整客戶、薪資、銀行、發票等；難以控制存取／保存 | **禁止** |

外部可行技術方向（待開發環境確認）：Cloudflare Workers 的 Browser Run 可產生 PDF；授權可採合規的 Supabase 使用者 JWT 驗證／公司權限判斷；但正式服務使用方式、費用、中文渲染、可用性、限額與隔離性**尚未實測或核准**。不得因此宣稱 Cloudflare／Supabase 正式整合已完成。

參考文件：
- https://developers.cloudflare.com/browser-run/how-to/pdf-generation/
- https://developers.cloudflare.com/browser-run/quick-actions/
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/auth-headers

## 4. 建議的安全資料流（**目標設計**，不是已實作）

```mermaid
flowchart LR
 A[ERP 使用者點選對外 PDF] --> B[唯讀同步/版本狀態檢查]
 B -->|不明/衝突/未核對| X[停止，不改任何資料]
 B --> C[授權請求：文件 ID + 版本 + 指定區]
 C --> D[受控 PDF 網關驗證 JWT/MFA/公司與文件權限]
 D -->|未授權| X
 D --> E[唯讀取得可信來源並驗證版本和金額]
 E -->|版本或金額不合| X
 E --> F[伺服器產生最小對外 View]
 F --> G[隔離 Chrome 產生 PDF bytes]
 G --> H[驗證 A4/筆數/總額/發票隱私/大小章]
 H -->|失敗| X
 H --> I[同一份已驗證 bytes + SHA-256]
 I --> J[一次性 HTTPS 下載/列印]
 ```

**只傳最小請求：** `{documentType, billingId, targetProjectId, expectedRevision}`。使用者 JWT 只放 HTTPS Authorization header，**不得放 URL fragment/query/body、PDF、日誌或檔名**。前端不得傳整份 snapshot／IndexedDB／銀行／薪資／抽成／帳號密碼。網關自己從授權的可信來源唯讀取得所需資料；**若無法安全按單筆文件查詢並驗證權限，先停止方案，不得改成傳整份 ERP**。

**授權必須雙重確認：** 驗證簽章與時效的使用者 JWT（不可僅解碼）、MFA／公司成員／請款讀取權限、指定文件所有權與預期版本。不能因為請求攜帶客戶案場名稱就視為有存取權。若使用 Supabase 服務端存取，需遵守 RLS／最小權限與相應最新文件；**禁止在前端或公開專案寫入 service-role secret**。

**對外 View 白名單：** `schema`, `documentType`, `title`, `customer`, `project`, `date`, `taxMode`, `invoiceStatus`（對外計價呈現必要開關，非內部票號）, `lines[house,item,unit,qty,price,amount]`, `salesAmount`, `taxAmount`, `totalAmount`, `retentionAmount`, `receivableAmount`, `publicNote`, `company`（僅對外抬頭欄位）。禁止 `sourceSnapshots`, `invoiceNo`, `invoiceRefs`, `invoiceDate`, `salary`, `commission`, `bank`, `auth`, `session` 等進入 PDF renderer；**歷史版本一律另行核對，不可自動走一般對外路徑**。

**渲染與驗證：** 固定版本 HTML/CSS/字型/LOGO/章圖資，禁止任意網頁 URL 轉 PDF、外部 JavaScript、外部圖片與任意 `fetch`／SSRF；瀏覽器網路白名單、文件大小及列印時間限制。以 A4 頁數 == 1、最小字體、所有明細／彙總、稅額／含稅總額／保留款、僅指定區、沒有內部票號、沒有裁切、版號/章影正確為**必要條件**。沒有一個可驗證 → 一律拒絕交付。必須使用**同一份**經驗證 bytes，摘要一致才交付；不可驗證後重新渲染。

**資料保護：** HTTPS，`Cache-Control: no-store`，附件檔名無敏感資訊；不永久存放 PDF／JSON，不寫一般存取日誌的 payload 或 JWT，無外部分析追蹤；清理短暫緩存。限制使用者/公司呼叫頻率與並發、固定 renderer 版本、稽核只記狀態碼與不含隱私的追蹤 ID。所有雲端與本機快照保持**唯讀**，不可因列印觸發修復/還原/提交。

**舊路徑風險：** 若正式 `billing-print.html` 的 `window.print()` 或 `?print=1` 繼續開放，就不能宣稱「所有對外列印都已強制 PDF 驗證」。只能在新路徑驗收通過且獲得另外正式發布授權後，另以最小差異統一入口；瀏覽器自身快捷鍵的限制要如實告知。

## 5. 暫時不可跨過的 7 個閘門

1. **G1／只讀來源：** 證明正式雲端存在可按**單一文件+版本+公司**唯讀查詢的安全方法；不建立新表、不改 RLS／schema、絕不使用整份真實 ERP 備份。
2. **G2／權限：** 以**完全虛構**資料測有效/失效 JWT、MFA、跨公司、跨區、無權限與越權請求，全部 fail closed；不得使用正式 token 做測試。
3. **G3／資料一致性：** 檢查同戶不同區合併只顯示選定區、來源明細不丟失、稅額保留款原計價不被服務重算造成差異。
4. **G4／PDF 品質：** 單筆／普通合併／跨區合併／歷史版本隔離，手機與桌面、長中文品名、長備註、A4 一頁、章影佔位與真實章印*另外*人工驗收。
5. **G5／安全與失敗：** 渲染超時、非 A4、斷網、版本競爭、缺明細、偽造金額、PDF 修改、SSRF、日誌/快取洩漏測試。
6. **G6／回歸：** `main`／`beta`、IndexedDB/ Emergency mirror、雲端同步、請款、發票、應收、銀行、薪資、抽成、其他 PDF **全不變**；所有 CI PASS、手機與電腦確認。
7. **G7／正式發佈：** 從當時**最新 main** 新開最小候選；確認最近 `SYNCED`、完整可還原備份、人工差異與帳務回歸、對外 PDF 驗收，再請所有者**另行明確授權**。任何一項失敗停止。

## 6. 本階段的輸出與建議

- `P40-16AD` 僅作**不連線正式系統**的設計與最小資料契約測試；`main`、`beta`、Supabase、真實請款、銀行、薪資、抽成、PDF 均不動。
- 建議下一階段 `P40-16AE` **只做完全隔離的偽造 token／資料、限域請求、費用與權限模型可行性驗證**，先把 G1 的來源查詢障礙列明；若無法確保公司隔離與單筆來源，**停止 PDF 後端方案**。不需要把這份研究分支合併。
- 在此之前，正式 ERP 沿用目前的列印功能，不對使用者宣稱已具備 A4 自動超頁阻擋。
