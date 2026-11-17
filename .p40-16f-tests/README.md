# P40-16F｜隔離 PostgreSQL 雙租戶 RLS、最小權限及受控 RPC 測試

**測試範圍：GitHub CI 產生的一次性 PostgreSQL 16 資料庫。絕不在正式 Supabase 執行，也不讀取／複製真實 ERP 請款。**

## 本階段包含
- `isolated_roles_rls_rpc.sql`：CI 專屬虛構公司 A/B 的獨立資料庫登入帳號、RLS、只允許 SELECT 的角色，以及專用不可登入的 `p40f_executor`；所有角色只用測試密碼。
- `simulate_approved_adjustment`：僅供**虛構資料**使用的限權、固定 search_path 的 SECURITY DEFINER 函式。透過 PostgreSQL 的真實 `session_user` 判斷所屬虛構公司；在文件 `FOR UPDATE` 鎖下驗證版本、快照、逐張原單、營業稅／保留款／應收加總、開票與收款狀態、唯一操作鍵。測試後在虛構表追加事件，不修改原單。
- `fake_ar_projection` 使用 PostgreSQL 16 的 `security_invoker=true`，讓視圖使用查詢者本身的 RLS 權限，計算原應收及虛構折讓調整後應收。
- `test_rls_rpc.py`：使用**不同實際登入帳號**（不使用管理員的 `SET ROLE` 假裝登入）驗證租戶隔離，未授權直接 INSERT/UPDATE/DELETE、跨公司 RPC、漏驗證、發票已開立、已有收款、分攤錯誤、兩條連線同時提交及重送。
- CI 仍執行先前 P40-16A/B/C/D 的 Node 回歸測試。測試資料與報價／請款實務無關，不涉及正式資料。

## 安全與會計邊界
1. `SECURITY DEFINER` 必須非常謹慎：測試專用函式擁有者 `p40f_executor` 沒有 LOGIN、SUPERUSER、BYPASSRLS；函式固定可信 `search_path`，撤除 PUBLIC 執行權限，只授予兩個虛構登入角色。正式環境不可以直接複製此函式或權限設計。
2. 在 GitHub CI 中 `session_user` 可對應兩個真實 PostgreSQL 登入角色；**正式 Supabase API / 連線池通常不會每個終端使用者有一個獨立 PostgreSQL LOGIN**，因此不能使用此 lab 的 `session_user` 作正式使用者授權。未來須設計可信驗證的身份、伺服器端 ACL/RLS、角色與權限策略，且使用者可自行修改的 claims 不能作為授權依據。
3. `p_synthetic_reviewer_confirmed=true` 只是 CI 虛構輸入；**不是會計核定、法定折讓憑證或正式入帳授權**。合法營業稅處理、電子發票折讓證明、已申報發票、收款退款、保留款、員工抽成及已付薪資皆尚未實作。
4. `fake_ar_projection` 只是數學投影，**不是正式應收、銀行或對外 PDF**。虛構源單完整保留；沒有任何正式 ERP 業務資料被更動。
5. 本測試只處理未開票且未收款的虛構成功案例；**已開票、已收款、待兌支票一律阻擋**。未來須額外核定這些合法調整程序。
6. 僅有三張 `fake_*` 交易表；沒有任何真實請款、發票、銀行、薪資、抽成或其他業務表。
7. 角色管理和函式建立是 CI 本機管理員操作，不能代表部署時的角色配置已安全。資料庫最小權限、稽核、API 不可繞過驗證、RLS 對連線池的行為，仍需另外在獨立環境驗收。

## 後續工作
P40-16G 可先研究正式 Supabase 身份／RPC／RLS 的**唯讀設計**，建立等價的隔離授權測試，並以虛構業務資料測試已開票／收款／保留款的受控調整建議。即使完成，仍不得沒有獨立授權就啟用正式折讓入帳或修改 main/beta。

**參考：**
- PostgreSQL 16 [Row Security Policies](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)
- PostgreSQL 16 [Function Security](https://www.postgresql.org/docs/16/perm-functions.html)
- PostgreSQL 16 [System Information Functions](https://www.postgresql.org/docs/16/functions-info.html)
