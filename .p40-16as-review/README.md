# P40-16AS｜酷舍 ERP 單筆請款安全讀取與登入權限：正式來源唯讀評估

**DRAFT／NO MERGE／NO DEPLOY／READ-ONLY／ALL TEST DATA SYNTHETIC／DO NOT ACCESS REAL SUPABASE BUSINESS ROWS**

基準：2026-11-18 正式 `main` `2ab9c9d5944b1360ba3eebf49695713168caca8a`；正式 `beta` `62669539053a15174081ba8670b18248195c6f8c`。本階段從**正式 main 獨立建立查核分支**，不合併 P40-16AQ、AR 或 AH～AP 任何實驗功能，也**不修改**正式 ERP、列印、同步、登入、Supabase、IndexedDB、請款／應收／發票／銀行／薪資／抽成與真實資料。全部 CI 為 Python 標準函式庫假資料測試與 GitHub 程式碼唯讀掃描。

## 1. 已核對正式來源：單筆 PDF 服務的資料來源仍未成立

### A. 目前正式雲端同步讀取的是整份 ERP 狀態資料

`assets/js/cloud-sync.js`：

```text
remotePath(userId) =>
/rest/v1/erp_states?select=data,updated_at,sync_version,last_writer_mode,last_base_sync_version
&user_id=eq.<userId>&limit=1

readRemote(auth) => request(remotePath(auth.user.id), auth)
remoteInfo(row) => snapshotInfo(row.data, row.updated_at)
```

以上為根據正式程式實際呼叫的**文字摘要**，不是在正式 Supabase 執行的新查詢。程式 `BUSINESS_COLLECTIONS` 包括 `billings`、`receivables`、`invoices`、`payroll`、`bankTransactions` 等；`erp_states.data` 是雲端同步所使用的狀態快照，**不是已核准提供 PDF 服務的單筆請款公開資料介面**。`erp_state_cas_write_v2` 是 CAS 寫入路徑，絕對不應由 PDF 產生器呼叫。

**不能**假設伺服器能夠把 `erp_states.data` 安全地當作單筆請款來源，也不能由瀏覽器上傳整份 ERP JSON／來源快照、帳務或私人發票資料到新 PDF 服務。若尚未證明真正受權限控制的單筆資料來源，正式 PDF 後端的安全門禁應保持 **BLOCK**。

### B. 正式 ERP 已有前端公司登入與 MFA，但不能直接當作後端授權

`assets/js/auth-gate.js`：

- `sessionAal()` 會在瀏覽器解讀存放的 JWT claims 以顯示 AAL 狀態。**「解碼」不等於新伺服器的密碼學簽章驗證**。
- `resolveCompanyContext()` 要求 `aal2`，查 `company_members` 的 `company_id / user_id / employee_id / role / status`、`companies` 和 `erp_company_states` 的**同步 metadata**，在前端建立 `activeCompanyContext`。
- `canView('billings')` 按前端角色權限決定：`owner`、`admin`、`accounting` 有閱讀請款，`employee` 沒有。這些資訊是**前端 UI 權限**，新服務必須另外在可信環境檢查真實登入與公司/文件授權，不能信任客戶端傳入的 `role`、`companyId`、`approvedByTrustedCaller` 或 `user_metadata`。

Supabase 官方最新 JWT 文件要求以受信任的方法驗證簽章、核發者、有效期等，不能只解碼 token；RLS 應依已驗證的使用者與擁有者/公司等權限限制資料列：

- <https://supabase.com/docs/guides/auth/jwts>
- <https://supabase.com/docs/guides/auth/jwt-fields>
- <https://supabase.com/docs/guides/database/postgres/row-level-security>

未經另外明確批准，本輪**沒有新增任何 Supabase 功能、密鑰、SQL 或 RLS 政策**，上述文件僅供未來安全設計參考。

### C. 目前跨區請款 PDF 來源是瀏覽器端組合

`assets/js/billing-groups.js` 以 `printSaved()` 從當前 ERP Store 的對外文件資料及選定原單建立 `payload`、`template`，再經 `external-billing-print.html` 的正式 `validate()`／`originalTemplateView()` 產生建商版 `publicView`。只有指定的顯示區會送到正式一般對外列印頁，歷史版本有另外的發票對照列印路徑。這段程式證明**前端能產生對外 View**，**並不**證明已存在伺服器端「以文件 ID 及公司權限安全取得單筆核定明細」的 API。

