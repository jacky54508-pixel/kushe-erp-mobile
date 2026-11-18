# P40-16AQ｜跨區對外請款「最小候選」— 未部署，正式發布仍阻擋

> **DRAFT / NO MERGE / NO DEPLOY / NO REAL DATA / 未取得正式發布授權**  
> 基準正式 `main`：`2ab9c9d5944b1360ba3eebf49695713168caca8a`；`beta`：`62669539053a15174081ba8670b18248195c6f8c`，2026-11-18 核對。**不得**把此候選分支或之前 AH～AP 研究 PR 直接合併進正式 `main`。

## 這一次真正改了哪些候選程式

**唯一候選應用程式變更檔：`billing-print.html`。** 沒有改動原 `assets/js/`、`index.html`、`billing-bundle-print.html`、`external-billing-print.html`、Supabase schema、IndexedDB／Emergency mirror、真實請款或任何帳務紀錄。

只在列印頁既有 `invoice-group-document` 的判定後，多加一個極窄的 `p40aq-current-customer-zone` 樣式 class。必須同時成立：

- 單據類型是 `billing`，且非 `quotation`；
- `isMergedExternalBilling===true`，同時**沒有** `sourceInvoiceReferences`（不套到原發票對照／舊資料型態）；
- `mergedBillingProjects` **只有一個值**，並與對外已核對的 `project` 一致；
- 對外顯示不附原始來源單號（`number` 為空）；
- 真正外部入口仍先經原 `assets/js/external-billing-print.js` 的 `validate()` 和 `originalTemplateView()`，僅將經核定的指定區域 View 轉送到既有 `billing-print.html`。

列印用 CSS **只套在 `.paper.invoice-group-document.p40aq-current-customer-zone`**，移植原 P40-16AO 已測試的間距/邊距設計（公司抬頭、資訊區、施工表、底部彙總、備註、金額和簽章的非字級空間），不降低字級、不替換戶別為序號、不動公司 LOGO 大小和印章原位置，不更改金額或計價邏輯。

**不符合以上條件**的單筆請款、報價單、一般合併、跨區保存版、原發票對照和其他舊列印資料，**不會套用本候選的新 CSS**。

## 刻意沒有實作（上線阻擋點）

**此候選只是一項保留正式風格的跨區列印「間距優化」，不是全面 PDF 交付服務。** 正式頁面的原生 `window.print()`、`?print=1`、瀏覽器 File → Print 及列印快捷鍵均保持不變。使用者仍可能從舊列印入口列出兩頁文件；**不能**用 CSS 或 DOM 高度保證它能安全阻擋所有超頁。

同分支 CI 以**真正 Chrome 輸出 PDF bytes → PyMuPDF 重新開啟 → A4、頁數、每筆戶別/品項/原核定金額/備註、指定區、印章位置與內部隱私**等條件檢查單頁樣本；測試只對**虛構資料 PDF**執行，成功樣本才放入短期 GitHub Actions 附件；**這個 CI 檢查器並未接入正式 ERP 列印入口**。

若真正要求所有建商 PDF 都必須單頁、只交付經驗證的 PDF bytes，需另外授權設計安全的 PDF-first 交付流程與實際身分、公司、來源資料的唯讀核對，才可能全面阻擋不合格文件。**目前不得聲稱已經完成。**

## 本候選的 GitHub CI 必須檢查

1. **先核對最新固定的正式 `main`、`beta`**；有任何基準變動直接 STOP。
2. `git diff` 只允許 `billing-print.html`、本候選的測試、報告和獨立 CI；所有其他正式文件、ERP、Auth、Sync、發票／銀行／薪資／抽成 JavaScript 一律與 `main` blob 完全相同。
3. 在本地虛構來源執行真正的 `external-billing-print.html` → `billing-print.html` 路徑，確保原正式 `validate()` 及 `originalTemplateView()` 沒有被取代。
4. 用固定的同一份虛構公開 View，讓正式 `main` 原 HTML 與候選 HTML 分別真正產生 PDF bytes。PyMuPDF 驗證 A4、頁數、原施工戶別與品名、核定金額、底部彙總、所有備註及指定區；多頁**不附交付 PDF**。原公司 LOGO／大小章由中性測試 SVG 替換，不能當成實際章印驗收。
5. 驗證 8 筆及 18 筆測試資料的單頁、30 筆超頁安全阻擋、其他區域/票號不外洩；單筆請款、報價單、一般／舊跨區資料**沒有取得專用新 CSS class**。
6. 測試通過 **不代表**真實帳務、實際手機/電腦使用者操作、跨裝置同步、所有瀏覽器列印入口和真正品牌文件均 PASS。

## 2026-11-18 實際 GitHub CI 記錄（已驗證）

- GitHub Actions [#44299494484](https://github.com/jacky54508-pixel/kushe-erp-mobile/actions/runs/44299494484) **SUCCESS**：固定 `main`／`beta` 與所有其他 ERP JS/HTML 路徑安全檢查 PASS。
- 真正透過正式 `external-billing-print.html` → 候選 `billing-print.html` 列印，不是虛構的獨立 PDF HTML 版型；同一份虛構公開 View 分別交給正式 main HTML 與候選 HTML，在 Chrome 產生 PDF bytes，PyMuPDF 再次獨立開啟核對。
- 電腦 1280px + 手機模擬 390px：**6 份通過單頁的虛構 PDF**（8筆短單、18筆6種項目、18筆9種項目，各兩裝置）；**4 個多頁拒絕交付**（30筆6種、30筆15種，各兩裝置）。
- 施工來源戶別與品名、核定總額、備註、指定唯一案場、內部來源票號／其他區名不外露，以及公司標題/章位尺寸，均在測試中對照；最低可抽取字體實測**原版 7.8pt、候選版 7.8pt**，沒有再縮小。
- **6 次其他模式隔離驗證 PASS**：單筆、報價、舊跨區（各電腦＋手機模擬）都沒有套用 `p40aq-current-customer-zone` CSS。
- 只有通過單頁的虛構 PDF 被放進 3 天的 Actions artifact。沒有任何正式帳務、真實章印、真實原發票或 ERP 登入資料。
- **重要：`production_byte_gate:false`。** 證據已確認這是「候選版型＋CI 的 PDF bytes 驗證」，**不是正式 ERP 已安裝 PDF-first 單頁阻擋服務**。

## 此分支正式發布仍需全部七項門檻

1. **最新正式 SYNCED** 且無雲端衝突；
2. **完整最新可還原備份** 和恢復可行性；
3. **真實公司抬頭／LOGO／大小章** 逐頁驗收；
4. **真實手機與電腦**、各種 PDF 輸出與密集單據驗收；
5. **真正要交付的 PDF bytes** 驗證與舊原生列印入口的清楚限制；
6. 請款、折讓、稅基、保留款、各月原發票、應收、銀行、薪資、抽成完整回歸；
7. 使用者**另行明確同意發佈正式版本**，且每個檢查 PASS。

**在這些條件未完成前，P40-16AQ 只能保持 DRAFT／隔離候選，正式 `main`、`beta` 與全部真實資料不動。**
