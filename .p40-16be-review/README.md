# P40-16BE｜正式 JWT 簽章模式／單筆請款來源：安全唯讀實測

> **DRAFT — NO MERGE / NO DEPLOY / READ-ONLY / 不讀正式帳務內容。**  
> 2026-11-19，從正式 `main` `2ab9c9d5944b1360ba3eebf49695713168caca8a` 獨立建立候選。正式 `beta` `62669539053a15174081ba8670b18248195c6f8c` 未變。本分支**只新增**查核報告、結果 JSON、離線測試及 GitHub Actions，無任何正式 ERP 原始碼、頁面、請款、列印、PDF、GitHub Pages 或 Supabase 資料庫／RLS 修改。

## 1. 實際做過哪些唯讀查核

- **GitHub 正式分支和實際來源**：重新讀取 `main`、`beta` 的 SHA，及 `assets/js/config.js`、`assets/js/cloud-sync.js`、`assets/js/billing-groups.js` 等正式檔案。確認程式設定對應**同一個正式 Supabase 專案**；報告刻意不公布專案識別碼、URL 金鑰或任何 token。
- **Supabase 正式專案：只看 metadata**：讀取專案運作狀態、PostgreSQL 版本、`public` 資料表結構、Edge Function 的已部署清單；查詢 `pg_catalog`／`information_schema` 的**表名、欄位型態、RLS flag、列級授權政策名稱、函式名稱和 SELECT/EXECUTE 權限**。
- **沒有做的事**：未執行任何 `SELECT data` 來取得公司/使用者 JSONB 快照；未查 `auth.users`、`auth.sessions` 或任何真實原請款、銀行、發票、薪資、人員資料**列**；未取 Supabase 金鑰、JWT、私鑰、`service_role`；未執行 DDL/DML、RLS 修改、Migration、Edge 部署或正式 GitHub 合併。

## 2. 實際驗證到的正式資料來源

| 項目 | 2026-11-19 唯讀結果 | 對核准／PDF 安全的影響 |
|---|---|---|
| `public.erp_states` | `data jsonb`，每位使用者 `user_id` 為主鍵；RLS 開啟，登入角色具 `data` 欄 SELECT 權限，並有原使用者限制及 MFA 的 RLS policy | **可讀取自己的整份 ERP 狀態 ≠ 安全的單筆請款 PDF API**；不得外送整份 `data` 給列印網關 |
| `public.erp_company_states` | `data jsonb`、`sync_version`；RLS 開啟；一般 `authenticated` **沒有 `data` 欄 SELECT grant**，僅可讀若干同步 metadata 欄位 | 即使已有「成員可讀公司」RLS policy，也不代表已授予整份公司 JSONB 讀取權；不可用特權函式或 service key 偷繞過 |
| `public.companies`／`public.company_members` | 已有公司、成員、角色欄位及 RLS/MFA restrictive policy。合法角色為 `owner/admin/accounting/employee` | 有公司成員資格不等於有某**一張請款文件**的審查權；需要可信逐文件 ACL 和即時會員狀態 |
| `erp_maintenance.recovery_backups` | RLS 開啟且 `authenticated` 沒有 SELECT grant | 維持保護；不能拿來作 PDF 請款來源 |
| RPC | 存在員工**有限範圍**讀取投影 `employee_erp_read_projection`，另有同步寫入等 RPC；**未發現獨立的核准單筆請款讀取 RPC** | 員工投影不是建商請款文件來源，也不能用同步寫入 RPC 冒充唯讀授權 |
| Edge Functions | 正式專案回報已部署數量 **0** | 目前沒有既存的 PDF/核准 Edge 服務可以直接安全啟用 |
| 獨立單筆請款表／view | 正式查核的 `public/private/erp_maintenance` metadata **未發現** | 目前沒有已核准、文件級資料來源；**必須先設計來源生成與版本一致性**，不能假裝已存在 |

更重要：`assets/js/cloud-sync.js` 的 `remotePath(userId)` 從 `erp_states` 讀 `data` 加上同步版本；`assets/js/billing-groups.js` 的 `printSaved()` 從**目前瀏覽器的 ERP Store**讀取原請款、組合並透過現有列印 HTML 走不同的現行／歷史路徑。原有功能**完全沒被本次調整**。

### 關於 JWT：目前**無法誠實宣稱正式專案使用 RS256 或 ES256**

前一階段 P40-16BD 的 **78 項 RSA 驗證測試通過**，但它驗證的是**CI 當下臨時生成的 RS256 金鑰**，不是正式 Supabase JWT。