**查核限制：** 本輪只看 GitHub 原始碼，並**未**存取正式 Supabase 線上 schema、RLS、RPC、實際任何資料列或帳務快照。可能另有未納入 GitHub 的資料表、檢視、RPC 或 Edge Function；若存在，需要經額外明確授權以**僅 metadata 唯讀**方式獨立證明其安全性，不可直接假設沒有。

## 2. P40-16AS 已建立的可執行安全門禁

`.p40-16as-tests/fake_single_document_boundary.py` 是一個**不可直接上線**的虛構契約模型。它**只接受**以下最小定位參數：

```json
{
  "documentType": "cross-zone-billing",
  "documentId": "SYNTHETIC-01",
  "targetBillingId": "FAKE-BILL-01",
  "expectedRevision": "FAKE-REV-01"
}
```

其餘如 `companyId`、`role`、`publicView`、`sourceSnapshots`、`access_token`、`approvedByTrustedCaller` 以及整份 `data` / `payroll` / `bankTransactions` 均一律不接受。

「登入」在測試中完全由 `FakeVerifier` 的 `FAKE-HANDLE-` 身分提供，**並沒有 JWT 簽章驗證功能**；文件來源來自 `FakeDocumentScopedProvider` 的虛構單筆記憶體資料，**完全不是正式 Supabase**。測試會拒絕：未驗證 JWT、MFA/AAL 未達標、公司成員無效、員工不具請款權限、跨公司、目標原單不一致、文件版本過舊／封存、只提供整份 ERP snapshot 或未證明 RLS 的來源，以及內容混入原發票或其他私人欄位。

假資料只包含 `SYNTHETIC-` 文件、`FAKE-` 公司與版本。測試即使全部 PASS，也**只能證明拒絕規則的形式及負面情境**，不能證明現在 Supabase 有安全單筆讀取能力。

## 3. 正式門禁仍未通過

| 門禁 | 狀態 | 目前缺口 |
|---|---|---|
| 真正單筆可信來源 | **BLOCK** | 雲端同步只可由目前程式證實 `erp_states.data` 快照；正式單筆專屬來源的 schema/RLS 未驗證 |
| 後端 JWT/MFA/公司授權 | **BLOCK** | 前端 `canView` 和 JWT payload 解碼不能代替可信端驗證 |
| 文件公司＋原單＋版次權限 | **BLOCK** | 尚無真實文件層級讀取/授權與跨公司 IDOR 整合測試 |
| 最新正式 SYNCED 與可還原備份 | **BLOCK** | 本輪不登入 ERP、不讀取真實狀態、不建立或回復真實備份 |
| 真實 LOGO、大小章、財務、手機/電腦驗收 | **BLOCK** | 前面 AI～AR 全是虛構來源與模擬裝置 |
| 真正正式 PDF-bytes 交付入口 | **BLOCK** | P40-16AR 只有 localhost 實驗；正式 `window.print()` 未阻擋 |
| 使用者另行明確同意正式發布 | **BLOCK** | 本次「下一步」授權唯讀查核與虛構測試，沒有授權 main 部署 |

### 後續最小且安全的下一步（仍未授權執行）

若使用者另行同意，才可以先對正式 Supabase **唯讀查 schema/RLS/RPC metadata，不查任何真實 business row，也不改權限**，確認是否已存在具公司及文件層級授權的單筆公開 View 或端點。若沒有，**停止上線**，另外設計獨立、經測試的資料來源/權限方案；任何 schema 或 RLS 變動須獨立授權、隔離環境先行、備份及回復檢查後才進入正式。

同時不動 P40-16AQ 候選程式，不把 P40-16AR 的本機假授權伺服器放到 Cloudflare/GitHub Pages 或正式 Supabase，不匯出或上傳整份 ERP。

**最終定位：P40-16AS 是「正式資料來源與授權的唯讀可行性和阻擋門禁」，不是新的 PDF 正式上線、真實備份或帳務操作。** 僅本分支的程式與 CI 測試可被自動執行，PR **DRAFT／NO MERGE**。

機器查核矩陣：`.p40-16as-review/source_risk_matrix.json`；假資料模組與測試：`.p40-16as-tests/`。