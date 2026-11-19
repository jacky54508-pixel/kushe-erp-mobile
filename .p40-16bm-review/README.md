# P40-16BM｜正式 ERP 可信請款來源與核准制度：唯讀決策門禁

> **DRAFT / 只新增報告、純函式門禁與靜態測試 / NO MERGE / NO DEPLOY / NO PRODUCTION DB ACCESS。**
>
> 2026-11-19（台灣）；正式 `main` 釘選 `2ab9c9d5944b1360ba3eebf49695713168caca8a`；正式 `beta` `62669539053a15174081ba8670b18248195c6f8c`。沒有修改原 ERP、雲端同步、PDF、財務程式、Supabase schema/RLS/Edge，沒有讀寫任何真實業務資料列。

## 1. 目前確定的正式程式事實

- `assets/js/cloud-sync.js`：`remotePath()` 在使用者範圍讀 `public.erp_states.data` **整份 JSONB** 與 `sync_version`；`casWrite()` 經 `erp_state_cas_write_v2` 更新。**這不是文件級 API，更不因為 CAS 成功就證明所有由瀏覽器填寫的財務內容有獨立可信證據。**
- `assets/js/auth-gate.js`：`resolveCompanyContext()` 在前端讀取 `company_members` 角色、`companies` 與 `erp_company_states` 的**同步 metadata**。它能建立現有使用者的公司視圖，卻不能直接當成新伺服器的單筆文件授權／不可撤銷核准。前端 `shadowVerified` 也不是伺服器獨立授權證據。
- `assets/js/erp-store.js`：合併對外文件位於 `state.meta.externalBillingDocuments`，有 `sourceSnapshots`、`settlementSnapshots`、`targetBillingId`、`revision` 與 `history`；現有保存依靠原始帳款及來源快照核對。不得整批覆寫既有大量文件或強制對既有版本補登新核准。
- `assets/js/billing-groups.js` 和 `assets/js/external-billing-print.js`：現在/歷史列印走不同路徑。當前列印只應顯示指定目標區；**歷史列印分支仍會顯示原單/發票對照**，因此不能未審查就當成新服務可直接對外提供的格式。現有路徑本階段一律不動。
- Supabase Dashboard 上 Current ECC P-256 / `ES256` 由先前使用者截圖確認；**未取得真實 JWT、檢查有效/已撤銷 session 或逐文件 ACL**。模型測試與假 JWT 均不能頂替正式證據。

## 2. 建議的最小風險設計（尚未獲負責人核准）

**短期：** 保留正式 ERP 的現有請款、歷史保存與 PDF 流程。新的核准／列印網關維持關閉，原有 `erp_states.data` 的 SELECT、Supabase schema/RLS/CAS 均不改。

**中期候選 A（優先審查）：** 在獨立、全假資料 PostgreSQL 中驗證「可信寫入流程＋單筆對外投影＋每次版次變更使核准失效＋不可竄改稽核」之同交易處理。**真正上線前必須先查明 `erp_states` 使用者資料與 `erp_company_states` 公司資料的正式權威關係**，不得假定兩者等價；須由可信伺服器核對當前來源、建立明確白名單投影，並以有效會話、AAL2、公司成員和逐文件 ACL、核准事件證實該文件被授權。僅將用戶端 JSONB 寫入 PostgreSQL 同一交易，不能自動把用戶端業務事實變為可信；需另外核對會計來源和實際核准者所確認的精確版本。

**候選 B：** 全面改為獨立規範化請款帳本。需要大量真實資料遷移及正式流程重寫，風險較高，**目前不建議開始**。

**同交易失敗規則：** 已儲存業務資料若造成單筆對外投影變舊，僅該份新對外核准／交付失效；不可為了附加功能阻止公司的每日施工、銀行或薪資正常保存。若 projection 更新失敗，既有同步怎麼安全成功、該文件如何標記待核對，都須先設計與證明，不能默認用整份 ERP JSONB 傳給 PDF 服務補救。與該請款無關的薪資或銀行更新，不應毫無理由讓所有核准失效。

## 3. 負責人尚需作的兩個獨立決策（本 PR 不代為批准）

| 決策 | 安全選項 | 本次狀態 |
|---|---|---|
| **誰是對外文件的唯一可信來源？** | 釐清使用者 `erp_states`、公司 `erp_company_states` 及現有帳務同步／權限的真正權威，選定可被伺服器核對、可原子保存的來源；不得擴大整份 JSONB 的讀取 grant | **未決定** |
| **誰可核准「變更對外施工明細」？** | A. 由 Owner 審核，若僅一人則另明確批准自我核准例外與稽核；B. 編輯者與 Owner/Admin 不得同一人（maker-checker） | **未決定；本階段任何核准都不能自動生效** |

原有已確認文件繼續沿原流程使用，但**新伺服器核准功能不能繼承舊核對勾選框**，也不能靜默擋住既有請款。

## 4. 必須維持 BLOCKED 的正式門檻

`decision.json` 列出 15 個需獨立完成的實證門檻，包括：可信資料源及公司歸屬、伺服器交易原子性、真 ES256 簽章驗證／Session 撤銷／AAL2、逐文件 ACL、負責人選定審查制度、持久版次稽核、歷史/新版對外隱私、實際同一份驗證與交付的 PDF bytes、折讓/保留款/發票/應收/銀行/薪資/抽成回歸、最新 `SYNCED` 與完整可還原備份、手機/電腦驗收，及另外明確的正式發布授權。

`.p40-16bm-tests/release-gate.cjs` 是**只讀、不聯網、不能執行部署的檢查清單純函式**：任一缺少即回 `BLOCKED`；即使模擬全部門檻為 `true`，也僅回 `REVIEW_READY_NO_AUTODEPLOY`，絕不回發布成功。測試只驗證守門邏輯與正式程式邊界，**不是**正式授權測試，也不代表已核實 owner 權限、財務真實性、JWT 或 PDF。

GitHub Actions 嚴格限制 **新增五個文件**、釘選 `main`/`beta` SHA，確認所有 ERP JS/HTML/PDF、主站部署檔與原有 CI 無變動；在正式倉庫 checkout 才執行來源對照。**任何一項失敗立即停止；不得自動合併或部署。**

**結論：P40-16BM 定義並鎖定尚未取得授權的正式整合設計與門檻。正式發布維持 BLOCKED；不修改任何正式資料。**

Supabase 官方背景：
- https://supabase.com/docs/guides/auth/signing-keys
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/api/securing-your-api
