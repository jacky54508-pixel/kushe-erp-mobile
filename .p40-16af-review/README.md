# P40-16AF｜正式 Supabase 資料來源唯讀查核與 PDF 閘門

**執行範圍：2026-11-18，READ ONLY METADATA。** 本階段只讀取正式 Supabase 公開 schema 的資料表、欄位、RLS 政策中繼資料及可見函式名稱。沒有 SELECT 任何客戶、請款、發票、薪資、銀行或 ERP JSON 內容，沒有 INSERT/UPDATE/DELETE、migration、RPC 呼叫或部署。

## 核對資訊與來源限制

- 正式 GitHub main 的前端設定 Supabase URL，與本次連線名為 kushe-erp-cloud 的專案參照一致。另一個測試專案 kushe-auth-lab 處於 inactive，沒有連接或修改。
- 公開 schema 目前四張表：erp_states、erp_company_states、companies、company_members。
- erp_states 的主鍵為 user_id，包含 data jsonb、sync_version 和時間/來源版本欄位；erp_company_states 的主鍵為 company_id，也包含 data jsonb 和同步版本欄位。
- companies 存公司身分欄位，company_members 存公司、使用者、角色及狀態欄位。
- 公開四張表的 RLS 均啟用。政策中可見限制性（RESTRICTIVE）p20_require_mfa_aal2 規則；這是**政策存在的查核**，不是用真實登入與查詢證明它在每種行為下均能限制存取。
- 搜尋公開 schema 的可見函式名稱，未發現針對單筆請款、PDF、billing 或 document 的函式；與狀態資料相關者包含 erp_state_cas_write、erp_state_cas_write_v2 及 erp_states_enforce_sync_version。沒有呼叫任何函式或查看其程式內容。
- **沒有確認任何非 public 的內部 schema 或其他外部服務**；不可把「公開 schema 未發現」擴大為「所有系統絕對不存在」。
- 正式 assets/js/cloud-sync.js 的 readRemote() 會透過 erp_states 資料列擷取整個 data，而不是已隔離的 billingId 單筆列印資料。正式程式亦含公司層資料同步。未驗證正式 PDF 所需業務資料如何在雲端索引至單筆請款。

## 重要結論 G1 = BLOCKED

現有可查證的公開資料結構，沒有現成的「按公司、請款 ID、修訂版本，僅回傳一筆對外請款白名單資料」的安全來源。即使允許讀取一筆 erp_states／erp_company_states 資料列，回傳的 data 仍可能包含整份 ERP；**不能**因 RLS 已啟用就把整份 JSON 傳給新 PDF 服務。

正式整合之前，**禁止**：傳整份 IndexedDB、Emergency mirror、erp_states.data、erp_company_states.data、帳務備份；將資料庫管理密鑰放在前端；建立新 table/view/RPC/Edge Function 或修改既有 RLS／schema；變更 main/beta 或正式請款／發票／薪資／銀行／抽成資料。

## 安全架構選擇

1. **A. 單筆已授權服務端來源（最佳目標，但須另取得資料庫修改與部署授權）**：專用、唯讀且最小權限的單筆資料投影；請求僅含 documentType、billingId、targetProjectId、expectedRevision；服務端驗 JWT/MFA、公司成員、文件所有權／版本／金額，從可信單筆來源組成對外 View，PDF 渲染＋A4/內容/私密欄位驗證後交付同一份 PDF。若需建立表/RPC/投影同步，必須另提 schema 與一致性／RLS／回滾設計、正式備份、授權，**本階段不實作**。
2. **B. 裝置本地保護型 PDF（保密優先備案）**：在授權使用者的本機產生 PDF 並驗證，不向外部服務傳送帳務。仍需解決 Chrome 原生網頁無可靠列印頁數 API、獨立 PDF 引擎與真實手機/電腦流程一致性問題；P40-16AB 已否定單純 DOM 高度估算。
3. **禁止方案**：前端直接把整份 ERP、銀行、薪資或來源快照送到外部 PDF 服務；服務端直接以使用者聲稱的金額、companyId、單號為可信身分與金額；未驗證 PDF 就直接提供列印下載。

## 各階段正式進入條件

- G1：可信單筆資料來源存在並且無法讀到無關紀錄；目前 BLOCKED。
- G2：真實服務端驗證 JWT/最新 MFA/公司及文件權限、RLS 防越權；目前未驗收，前階段 P40-16AE 僅用虛構模擬通過。
- G3：與既有對外 PDF 的單筆／合併／跨區及歷史版本、發票隱私、稅額保留款、施工明細相符；待驗證。
- G4：真正 Chrome A4 渲染頁數/文字/大小章與同一 PDF bytes 雜湊核驗；P40-16AC 僅虛構外部 Playwright 原型通過。
- G5：重新由當時最新 main 開最小候選，最新 SYNCED、完整可還原備份、CI、手機電腦／正式 PDF 視覺驗收，另得使用者明確正式發佈授權；目前沒有授權。

**本研究分支僅記錄這次唯讀查核及純虛構阻擋測試，GitHub CI 綠燈不表示 G1 或正式發布通過。**

參考：https://supabase.com/docs/guides/database/postgres/row-level-security 及 https://supabase.com/docs/guides/functions/auth-headers
