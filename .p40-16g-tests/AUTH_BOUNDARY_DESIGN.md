# P40-16G｜正式 ERP 身分授權與 RLS/RPC 的隔離驗證（唯讀設計）

**範圍**：只在 GitHub Actions 一次性 PostgreSQL 16 `p40_16g_ci` 使用 **FAKE-*/SYNTH-*** 虛構資料。沒有正式 Supabase 連線、資料讀寫、Schema Migration、網頁部署或正式折讓入帳。

## 1. 已查核目前正式程式的實際架構

以正式 `main=2ab9c9d5944b1360ba3eebf49695713168caca8a` 唯讀原始碼為準：

- `assets/js/auth-gate.js` 的 `resolveCompanyContext()` 在登入、MFA AAL2 完成後，透過 Supabase REST 讀取 `company_members`、`companies` 與 `erp_company_states`，限制同一個 user 只有一筆有效公司身分，角色為 `owner/admin/accounting/employee`；`canView/canWrite` 為前端模組導航／畫面權限，**不是可保護帳務入帳的資料庫授權**。
- `assets/js/app.js` 的登入路由仍保留 `legacySourceUserId` 為正式完整 ERP 使用者的限制；普通非 legacy 管理員／會計不會自動開通共用業務資料，員工使用獨立 shell。
- `assets/js/cloud-sync.js` 的業務快照仍存取 `erp_states` 中 `user_id=目前登入者` 的資料，寫入經過 `erp_state_cas_write_v2`。公司 `erp_company_states` 目前用於認證公司身分／狀態核對，不代表正式帳務入帳已遷移成多公司共享交易台帳。
- 因此**不可直接把 P40-16F 的每家公司獨立 SQL LOGIN／`session_user` 角色模型套用到正式 ERP**，也不能用前端的 `companyContext.role`、自訂 JSON metadata 或既有整份快照寫入，授權折讓入帳。

## 2. 官方文件核對原則

- Supabase [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)：暴露的 schema 必須啟用 RLS，SQL 建表須自行啟用；`authenticated` 表示已登入**不是**特定公司有權操作。
- Supabase [Auth Users](https://supabase.com/docs/guides/auth/users)：`user_metadata` 可由使用者自行修改，不能做安全決策；即便 `app_metadata` 較可信，也可能因舊 JWT 而延遲反映權限變化。
- Supabase [Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks)：Custom Access Token hook 的資料必須經伺服器信任邊界驗證，不能假設直接 SQL 連線裡自設的 `request.jwt.claims` 是真實 JWT。
- 永遠不能在公開前端置入 service role 或 Secret key。若設計 `SECURITY DEFINER` 應置於非公開 schema、收回 PUBLIC EXECUTE、固定 `search_path`、建立最小權限擁有者，並評估能否用 `SECURITY INVOKER` 更安全地實作。

## 3. 本階段隔離實作

- `.p40-16g-tests/isolated_gateway_rls.sql`：建立 p40g_authenticated／p40g_anon **NOLOGIN** 模擬角色、虛構公司 A/B、會員資料、請款來源、發票和收款資料表。五張表都有 RLS，角色只有 SELECT，不開放 DML。會員與公司範圍以**當下資料庫會員狀態**核對，需唯一有效公司會員且 owner/admin/accounting 才能閱覽請款，employee 禁止。
- `preview_discount` 為 `SECURITY INVOKER` 的 **唯讀**計算 RPC；要求模擬驗證權杖 `sub`、`aal2`、有效期限，當下會員權限，版本、來源金額核對。任何結果 `canPost=false`、`canSave=false`。
- `fake_ar_summary` 使用 `security_invoker=true`，讓視圖依當下請求人的 RLS 控制讀取公司應收數字。已開發票／已有收款只回傳 `REQUIRES_ACCOUNTING`，不調整原單、不產生折讓憑證。
- `.p40-16g-tests/test_gateway_rls.py`：以 CI 管理員模擬可信 PostgREST 設定 GUC 的情境；測試 A/B 公司隔離、偽造 `user_metadata/app_metadata` 無法取得 owner 權限、MFA 未達 AAL2、JWT 過期、會員停權、同使用者多有效公司、匿名使用者、跨公司查詢、直接 SQL 寫入被拒絕、原始資料零變動、已開票與收款風險。

## 4. 不可忽略的信任界線

**本測試沒有驗證 JWT 簽名！** PostgreSQL 的 `request.jwt.claim.*` 本身只是 session GUC；持有**未受控直接 SQL 連線**的攻擊者有可能自行設定它。測試透過 CI 管理員設定 claim 模擬「已受可信 API Gateway 驗證的結果」，驗證的是**RLS 與會員授權邏輯**，不是可信 JWT 驗證端到端安全。正式 Supabase 的身份必須在 **Auth/PostgREST/受控後端** 確實驗證，將權杖與 `auth.uid()`、企業會員權限安全綁定；不得讓前端直接傳送可信 uid/role/company_id 讓資料庫照單全收。正式環境必須禁止資料庫直接連線、特權 SQL/RPC、公開的 `SECURITY DEFINER` 等繞過路徑。

目前模擬直接以 `current_setting('request.jwt.claim.sub',true)` 取得使用者；**這不是正式 RPC/授權程式**，不能部署。JWT 被註銷但仍在有效期內、Auth Session 撤銷、MFA 狀態降級與多裝置登入也仍須獨立測試；資料庫會員即時停權只能縮減部分風險。

## 5. 必須另外完成的正式入帳門檻

1. 先核對真實 `company_members`、`erp_company_states`、legacy `erp_states` 的讀取／寫入授權和 schema，但**不得改動正式資料**；確認公司共用資料切換策略，不可私自遷移正在大量使用的資料。
2. 隔離真實 PostgREST/Auth 服務，用**真的已驗證** JWT、兩家公司、兩種權限與 MFA 測試 RLS/RPC；驗證跨企業/直接 DB/權限撤銷及快照競態。
3. 分離只讀折讓核定、正式追加式調整事件、原單應收投影、收款退款與發票折讓證明；避免修改整份 IndexedDB/ERP 快照覆蓋既有資料。
4. 建商核定的原單分攤、已開立電子/紙本發票的法定折讓憑證及營業稅、已收款、保留款與員工已付／未付抽成須**人工核定**。
5. 發布前另行取得 owner **明確的正式寫入與部署授權**；完整 SYNCED、安全備份、可還原驗證、CI、權限、資料串聯都必須 PASS。任何一項失敗立即停止。

**本 PR 為獨立測試，不在 index.html 載入，不修改 main/beta，不開通正式入帳。**
