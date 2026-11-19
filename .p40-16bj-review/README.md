# P40-16BJ｜臨時 PostgreSQL 17 RLS、單筆請款來源交易與版本競態驗證

**DRAFT / FAKE ONLY / NO MERGE / NO DEPLOY / NEVER CONNECT PRODUCTION.**

## 隔離界線

GitHub Actions 使用單獨的 `postgres:17` 服務容器，資料庫名稱 `p40bj_fake_only`。所有公司、員工、session、請款、目標區、發票與金額都是虛構測資，SQL 不會連接正式 Supabase、正式 ERP 或真實客戶、員工、銀行資料。不存取 `auth.users`、Supabase 現行 JWT、service key、完整正式 JSONB 快照，不寫入 GitHub 正式 `main` 或 `beta`。

此次 GitHub 候選從正式 `main` `2ab9c9d5944b1360ba3eebf49695713168caca8a` 獨立建立，只新增 `.p40-16bj-*` 報告、虛構 SQL、競態測試腳本及 CI。禁止合併／禁止部署。

## 實際設計與測試

- 在臨時 PostgreSQL 建立 `p40bj` 封閉 schema、假公司會員、假 session、逐文件 ACL、假來源 snapshots、單筆對外投影 documents、append-only audit_events。
- 所有表 `ENABLE ROW LEVEL SECURITY` 與 `FORCE ROW LEVEL SECURITY`，假 reader/writer 都無 `SUPERUSER` / `BYPASSRLS`。假 reader **沒有** `snapshots` 的 SELECT 與 `commit_fake_snapshot` 的 EXECUTE，不能直接取得完整測資。
- 假 reader 的 RLS 要同時符合假 session + 假 AAL2 + 有效公司角色 + 文件 ACL + 文件 current approved revision；`read_one_document` 額外綁定文件 ID、唯一目標區、來源 sync_version、文件 revision。
- 假 writer 在單個 PostgreSQL 函式交易中對假來源 row lock、CAS 版本、更新快照、白名單投影與審核狀態、建立 audit 事件；新版本標為 `pending_review`，舊核准不能直接沿用。`SECURITY INVOKER`，沒有以 `SECURITY DEFINER` 偷繞過 RLS。
- 反例測試包括跨公司、同公司未獲 ACL、錯誤目標區、錯誤版次與同步版本、非會計員工、AAL1、失效 session、完整 JSONB 讀取/寫入權限、私人欄位外洩；原子失敗中途回滾、重複/舊版本拒絕、兩連線競爭單一成功與單一 audit。
- `customer_projection` 從**已在假資料庫內**的完整假來源，以明確欄位 allowlist 產生對外資料（施工項目、指定區、金額與審查後對外備註），不允許把未處理的來源、內部薪資、銀行或其他區/發票清單當作對外 PDF 輸出。

## 誠實限制（正式發布仍 BLOCKED）

這不是正式 Supabase Auth 端對 JWT 的簽章、session 或 AAL2 驗證。`request.jwt.claim.*` 只是由 CI 管理者手動設置的假請求值，**不可以直接開放給不可信使用者自行 SET**。真正服務端須由可信 PostgREST/JWT 驗證鏈建立 claims，並再次核實可撤銷的 session、即時公司會員、文件 ACL 與持久核准。`customer_projection` 依賴已受信任的資料，尚未證明正式 ERP 的 `erp_states.data`／`erp_company_states.data` 如何可信、原子且不外送完整 JSONB 地生成單張核准投影。自由文字的對外備註仍需要實際審查。

SQLite P40-16BI、此 PostgreSQL CI、及之前 P40-16AU 的 RLS 模型都**不是正式資料接入／跨裝置同步／真實財務或 PDF bytes 實測**。仍須通過真實資料來源版本、備份可還原、正式驗證、行動/桌面、發票、折讓、保留款、薪資、抽成、銀行、印章/LOGO 和 PDF 逐位元組交付的獨立驗收。既有已確認歷史請款不可被新原型一律阻斷。

**只有 GitHub Actions 真正以 postgres:17 完成執行，才能稱為 PostgreSQL CI PASS。** 在 CI 證據之前僅能標示隔離測試已提交、待驗證。任何正式 `main`、beta、資料庫 schema/RLS、Edge、網站發佈皆須負責人另行明確批准。

## GitHub Actions 確認（2026-11-19）

[GitHub CI #44530644606](https://github.com/jacky54508-pixel/kushe-erp-mobile/actions/runs/44530644606) **SUCCESS**。`postgres:17` 真的啟動；RLS 與欄位白名單、假 ACL/AAL2/session、版本綁定、錯誤更新回滾、舊版禁止核准沿用、雙連線一成功一衝突及單一 audit event 均通過。GitHub CI 項目已核對成功日誌，這仍**不是**正式 Supabase Auth、真實請款或正式 PDF bytes 的驗證；正式發布仍為 BLOCKED。
