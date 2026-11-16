# P40-16I — 正式 ERP 帳務結構「唯讀盤點」與虛構資料關聯稽核

**狀態：僅 GitHub 獨立候選、唯讀 SQL 中繼資料及合成測試。不合併 main/beta、不變更正式 Supabase Schema 或業務 JSONB、不修改任何真實資料。**

## 1. 本階段已直接唯讀核對的正式資料庫結構

查核對象為既有正式 Supabase 專案的 **資料表 schema、權限、政策、函式及 trigger 的 metadata**，不 SELECT 真實用戶列、不讀取任何 `data` JSONB 內容，也不產生任何正式 SQL migration。

| 表 | 主要 key / 結構 | RLS | 帳務角色 |
|---|---|---|---|
| `public.erp_states` | `user_id` (PK, auth.users FK), `data jsonb`, `sync_version`, `updated_at`, `last_writer_mode`, `last_base_sync_version` | ON | 依登入帳號的 legacy ERP 整份業務快照；**不是拆開的發票/應收台帳** |
| `public.companies` | `id` (PK), `owner_user_id`, `legacy_source_user_id` | ON | 公司與原帳號關聯 |
| `public.company_members` | PK `(company_id,user_id)`、`employee_id`, `role`, `status` | ON | 成員及角色資料；與實際財務寫入權限分開 |
| `public.erp_company_states` | `company_id` (PK), `data jsonb`, `sync_version`、writer/version metadata | ON | 公司層級狀態；正式用戶端尚未將全 ERP 業務寫入切換到此表 |

現有正式 **public** schema 沒有獨立的 `billings`、`receivables`、`invoices`、`retention_receipts`、`commissions`、`payroll`、`bankTransactions` PostgreSQL 表。這些是 **`erp_states.data` 裡面的業務集合**，不能直接對整份 JSONB 套用一般 SQL FK／交易式折讓入帳設計。

### 角色、同步的已核對安全邊界

- `erp_states` 的 `authenticated` 有 SELECT/INSERT/UPDATE 的 SQL GRANT，RLS 依 `auth.uid()=user_id` 限定本帳號，另有 AAL2 的 **RESTRICTIVE** policy；**並非所有 write 都必然經 `erp_state_cas_write_v2`**，因為 legacy 直接更新權限仍存在。這是未來正式折讓如何防舊用戶端整份資料覆蓋的重大風險，*沒有*在此修改任何 policy/GRANT。
- `erp_states`、`erp_company_states` 均有 BEFORE INSERT/UPDATE 的版本管理 trigger。
- `erp_state_cas_write_v2` 是正式雲端同步程式實際使用的 RPC；`auth-gate.js` 已有公司會員／MFA AAL2 與角色查核，但 `canWrite()` 為前端畫面權限，不等於折讓財務交易權限。
- 資料庫 metadata 查到 `authenticated` 對 `erp_company_states` 的 **SELECT table GRANT 為 false**，儘管該表有 SELECT RLS policy。這應以獨立登入測試進一步核對 REST 讀取效果，避免誤以為有 policy 就一定有查詢權；**本階段不得直接調整正式授權**。
- `companies`、`company_members`、`erp_states`、`erp_company_states` 的 AAL2 追加政策均為 **RESTRICTIVE**，沒有發現「MFA OR 其他放行政策而繞過 owner predicate」的單純組合錯誤。這只是 metadata 分析，**不是正式使用者端穿透測試**。
- `private.company_member_role`、`private.is_company_owner` 為安全敏感 `SECURITY DEFINER` 函式，未來任何折讓 RPC 需逐一查核 owner、search_path 和 EXECUTE GRANT；現有權限一律保留。

## 2. 正式 GitHub main 的帳務資料關聯（從程式定義取得，未讀客戶資料）

### 單筆請款 → 唯一應收

- `state.billings[]`：`id`, `number`, `receivableId`, `preTaxAmount` / `amount`, `taxAmount` / `tax`, `grossTotal`, `retentionAmount`, `total`, `invoiceStatus`, `invoiceNo`。
- `state.receivables[]`：`id`, `billingId`, `amount`, `received`, `retentionReceived`。既有程式 `resolveReceiptProjectRelation()` 對收款要求唯一請款／應收／案場／客戶識別。
- 原始應收的金額規則：`untaxed + tax = grossTotal`、`grossTotal - retention = receivable`；歷史帳資料有 legacy 補正例外，異常**不可自動修復**。

### 合併文件 → 保留來源原單

