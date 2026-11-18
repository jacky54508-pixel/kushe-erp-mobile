# P40-16AR｜已驗證 PDF 原始位元組的「驗證後交付」隔離實作

> **DRAFT / NO MERGE / NO DEPLOY / 只允許虛構來源與 localhost。**  
> 本階段**不會**部署正式 PDF 服務、下載按鈕、Supabase 連線、身分驗證端點，也沒有修改任何真實 ERP 財務資料。此 PR 只新增 `.p40-16ar-tests/`、本報告與單獨 GitHub Actions；繼承上階段**尚未合併**的 P40-16AQ 版型候選，`billing-print.html` 及所有正式來源皆未在 AR 階段另改。

## 真正完成的技術路徑

**目的：確認「先檢查真正輸出的 PDF bytes，再交付精確同一份 bytes」是可實作的，而不是檢查 DOM 高度後讓瀏覽器另印一份。**

1. 在隔離 Chrome 中由**正式原始程式** `external-billing-print.html` 讀取完全虛構的跨區兩張原單：8 月／10 月、分屬 L 區與指定 M 區、原始來源發票號碼是隱私哨兵。
2. 正式 `validate()`／`originalTemplateView()` 決定真正的**建商版** `publicView`，再轉至 AQ 候選的 `billing-print.html`。只保留已核對的指定 M 區、原戶別、施工項目、來源核定金額，並保留正式風格和章位。
3. 只在 CI 隔離主機呼叫 Chromium `page.pdf()` 真正取得 PDF bytes；`verified_bytes_handoff.py` 以 PyMuPDF **開啟同一份 bytes**，檢查是否剛好 A4 一頁、來源戶別／施工品名／最下方施工彙總／備註／核定請款金額／保留款／應收是否完整；其他區域、內部發票／銀行／薪資資訊不能出現在對外文件。真實公司 LOGO／章印被記憶體中性圖像取代。
4. 同一份 PDF 完整檢查通過後，才存入**純記憶體的 SHA-256 指紋登錄庫**，核發高熵一次性憑證。模擬使用者必須在模擬文件權限和版本仍有效時，才能透過本機 `127.0.0.1` 的 `POST /lab-only/verified-pdf` 取得 **SHA-256 與原始通過版本完全相同的 PDF bytes**。
5. 文件若是兩頁、缺明細、總額遭更改、包含其他區域或原發票、PDF 遭竄改、權限失效、文件版本改變、超過單次下載次數，便**不能領取**；只有通過的虛構文件會放到短期 GitHub Actions 測試附件。任何 30 筆仍超頁的測試，不會產生可下載 PDF。
6. 實驗用假文件必須以 `SYNTHETIC-` 起始，假公司以 `FAKE-` 起始，假版次以 `FAKE-REV-` 起始，清楚保證它**不是直接可部署的真實用戶服務**。

## 正式上線前不可迴避的阻擋條件

| 必須完成 | 目前現況 |
|---|---|
| 從正式 Supabase／ERP **可信來源只讀取得指定一筆原請款** | **BLOCK**：實驗僅使用虛構記憶體資料，不證明正式雲端可單筆安全讀取。不能上傳整份 ERP snapshot 到外部服務 |
| 驗證真實登入 JWT、MFA、公司身分、所屬案場和請款權限 | **BLOCK**：`FakePrincipal` 僅是測試資料，**不是**正式 JWT 或 MFA；不得直接投入正式 |
| 正式目前是否 `SYNCED`、版本是否有雲端衝突 | **BLOCK**：本階段沒有查任何真實 SYNCED |
| 完整可還原最新備份 | **BLOCK**：本階段沒有進行真實備份或資料庫操作 |
| 公司真正 LOGO／大小章、手機與電腦 PDF 正式逐頁驗收 | **BLOCK**：本階段只用中性圖像及模擬手機視窗 |
| 實際折讓／歷史補登／開票月份／稅別／保留款／員工抽成與銀行完整回歸 | **BLOCK**：虛構案例不可當真實財務簽核 |
| 正式瀏覽器列印全部入口都改為安全下載 | **BLOCK**：`window.print()`、`?print=1`、File → Print、快捷鍵仍存在，沒有更動 |
| 公司負責人另行明確同意正式發布 | **BLOCK**：本次「下一步」僅是授權隔離測試，**不是**正式上線批准 |

## 安全界線

- localhost 端點僅由 GitHub CI 的**本機測試 runner**建立和刪除，不會部署到 Cloudflare、GitHub Pages 或正式網站。
- 本機一次性票證、模擬會話與 SHA-256 在實驗中可以驗證位元組相同；**SHA-256 本身並不是身分驗證、資料來源授權、數位簽章或真實建商收件人的保證**。
- 正式建商 PDF 不列原發票號碼、原其他區案場名稱；歷史保存及一般合併請款仍使用**獨立**正式顯示規則，P40-16AR 不處理也不修改。
- 若輸出的真實 PDF 無法放進 A4 一頁，必須拒絕新下載流程，不能強行縮字、隱藏戶別、改成序號或刪除「施工項目彙總」。
- 改正式版以前需要完整實體手機／電腦與所有帳務回歸驗收，且正式頁數的真正保障要來自**驗證後交付的相同 PDF bytes**，而不是 CSS 或模擬。

**P40-16AR 結論：本輪驗證的是「隔離本機 PDF bytes 安全交付路徑」，不是正式企業 ERP PDF 網關。正式 `main`、`beta`、Supabase、真實財務資料都不動。**

**機器查核：** `.p40-16ar-tests/verified_bytes_handoff.py`、`.p40-16ar-tests/test_verified_handoff.py` 與 `.github/workflows/p40-16ar-verified-handoff.yml`。實際成功與阻擋件數以同分支 GitHub CI 輸出的 `P40AR_PDF_FIRST`、`P40AR_LAB_COMPLETE`、附件 `.p40-16ar-review/results.json` 為準。