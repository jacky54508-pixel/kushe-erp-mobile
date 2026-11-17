# P40-16J｜全量 JSONB 同步 vs 追加式折讓台帳：隔離 CAS 競態與風險設計

**狀態：只限 GitHub Actions 內的一次性 PostgreSQL 16 測試庫 `p40_16j_ci`，沒有任何正式遷移、正式 API、真實付款或正式折讓入帳。主站 main／beta 不更動。**

## 一、P40-16I 已唯讀查核的正式架構（不讀任何 ERP 真實業務內容）

1. 正式 Supabase `public.erp_states` 以 `user_id` 存放整份 ERP `data jsonb`，維持 `sync_version` 及 BEFORE INSERT/UPDATE 版本遞增觸發器。`assets/js/cloud-sync.js` 的 `casWrite()` 經 `/rest/v1/rpc/erp_state_cas_write_v2` 提交，要求預期雲端同步版本。
2. **重大兼容性風險**：正式 `authenticated` 對 `erp_states` 的 SQL `SELECT`、`INSERT`、`UPDATE` grant 目前仍在，RLS 限定 `auth.uid()=user_id` 且 AAL2 RESTRICTIVE。這代表新版 CAS RPC 並非唯一的可能寫入通道。舊用戶端可能透過原有直接寫入，更新整份 JSONB。版本遞增 trigger 只管版本，不會自動保護另一張新增折讓台帳。**不能因已有 CAS 就宣稱所有正式帳務不會被覆蓋。**
3. 合併請款 `meta.externalBillingDocuments` 是對外文件關聯（`sourceIds[]`、`targetBillingId`、保存快照／版本）；原請款、應收、發票、保留款、收款、抽成及銀行均在同一 JSONB ERP 業務快照內，且存在歷史及虛擬發票表示方式。
4. `erp_company_states` SELECT RLS policy 存在，但正式 `authenticated` table GRANT 顯示 SELECT false，仍需使用獨立測試帳號驗證實際讀取；本階段**不修改**正式 GRANT、policy、MFA 或其他功能。

## 二、P40-16J 精確的隔離實驗

GitHub CI 建立一個 disposable `p40_16j_ci`；SQL 在**私有 `p40j_ci` schema** 內有：

- `fake_snapshots`: 一張合成請款的 `data jsonb`、`sync_version`、`ledger_version`；原金額 `original` 永不直接覆寫。
- `fake_ledger`: 追加事件 `SIMULATED_ALLOWANCE`、`SIMULATED_REVERSAL`；`event_id` 唯一、`operation_key` 唯一、對應文件事件版本唯一，回沖原事件只能被引用一次，不允許修改／刪除。
- `fake_projection`: 從原始假金額減去淨折讓計算**合成**可讀投影，回沖後投影回到原金額；不是真實應收或稅額計算。
- `safe_snapshot_sync`: 模擬安全同步函式，鎖住 `fake_snapshots` 文件列並同時驗證**同步版本和折讓台帳版本**；只允許改安全的 `ui.note`，禁止改原金額或塞入暫存應收／折讓金額。
- `simulate_allowance`、`simulate_reversal`: 模擬受控追加式帳務事件，在同一 PostgreSQL 交易鎖內檢查版本、冪等 key、事件唯一及回沖引用；沒有正式發票／銀行／薪資／抽成修改。
- `p40j_client` 與 `p40j_operator`：**CI 的 NOLOGIN 虛構角色**。client 只可讀與安全同步 RPC，不可直接 DML，也不可執行折讓／回沖。operator 只可讀、執行合成台帳追加 RPC，不可任意修改整份 snapshot。這是**授權原理演練，不具備正式 Supabase Auth 身分綁定**。

### 同時提交的核心不變量

**序列 A：** 客戶端拿到 `sync_version=1, ledger_version=0`，同時操作兩件事：
- 折讓先提交：追加 32,100 的合成事件，`ledger_version=1`；舊版全量 JSONB 同步必須因 ledger_version 過期被拒絕。
- 舊資料先同步：安全的備註更新讓 `sync_version=2`；舊版折讓指令必須因 sync_version 過期被拒絕。
- 若客戶端**重新讀取**兩個版本後仍符合所有資料關聯及授權，才允許新交易。不能靠「強制重新整理」或忽略衝突硬過。

**序列 B：** 同操作鍵並行提交，只能新增一筆事件，重送返回 `REPLAY`；同鍵不同內容應拒絕。

