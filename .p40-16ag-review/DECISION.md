# P40-16AG｜PDF 路徑選型：本機端優先、雲端服務保留為備案

**性質：唯讀架構決議＋虛構資料契約測試。狀態 DRAFT / 未合併 / 未部署。**  
基準：正式 `main` 2ab9c9d5944b1360ba3eebf49695713168caca8a、`beta` 62669539053a15174081ba8670b18248195c6f8c。所有 GitHub 正式列印與同步程式保持不變。

## 1. 已核對的正式現況

- 對外單筆列印：`assets/js/billing-print.js` 生成資料後，以 JSON → base64 → URL hash 導向 `billing-print.html`，可依 `print=1` 直接 `window.print()`。
- 普通合併列印：`assets/js/billing-bundle-print.js` 也使用 URL hash 與 `billing-bundle-print.html`，**不能**只改單筆入口。
- 跨區合併對外 PDF：有獨立對外顯示邏輯，僅應列印建商指定區域、原施工明細與最下方彙總；內部多張發票資訊不應出現在對外文件。
- 正式雲端：`erp_states.data` 和 `erp_company_states.data` 為整份 JSON。P40-16AF 的公開 schema metadata 唯讀查核未找到已可驗證安全授權的「單一請款／版本／區域」資料來源，因此**禁止**新 PDF 服務讀取整個 JSON。
- P40-16T～AC：真正 Chrome PDF 測試證明 18／30 筆部分虛構中文施工明細能排成 A4 單頁，長品名／長備註會超頁；DOM 高度不等於最終 PDF 頁數；外部 Playwright PDF-first 可驗證相同 PDF bytes，但並不是現有 GitHub Pages 的正式功能。

## 2. 選型決策

| 比較 | A：在受權限控制的 ERP 裝置端產生**新的** PDF bytes（本次首選探索） | B：新增服務端 PDF 網關（備案） |
|---|---|---|
| 正式 Supabase schema/RLS | 不必修改 | **G1 阻擋**：先需要可信單筆只讀來源與資料權限 |
| 把 ERP 內部帳務交給新服務 | 不需要；僅從已載入本機的狀態建立對外最小 View | 有新傳輸風險，不能送整份 JSON 或讓服務端盲信前端 |
| 版型改動 | 需要一套新且可驗證的 A4 檔案組版；原 HTML 列印程式維持原樣 | 可以用原 HTML/Chromium，但需獨立服務、認證及資料一致性 |
| A4 頁數 | 可檢查 PDF bytes 頁數；但還必須驗證每筆文字、字體、章影與位置 | 同樣需驗證 PDF bytes 與帳務資料一致 |
| 手機／電腦 | 有 browser API、中文字型、記憶體、效能和下載相容性風險待測 | 有網路失敗／延遲／費用與授權問題 |
| 直接導入正式版？ | **NO**；待實體裝置、真實品牌 PDF 與完整業務回歸 | **NO**；G1 尚未有可信單筆來源 |
| 推薦動作 | **先建新隔離、完全虛構的本機 PDF 原型** | 不建立表、RPC、Edge Function、Worker，也不申請正式服務權限 |

可研究的前端 PDF 套件：`pdf-lib`（可嵌入 CJK 字型，但通常還需要 `@pdf-lib/fontkit`）、`pdfmake`（有結構化表格、自訂字型與分頁能力）。此處**未安裝、未選定版本、未測過與正式 ERP 相容性**。在隔離實作前需釘選確切版本與 lockfile、審查授權／弱點及中文字型的合法來源，字型檔不放進可供一般人下載的測試附件。

文件參考：
- https://github.com/Hopding/pdf-lib
- https://github.com/bpampuch/pdfmake
- https://supabase.com/docs/guides/database/postgres/row-level-security

## 3. A 方案的安全資料流（**目標，尚未實作**）

1. 使用者在 ERP 的**已授權登入狀態**選一筆對外請款（單筆／一般合併／跨區合併各自核對）；先顯示目前同步與來源版本，遇 `REMOTE_NEWER`、`UNKNOWN_CONFLICT`、`LOCAL_NEWER` 未核對時**不自動覆寫／同步／列印**。
2. 從 ERP 現存但不被修改的單據狀態產生一份**新物件**的對外最小 View，不得帶 `sourceSnapshots`、`settlementSnapshots`、`invoiceNo`、`invoiceRefs`、`bank`、`salary`、`commissions`、`auth`、`access_token` 或整份 ERP。
3. 只在本機記憶體使用 PDF 組版器，明確安排表格每筆中文品名、完整原明細、最下方施工項目彙總、金額與保留款、備註、LOGO／大小章的實際尺寸，不得把原明細改成序號或刪除戶別，不得縮字到小於 8pt。
4. 產生 PDF bytes 後獨立檢查 A4 等級、**實際 PDF 頁數必須為 1**、每筆明細／彙總／稅金／含稅總額及簽章區完整、建商指定區、沒有內部發票資訊、文字界線無裁切。驗證過的 bytes 與交付的 bytes 須雜湊一致。
5. **只提供通過檢查的 PDF Blob 預覽／下載**；長中文品名或備註超頁、檢查失敗、無法驗證則阻擋，並顯示明確原因。不能強行單頁裁切、隱藏明細或靜默另加第二頁。
6. 正式站原來的 `window.print()` / `?print=1` / `File → Print` **不可能僅靠一個 JS UI 完全封鎖**，所以在未取得另行正式發布授權與完整入口整合前，**不可宣稱所有對外 PDF 都受新驗證管控**。

**限制：** 裝置端生成避免新增傳輸通路，但不等於服務端重新驗證使用者或對抗惡意修改瀏覽器資料；本階段是企業內部授權使用者的文件輸出優化，不是對第三方提供可驗證之財務認證 API。

## 4. P40-16AG 交付項目與檢核

- 本分支只新增本報告、純 Python 離線虛構資料契約測試與獨立 CI，**不產生真實 PDF，也不修改正式頁面**。
- 隔離測試應證明：對外最小資料格式有白名單、來源不被修改、跨區僅選定區、外部無內部發票或銀行／薪資欄位、驗證前不能交付、超頁及內容缺漏時阻擋、驗證後 bytes 改變拒絕。
- 此類測試 **只驗證設計規則**，不能當成實際中文字型、真實大小章與 A4 PDF 已通過；P40-16AH 要使用真正在瀏覽器工作的 PDF 組版器與虛構資料測試上述物理約束。

**P40-16AG 決議：A 方案進入獨立原型；B 方案 G1 保持阻擋。正式 main/beta、Supabase、正式請款 PDF 與所有真實帳務一律不動。**
