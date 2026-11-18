# P40-16AT｜正式 Supabase 單筆請款資料安全與權限「僅中繼資料」查核

> **DRAFT／禁止合併／禁止部署。** 2026-11-18 完成正式 Supabase 專案與 ERP `main` 設定比對；查詢限資料庫系統中繼資料與安全建議。**未查詢任何真實請款、客戶、員工、銀行或其他業務資料列；無寫入、備份更動、RLS 變更或登入驗證測試。**

正式基準 `main` = `2ab9c9d5944b1360ba3eebf49695713168caca8a`，`beta` = `62669539053a15174081ba8670b18248195c6f8c`。查核時交叉比對正式 `assets/js/config.js` 的 Supabase 主機與連接帳戶的專案清單，確認正式專案名稱為 `kushe-erp-cloud`（狀態 `ACTIVE_HEALTHY`），而隔離 `kushe-auth-lab` 為 `INACTIVE`。**報告不包含專案識別碼、任何 Token、公司/員工/客戶個資、資料庫實際列或完整政策原始 SQL。**

## 一、實際正式資料庫中繼資料查核

| 項目 | 實際結果 | 意義 |
|---|---|---|
| `public` 業務相關資料表 | **4 張**：`erp_states`、`erp_company_states`、`companies`、`company_members` | 均開啟 RLS；並沒有獨立單筆請款資料表 |
| 單筆請款專用 RPC / View / Edge Function | **未發現**；目前已部署的 Edge Functions 為 **0** | 不能把整份快照型 ERP 狀態 API 誤當安全單筆請款來源 |
| `erp_states.data` | `authenticated` 具有欄位 SELECT，但有使用者本人及 AAL2 的 RLS 政策 | 這是**使用者狀態快照**，並非已授權的單筆請款 PDF API；未執行實際 RLS 角色測試 |
| `erp_company_states.data` | `authenticated` **沒有** `data` 欄位直接 SELECT 權限；但部分同步中繼欄位有 SELECT | 公司成員的中繼資料讀取權限不等於可以直接讀取整份公司帳務 |
| 公司成員與 MFA | 現有 RLS 有公司會員／有效狀態與 AAL2 規則；函式有會員/員工驗證 | 只是**結構與函式定義已檢查**，不能推論正式 PDF 網關已有完整授權 |
| `employee_erp_read_projection` | 存在員工資料受限投影 RPC；其內部函式先檢查 MFA、有效公司員工與綁定，再選擇員工所需區塊 | **不是單筆請款 PDF 資料來源**，不得借用來取得請款/銀行/薪資快照 |
| `erp_maintenance.recovery_backups` | RLS 已開啟，沒有 RLS 政策，亦沒有一般 `authenticated` SELECT 授權 | 符合「拒絕一般人存取」的現況，是否符合維運預期另行確認；**不修改** |
| 安全顧問提醒 | 外洩密碼防護未開啟（WARN），維護備份沒有 RLS policy（INFO） | 只記錄，不替使用者更動正式認證或資料庫設定 |

上述皆來自 **Supabase 專案中繼資料工具、`pg_catalog` / `information_schema` / `pg_policies` 等唯讀 SQL**；SQL 僅讀 schema、role privilege、function definition 與 policy metadata，沒有任何 `SELECT` 指向 ERP business rows。`list_tables` 會回傳近似資料列統計，但並未取出任何一筆實際內容。

## 二、重要安全判斷

**P40-16AT 的正式結論：目前沒有找到可供新 PDF 服務直接安全使用的「單筆核定請款資料來源」。**

原因是現有 `erp_states.data` 和 `erp_company_states.data` 是 JSONB 狀態快照，即使原本 ERP 有權限、資料同步、MFA、員工受限投影，也**不能**證明存在一個可以在可信端依「公司＋文件 ID＋指定原單＋版本」**只取得單筆**資料、核對核定金額與施工明細、並保證只輸出建商授權區域的來源。現有 PDF 格式的跨區公共 View 仍由瀏覽器前端建立。

- **不可**以 `erp_states.data` 整份快照直接交給新下載服務、外部 PDF 網站或另一個 Cloudflare Worker。
- **不可**把前端 `canView('billings')`、解碼 JWT payload 或公司同步中繼資料視為伺服器端已驗證授權。
- **不可**把 `employee_erp_read_projection` 推論為員工或外部服務可讀取完整請款，它在查到的函式定義中用途不同。
- **不可**把本次中繼資料查核當作真實帳號的 RLS／IDOR 安全滲透測試，因為沒有用真實或隔離測試使用者去讀任何業務列。
- **不可**把 P40-16AR 的 localhost SHA-256 同檔交付試驗宣稱成 ERP 正式下載功能。既有 `window.print()` 仍未具備驗證後交付的全路徑門禁。

## 三、上線前要先解決的事情

1. **優先設計**公司／指定文件／原單／版次可驗證的單筆資料來源；先在完全隔離且全部虛構資料環境中證明，並且不能把正式 ERP 的整份 JSONB 快照上傳新服務。
2. **先有資料來源，再設計可信後端授權**：真實 JWT 簽章、issuer、audience、expiry、AAL2/MFA、有效公司成員及文件層級可讀權限。不能相信客戶端自行上傳的 `companyId`、`role`、`publicView`。
3. PDF 要使用已核對的單筆請款、施工明細、折讓、稅額／保留款及對外顯示區產生，再獨立驗證**真正 PDF bytes**與 SHA-256，交付同一份通過驗證的 bytes。
4. 原正式 `main`、`beta`、Supabase、正式登入、公司資料及已輸入帳務保持不動。新的資料表、RLS、RPC、Edge Function 或任何正式部署**都必須單獨明確授權**，並先最新 `SYNCED`、完整可還原備份、全部 CI 與手機／電腦實際驗收。
5. **正式發布仍然 BLOCKED。** 不合併本審核 PR，也不合併先前 P40-16AQ/AR 研究候選。

## 四、已完成的驗證與保留限制

本次所做的是*結構確認*：正式專案識別、表與 RLS 開關、角色 SELECT 權限、RLS policy 定義、SQL 函式清單／權限／程式定義、目前 Edge Function 清單及 Supabase Security Advisor，**沒有真實業務資料抽查**。未經當前使用者新一輪正式授權，不應為測試而建立任何新帳號、匯出快照、安裝程式或更動資料庫。

詳細但不含原始政策 SQL 的結果在 `.p40-16at-review/decision.json`。獨立 CI 只驗證本報告的阻擋狀態、正式 `main` 和 `beta` 的原始程式不變；**CI 無法重新查核 Supabase 線上資料庫，因此 GitHub PASS 不等於資料庫安全實測 PASS**。

安全顧問提醒原始補強指引：

- <https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection>
- <https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy>
- <https://supabase.com/docs/guides/database/postgres/row-level-security>

**最終判定：P40-16AT 查核完成，正式單筆請款 PDF 下載服務的資料來源及授權仍未成立；正式 ERP 可維持原狀繼續使用，不能合併或發布。**
