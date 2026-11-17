# P40-16K｜離線重連、跨裝置與 Emergency mirror 還原 fail-closed 演練

**僅 CI 虛構資料，絕不連線或修改正式 Supabase、IndexedDB、客戶請款、發票、銀行、薪資與 PDF。所有候選 PR 保持草稿。**

## 正式 main 唯讀原始碼盤點

- `assets/js/cloud-sync.js`：主資料 `erp_states` 按登入使用者 `user_id` 讀取，正式寫入採 `erp_state_cas_write_v2` 的 `sync_version` 基準確認。成功後回讀核對 fingerprint，失敗或版本衝突不應認定成功。自動同步有 `SYNCED`、`REMOTE_NEWER`、`LOCAL_NEWER`、`CONFLICT` 等狀態。
- 同檔的 `reconcileFromCloud`、`refreshTemporaryFromCloud`、`commitTemporarySnapshot` 依 ONLINE／FOCUS／VISIBILITY／POLL 等事件檢查雲端，臨時裝置採 cloud-only 模式，不應直接落地正式資料；權限與主帳號改變需重新檢查。
- `assets/js/erp-store.js`：IndexedDB `KuSheERP25_Core34_DB`、store `erp`、key `main`；Emergency mirror 為 `KuSheERP25_EMERGENCY`。主資料版本 `meta.businessSnapshotRevision`、提交 token、receipt version 和 journal `COMMIT_VERIFIED` 之間有防止半套寫入的比對。
- Cloud restore 要先檢查本機資料安全並建立備份 marker，對雲端版本做兩次讀取，再在受控流程更新本機，並驗證終端 fingerprint；中途失敗要求 rollback 及停止繼續同步。
- 重要未完成風險：正式版尚無新折讓台帳 `ledger_version`；舊式 `erp_states` 完整 JSONB 直接寫入仍可能繞過將來新的台帳 fence。即使此隔離測試 PASS，也**不代表**正式 ERP 已具備折讓與跨來源原子一致性。

## 本階段虛構模型測試

`.p40-16k-tests/offline_recovery_model.cjs` 是**純記憶體狀態模型**，無任何真正網路／IndexedDB／localStorage／ERP Store／Supabase API 操作，也沒有正式財務寫入。使用完全虛構資料：
- 文件 `SYNTH-BILLING`，原合併 632,100，只是測試既定案例；
- `SYNTH-PC`、`SYNTH-PHONE`、`SYNTH-TEMP` 三種測試裝置；
- 模型額外設計 `syncVersion` + **假想未來** `ledgerVersion` 雙版本，並透過兩層資料、提交 token 和 journal 校驗本機一致性。

回歸測試 `.p40-16k-tests/offline_recovery.test.cjs` 覆蓋：
1. 離線本機編輯、回線後雲端上傳並驗證；
2. 兩台裝置同時編輯，後送方因版本衝突被拒絕，不覆蓋先送方；
3. 離線期間新增的模擬折讓事件讓原本的本機版本失效；
4. 伺服器已寫入但最後網路中斷，必須回讀 fingerprint + 版本才能判定成功；
5. 備份記號綁定特定使用者、資料 fingerprint、建立時間，30 分鐘到期；備份前不得覆蓋本機；
6. 還原前雙讀比對雲端；還原過程主資料、Emergency、token 或 journal 任一階段故障，都只能按操作所有權安全 rollback，不得半套套用；
7. 若發生別人同時改 journal／版本而無法證明 rollback 擁有權，直接 CRITICAL BLOCK，不能自動修復；
8. IndexedDB／Emergency 不同、提交 token 錯誤或 journal 未完成，一律拒絕自動同步與還原；
9. MFA／登入主體變動、編輯器未儲存、臨時裝置落地寫入，一律 fail closed；
10. 所有出入帳／薪資／發票與原請款金額都不能由模型改變；任何結果 `canPost=false`、`canSave=false`。

## 與上一階段的不同與最重要限制

- P40-16J 透過真實 CI PostgreSQL 驗證「JSONB 全量寫入 vs 模擬折讓台帳」的交易競態，並**證明舊 direct UPDATE 是未排除的可能繞過路徑**。
- P40-16K 聚焦於**離線客戶端／本機雙層儲存／手動還原的期望狀態機**，目前是獨立 Node 純函式模擬，**不是把正式 cloud-sync.js 或 erp-store.js 完整在兩台真實裝置驗收**。不應把此 CI 結果當成正式產品已修好某個故障。
- 現有 Emergency mirror 的直接修復、歷史資料補正、IndexedDB journal 舊版本及暫時裝置，可能有更多正式分支，尚需要日後於完全隔離的真實瀏覽器做完整 E2E。
- `documentData` 裡沒有實際發票/保留款/收款/薪資之帳務更新能力；同樣不能宣稱會計規則已完成。

## 正式發布仍必須阻擋

1. **沒有完整的舊版同步寫入通路清單／權限收斂及對應 migration。** 目前 `erp_states` 仍可由符合 RLS 的 client 直接 UPDATE。
2. **沒有完整跨來源原子交易。** 正式 `erp_state_cas_write_v2` 尚不知新的 `ledger_version`；新 SQL 台帳和舊整份 JSONB 在非同步讀取時可能顯示不同餘額。
3. **沒有經會計核准的各原單分攤、法定折讓憑證與稅額申報、收款／支票／保留款沖帳、已付薪資與抽成處理。**
4. **沒有真實應用端的多裝置/離線/復原及完整 PDF/銀行/發票回歸驗收。**
5. 沒有最新正式 SYNCED、安全可還原備份、main 最新差異及新的明確 owner 授權。任何一關不合格就必須停下，**不得部署、不得啟用入帳或自動改真實資料**。

**本次只新增隔離 CI/文件/測試檔案。不含正式 API 或任何正式 Supabase Migration。**