- `state.meta.externalBillingDocuments[]`：`id`, `revision`, `status`, `sourceIds[]`, `targetBillingId`, `sourceSnapshots[]`, `settlementSnapshots[]`, `totals`，以及修訂歷史。
- `sourceIds[]` 是原請款 `billings[].id`，而非建立一張新的應收或發票。`externalBillingDocumentIndex()` 現有保護：原單不能同時有效合併兩次、保存來源及收款快照與最新資料不同會標示條件變動。
- **對外 PDF 是文件呈現，不是新增財務總額來源**；不可為合併總折讓自動創造新原請款或合併發票。

### 發票 → 原單或應付

- `state.invoices[]` 銷項 `invoiceType:'output'`、`sourceType:'billing'`、`sourceId:billing.id`／`billingId`；另一種為 `invoiceType:'input'` 關聯應付。
- `invoiceRows()` 可能產生不持久化的 `virtual:true` 待開票列，**不可將 UI 虛擬列當作已開立的真實發票**。
- `saveInvoice()` 對銷項會同時更新原請款的發票狀態、票號及關聯應收資訊；本次不能透過此函式處理折讓。

### 收款／保留款／銀行

- `state.receipts[]`：依 `receivableId` 對應應收，可能具有客戶扣款、手續費及銀行流水。不能只依 `receipt.amount` 判斷實際沖銷金額。
- `state.retentionReceipts[]`：與 `receivableId`、`billingId` 關聯；`state.bankTransactions[]` 有對應 `sourceId`、`sourceType`。已有保留款收回不得改寫原銀行交易。
- 對支票、扣款及歷史收款 `legacyReceived` 的處理，必須沿用專門的帳務函式核對；**P40-16I 不替代正式應收金額計算**。

### 員工抽成／薪資

- `state.commissions[]` 可能由請款、每日施工或人工來源產生；`sourceType:'billing'`／`billingId` 只代表「直接綁定」的部分，不能反推沒有其他每日業績抽成。
- `state.payroll[]`、`state.salaryPayments[]`，及 `bankTransactions[]` 已有付款鎖，已付款薪資不得重新計算或覆蓋。
- 現行抽成按未稅來源乘員工抽成率；**折讓是否影響已計算／已付款抽成，至今尚未核定**。不得以合併請款折讓直接除以員工數或自動重算抽成。

## 3. 虛構測試審核器

`.p40-16i-tests/financial_links_readonly.cjs`：純函式、不載入 `index.html`、無 Supabase/IndexedDB/network/persist 操作。對完整**虛構** ERP 快照驗證：
- 合併文件唯一 ID、有效 revision、原單 source IDs 的唯一性和對外 target 屬於來源；
- 每張原單唯一 `billingId` 應收、雙向 `receivableId`、五欄金額的嚴格整數勾稽；
- 保存 `sourceSnapshots.anchors` 與原單現在金額的異同、合併文件 saved totals；
- 每原單的發票資料、收款／保留款和關聯銀行紀錄；
- 直接來源抽成及已付款薪資的阻擋；
- 即使所有數字匹配，也**一律** `canPost=false`、`canSave=false`，最多回傳 `MANUAL_REVIEW_REQUIRED`。

`.p40-16i-tests/financial_links_readonly.test.cjs` 全使用 `SYNTH-*` 假資料，包含 632,100→600,000 案例的 2 張假原單／1 張假發票示例。沒有碰真實用戶帳務快照。此審核器只是未來發展的單獨研究，**不能拿來判斷某一筆真實折讓可直接入帳**。

## 4. 下一階段阻擋條件

1. **沒有解決 JSONB 全量同步 vs 獨立折讓事件的原子性**：若外部 SQL 台帳先入帳、舊版 JSONB 隨後同步覆蓋，可能造成不同模組的顯示及餘額不一致。
2. **沒有合法折讓憑證鏈**：已開／已申報的發票，仍須會計核對法定折讓證明、稅額與申報。
3. **沒有全路徑抽成／已付薪資處理規則**：不得自動改既有薪資或抽成。
4. **沒有已收款與銀行反向調整流程**：不可刪除或倒填收款。
5. **正式授權與資料升級未通過**：需先解決正式 company permission 的 GRANT/API 行為、可信 JWT、member role 審查與最小權限、備份與 rollback。
6. 只有具體 owner **另行明確同意正式寫入與發布**，且 SYNCED、最新安全備份、隔離 CI + 全帳務回歸 + 對外 PDF 維持原樣等全部 PASS，才能開始正式入帳設計後的受控發布。

**本文件不含任何正式資料列、顧客資訊、薪資、發票號碼或真實請款明細。**