**序列 C：** 回沖只追加第二筆反向事件，原事件仍保存、淨折讓恢復 0，重複回沖不可再次改變投影。

**序列 D — 舊路徑危險示範（絕對不可忽略）：**
使用 CI 管理員對**測試** `fake_snapshots` 直接寫入舊的快取應收金額，即使台帳顯示已折讓 32,100，JSONB 仍能記錄過時的未折讓金額，形成雙來源不一致。測試**立即 ROLLBACK**，不留下危險資料。這證明**只建立折讓台帳、只在新的同步 RPC 加 CAS，都不能保護現有舊直接寫入路徑**。

> 注意：此示範只使用 CI 管理員對假資料的可行更新。實際業務環境還有自己的 RLS／觸發器／登入身分，**尚未在正式帳號測試**；不得宣稱已發現真實 ERP 發生金額覆寫，只能說目前架構有「須排除的可能繞過通路」。

## 三、仍未完成、會阻擋真正入帳的條件

1. **要安全，所有真實寫入通道都必須管制。** 不能只在 `erp_state_cas_write_v2` 裡檢查 ledger_version，因為舊 direct UPDATE/UPSERT、跨裝置自動上傳、離線重送、應急還原，仍可能攜帶過時的整份 JSONB。須規劃先回歸再撤除無保護直接更新的前後端路徑，且準備可復原轉換，**在本階段禁止直接更改權限**。
2. **單一財務真相來源**：正式對外請款 PDF、應收、收款、保留款、發票及抽成目前讀取 ERP JSONB 原有欄位。若改由新的 SQL 台帳投影，一定要有可稽核的逐原單映射和一致的 UI/報表讀取規則；未具備時不應新增真實事件，避免 PDF 與應收看起來不同。
3. **安全復原與同步**：需測試 IndexedDB、Emergency mirror、雲端版號、CAS、恢復及異常斷線；不可因打斷衝突時重試而把未儲存資料覆蓋。
4. **已開發票折讓憑證與稅務**：依實際原單及合法憑證處理，不能把 32,100 當成自動未稅分攤。已收款、已收保留款、支票與銀行歷史需要獨立沖回流程。
5. **抽成與已付薪資**：折讓前後抽成計算基準、來源與薪資入帳狀態需人工核定；**禁止修改已付薪資或舊抽成記錄**。
6. **正式授權／驗收**：真正 Supabase 身份連結、公司權限、當下會計核定、備份、正式 SYNCED、完整門禁、真實帳務重算與對外 PDF、手機/電腦回歸需要另外通過。主站 main 僅經新的**明確正式發布授權**才能改動。

## 四、可能的正式設計選項（尚未選擇／未實作）

- **方案 A — 保留 JSONB 作唯一業務帳本，另在同一 CAS 寫入中保留不可覆寫的調整事件**：可減少跨兩資料來源讀取差異，但現有全量覆寫及舊用戶端相容性、資料庫唯一事件／持久稽核能力難以保證，不能直接上線。
- **方案 B — 獨立追加式 SQL 折讓台帳，所有財務讀取使用同一個投影**：可支援唯一索引與原子交易，但必須把舊 JSONB 同步與所有可能直接寫入的通路一起納入版本閘門，並導入可靠的逐原單／發票／應收投影及漸進轉換。不得直接套用本 CI SQL。
- **方案 C — 維持 P40-15C 唯讀折讓試算，先用會計外部核對合法折讓文件**：在財務資料多、同步高風險及抽成基準未定的現況下，是當前不更動真實資料的安全作法。

目前還沒有獲得哪一種正式寫入架構的核定；**P40-16J PASS 只能證明隔離模型能阻擋指定競態，並不能證明正式 ERP 已解決雙來源問題。**

## 五、P40-16J 範圍鎖定

只新增：
- `.p40-16j-tests/isolated_sync_ledger.sql`
- `.p40-16j-tests/test_snapshot_ledger_races.py`
- `.p40-16j-tests/SYNC_LEDGER_RISK_REPORT.md`
- `.github/workflows/p40-16j-jsonb-ledger-races.yml`

以上均不載入 `index.html`，不在正式 Supabase 執行，不需任何實際使用者資料，不產生實際應收或發票折讓，不調整原單及對外 PDF。

下一步 P40-16K 若要繼續，只能先做**無寫入的全路徑同步與出入帳對照規劃／虛構資料的離線復原故障測試**，不等同正式發布授權。