此次查到的狀態：
- 正式專案與公司資料庫正常，但沒有一項已取得的專案中繼資料能夠**直接確認目前發出 access token 使用的 JWT 簽章演算法**。
- 嘗試唯讀取得正式專案的**公開 JWKS**，目前使用的外部讀取介面回覆**不可存取**，未取得任何 key 值。**不可因 JWKS 不可存取而推斷是 HS256**。
- 就算能看到公開 JWKS 中有 `RS256` 或 `ES256`，它也可能包含 **standby 或 previously used** 的驗證公鑰。單純列出 JWKS 並不足以確認**正在簽新 access token** 的 key。
- 查詢 `auth` schema 的 catalog 名稱不能取代官方**JWT Signing Keys / Current key** 狀態驗證；本次沒有進一步查任何 signing key 資料列或密鑰，也沒有取得或記錄正式 JWT。
- 正式應使用 Supabase 官方適用的 `auth.getClaims()` 或可信 JWT 驗證套件，根據真實專案 JWT Signing Keys 狀態及 key rotation 設計；若採對稱 JWT，不能用臨時 RS256 原型假冒已支援。驗證簽章仍不能代替**即時 Session、AAL2、會員、公司和單筆文件 ACL**。

官方參考：
[JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)、
[Supabase JWT](https://supabase.com/docs/guides/auth/jwts)、
[JavaScript auth.getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims)、
[MFA](https://supabase.com/docs/guides/auth/auth-mfa)、
[Sessions](https://supabase.com/docs/guides/auth/sessions)。

**簽章狀態的下一步**（只讀，不取得 secret）：由經授權的管理者在正式 Supabase Dashboard → Authentication → JWT Signing Keys 檢視 *目前 Current key 的 alg 和輪替狀態*，或在合法的已驗證 Session 與可信工具中核對已簽 JWT 的 `alg`／`kid`（**不要上傳或貼出原 JWT**）。沒有這項證據之前，保留 `UNKNOWN`，不可合併伺服器 JWT 核准程式。

## 3. 真正單筆請款可信來源：建議的安全順序（不執行正式修改）

**現況不能直接拿 Browser 傳入的整份 ERP JSONB，也不能把 `erp_company_states.data` 或 `erp_states.data` 的 SELECT 權限擴大給 PDF Worker。** 安全的下一步至少需要以下設計，並在獨立虛構環境驗證：

1. **受信任的文件級來源投影**：只包含該張請款所需的 `company_id`、`document_id`、`target_billing_id`、`revision`、來源同步版本／SHA-256 及核定的建商對外欄位；不包含無關的公司內部薪資、銀行、其他建商或原發票對照。
2. **一致性問題先解決**：現有正式請款存在 ERP JSONB 快照。新投影若獨立更新，必須嚴格避免「ERP 保存已成功但單筆投影還是舊版」的競態；需要在真正受信任資料來源完成原子／版本綁定的設計和隔離測試後，才能談正式 schema／同步流程變更。
3. **真實身分＋文件權限**：由可信服務獨立驗 JWT、session、AAL2、有效公司成員及**文件 ACL**，不能只看前端 role。核准人制度（owner/admin 或 owner-only，及單人例外）尚未獲負責人正式採用。
4. **核准與財務分開**：可信且持久的版本簽核要跟原施工明細的核定來源一致；不能自行改正式折讓、應收、發票、保留款、銀行、薪資或抽成。
5. **PDF 交付前最後閘門**：對外只顯示合併目標區、保留原施工明細／最下方彙總、不能露出其他區或原發票資訊；完成 A4/章印/LOGO 和「驗證 bytes 與交付 bytes 同一份」驗收，並保留過往合法歷史列印的原路徑。

## 4. PR 的 CI 能證明什麼、不能證明什麼？

`.p40-16be-review/decision.json` 是**2026-11-19 的人工整理、匿名化 LIVE metadata 快照**，不是 GitHub CI 即時查 Supabase 的連線設定。它明確標示 `jwt_current_algorithm_verified:false`、`trusted_document_projection_exists:false`、`production_release:BLOCKED`。

`.p40-16be-tests/test_verified_boundaries.cjs` 的 Node 離線測試核對正式 **main** 來源與匿名化結果，確保**不可誤宣稱**：

- 有公司資料欄位的 RLS policy 就等於 `authenticated` 有 `data` 欄 SELECT grant；
- 有員工投影函式就等於已存在請款 PDF/折讓可信函式；
- 任意 JSONB 快照就等於安全單筆來源；
- P40-16BD 假 RS256 PASS 就等於正式現行 JWT 演算法已知；
- 沒有公開 JWKS 回應就一定是 HS256；
- 模擬測試 PASS 就等於最新 SYNCED、備份可還原、真實手機/電腦或正式財務全驗收已完成。

GitHub Actions 會釘住正式 `main`／`beta` SHA，嚴格限定**只新增本階段 4 個隔離檔案**，逐項證明任何正式 ERP JS／HTML、原 PDF、登入同步或部署檔案都沒有更動。

## 5. 正式上線仍然 BLOCKED

尚未完成真正正式 JWT 演算法、信任來源、確定公司核准制度、保存可靠核准紀錄、文件級權限、正式對外隱私與 PDF bytes、最新 `SYNCED`、可還原備份、完整會計回歸、公司大小章/LOGO、手機／電腦實機驗收。**任何資料庫 schema/RLS、GitHub `main` 或正式發布仍須負責人另行明確授權；測試全通過也不能自動發布。**

**結論：本階段是唯讀的實際資料結構與安全差異確認；發現核心阻擋點後已保守標為 UNKNOWN/BLOCKED，未動任何正式資料。**
