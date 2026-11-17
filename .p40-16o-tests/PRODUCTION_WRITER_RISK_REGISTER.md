# P40-16O｜正式 ERP 所有已知寫入入口的唯讀盤點與發布阻擋條件

**定位：只讀最新正式 `main=2ab9c9d5944b1360ba3eebf49695713168caca8a` 的 GitHub 原始碼。P40-16O 候選版僅增加 scanner、in-memory tests、報告及專屬 CI；不寫入正式 Supabase、不匯入任何真實 JSONB、不得合併或部署。**

## 1. 已人工對照的正式來源檔案及寫入／回復路徑

| 來源與定位 | 實際作用 | 對未來折讓 ledger 的風險／處置 |
|---|---|---|
| `assets/js/cloud-sync.js:839,880–930` | 通用 `request()`、`readRemote()` 查詢 `/rest/v1/erp_states`；`casWrite()` 使用 `POST /rest/v1/rpc/erp_state_cas_write_v2`，RPC body 傳 `expected_sync_version,new_data,writer_mode` | **核心風險：沒有 ledger_version**。只靠目前 sync_version 無法證明與將來獨立折讓事件同一交易版本 |
| `cloud-sync.js:246–268` | 臨時裝置 `commitTemporarySnapshot()`，用 `casWrite` 並回讀驗證 | 同上，臨時裝置不等於沒有雲端寫入 |
| `cloud-sync.js:1663–1708` | 公司信任裝置優先，人工確認以本機覆寫 Temporary 分叉雲端，經 `casWrite` | 人工確認及原有 CAS 只能保護目前 JSONB 版本；新折讓 ledger 要在同交易鎖下核對 |
| `cloud-sync.js:1713–1780` | 手動雲端上傳，`casWrite`，回讀驗證 | 同上；重送／跨裝置策略必須對 ledger fence 生效 |
| `cloud-sync.js:2145–2220` | 自動備份 `autoBackupOperation()`，`casWrite` | 同上；背景同步不可無聲覆寫折讓後的舊 JSONB |
| `cloud-sync.js:640–703` | `safeApplyOperation()` 自動套用較新的雲端 snapshot，轉呼叫 `store.applyRemoteSnapshot()` | **本機覆蓋／雲端還原**，會觸發真實 Store 的版本、journal、備份與本機資料替換；不能把 ledger 視為已由它保護 |
| `cloud-sync.js:1459–1618` | `restoreOperation()` 手動還原，轉呼叫 `store.replaceSnapshot()` | 必須同時管制備份 marker、雲端資料版本與新 ledger 版本；不得自動倒回已入帳應收 |
| `cloud-sync.js:1337–1400` | `recoverPendingApplyFence()`：重啟後檢查未完成雲端套用 | 是復原交接而不是新折讓交易；必須列入全流程驗收 |
| `assets/js/erp-store.js:2404–2442` | `commitStoreDraft()` 真正寫 IndexedDB `erp/main`、Emergency、提交 token 與 journal | 正式**主要本機業務寫入**，會影響請款、應收、發票、薪資及銀行，不可直接替換 schema |
| `erp-store.js:2548` | `persist()` 遺留呼叫入口，正式 writer 由 Store 交易 gate 驗證 | 使用者業務操作仍可能透過此 API 包裝；需逐函式核對 |
| `erp-store.js:3620,3697–3698` | 收款失敗復原 `restoreReceiptMutation()`、IDB / Emergency rollback | **歷史／例外回寫**；雖有安全保護，未來新 ledger 不能只保護成功提交路徑，回復也須能恢復一致的跨帳本狀態 |
| `erp-store.js:4327,4423–4424` | 應付刪除與材料舊帳修復等失敗回復時，條件式直接 `dbSet(STATE_KEY,state)` 和 Emergency 回寫 | **需詳細復核的例外途徑**，可能發生於 `activeStoreTransaction` 不存在時；不可假設新金融事件不受影響 |
| `erp-store.js:4518,5110–5111` | 歷史應付／薪資付款例外 rollback，直接恢復保存的本機快照 | 已付款薪資與銀行串聯的安全門檻要獨立檢查；這些路徑不是正式交易入帳入口 |
| `erp-store.js:5914–5920` | 案場合併回復 `projectMergeRestore()` | 關聯各原單、收付、銀行等，未來發生折讓後若還原舊快照，須防止覆蓋新 ledger 投影 |
| `erp-store.js:6516,6658,6672,6793` | Emergency 鏡像修復、自動遠端套用、人工 snapshot 替換與受控 `recoverStore()` | IDB 和 Emergency 的本機復原流程必須列入 ledger fencing；現階段**未作任何變更** |
| `assets/js/recovery.js:37` | `recoverStore()` 使用者手動確認入口，需 operationId 和確認 | UI 授權不是獨立財務 ledger 的 server-side 授權 |
| `assets/js/settings.js:175,198` | `store.saveSystemSettings()`，一般本機設定寫入 | 透過 Store 業務快照，本機修改可能隨後觸發完整雲端同步 |
| `settings.js:43,209–225` | 匯出安全備份到使用者瀏覽器下載檔案 | **匯出本身不會改動雲端**，但使用這份舊備份進行還原需要版本驗證 |
| `assets/js/legacy-adapter.js:12–40` | 從本機 localStorage 找 Legacy／Emergency 資料，提供唯讀 facade | 非直接雲端 writer；舊資料匯入途徑須由 Store 的核驗 gate 限制 |
| `assets/js/auth-gate.js:212,233` | `requestJson()` 是另一個網路入口，但主要操作 Auth（登入、重設密碼、MFA/登出）及會員身分讀取 | **不能把 Auth 的 POST 當成業務 ERP 寫入**；也不能把前端角色視為資料庫入帳權限 |
| `assets/js/employee-shell.js:27–31` | `POST /rest/v1/rpc/employee_erp_read_projection` | 這是**POST 形式的唯讀 RPC**，不能只用 HTTP method 斷定是否寫財務 |

