# P40-16AZ｜酷舍 ERP 核准制度與既有請款之安全整合邊界

> **DRAFT / NO MERGE / NO DEPLOY / ALL DATA FAKE / NO LIVE AUTH OR SUPABASE.**  
> 2026-11-18，依正式 `main` `2ab9c9d5944b1360ba3eebf49695713168caca8a`、`beta` `62669539053a15174081ba8670b18248195c6f8c` 原始碼制定**測試契約**。此分支直接從 main 建立，不繼承 P40-16AQ～AY 候選應用程式，僅新增隔離測試、報告和 GitHub CI。**絕不執行正式 Supabase SQL、讀取真實 ERP 帳務、登入正式站、修改列印或改寫任何真實歷史。**

## 1. 已確認的正式來源（不是推測）

| 原正式來源 | 已存在能力 | 無法當成新服務安全保證的部分 |
|---|---|---|
| `assets/js/erp-store.js` `saveExternalBillingDocument()` | `expectedSnapshot` 衝突偵測、核對條件、`revision+1`、`history` 以前版本、原請款／應收／收款複本、上限 50 版 | 沒有持久且可信的「獨立審查人核准簽章」；目前正式資料主要仍在 ERP 同步快照 |
| `assets/js/billing-groups.js` `printSaved()` | 已確認文件列印、歷史版本列印獨立，遇原單或收款異動會要求先保存新版本 | 不能直接要求全部既有文件都必須有新核准，否則以前合法文件可能突然無法列印 |
| `assets/js/external-billing-print.js` `validate()` | 原單、施工明細、數量價格、未稅、稅金、保留款與收款核對 | `unified.reason` 是說明文字，並非可信審查人的身分及版本簽名 |
| `assets/js/auth-gate.js` | 前端 `owner/admin/accounting` 有請款讀取；`employee` 沒有。前端 MFA AAL2、公司成員判斷已存在 | 前端 `canView` 或 JWT payload 解碼不等於新後端真正驗證簽章、有效 session、公司和文件 ACL |

上述來源與現行正式資料庫「未發現單筆請款專用授權 API」的 P40-16AT 結論相符。要做真正正式整合，首要仍是**可信來源**及**可獨立授權的審查服務**，不是只加一個「核准」字卡。

## 2. P40-16AZ 已建立的純模擬整合契約

`.p40-16az-tests/mock_integration_boundary.cjs` 是**不含網路、持久儲存或真實登入的 Node.js 隔離模型**，使用 `assets/js/external-billing-print.js` 原本 `validate()` 而非替代金額計算器。假資料只允許 `FAKE-` 文件、公司、使用者、8 月／10 月原發票、施工項目及公司權限。

**階段一：保存/送審**
- 已經存在且未另存新版本的 `legacy` 有效文件仍走 `PRESERVE_CONFIRMED_LEGACY_PRINT`；不追溯要求所有舊文件都簽核。
- 新保存的文件若有重新編排的施工明細，必須對應**當前**文件 `revision` 和經正式原始金額檢查的來源 `SHA-256`。任何新版都不沿用前版的核准。歷史版本仍用 `PRESERVE_EXISTING_HISTORY_PRINT` 路徑，模型不修改現行列印 JS。
- 每次新儲存的測試版本都核對 `expectedRevision`；落後的手機/電腦不能用舊版直接覆寫。這只是模擬交易，不是 Supabase 的真正原子 CAS。

**階段二：核准**
- 模擬同公司且具有此份文件 ACL 的 `owner/admin` 才能核准；編輯者本人即使有 owner 權限，也不能自己核准。會計可以編輯和查看，但在此**實驗政策**中不能核准。實際要誰核准必須由公司負責人另行決定。
- 核准必須指定完整 `documentId`、`revision`、`sourceHash`；若來源、公司、文件身分或核對理由不符就拒絕。**由客戶端傳來的 `role`、`companyId`、`approved=true`、`publicView`、原發票或整份 ERP Snapshot 一律不作為可信授權。**
- 核准只代表「這份版本的重編施工明細可進下一道列印安全檢查」，**不代表議價／折讓已入帳、發票、應收、銀行或員工薪資抽成被重新計算**。

**階段三：交付前再次核對**
- 模型 `beginPreflight` 核對目前身份、公司、文件 ACL、版次、獨立核准或舊版相容條件，產生一次性測試憑證。
- 模型 `finalizePreflight` 再核對使用者、角色、版本與來源指紋；交付前若任何身份或目前版本有變，不能使用舊憑證。只有當相同文件仍合格時才回傳 `safeToProceedWithFurtherPdfByteVerification`。
- **這不是實際交付 PDF bytes！** 真正 PDF-first / SHA-256 同檔交付仍是 P40-16AR 的本機實驗，尚無正式單筆來源及可靠伺服器驗證，不能因測試通過直接接到 GitHub Pages 或 Cloudflare。

## 3. 關鍵尚未定案的公司制度

此處採用的角色分工為**研究用預設**，不是公司已採用的核准政策。正式開發以前要先明確決定：由負責人一人核准、owner/admin 可核准，或不同金額需雙人核准；是否要求編輯者與核准者分離；歷史文件要免補核到哪一天、已收款／已開發票文件是否禁止重編，以及授權員工異動時如何處理已核准文件。

因為目前未讀取正式資料，也不知道每張實際文件的使用情形，不能直接將新核准門禁一次啟用到所有歷史請款。此階段僅證明隔離模型的相容方案，不宣稱資料遷移已完成。

## 4. 不得忽略的正式發布阻擋

1. 正式 Supabase 的安全單筆請款來源、受限來源產生流程與簽署核准人身分尚未建立；不得將整份 `erp_states.data` 快照外送。
2. 真正 JWT 簽章、MFA AAL2、公司有效會員、文件層級 ACL/IDOR、審查人權限，需要以獨立可信服務及真正測試使用者證明，不能採用此模擬 `FakeTrustedIdentitySource`。
3. 持久且不可任意改寫的核准事件及核准後撤銷、會計期間鎖定仍未建立。P40-16AY 的 JSONL 只是本機概念驗證，亦非真正 WORM/數位簽章。
4. 對外備註中敏感資訊的全面人工審核、原發票和其他區域不外露、原施工明細、真正 A4 一頁／PDF bytes 身分、公司 LOGO／大小章及手機／電腦驗收仍必須完成。
5. 上線前需新鮮 `SYNCED`、完整可還原安全備份、所有 CI、真實財務與 PDF 全流程回歸，以及負責人**另行明確批准正式發布**。

**結論：P40-16AZ 是隔離整合「**核准與版本、既有列印相容、交付前重新驗證**」的設計測試，不是正式 ERP 安全核准功能。所有正式程式與真實資料保持不動。**

測試 `.p40-16az-tests/test_integration_contract.cjs`；CI `.github/workflows/p40-16az-approval-integration-boundary.yml`。