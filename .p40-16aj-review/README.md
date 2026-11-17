# P40-16AJ｜單筆請款原始金額與施工明細來源保護：隔離轉接器

**草稿／不得合併／不得部署／不可修改正式帳務或 Supabase。** 基準正式 `main`：`2ab9c9d5944b1360ba3eebf49695713168caca8a`，`beta`：`62669539053a15174081ba8670b18248195c6f8c`。本分支沿用 P40-16AH/AI 虛構測試，新增 P40-16AJ 測試及報告；沒有修改任何正式 ERP JS、PDF、MFA、同步或資料儲存檔案。

## 已通過的 CI

GitHub Actions [P40-16AJ #44199627435](https://github.com/jacky54508-pixel/kushe-erp-mobile/actions/runs/44199627435) SUCCESS：
- 正式 main/beta 釘選、正式列印/帳務/雲端原始檔差異保護 PASS；
- P40-16AI 原始相容性診斷 **11/11 PASS**，仍保留 9 類**未解決的正式 PDF 不相容**；
- P40-16AJ 新增轉接器 **18/18 PASS**，使用隔離 Node VM 呼叫正式 `assets/js/billing-print.js` 的真實 `buildExternalView()`，以虛構帳務作為輸入；
- 合計 **29 項測試成功**，但不代表已經驗證真正 PDF 或真實帳務相容性。

## 本階段實作範圍

`.p40-16aj-tests/source_preserving_single_adapter.js` 僅在測試中被載入，不掛進正式 ERP：
- **小數施工數量及單價**：允許最多四位小數的虛構資料，保留原 `qty`、`price`、`amount`，不得用 `qty×price` 另算原施工小計。
- **歷史補登**：遇 `sourcePricingType:'historical-supplement'` 可保留原始 `amount`；`qty`、`price` 為 `null` 時畫面規格標示 `—`，不自行補成零或假單價。
- **稅額與保留款**：使用正式 `buildExternalView`（含 `billingDocumentState` 保護金額）給出的 `salesAmount`、`taxAmount`、`totalAmount`、`retentionAmount`、`receivableAmount`；不重新推算折讓或覆寫原金額。按正式 `billing-print.html` 規則，在有稅且 `taxMode==='含稅'` 時，以含稅總額作為明細合計核對基準。
- **施工彙總**：依正式密集對外 PDF 原程式，用 `item+unit+price+sourcePricingType` 分組；同品名同價但不同來源不能被合併；彙總小計直接累加原 `amount`。
- **對外隱私**：以白名單只選取允許公開的列及公司欄位；虛構測試加入內部發票、薪資、銀行、登入憑證欄位以驗證不外洩；公開備註若含敏感哨兵則阻擋。
- **同步與授權**：模型只有當外部呼叫者提供標記為已核准、文件活動中、`SYNCED` 的虛構信任狀態才處理；**不是 JWT／正式權限查驗**，也沒有任何真實 ERP 或 Supabase 讀寫。
- **合併/跨區/歷史保存**：一般合併 `kushe-combined-billing-v1`、`isMergedExternalBilling`、含原發票對照的文件均**拒絕進入單筆轉接器**，不把跨區資料直接扁平化，也不使用其他區域或票號。

## 重要限制：正式版仍不可發布

- **不是真正的 PDF 產生器**：P40-16AJ 僅有 `normalizeSingle`、`denseSummary` 和 `previewSpec`。它會明確標示 `safeForProduction:false`；沒有輸出可交付 PDF bytes；P40-16AH 的 `local_pdf.js` 仍是先前只接受整數與簡單稅額模型的**舊虛構原型**，並沒有被本階段直接改寫。
- **不等於真實業務金額已核對**：小數精度、四捨五入、所有議價折讓與歷史補登、免開發票/已開/待開、保留款、原請款來源版本仍需正式資料結構的獨立測試；不能僅用 `approvedByTrustedCaller:true` 就聲稱授權完成。
- **不能聲稱 PDF 版型等效**：正式公司 LOGO／大小章、A4 單頁、原戶別順序、施工細項及最下方彙總、實體手機和電腦、跨區合併／一般合併尚未用本階段轉接器產生任何真實 PDF。
- **嚴禁合併部署**：與原正式 `billing-print.html`／`billing-bundle-print.html`、`external-billing-print.html`、`window.print()` 均沒有連線，現有正式 ERP 運作方式完全不受影響。

## 建議下一階段 P40-16AK（仍限完全隔離測試）

在新的候選分支**只修改試驗版** PDF renderer，讓其讀取 P40-16AJ 的 `previewSpec`，真正輸出小數／含稅／歷史補登／保留款的**虛構 A4 PDF**，再以 PyMuPDF 檢查逐行文字與數字、最下方施工項目彙總、頁數、印章與安全隱私。一般合併及跨區合併繼續 BLOCK，直到各自有獨立相容性驗證。

未來任何正式修改都必須從**當時最新正式 main**另開最小候選，先確認最新 `SYNCED`、完整可還原備份、全部 CI、實際對外 PDF 手機／電腦驗收與完整財務回歸，再由公司負責人**另行明確授權正式發布**；任何失敗立即停止。

**P40-16AJ 結論：隔離來源轉接 PASS；正式 PDF 可發布狀態仍是 BLOCKED。**
