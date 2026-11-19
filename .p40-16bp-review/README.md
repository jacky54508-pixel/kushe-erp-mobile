# P40-16BP｜新請款核准門禁與既有列印保護：隔離演練

> **DRAFT／FAKE ONLY／NO MERGE／NO DEPLOY／不接正式 Supabase／不讀寫真實資料。**
>
> 2026-11-19（台灣），正式 `main` 固定 `2ab9c9d5944b1360ba3eebf49695713168caca8a`，`beta` 固定 `62669539053a15174081ba8670b18248195c6f8c`。本階段只從正式 `main` 新開隔離分支，**新增**本說明、JSON 判定、純函式測試及單獨 CI；不修改任何正式 ERP JS/HTML/PDF、雲端同步、主站部署、公司資料及授權設定。

## 目的：保護既有 ERP，不把未核准的制度裝進正式版

- **建議測試候選（未正式選定）：** 負責人核准他人編輯的新對外施工文件；負責人自己是編輯者時一律拒絕，不啟用自我核准例外。
- **正式政策仍未決定。** 「下一步」不表示同意 A／B、自核例外、正式 schema/RLS/ERP 程式變動或發布。`decision.json` 的 `owner_policy_selected=false`、`self_review_exception_enabled=false` 保持不變。
- 單獨測試新增 `new-external-document-approval` 候選流程，不接正式入口。既有 `existing-single-print`、`existing-current-merged-print`、`existing-historical-print`、請款保存、每日施工、薪資存檔僅以 `LEGACY_ROUTE_UNCHANGED` 記錄「**設計上應當保持不變**」，這**不是**實際正式網站的端到端驗收。
- 禁止把過往已確認的歷史請款全面標成新門禁的待核准，也不可因新增附加核准服務而攔截實際施工、薪資、收款或發票流程。

## 獨立模型驗證

`.p40-16bp-tests/rollout_boundary.cjs` 是無網路、無輸入輸出（不操作任何 ERP 或 Supabase）的 Node.js 純函式。輸入全部是假公司/假身分/假原單/假結算及假 JWT Session 檢查證據。

- 新核准只有**公司+單筆文件+目標區+原請款+收款+發票來源指紋+版次+同步版本+施工明細+公開備註**全吻合，且角色和模擬 AAL2/Session/ACL/稽核全具備，才回 `FAKE_ELIGIBLE_FOR_REVIEW_ONLY`。
- 即使假情境成功，也永遠 `actualApproval:false, canDeploy:false, canWrite:false`。**不產生真核准、PDF、有效證明或資料庫紀錄**。政策還沒選定的真實狀態一律 `BLOCKED`。
- 原單、收款、發票、目標區、施工明細、對外備註、金額、同步版本、簽核人異動會拒絕。任何編輯者與核准人同人都拒絕，包含負責人自己；不允許第二次勾選或自核例外悄悄開啟。
- 薪資、銀行等與文件內容無關的欄位不應納入單筆核准指紋；這僅能防止模型無謂失效，**未證明正式來源、帳務、同步一致性或授權安全**。
- **重要對外隱私：** 正式 `assets/js/external-billing-print.js` 的當前版顯示單一目標區，歷史保存分支仍具有原請款/發票對照表。歷史路徑保留原樣供既有操作，**新對外服務不可把歷史表格當安全白名單直接交付建商**；未來需獨立核實是否應遮蔽原票號及其他來源資料。

## 測試與 CI

本機 Node 22.16.0：`node --test .p40-16bp-tests/test_rollout_boundary.cjs`，**40 cases = 39 PASS / 0 FAIL / 1 SKIP**。SKIP 是本機缺少完整 GitHub repo checkout 而沒有執行官方原始碼靜態對照。正式 GitHub Actions 設 `P40BP_FULL_SOURCE_REQUIRED=true`，這一項必須跑完，且拒絕任何 SKIP。

GitHub Actions 工作流程嚴格釘選上述 `main`／`beta` SHA、限定五個**新增**的 `.p40-16bp-*` 文件／workflow，檢查正式 JS/HTML/PDF、`.github/workflows/pages.yml` 差異為零。此 CI **不接 Supabase，沒有 JWT、service_role、公司真實資料、外部 API 或發布權限**。只有取得 GitHub CI 真正的 SUCCESS 才能標示 CI PASS。

## 尚未完成的正式發布條件

1. **正式可信來源未成立**：正式 `erp_states.data` 仍是使用者範圍的完整 JSONB 同步，與 `erp_company_states` 公司資訊的權威關係、真正原子資料投影沒有確認。客戶端提供的 JSON 不能自稱可信帳務來源。
2. **正式核准制度未選定**：本階段 A 候選仍未經負責人獨立同意；B 也保留為選項。若往後選 A，本版本仍採「自己修改不可核准」的保守演練。
3. **真實安全證據未完成**：正式 ES256 JWT/Session/AAL2、即時會員、逐文件 ACL、持久稽核／撤銷，及實際 PDF bytes 的驗證、交付與歷史版本隱私未驗證。
4. **正式驗收未完成**：最新 SYNCED、可還原安全備份、全會計連動、手機/電腦、LOGO/章印、A4/明細彙總、跨區合併與歷史 PDF 保持正確。
5. **嚴禁未經另外明確授權** 修改 `main`、`beta`、正式 Supabase schema/RLS/CAS/Edge、請款、折讓、應收、發票、銀行、薪資、抽成或對外 PDF，亦不得部署正式站。

**結論：隔離原型有助設計審查，但不是正式核准制度，也不是真實功能實測；正式發布 BLOCKED。**
