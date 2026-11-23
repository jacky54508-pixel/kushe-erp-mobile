# P40-16BN｜單筆請款核准制度候選（尚未獲負責人批准）

> **DRAFT / FAKE ONLY / NO MERGE / NO DEPLOY / NO PRODUCTION DATA ACCESS.**  
> 2026-11-19。正式 `main` 釘選 `2ab9c9d5944b1360ba3eebf49695713168caca8a`；`beta` `62669539053a15174081ba8670b18248195c6f8c`。本 PR 只新增測試、決策報告與 CI，不改正式任何 JS/HTML/PDF、Supabase schema／RLS／RPC／Edge、業務資料或歷史文件。

## 1. 核准範圍：只研究「更動後的對外施工明細」

- **原請款、實際施工、應收、發票、保留款、折讓、薪資抽成、銀行**：不得因這個文件核准模型而新增、刪除、重算或覆寫。
- **既有已保存、歷史請款、當前合法 PDF**：仍走既有流程；本測試絕不掛載入口、阻止歷史列印，或要求全面補核。
- 未來若有新「對外核准服務」，它只處理 **指定公司 + 指定文件 ID + 目標區 + 版本 + 已核對來源** 的安全讀取與核准紀錄。沒有正式可信來源、真正授權與持久稽核之前，保持關閉。

## 2. 尚未批准的兩個政策選項

| 選項 | 編輯者（建議） | 核准者（建議） | 負責人自己編輯時 | 特性 |
|---|---|---|---|---|
| **A. Owner 最終核准** | owner/admin/accounting | 只有 owner | **預設拒絕自核**；僅在負責人另行批准「自核例外制度」後，要求重新 AAL2、明確第二次確認、原因、版次指紋與不可變稽核。**自核依然不是雙人覆核。** | 適合單一負責人的小公司，但必須承擔自核風險 |
| **B. 兩人覆核（maker-checker）** | owner/admin/accounting | 不同人的 owner/admin | 永遠不能自核；必須另一位有授權的 owner/admin | 權責分離較強，卻需要至少兩個有效審查人 |

**本 PR 沒有採用任何一個選項；`owner_policy_selected:false`，`reviewer_policy:UNDECIDED`，自核例外不啟用。** 「下一步」只授權繼續隔離研究，不構成核准制度、正式變更、部署同意。

## 3. 隔離測試與拒絕條件

`.p40-16bn-tests/approval_policy.cjs` 是無 I/O 的純函式模擬器，所有 company/role/session/ACL/AAL2/trusted source/durable audit 均由**虛構測試注入**。`candidateReview()` 只會回傳 `BLOCKED` 或 `MOCK_POLICY_PERMITS_REVIEW_ONLY`，永遠不會產生真核准／PDF／帳款更新。即使測試在模擬模式正面通過，也明確回傳 `productionApproved:false, canDeploy:false, isRealApproval:false`。

- 政策仍 `UNDECIDED`、缺有效 Session／AAL2／會員資格／逐文件 ACL／可信來源／持久稽核，拒絕。
- 員工不得簽核；核准者必須符合 A/B 限制，不能只用前端角色字串當正式授權。
- 只接受當前有效文件；核對 document ID、company ID、target billing ID、revision、sync version 及受控內容指紋。
- 變更施工項目、數量、單價、對外備註、客戶、來源／收款／發票等，舊指紋無效。
- 自核例外必須是政策經負責人另外批准後才可能實作；第二次 AAL2／勾選／原因是稽核措施，**不能冒充獨立核准人**。
- 歷史文件、現有 PDF、正常施工輸入不屬於新門禁範圍，仍應在完整相容性驗收前完全不動。

本機執行：`node --test .p40-16bn-tests/test_approval_policy.cjs`。單獨 GitHub Actions `GITHUB_ACTIONS=true` 時不允許來源比對 SKIP，會釘選正式 main/beta SHA，嚴格限定五個新增隔離檔案。

## 4. 正式上線依然完全 BLOCKED

先確認 **`erp_states.data` 使用者範圍 JSONB 與 `erp_company_states` 公司範圍的真正權威與版本關係**。正式 `cloud-sync.js` 仍以整份 JSONB 進行 CAS，同步成功不等於可信核准原始帳務；**不能**把全量快照送 PDF Worker，亦不可提高一般使用者讀取 `erp_company_states.data` 的權限。Supabase JWT 現用 ECC P-256 / ES256 的截圖證據，不等於真實 Session、AAL2、公司、逐文件 ACL 的實際驗證。簽核必須持久綁版、防重送、有真實伺服器時間與授權紀錄；SHA-256 只是測試指紋，不是數位簽章。

尚需完成可信來源原子性、真正 MFA／會話撤銷、逐文件 ACL、真核准政策選擇、不可變稽核、舊版和跨區 PDF 隱私、驗證與交付相同 PDF bytes、完整安全備份／SYNCED、實際手機電腦、全財務回歸。**若未取得負責人對政策與正式部署的兩次獨立明確授權，任何正式修改與發布均禁止。**

**結論：只有隔離規格候選與離線模擬。正式資料及現有功能保持原狀。**
