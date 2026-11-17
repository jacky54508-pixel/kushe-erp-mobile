# P40-16E｜隔離 PostgreSQL 真實交易測試（正式 ERP 完全不動）

**狀態：CI 一次性虛構資料庫驗收。未合併 main／beta，未連線、修改或部署任何正式 Supabase 專案。**

## 一、本階段達成什麼

在 GitHub Actions 的 Ubuntu Runner 啟動 `postgres:16-alpine` Service Container，DB 名稱固定 `p40_16e_ci`，本地連線 `127.0.0.1`。此 DB 在 CI Job 結束後被移除，沒有任何真實資料。程式明確拒絕非 localhost 或不同 DB 名稱的連線。Job 不注入正式 ERP 或 Supabase 機密。

新增內容：

- `.p40-16e-tests/isolated_schema.sql`：三張 **synthetic_** 測試表；折讓與回沖事件、原單分攤明細、文件修訂版本；操作鍵、事件 ID、原事件回沖關聯的資料庫 UNIQUE／FK／CHECK；歷史事件禁止 UPDATE/DELETE。
- `.p40-16e-tests/test_transactions.py`：真正使用 Psycopg 3 及 PostgreSQL transaction，測試 `SELECT ... FOR UPDATE`、`UPDATE ... WHERE revision=expected` CAS 版本檢查、不同連線同時提交、同鍵重送、跨文件重複唯一鍵、交易失敗 ROLLBACK、已登載事件不可更改、回沖只新增反向事件及二次回沖阻擋。
- `.github/workflows/p40-16e-ephemeral-postgres.yml`：只在 P40-16E 候選分支啟動資料庫；比對 main 不變、只允許隔離檔案變更，完成後不部署網站。

## 二、交易測試證據

CI 完整 PASS：https://github.com/jacky54508-pixel/kushe-erp-mobile/actions/runs/43857169255

執行 `python .p40-16e-tests/test_transactions.py`：13 項測試全部 PASS。涵蓋：

1. 原單分攤假資料 632,100 → 600,000、折讓 32,100，一次新增事件及 2 張來源明細。
2. 相同操作鍵、相同內容重送，回傳 replay 不增加事件；相同操作鍵不同內容拒絕。
3. 兩個連線同時寫入同一文件與同一鍵，只產生 1 筆事件。
4. 不同操作鍵、相同舊版本同時提交，只允許一個成功，另一個因版本衝突被阻擋。
5. 不同文件共用操作鍵，測試資料庫 UNIQUE 約束拒絕重複，包括雙連線競爭。
6. 故意在交易已 INSERT 事件但未更新文件版本前拋出例外：ROLLBACK 後事件數與文件 revision 均不變。
7. 修改或刪除原事件、原單分攤均被資料庫 Trigger 拒絕。
8. 回沖只新增 `SIMULATED_REVERSAL`，原折讓及分攤不更動，淨折讓 0；同一回沖重送不重複、兩個連線競爭回沖只准一個成功。
9. 來源快照改變、跨文件回沖、分攤金額錯誤均停止。
10. 測試 Schema 只有三張虛構表，沒有真正的發票、銀行、薪資或應收表。

## 三、已知限制與絕對禁止

- **本實驗不是正式會計入帳。** `evidence_reviewed=True` 只是測試用輸入，不能視為建商核定、合法折讓證明、會計複核或真實帳務授權。
- P40-16A/B/C 的核對規則與 P40-16D 的 JS 純模擬，並沒有接上此 SQL Schema；**跨模組整合仍未驗證**。
- `SELECT FOR UPDATE` + CAS 已在臨時 PostgreSQL 中測試，但實際的正式資料同步、離線/多裝置衝突、RLS、最小權限、作廢發票、已申報電子折讓、收款、保留款、抽成與已付薪資**尚未整合測試**。
- append-only Trigger 不能取代 DB 角色權限、備份不可竄改及稽核；此 CI 以測試資料庫管理員執行，管理員仍能改 Schema 或 TRUNCATE。因此正式環境須建立最小權限角色、嚴格的 RPC／後端安全路徑、不可變稽核及災難回復測試。
- 假資料演練沒有真實 invoice discount proof 的合法性；應由會計依財政部規範確認原發票是否申報、買受人類別、電子或紙本憑證，以及折讓對應的法定程序。
- **沒有**正式 ERP 的 `index.html` 引入、`erp-store.js` 改動、Supabase Migration、正式帳務表或資料寫入，也沒有員工抽成重新計算。

## 四、下一步安全門檻（P40-16F，須另外確認範圍）

1. 以專用的**隔離** Postgres 測試 Schema，建立最小權限、RLS、受控 RPC 並測試不授權的直接寫入被拒絕。
2. 對照真實 ERP schema **唯讀**盤點欄位與唯一來源，不複製真實資料。
3. 以虛構發票／應收／保留款／收款／薪資資料進行完整關聯與同步衝突測試；設計追加式調整投影。
4. 由負責人與會計確認**真實**原單折讓分攤、發票折讓憑證及員工抽成／已付薪資規則。
5. 之後仍須最新 SYNCED、完整可還原備份、CI 與安全權限 PASS，以及新的明確正式寫入／發布授權；任何失敗都必須停止。

**禁止直接把 P40-16E 測試 Schema 套用到正式 Supabase；禁止將 PR 草稿合併 main 或 beta。**
