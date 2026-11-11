# P39-3E｜獨立資料庫雙用戶端測試驗收紀錄

日期：2026-11-11（Asia/Taipei）
工作分支：p39-3-allowance-candidate-20261111
正式 main 基準：39b8d543d785f0e0e2c468bed16d8f2e2efaa0fb

## 操作隔離

1. **沒有使用正式 Supabase**：不使用正式專案的網址、service role key、登入資訊或任何真實業務資料。
2. **沒有解除既有獨立 auth-lab 的 READ ONLY 限制**。該專案保持不變。
3. 在 GitHub Actions 的一次性 ubuntu-24.04 runner 中啟動 PostgreSQL 17.6 容器，透過 127.0.0.1 的臨時 HTTP gateway 測試。
4. 全部測試資料使用 P39 synthetic marker 及 SYN- ID；資料庫 SQL 也設有虛構標記 CHECK。
5. 除候選 GitHub 分支之外，沒有修改 main、beta、正式 Supabase、真實 ERP 或任何 Cloudflare / GitHub Pages 正式部署。

## 程式與腳本

- p39-candidate/isolated-postgres-schema.sql：測試資料庫快照資料表、唯一操作 ID、來源 CHECK 與已提交版本約束。
- p39-candidate/isolated-postgres-domain.js：透過既有 P39 core.js、scenario-gate.js、voucher-review.js、effective-accounting.js 執行真實的合成資料帳務試算與原始資料保護。
- p39-candidate/isolated-postgres-http.test.py：具備資料庫事務鎖、CAS（版本比較後更新）、防重複操作、兩個獨立 HTTP 用戶端及失敗注入的臨時 gateway 測試。
- .github/workflows/p39-3-candidate.yml：新增第三組獨立 PostgreSQL CI 工作，與原有 ERP 回歸及虛構域測試並行。

## 本輪測試：三組 GitHub Actions 全部 PASS

Workflow run：
https://github.com/jacky54508-pixel/kushe-erp-mobile/actions/runs/42966338859

PostgreSQL 9 項實際測試：
1. 兩個用戶端同時提交相同操作識別碼：唯一入帳、另一端回覆重播成功。
2. 過期版本提交拒絕。
3. 相同操作識別碼、不同議價金額：防竄改拒絕。
4. 故意在 COMMIT 前中斷：資料庫完整回滾，不會部分改寫。
5. 已成功 COMMIT 但 HTTP 回應丟失：重送只取得原交易。
6. 免開發票：不產生稅額、有效應收與保留款勾稽。
7. 已開發票／已收款／抽成存在／支票歷程：阻擋測試交易。
8. 非測試身份與非 SYN- 來源：拒絕。
9. HTTP gateway 重啟後：從 PostgreSQL 重新讀取到同一已提交版本。

原始請款、原發票、原應收、銀行、薪資資料不因模擬折讓被覆蓋。

## 仍未通過的正式上線安全關卡

- **這不是遠端 Supabase 雲端實測**。它是 GitHub hosted runner 上的獨立 PostgreSQL + HTTP，不能直接推論真實 Supabase Auth、RLS、Realtime、跨裝置及雲端復原都正確。
- 既有 auth-lab READ ONLY，不能拿來進行折讓寫入；也不能拿正式 erp-cloud 作壓力測試。
- P39 真實折讓 Store writer 未開啟：仍僅允許 localhost 虛構資料，正式資料一律拒絕。
- 已開電子發票必須先由合法流程完成電子折讓證明的開立、傳輸、存證、對應發票核對；目前系統僅有合成證據閘門。
- 正式對外請款 PDF 與獨立折讓對帳摘要不得混同，正式月結／稅務報表需另外驗收。
- 員工抽成、已發薪或已收款案件不能自動重算，必須有經核對的獨立追溯調整方案。

## 下一階段 P39-3F 前置條件

若要做真正的遠端 Supabase 多裝置寫入測試，需要用戶**明確同意**建立一個全新的獨立測試專案（可能有額外資源與費用），設定完整的合成身份、Auth/RLS 與交易 API；不能重啟 READ ONLY 的 auth-lab、不能把真實資料複製進測試環境。

如果尚未獲得這項授權，可繼續在現有候選分支進行 GitHub CI、PDF 與薪資交叉檢查，但不得聲稱已完成遠端雲端驗收或發布正式 main。
