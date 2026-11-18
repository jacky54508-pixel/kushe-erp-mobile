# P40-16AI｜正式對外請款 View 與 P40-16AH 裝置端 PDF 原型唯讀相容性檢查

> **DRAFT / NO MERGE / NO DEPLOY。** 本 PR 僅測試原已發布的單筆、一般合併及跨區對外列印程式，使用完全虛構的單號、金額、戶別、區域及發票哨兵。不連線正式 Supabase，不讀取任何真實 ERP 資料，不改 main/beta、資料庫或既有 PDF。

基準：正式 `main` `2ab9c9d5944b1360ba3eebf49695713168caca8a`；正式 `beta` `62669539053a15174081ba8670b18248195c6f8c`。分支從 P40-16AH 的隔離測試分支繼承，原 P40-16AH 腳本僅供比較，沒有任何正式模組引用。

## 驗證方法

1. 在 Node.js 的隔離 `vm` 裡**直接載入正式程式** `assets/js/billing-print.js` 與 `assets/js/billing-bundle-print.js`，使用模擬 Store 的虛構請款物件呼叫真正的 `buildExternalView()`、`buildCombinedView()`。
2. 從**正式原檔** `assets/js/external-billing-print.js` 唯讀擷取 `originalTemplateView()`，用虛構跨區合併來源核對指定區顯示／對外內容，真正的原發票號碼只作為「不得出現在對外 View」的哨兵。
3. 從**正式原檔** `billing-print.html` 擷取原本密集版型的 `summaryGroups`／`summaryItems` 分組程式，對照 P40-16AH 的 `summaryOf()`。
4. 使用真正的 P40-16AH 測試模組 `publicOnly()` 去驗證原始單筆/合併 View 的格式是否相容；故意驗證已知不相容情境應該遭到拒絕，絕不為了得到 CI 綠燈而讓錯誤金額進入 PDF。
5. 所有操作只在 GitHub Actions 讀取檔案、產生測試報告。**沒有** Chrome PDF 產出、沒有真實公司大小章、沒有實體手機，也沒有對既有 ERP 進行任何資料修改。

## 已找到的正式相容性問題（都必須解決，不能直接發布）

| 編號 | 已發布程式真正處理的內容 | P40-16AH 隔離原型現況 | 狀態 |
|---|---|---|---|
| AI-01 | 單筆 `buildExternalView` 回傳 `kushe-external-document-v1`，不包含原型自設的 `status` 欄位 | 直接拒絕，只有在**虛構測試資料**額外加 `status:'active'` 後才接受 | BLOCK |
| AI-02 | 正式線項可包含小數數量或單價 | 原型只允許整數 `Number.isSafeInteger` | BLOCK |
| AI-03 | 歷史補登 `historical-supplement` 允許金額但沒有標準 qty/price | 原型強制每行 `qty × price = amount` | BLOCK |
| AI-04 | 含稅對外列印時，施工明細合計可依原定義為含稅總額，而非未稅合計 | 原型硬性要求所有明細金額加總等於 `salesAmount` | BLOCK |
| AI-05 | 受保護請款 `billingDocumentState` 的未稅、稅額、總額、保留款、應收為核定來源 | 原型尚未和正式核對門檻整合，不能自行推算折讓或保留款 | BLOCK |
| AI-06 | 普通合併 `kushe-combined-billing-v1` 使用 `billings[]`、`projects[]` 及 `totals` | 原型只支援單筆 `billing` 格式；不可自行扁平化或丟失原單／案場／發票隱私 | BLOCK |
| AI-07 | 跨區合併一般對外 View 由 `originalTemplateView` 只留下指定 `displayProjectName`、原始對外施工項目及來源類型；不傳原票號/日期/內部快照 | 原型沒有驗證資料來源分類、跨區原始單據狀態與實際品牌版型 | BLOCK |
| AI-08 | 密集施工項目彙總分組鍵包括 `item`、`unit`、`price`、`sourcePricingType` | 原型只用 `item`、`unit`、`price`，可能把不同來源類型合併（**即使總金額剛好正確**） | BLOCK |
| AI-09 | 正式 `billing-print.html` 會依 `invoiceStatus`、`taxMode`、`pricingMode` 等控制對外欄位顯示 | 原型公開 View 未保留 invoiceStatus/pricingMode 的顯示決策 | BLOCK |

## 不能當成已通過的項目

- 正式單筆、一般合併、跨區合併、議價折讓及歷史修訂後的**所有實際數字**與 PDF 完全一致：**未通過**。
- 正式發票對照：一般對外不得顯示原票號；歷史保存版本應獨立驗證，**不能偷用一般對外路徑**。
- 混合含稅／未稅、實做實算、總價、保留款、折讓、應收扣款、跨員工抽成等業務資料不應由 PDF 產生器重算。
- 原本最下方施工項目彙總、每個原始戶別，以及公司 LOGO／大小章定位，尚未做與 P40-16AH PDF 的**逐像素/逐字**等效比對。
- **CI PASS = 發現差異與阻擋設計通過，不代表相容性通過。** P40-16AH 本機生成中文 A4 單頁的成功，不等於新產生器可立即取代正式對外請款。

## 風險隔離及接下來的 P40-16AJ 建議

- 下一階段**只在另一個隔離候選**建立明確的來源分類轉接器，先支援「普通單筆虛構請款」的可接受／不可接受情境；保留原 `billingDocumentState` 的核定總額與來源明細，不修改任何正式商業公式。
- 對一般合併與跨區合併要**各自有獨立 contract**；若無法逐筆核對所有原單、指定區、來源類型、發票隱私與摘要金額，必須拒絕產出，不可直接攤平成單筆。
- 新版型若無法完整 A4 一頁（明細、完整彙總、LOGO/公司大小章/備註），**拒絕 PDF**，不得移除欄位、把戶別變序號、裁切、或縮字到低於 8pt。
- 繼續堅守：`main` 不動、正式資料不動；先最新 SYNCED、完整可還原備份、差異查核、完整 CI、實體手機與電腦/正式對外 PDF 驗收，再取得公司負責人**另行明確正式發布授權**。

**決策：P40-16AI 為診斷草稿，正式 PDF 替換 = BLOCKED。**
