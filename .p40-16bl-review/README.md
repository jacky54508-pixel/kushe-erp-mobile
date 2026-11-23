# P40-16BL｜正式 ERP 雲端同步→單筆請款可信投影：隔離銜接與失敗保護

**DRAFT / FAKE DATA / NO MERGE / NO DEPLOY / NO PRODUCTION SUPABASE ACCESS.**

- 2026-11-19（台灣）基準 `main`: `2ab9c9d5944b1360ba3eebf49695713168caca8a`；`beta`: `62669539053a15174081ba8670b18248195c6f8c`。
- 本分支從正式 main 獨立建立，只新增隔離測試 `.p40-16bl-tests/`、報告 `.p40-16bl-review/`、專屬 CI，**不修改**正式 ERP、雲端同步、PDF、請款、發票、應收、銀行、薪資、抽成、Cloudflare、Supabase、RLS 或現有資料。
- 先前 P40-16BJ 的 PostgreSQL 17 容器工作流程 #44531046888 經 GitHub jobs 重新查核 **success**；但該測試仍是虛構資料、假身份及假 AAL2，並不能代表正式認證或單據來源已實作。

## 1. 正式程式實際的信任邊界（純唯讀查核）

1. `assets/js/cloud-sync.js` 的 `remotePath()` 自 `public.erp_states` 讀取 `data` 全部 JSONB，加上 `sync_version`；`casWrite()` 經 `erp_state_cas_write_v2` 提交整份資料。目前並**沒有**經查核證實可在同一筆伺服器交易中維護文件級對外投影的正式寫入流程。
2. `assets/js/erp-store.js` 的合併文件保存於 `state.meta.externalBillingDocuments`，v2 有 `sourceIds`、`targetBillingId`、`sourceSnapshots`、`settlementSnapshots`、`totals`、`unified`、`revision`、`history`。`externalBillingDocumentIndex()` 對原單及收款快照做漂移核對。
3. `assets/js/billing-groups.js` 的 `printSaved()` 仍從瀏覽器 Store 組成列印資料；`assets/js/external-billing-print.js` 當前文件會只顯示目標區，但舊版/歷史文件還走獨立路徑。**不得因新實驗而中斷現有合併或歷史 PDF**。
4. 正式 Supabase 先前唯讀 metadata 查到 `erp_states.data` 屬使用者範圍全量快照，`erp_company_states.data` 對一般 authenticated 沒有 SELECT grant。**尚未決定正式跨使用者、跨公司的唯一可信授權來源**，不能把這兩種表的權限混在一起。
5. 業主 Dashboard 顯示 Current JWT 是 ECC P-256 / ES256，並不證明已驗證任一真實 access token、current session、AAL2、公司會員與單據 ACL。新的 PDF 服務絕不能信任瀏覽器自稱的 role/approved/snapshot。

## 2. 本次隔離模型真正做了什麼

`.p40-16bl-tests/test_sync_handoff.cjs` 使用 Node 22 的內建 SQLite（**不是正式 Supabase/PostgreSQL**），僅用虛構建商、M 區、L 區、薪資、銀行及原單發票測試資料。模型假設未來有**可信的、與資料庫 CAS 同一個交易邊界**，才建立投影。這個假設**尚未在正式環境成立**。

