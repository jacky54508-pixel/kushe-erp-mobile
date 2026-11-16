# P40-16M｜真實 ERP 同步模組的隔離整合驗收（不得入帳）

**禁止合併 main 或 beta／禁止部署／禁止讀取或寫入任何真實 ERP 與正式 Supabase 資料。**

## 與 P40-16L 的關鍵差異

P40-16L 使用自行設計的簡化型原生 Chromium 儲存模型。本階段 **直接載入正式 main 裡原封不動的 `assets/js/erp-store.js` 和 `assets/js/cloud-sync.js`**，讓 Chrome 在完全隔離的測試 Origin 呼叫這兩個真正的 Store / Cloud Sync 模組：

- CI Fixture URL：`http://127.0.0.1:8798/.p40-16m-tests/real_module_fixture.html`，**不是正式 ERP 網址**，不載入正式 `index.html`。
- Fixture 只注入 **虛構** `KusheAuthGate`（`SYNTHETIC-PRINCIPAL-ONLY`）、空的 `KuSheLegacyData` 與 `KUSHE_PHASE1_CONFIG`，其中 Supabase URL 是 `https://p40m.invalid`；絕不載入真正的 `assets/js/config.js` 或真實登入金鑰。
- Playwright 的 Context Route **攔截所有 HTTP/HTTPS**，僅放行本地 127.0.0.1:8798 及以 Python 內存模擬的 `p40m.invalid` GET/POST；其他網址一律取消並記錄。假 CAS 支援 `erp_states` GET、`erp_state_cas_write_v2` POST，核對預期版本、writer_mode 和業務陣列是否只有虛構客戶。
- 因為測試 Origin 不同，即使實際模組中的 DB 名稱為 `KuSheERP25_Core34_DB`，Chrome IndexedDB/localStorage 亦與正式網站**完全隔離**。CI 使用全新短命 BrowserContext，沒有任何真實備份或業務資料。
- 原始碼只被測試頁面 **引用**，沒有複製、改寫或加入 `index.html`。CI 的 main/beta SHA 與檔案差異白名單防止誤改。

## 實際整合測試範圍

1. 真正的 `KuSheERPStore.load()` 在乾淨瀏覽器從空狀態載入，而不匯入任何實際客戶記錄。
2. 真正的 `saveCustomer()` 只以 `SYNTH-*` 虛構客戶執行受保護 Store transaction，在 IndexedDB `main`、提交 journal `COMMIT_VERIFIED`、Emergency mirror、local commit token 一致；刷新頁面後仍可載入。
3. 直接呼叫 `KuSheERPStore.persist()` 被拒絕，不能繞過 Store writer。
4. 真正的 `KusheCloudSync.inspect()` 透過虛構 HTTPS GET 取得 Remote Empty／同步狀態，未設定 trusted device 時 `uploadLocal()` 必須阻擋。使用者取消手動上傳不得發出假 CAS。
5. 只在**隔離測試頁同意**時手動上傳虛構客戶記錄，真正的 `KusheCloudSync.uploadLocal()` 向假 `erp_state_cas_write_v2` 提交、驗證回讀及狀態 `UPLOAD_COMPLETE`，再次檢查 `SYNCED`。
6. 若變更模擬帳號，禁止以舊 trusted device 身分上傳舊使用者資料；`inspect()` 可以為新帳號重新查詢 `REMOTE_EMPTY`，**此讀取狀態不等於本機資料已完成帳號隔離**。正式身份清理需要另外驗收。
7. 刻意損壞真實瀏覽器 Emergency JSON：原始 Store 拒絕重新載入並回報 `STORE_LAYERS_DIVERGED`。若損壞真實 IndexedDB journal，重新載入也必須停止。
8. 在假雲端斷線時，真實 `inspect()` 不得修改本機資料，也不得假報同步成功；重新連線後可再次檢查。
9. 在已同步基準上假雲端另一個裝置新增資料，而本機另有新資料時，`inspect()` 必須保持衝突或需要人工決策狀態，不得自行寫回。
10. 原始雲端同步仍**只有** `sync_version` 而沒有台帳 `ledgerVersion`：本測試只能證明現有 JSONB CAS，**不能**解除 P40-16J「新增獨立折讓台帳與舊同步寫入路徑不同步」的安全阻擋條件。

## 重大驗收限制

- **真實程式模組 ≠ 正式完整 ERP 應用**。本測試的 AuthGate、雲端 HTTP、legacy adapter 和確認視窗是虛構替身；無真實 Supabase Auth / RLS 或真正遠端 `erp_state_cas_write_v2` 交易。Chrome 本機 IndexedDB 是真實 API，但沒有用正式業務資料。
- 只測安全且獨立的假客戶保存／雲端狀態轉換，不測真實請款、發票、應收、銀行、抽成和已付薪資的寫入、對外 PDF 顯示或完整 app 路由。
- 正式 `erp_states` 的 legacy direct UPDATE/INSERT 通路尚未解除，未來 ledger 的版本也尚未綁定真實的同步 RPC。只驗收本階段模型不能宣稱折讓可正式入帳。
- **不要將任何合併請款 632,100 → 600,000 的測試數字當成實際核定**，每張原單分攤及發票折讓法定憑證仍待人工核對。
- P40-16M 的草稿分支繼承之前 P40-16A~L 草稿歷史；**不可直接合併到正式 main**。未來任何單項正式功能需以屆時最新 main 另開最小差異分支，並經正式資料安全備份、SYNCED、CI 與負責人明確批准。

## 下一階段建議（仍不准真實財務寫入）

P40-16N 應優先做「所有舊雲端直接寫入途徑與端點的**完整唯讀盤點**、安全換軌方案」；以及用完全獨立 PostgREST/RLS 模擬舊 JWT 客戶端嘗試 direct UPDATE 的流程。先證明所有寫入入口都能受同一版本閘門保護，再談會計折讓事件的正式 integration。
