# P40-16Q｜不中斷日常作業的新舊同步轉換：隔離測試與保護條件

> **DRAFT / 只限 CI。不是正式 ERP 的修改、資料遷移或發布。**
> 正式 main、beta、Supabase、原請款、應收、材料、銀行、薪資、抽成及對外 PDF 一律不動；不得在正式資料庫執行此 SQL，也不能用此原型處理實際折讓。

## 一、目標與先決限制

P40-16P 的 PostgreSQL 測試確認，若直接打開「舊版寫入一律拒絕」護欄，雖然能保護新折讓台帳，卻會中斷目前正式 ERP 的大量輸入。P40-16Q 因此在獨立的**假帳務資料**上研究三階段路線：

1. **legacy 舊版相容**：尚未啟用獨立折讓台帳，沿用單一 `sync_version`。假業務模組可以依原本流程輸入；過期版本仍拒絕。
2. **shadow 新舊並行**：不建立任何折讓事件，舊版 `legacy_write` 與新版 `modern_write(sync,ledger)` 都可以依 CAS 修改測試資料。暫時維持現有輸入不中斷，讓裝置升級並驗證備份。
3. **guarded 折讓版本護欄**：只有管理端在已知裝置都升級到 generation 2、待同步草稿 0、已確認備份、最後一次雲端版號都重新認證且操作員明確確認後，才允許切換。切換後 legacy write 回 `UPGRADE_REQUIRED`，新版必須核對 **sync_version 和 ledger_version**。

**重大限制**：`fake_clients` 記錄的只是**已知**假裝置。真實 ERP 可能還有未連線的舊裝置、共用瀏覽器、舊版備份、工作人員手機、快取頁面或自動重送。單靠「已知客戶端都升級」不能證明未知裝置不存在，因此此 CI **不能批准正式切換**。

## 二、真 PostgreSQL 16 的測試範圍

`.p40-16q-tests/staged_compatibility.sql` 在一次性 `p40_16q_ci`、私人 `p40q_lab` schema 執行，使用虛構公司 `SYNTH-Q-OWNER`、虛構裝置 `SYNTH-PC` / `SYNTH-PHONE`，模擬 JSONB 的以下 **12 類業務陣列**：daily 施工、projects 案場、billings 請款、receivables 應收、invoices 發票、receipts 收款、retentionReceipts 保留款、materials 材料、payables 應付、payroll 薪資、commissions 抽成、bankTransactions 銀行；另有 settings/UI，但沒有實際各模組計算公式。所有項目要求測試 `SYNTH-` ID，禁止真實帳務列。

- legacy/shadow 沒有 ledger 事件時，維持虛構模組的全量 JSONB 寫入，示範逐模組不因「先升級元件」而停止。
- 階段切換本身增加 sync_version，對過時用戶端形成有效 CAS 衝突；裝置的核對必須是最新版本，否則不允許啟用 guard。
- 只有假管理員可以修改裝置升級資訊、切換階段與製造假折讓事件。受限 PostgreSQL 假帳號只有 SELECT 與 legacy/modern 兩種同步 RPC 的 EXECUTE，沒有直接 SQL UPDATE/INSERT/DELETE、管理員 RPC 權限。
- 折讓事件和投影的 gross 在單一 PostgreSQL 交易寫入；原始 632100 保持；虛構折讓 32100 之後投影 600000，回沖必須另新增一筆事件而不是刪除舊事件；操作鍵不能重複入帳。
- **折讓事件發生後**，目前原型會阻擋 12 類業務陣列及財務設定的所有更動，只允許 `ui.note`。這是**明確不完整**的安全措施：在沒有專門的應收、發票、收款、保留款、薪資、抽成交易 API 前，禁止宣稱這樣仍能正常做生意。實際正式 ERP 不得啟用此模型。
- 只有在完全沒有 ledger 事件時才允許 guard 回退到 shadow/legacy；一旦產生記帳事件，不允許直接退回不受保護的同步模式。
- **不包含正式 Supabase Auth/JWT、RLS 多租戶與 shared authenticated 角色、實際 `erp_state_cas_write_v2` schema、正式 CloudSync 的 REST 行為**；這些都尚未改動或完成。此 private CI role 模型**不可直接複製到 Supabase**。

## 三、離線資料救援的獨立模型

`.p40-16q-tests/offline_upgrade_rescue.cjs` 是純 Node 記憶體資料模型，**不使用**真的 IndexedDB、localStorage、HTTP、Supabase、ERP 原始碼或客戶資料。模擬：

- 員工/裝置離線持有未同步的 daily、billings、receipts、payroll 等假業務草稿，主資料與 Emergency 鏡像、提交 journal 都保持一致；
- 下載/保存**可驗證 SHA-256** 的測試備份資料，必須與目前離線草稿、用戶和裝置匹配，才能轉新版；
- 升級只變更離線模型的 generation，不會連線或自動上傳；尚未同步的業務項目原封不動保留；
- 重連必須核對雲端 `syncVersion+ledgerVersion` 及原始 snapshot fingerprint；舊版已被 guard 隔離時應先備份並提示升級，**不得直接丟掉草稿**；
- 如果雲端財務版本已被另一端更動，不做強制合併；返回 `CONFLICT_EXPORT_PENDING` 等人工核對狀態並保留本地待同步項目；
- 只有真正經伺服器確認版本及資料 fingerprint 都相符的 ACK 才可清除本地 pending。網路中斷／上傳結果未知時 pending 必須保留；
- 備份 SHA-256 是偵測意外損壞，**不能當成可信付款指令的簽章，也不能保證檔案來源合法**。

## 四、正式上線仍被 BLOCKED 的條件

1. **所有正式 ERP 的日常財務操作尚無新版、ledger 安全的完整交易 API**。目前原型在出現折讓事件後會停止絕大部分功能，因而不能部署。
2. 沒有確定正式全量 JSONB direct UPDATE/INSERT 舊路徑在不影響正常操作下可以收斂；P40-16O 僅盤點當時的原始碼，不包括未知舊版本和所有正式 DB 特權。
3. 尚未在正式 Supabase 上完成最新 metadata/權限和 read-only Auth/JWT/共享角色實測；本階段明確不連正式 Supabase，不執行 DDL 或修改權限。
4. 真實折讓的原請款分攤、已開立發票/營業稅合法憑證、收款、保留款、銀行流水、已付款薪資及員工抽成處理規則仍需人工核定。
5. 尚未在正式版原始 `index.html`、電腦和手機測試完整雙版本同步、網路斷線/恢復、Emergency/IndexedDB 及回復，亦尚未驗收所有 PDF 明細。現有正式 ERP 仍是 P40-15C 的唯讀折讓試算。

**P40-16Q 只完成「切換協定的風險與可行性」隔離演練，不能拿它當作正式入帳或發布許可。** 未來必須先解決全業務相容性並取得負責人的另一份具體正式發布授權、最新 SYNCED、完整安全備份、CI 及對外 PDF / 手機電腦回歸全部 PASS。
