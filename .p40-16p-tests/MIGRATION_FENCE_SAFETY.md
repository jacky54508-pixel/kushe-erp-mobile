# P40-16P｜所有已知寫入途徑的雙版本阻擋模型（一次性 PostgreSQL、安全隔離）

**絕不執行於正式 Supabase、正式 ERP 或真實業務資料；此文件與 SQL 僅是 GitHub CI 內的虛構演練。原請款、應收、保留款、發票、銀行、薪資、抽成、PDF、main、beta 都不修改。**

## 本階段在測試庫驗證的機制

`.p40-16p-tests/disposable_all_writers_fence.sql` 只供 disposable PostgreSQL 16 `p40_16p_ci` 使用，所有物件都在 `p40p_lab`，僅有虛構 `SYNTH-OWNER-P40P`。

1. 原有模擬整份 JSONB 同步以 `legacy_sync(expected_sync_version)` 表示。預設 `legacy_compatible` 模式，當還沒有獨立折讓台帳，允許只修改虛構 UI 備註的舊請求，版本衝突則拒絕。
2. 以**測試管理員明確切換** `guarded` 模式後，任何舊的 `legacy_sync` 不論 sync_version 是否最新，一律回 `UPGRADE_REQUIRED`，不修改一筆資料。
3. `fenced_sync(expected_sync_version,expected_ledger_version)` 只有在雙版本**都相同**且 guard 已開啟時才接受。客戶端不能改 `original`、`financialProjection`、額外任何財務欄位，只允許 `ui.note` 的虛構示範。既有 ERP 實際有大量財務編輯功能，本模型未提供它們的合法新路徑。
4. 折讓/沖回只由**測試管理員**透過 `admin_post_event`；在 PostgreSQL 同一 row lock/transaction 追加事件並更新 projection gross 與 sync_version + ledger_version。模擬原始金額 NT$632,100 不變，測試折讓 NT$32,100 後 projection NT$600,000；這些數字**純測試，非任何建商正式核定**。
5. 同一操作鍵重送必須返回 `DUPLICATE`、不重覆入帳；同鍵不同金額拒絕；沖回只新增反向事件，不刪除歷史事件。相同原單一筆折讓最多沖回一次。
6. 模擬 `p40p_client` 角色只能 SELECT 一個固定的假租戶以及執行兩種受控同步函式。禁止直接 `INSERT/UPDATE/DELETE` 測試 snapshot/ledger；不得執行 server-only `admin_post_event` 或 `admin_set_guard`。測試角色沒有 superuser／createrole 等權限；公開預設函式 EXECUTE 被撤除。
7. PostgreSQL 兩連線競態測試分別覆蓋新舊裝置及折讓事件，同筆版號只能有一個提交成功。錯誤時 SQL 交易完整回滾，projection 與事件不會半套變更。
8. 關閉 guard 只能在**沒有任何折讓台帳事件之前**。一旦 ledgerVersion 大於 0，不能直接降級回舊版無護欄模式；需另行設計與核准正式安全轉換與 rollback。

## 與正式 ERP 的重大落差（上線絕對阻擋）

- **這不是 Supabase 正式遷移。** 單一虛構租戶及本地 PostgreSQL login，不模擬真正的 Supabase Auth/JWT、共享 `authenticated` 角色、實際 membership/授權、PostgREST service key、RLS policy 和新舊分支所有登入途徑。`SECURITY DEFINER` 寫法只為特定 CI 模型，**不可**直接貼進正式 Supabase。
- **舊版同步一旦啟用 guard 就不能繼續寫入。** 正式 ERP 目前仍在大量輸入請款、材料、銀行、薪資等，若照此模型切換模式，會直接中斷原本操作。必須先提供經實測且與現有業務相容的新接口、客戶端切換與備份／回復策略；不能只做 `REVOKE` 或直接停用現有 RPC。
- 本模型允許新版只有虛構 UI 備註寫入，並未支援原版 ERP 的真實每日施工、請款/應收、發票、收款、保留款、銀行、應付、庫存、薪資、抽成等所有功能。**不能宣稱此設計已安全保留既有功能**。
- 本模型的 `original` 只含簡化假單號及金額，projection 只有 gross。沒有真實含稅/未稅/發票稅率、法定折讓單、已收款與保留款沖帳、銀行流水、已付薪資及抽成的會計規則，不得依此對真實資料計算或回填。
- 先前 P40-16O 原始碼掃描到 50 個 JS、36 個已知入口，**不是**對正式 DB 所有 function/GRANT/RLS/舊離線版本的完整可用性證明。使用測試帳號關閉直接 DML 的 CI 結果不代表正式 `authenticated` 已經被撤權。
- 即使測試的 `guarded` + 雙版本 CAS 通過，也沒有通過正式 CloudSync/Store 的雙版本 API 整合、更無正式手機、電腦、真實資料備份/還原或對外 PDF 驗收。

## 不動正式 ERP 的安全遷移順序（仍未開始）

1. 唯讀盤點**真正**正式 Supabase 的所有現有 GRANT、RLS、RPC 函式 owner/search_path、JWT/會員授權與舊客戶端版本，不改任何權限；過去的唯讀 metadata 查核並不替代最新驗證。
2. 選擇單一可靠的入帳真相來源。若以追加式台帳為權威，應在受控伺服器交易內確保每張原單應收、保留款、發票與財務投影連動；不能只改前端的數字。
3. 在完全獨立測試 origin/資料庫讓新版 ERP 所有既有寫入功能都可繼續正常運作，包含離線重試、預設備份/還原、已付款禁止錯帳、重複送出、暫時裝置、帳號變更。
4. 先設計**不會停擺**的相容遷移：觀察現有版本、明確 upgrade 提示、雙新舊版可追蹤切換，且保留未同步本機資料的安全救援。只有能證明沒有舊客戶端會繼續寫入時才考慮切換 guard；正式也不得假設網路上所有舊連線已退出。
5. 法定憑證、稅務、發票對應、應收/保留款/收款/銀行/薪資/抽成均逐原單核對。不得動已付薪資或真實請款而未取明確授權。
6. **任何正式發布與權限變更，都需要新的明確批准，且必須最新 SYNCED、可還原完整安全備份、由最新 main 起的最小差異、CI、手機／電腦及 PDF 回歸全部 PASS。**

### 驗收結論用語

- **隔離交易機制 PASS**：只證明特定虛構 PostgreSQL 雙版本策略可以阻擋舊 client 在 guard 啟用後寫入。
- **正式發布 BLOCKED**：目前方案不支援既有 ERP 全部財務業務寫入，不可直接部署，也不得合併 P40-16A～P 草稿到正式 main。
- 下一階段可研究 P40-16Q：隔離環境的**不中斷舊使用者遷移協定**，包括舊客戶端離線資料保存、升級引導及新版 ERP 全流程 regression；正式仍只讀折讓試算。