- **同交易結果**：虛構原始快照、文件級投影、稽核事件在一筆 `BEGIN IMMEDIATE...COMMIT` 內寫入；模擬故障回滾，禁止發生「原單更新但投影仍顯示可對外交付」的半提交。
- **只阻擋受影響文件**：當收款、發票或來源快照改變卻未重新核定時，模擬核心 ERP 快照依然可成功存檔，但該文件標成 `BLOCKED_STALE`、不提供公開內容；不應讓單筆 PDF 附加功能阻止公司每日施工或薪資資料保存。
- **無關更新不必重審全公司文件**：當只有虛構薪資或銀行資料變更，對外文件的**內容指紋**維持不變，原文件核准仍有效，但新讀取請求仍須對上最新同步版本。避免每次 ERP 寫入都讓全部文件失效。
- **核准版本隔離**：修改本張原單、收款或發票，或提高合併文件版次，必須重新取得對該文件內容的核准；不能沿用舊版。
- **最小公開投影**：只輸出客戶、目標區、日期、對外備註、施工列與原存金額。沒有其他區域、來源發票號碼、銀行、員工、抽成、內部重編原因或整份 JSONB。
- **權限與輸入拒絕**：假登入/Session/AAL2/公司/角色/單筆 ACL 錯誤時拒絕；客戶端如送 `role`、`snapshot`、`approved`、`publicProjection` 會直接拒絕。本次的認證、權限及核准全部是**虛構測試物件**，無真實伺服器身分可信度。
- **歷史相容性**：原有已確認的歷史 PDF 不由此原型接管。附加新服務不能要求正式既有文件全部重新建立或修改帳務。

## 3. 離線測試與 GitHub CI

- 執行：`node --check .p40-16bl-tests/test_sync_handoff.cjs`、`node --test .p40-16bl-tests/test_sync_handoff.cjs`。
- 2026-11-19 本機 Node 22.16.0：主測試 **29 PASS、0 FAIL**，另有來源比對的內層 1 SKIP（未有完整 GitHub checkout）；GitHub Actions 設 `CI=true`，**不得跳過**正式來源檢查。
- 專屬 CI 只能執行無網路業務存取、無 Supabase 憑證的離線 Node 測試；釘住 `main`、`beta` SHA、限定四個新增檔案，正式 GitHub source 只能讀不能修改。
- SHA-256 用於本地非權威完整性比對，**不是**數位簽章、防竄改持久稽核、實際建商 PDF bytes 驗證。

## 4. 候選正式方案（**僅供審議、未獲授權**）

### A. 最小交易一致性方案（優先研究，尚未批准）

在未來業主**另行授權**後，從經驗證的正式伺服器 CAS 來源中，設計「既有 ERP 同步版本更新＋單筆對外投影建立/標為待核對＋核准失效＋不可變稽核」的**同交易**實作。客戶端只能傳送正常 ERP 同步資料；不能自行宣告已核准的對外投影，也不能把整份 JSONB 傳給新 PDF 服務。投影表不開放一般瀏覽器讀整份資料；以真正 `SECURITY INVOKER`/RLS/GRANT、有效 JWT/Session/AAL2/公司角色和單據 ACL 配合實際授權設計。必須先在完全獨立的 PostgreSQL 及真實程式相容性測試中證明可行。**現有正式 CAS 不能假裝已具備此功能。**

### B. 獨立文件來源資料庫方案（較大風險）

正式遷移為規範化文件 ledger/同步，風險較高，需要既有大量真實資料雙向相容、版本歷史、復原及跨裝置驗證；**目前不建議直接碰正式系統**。

## 5. 尚未解決的阻擋點

- 無法在不修改正式 schema/CAS/權限的情況下，把此實驗變成真的原子可信投影；正式來源的「使用者快照 vs 公司快照」權威界線尚未經公司授權確認。
- 模擬 SQLite 非 Supabase PostgreSQL；假權限非真實 ES256 JWT 驗證、Session 撤銷、文件級 ACL 或持久簽核。正式單人/雙人核准政策仍待負責人選定。
- 不能證明對外備註不包含使用者自己輸入的敏感內容；需審核流程、深度白名單、最終 PDF bytes 與交付 bytes 同一份。
- 尚未驗證最新 `SYNCED`、完整可還原備份、真實 A4/LOGO/大小章、手機及電腦，以及折讓/保留款/多月發票/應收/銀行/薪資/抽成財務回歸。
- **嚴禁**未獲公司負責人另行明確授權便合併 main/beta、變更正式 Supabase schema/RLS/Edge/CAS、修改任何真實資料或部署正式版。

**本階段結論：FAKE ONLY / DRAFT / NO MERGE / NO DEPLOY；正式發布維持 BLOCKED。**