> 上述行號依 2026-11-17 唯讀的指定正式 main SHA。清單是基於原始碼與字面特徵的審查，**不是已證明窮盡所有動態呼叫、瀏覽器擴充、舊版離線客戶端或 DB 特權繞過**。

## 2. 工具型盤點與驗證的範圍

- `.p40-16o-tests/audit_writers.py` 唯讀掃描 `assets/js/**/*.js`，略過第三方 minified library，以 Python 字面規則找出 `fetch()`、REST/RPC URL、XMLHttpRequest/WebSocket/Beacon、IndexedDB 開庫、原生 IDB 寫入候選、localStorage/sessionStorage 持久化操作。
- 目前已人工審過的網路檔案只有：`cloud-sync.js`、`auth-gate.js`、`employee-shell.js`。其他 JS 出現新的 `fetch` 或 `/rest/v1` 就立即 fail-closed。
- 另建立 **31 個具體關鍵錨點**，涵蓋 cloud CAS、手動/自動/臨時/信任優先寫入、Store journal、收款/應付/薪資/案場合併回復與維修、授權查詢、匯出備份等。錨點缺失、重複、修改 CAS RPC path 或 body、出現 ledgerVersion 結構，都需先重新人工審查，**不能自動默認是安全的更新**。
- `.p40-16o-tests/test_writer_inventory.py` 使用原始碼的深拷貝做破壞性*虛構字串注入*（例如在報表模組新增不受審查的 `fetch(PATCH)`、偷換 CAS RPC、減少 CAS 參數、改名復原 API、偷加 ledgerVersion），要確定 scanner 在這些情境會報錯並拒絕變更。正式工作樹所有程式一律保持不變。
- GitHub CI 執行差異白名單、檔案 SHA 比對、掃描 strict 模式、上一階段安全回歸。scanner 產生 CI JSON 報告，**只包含來源路徑、行號、類別、錨點、數量，不包含任何使用者帳務資料或可用密碼**。
- 此 scanner 是**靜態候選入口發現**；例如透過字串組合構造 HTTP endpoint、重命名的 `fetch`、動態 require、PostgreSQL SECURITY DEFINER 特權或未納入 GitHub 的舊客戶端，不可能單靠它證明沒有問題。不得將掃描 PASS 當作允許入帳。

## 3. 已確認的高優先級正式發布阻擋（沒有對正式 DB 採取行動）

**BLOCKER A — Ledger vs ERP JSONB 的單一真相來源尚未解決。** 現有 `erp_state_cas_write_v2` 只有 `expected_sync_version,new_data,writer_mode`，未與未來獨立折讓台帳建立同筆原子 transaction/fence。即使所有候選 tests PASS，也不能說正式折讓能安全過帳。

**BLOCKER B — Legacy Direct SQL/REST 權限和舊客戶端未知。** P40-16I 當時的正式資料表權限*唯讀 metadata* 查核發現 `authenticated` 按 `auth.uid()=user_id` 仍有 `erp_states` INSERT/UPDATE GRANT。現階段沒有再連正式 Supabase，更沒有測試或變更這些權限。不能只修改新版 CloudSync 就解除舊的 direct UPDATE 通路；也不能在正在使用的正式站直接 REVOKE，否則可能中斷現有同步或資料輸入。

**BLOCKER C — 本機例外回復與備份復原尚需實際 E2E。** Store 內有收款、薪資付款、應付及案場合併的 fallback IDB/Emergency 回復；新 SQL ledger 導入後，如果本機復原與 SQL ledger 不同時管控，就可能呈現原單和應收不同步。P40-16M/N 的 browser+PG 仍只用 synthetic data。

**BLOCKER D — 真實帳務決策及對外顯示尚未核定。** 建商議價的原單分攤、已開發票的折讓證明/稅務、收款與保留款及銀行流水、員工抽成與已付款薪資，全部須核對法律與業務規則；原 PDF 的施工明細及跨區對外顯示要保持原樣。不得用合成 632,100／32,100 示範金額取代真實核定金額。

## 4. 發布路線的安全順序（均尚未獲授權）

1. **P40-16P 隔離階段**：先研究 *所有舊雲端寫入路徑* 的能否安全停用與轉換策略；以一次性 PostgreSQL、真實 Auth/RLS/REST 模型測試對 stale/離線/回復操作 fail-closed，對未提供新 fence 的舊版本應拒絕入帳，而不是自動改資料。
2. 只在隔離副本做 schema、版本鎖、遷移、復原及可回滾驗證。**不可在正式 Supabase 跑 DDL、REVOKE 或財務資料更新。**
3. 人工核定合法折讓及每張原單對照；確認已開票、保留款、應收、銀行、員工抽成與已付薪資影響。正式資料只允許有明確授權的最小操作，已付款薪資及既有原單不能未經授權直接重算。
4. 未來正式發布需從當時最新 main 新建最小範圍 release branch；核對最新 SYNCED、完整可還原的安全備份、GitHub CI、手機與電腦各模組、對外單頁 PDF 等全部 PASS，並取得新的**具體正式發布及寫入授權**。任何門檻失敗立即停止。

**本次正式 ERP 維持 P40-15C 唯讀議價折讓入口；無任何真實入帳功能新增或啟用。**
