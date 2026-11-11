# 酷舍 ERP｜P39-3F 本機 Supabase Auth／RLS 實機驗收報告

日期：2026-11-11（台灣時間）
Repo：jacky54508-pixel/kushe-erp-mobile
測試分支：p39-3-allowance-candidate-20261111
正式 main：39b8d543d785f0e0e2c468bed16d8f2e2efaa0fb
原 beta：62669539053a15174081ba8670b18248195c6f8c

## 實際執行項目

- 在 GitHub Actions 的臨時 Linux runner，用 **Supabase CLI v3.1.0** 啟動 Docker 內的本機 Supabase。
- CLI 執行 init、migration new、start、db reset --local；只套用候選資料夾的虛構 SQL，並以 stop --no-backup 銷毀測試環境。
- 本機 Auth 實際建立四個虛構帳號：相同公司 owner、approver、employee；另一公司 owner。
- 利用真正的 GoTrue 密碼登入及身分 JWT，透過 PostgREST 及資料庫 RLS 區隔不同公司、角色權限。角色資料存放於 DB 成員表，不使用可由用戶自行修改的 user_metadata 做權限判斷。
- 以本機 PostgreSQL 的 SECURITY INVOKER SQL RPC 執行版本 CAS、SELECT FOR UPDATE、唯一防重複操作鍵、折讓後有效應收與保留款核對及失敗回滾。
- 原始請款、發票、應收、銀行及薪資內容保持不變；合成折讓單不會冒充已完成合法電子折讓證明。
- 任何非 localhost／127.0.0.1 的 API／資料庫位址均不被測試接受。沒有連結、寫入正式 Supabase，也沒有建立新的遠端專案。

## 候選檔案

1. p39-candidate/local-supabase/schema.sql：本機測試用的 p39f_members、p39f_snapshots、p39f_allowances，RLS 與 SECURITY INVOKER RPC。
2. p39-candidate/local-supabase/local-rls.test.py：四個虛構 Auth 使用者、RLS／兩個 HTTP 用戶端、失敗回滾測試。
3. .github/workflows/p39-3f-local-supabase.yml：固定 Supabase CLI v3.1.0，在一次性環境啟動、測試並清除本機服務。
4. .github/workflows/p39-3-candidate.yml：保留原有候選分支安全更動範圍檢查。

## 驗收結果

**PASS：13 / 13 項真正的本機 Supabase 整合測試。**

GitHub Actions：
https://github.com/jacky54508-pixel/kushe-erp-mobile/actions/runs/43035192261

- 真正的 Auth 登入與錯誤密碼拒絕。
- RLS 成員可讀本公司，其他公司看不到；匿名沒有權限。
- 登入的一般員工不可自行新增 owner 成員或核准折讓。
- 其他公司的 owner 不得替本公司入帳。
- 原請款合成 JSON 資料不能被前端直接改寫。
- 兩個授權帳號同時提交相同操作識別碼：僅建立一筆。
- 舊版本提交拒絕；同識別碼但核定金額不同時拒絕。
- 交易中故意中斷：版本及折讓帳均完整回滾。
- 已開票、已有收款、員工抽成或支票歷程：拒絕折讓。
- 免開票案件正確試算有效應收與保留款，不生成營業稅。
- 第二個帳號重新送出成功的同一筆交易，只返回原有結果。
- 所有本機連線鎖定 loopback，資料庫開啟 RLS，SQL RPC 採 SECURITY INVOKER。

## 正式上線仍須 HOLD

- 這是本機 Supabase Auth／RLS／PostgREST 真實元件的測試，不是遠端 Supabase 或正式雲端跨裝置實測。
- p39f_* 屬於合成測試模型，不是正式 ERP 資料結構；目前合成折讓交易也不接受任何真實資料。
- 測試授權的 owner／approver 有單欄 revision 更新與合成折讓新增權限，正式過帳 API 必須另設更嚴謹的寫入保護、資料來源證明與限制；**測試 schema 不可直接移到正式環境**。
- 已開電子發票必須通過合法電子折讓開立／傳輸／存證與會計核對，本測試不提供官方驗證。
- 正式 PDF、收款、保留款、銀行、員工抽成、歷史薪資及跨裝置同步的正式業務寫入驗收尚未完成。
- 沒有改動正式 main、beta、正式 kushe-erp-cloud、kushe-auth-lab 或任何真實資料，也沒有建立付費資源、部署正式 ERP。

建議下一階段 P39-3G：在獨立候選分支進行正式交易契約與各帳務模組的相容性查核，正式發佈前必須再次由負責人明確同意。

**本機 Auth/RLS：PASS；正式版上線：HOLD。**
