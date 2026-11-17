# P40-16H｜一次性 Supabase Auth GoTrue + PostgREST JWT 簽章驗證 + PostgreSQL RLS

**分支：`p40-16h-auth-postgrest-e2e-ci-20261116`。禁止合併到 main/beta，禁止部署，禁止使用正式 Supabase 帳號／金鑰／資料。**

## 測試範圍

相較 P40-16G 的「由測試 SQL 直接設定 JWT GUC」模擬，本階段改用 GitHub Actions **真正運行**以下測試容器：
- PostgreSQL 16：完全一次性 `p40_16h_ci`，資料表只有 `p40h_ci.fake_members`、`p40h_ci.fake_documents`，公司/單據皆為 `SYNTH-*` 虛構資料。
- Supabase Auth / GoTrue `supabase/gotrue:v2.197.0`：虛構 email/密碼登入、TOTP MFA，簽發有效期短的 JWT（AAL1 / AAL2），使用 CI 當次隨機產生的簽章密鑰。
- PostgREST `postgrest/postgrest:v14.18`：實際核對 JWT 的簽章、期限與 role，再把經驗證的 claims 放到資料庫 session，依 PostgreSQL RLS、公司會員與 MFA 規則做唯讀操作。

此設計只在 GitHub CI 自身的 localhost 運行，沒有任何正式網址、正式 Supabase API/DB、正式登入用戶或可修改正式資料的密鑰。GoTrue / PostgREST 使用的測試密鑰不提交 Git；CI 結束容器即移除。

## 程式／安全門檻

- `.p40-16h-tests/local_only_rls.sql`：PostgreSQL anon/authenticated/authenticator 測試角色（沒有財務資料寫權限）、RLS、每日只讀折讓 RPC，沒有折讓過帳、薪資、銀行、真實應收／發票或 PDF 功能。
- `.p40-16h-tests/real_auth_e2e.py`：透過真實 GoTrue signup / password token / TOTP challenge / verify，以及 HTTP 呼叫驗簽的 PostgREST 實際測試。
- `.github/workflows/p40-16h-auth-postgrest-e2e.yml`：先執行 main/beta SHA 不變及候選 diff 範圍閘門，才允許啟動一次性測試容器；如有任何預料外檔案或版本變更立即停止；續跑 P40-16A～D 回歸。

## 必須確認的安全行為

1. 正常 GoTrue password 登入取得的 `aal1` JWT 不能讀取受保護折讓資料；只有 TOTP 實際驗證升級的 `aal2` JWT 才可進行**唯讀試算**。
2. PostgREST 對 JWT **竄改或偽造內容、損壞簽章、無權杖、錯誤權杖**的操作拒絕，而不是只信任自行設定的 GUC。
3. 公司 A 的有效 AAL2 JWT 不得存取公司 B 的單據；公司會員在資料庫停權後，即使 JWT 仍在有效期內也不可繼續存取。
4. 已開發票與已收款的虛構單據只能回傳會計查核提醒，不能自動生成法定折讓單、修改原單、應收或薪資。
5. 透過 PostgREST 的未授權寫入（PATCH/POST）必須被資料庫權限拒絕。
6. 測試最後正式 ERP 來源全部未修改：`main`、`beta`、`index.html`、`auth-gate.js`、`cloud-sync.js`、`erp-store.js`、請款、應收、發票、薪資、銀行、抽成及 PDF。

## 重要限制

- 此為**一次性精簡版 GoTrue / PostgREST / PostgreSQL 堆疊**，並非完整 Supabase 託管專案配置。它證明測試版的驗簽與 RLS 行為，**不代表正式 Supabase 的生產環境已通過權限或滲透測試**。
- 此模型不能直接替換正在使用的 legacy `erp_states` 雲端快照與 `erp_state_cas_write_v2` 同步路徑。多帳號共用資料、在線權限撤銷、跨裝置競態、session 撤銷及真正後端稽核仍須另外設計。
- 合併請款 632,100 → 600,000（整張折讓 32,100）只是虛構測試案例。真實原單折讓分攤、已開票折讓憑證、稅務申報、保留款與已付款／未付款員工抽成的處理尚未獲得正式核定。
- **無論測試是否通過，不能自行合併／發布，也不能直接連結正式 Supabase 資料庫、建立正式折讓台帳或修改任何真實資料**。

## 下一階段提案

P40-16I 建議先做**正式資料模型的唯讀盤點及孤立帳務對照驗證**，避免複製正式資料或改寫原單。若有任何實際入帳功能要發布，仍須獨立明確授權、最新 SYNCED、完整備份、跨裝置及各帳務回歸、會計審核和 CI 全 PASS。
