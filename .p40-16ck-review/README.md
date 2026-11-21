# P40-16CK｜公司大小章在匯出 PDF 失蹤：只修正列印圖片載入門檻

使用者 2026-11-21 15:11 提交正式匯出 PDF 截圖：薄荷色正確，但公司大小章顯示破圖，左上角品牌標誌也缺失。

## 確認的程式風險
正式 `billing-print.html` 原本以 `loadAssets()` 從同源 `enterprise/index.html` 讀取原始 `companyLogoAsset` 與 `companySealAsset`。舊函式只設定 `img.src` 就 resolve，並在 `.finally(...)` 開放列印，即使來源下載或解碼失敗亦不阻擋。因此當使用者立刻按匯出或資源載入異常，可匯出缺章 PDF。原始來源 PNG 經資料 URI 解析驗證皆為有效 PNG；**不需、也不應重新製作印章**。

## 最小變更
只修改 `billing-print.html` 的列印按鈕安全開關與 `loadAssets`；不改任何帳務及 PDF 動態資料。
- 按鈕預設禁止使用，先讀取正式同源 logo/seal、使用 `Image.decode()` 完整解碼。
- 公司大小章沿用既有 `removeSealBackground` 透明處理；**等待透明化後再解碼**，然後才放入文件 DOM，再等真正的 `img.decode()`。
- 公司 LOGO 與大小章 **兩張均完整**才啟用列印按鈕、設定 `__billingPrintReady=true`，並允許自動列印。
- 任何來源、圖片、透明化錯誤都阻擋列印，提示「公司 LOGO／大小章載入失敗，請重新開啟單據，勿使用缺章 PDF」。
- 保留已核准的薄荷版型、原有 logo/印章素材、動態欄位、簽章位置、實做實算、保留款、合併請款、A4 單頁規則，絕不修改金額或原始資料。

## 必須驗收
- 使用真正 Chrome 的原 `billing-print.html` 與原企業圖片；以**虛構**請款、報價、跨區合併三種單據生 PDF，`pdfimages -list` 必須有真正兩張圖像，且紙張是 A4 單頁。
- 人為延遲原圖載入：未完成前按鈕需禁用。
- 人為讓圖片來源失敗：必須拒絕列印並顯示錯誤。
- 原先 8 份薄荷版報價/請款與 6 份高密度 A4、14 項安全列印測試須維持 PASS。
- **正式發布仍 BLOCKED**：這是前次 P40-16CJ 之後的新修補，需另外授權。不得合併 main、部署、清除 IndexedDB 或改 Supabase。

