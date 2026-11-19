# P40-16BB｜重編施工明細的核准人角色與最小可信授權方案

**DRAFT／NO MERGE／NO DEPLOY／全部虛構身分、文件和測試。** 2026-11-19 以核對過的正式 `main` `2ab9c9d5944b1360ba3eebf49695713168caca8a` 直接建立獨立候選，`beta` `62669539053a15174081ba8670b18248195c6f8c`。**不得將任何本測試模組匯入正式 ERP，也沒有操作正式 Supabase、現有帳務資料、PDF、薪資、抽成或銀行。**

## 一、與真正正式 ERP 相符的事實

核對正式 `assets/js/auth-gate.js` 的 `ROLE_PERMISSIONS`、`sessionAal`，`assets/js/erp-store.js` 的 `saveExternalBillingDocument()`，`assets/js/billing-groups.js` 的 `printSaved()`：

- **現行前端** `owner/admin/accounting` 可以查看及編輯 `billings`；`employee` 不能查看請款。這是現行*請款*權限，**不是已存在的獨立核准者權限**。
- 前端已採 AAL2 MFA 與公司會員角色檢查。但前端自行解讀 JWT／顯示權限，**不能代替新可信服務的簽章、有效 Session、MFA、公司權限、文件層級 ACL/RLS 驗證**。
- 合併對外請款已有 `expectedSnapshot`、`revision+1`、`history`；仍須使用官方來源核對未稅、稅額、保留款、應收及原施工數量。任何核准／退回只作用於**對外施工重編文件**的可交付資格，不得修改財務帳或改價。
- `printSaved()` 分為當前及歷史路徑，當前原單／結算有漂移會停止列印。因此不能直接用新核准資料不足為由，把**未改動、之前合法保存的全部請款**一律停用。

## 二、候選政策（**尚未獲負責人核准**）

| 操作 | 候選角色 | 守門規則 |
|---|---|---|
| 查看請款及歷史 | 負責人 owner／管理者 admin／會計 accounting | MFA、有效公司會員、指定公司及該文件的閱讀權限；歷史保持只讀 |
| 編輯、送審 | owner／admin／accounting | 只能對當前有效版本和有權限的請款操作；保存新版本必須通過原正式 `expectedSnapshot`／金額核對；送審需指定 `documentId + revision + sourceHash` |
| 獨立核准／退回 | **候選 A：owner 或 admin** | 必須不同於最後編輯者和送審者，不能用前端 `approved:true` 或自己填入的 `role` 冒充 |
| 較嚴格替代方案 | **候選 B：只有 owner** | 同樣必須獨立於編輯者；若只有一人管理／送審，預設維持待審，**不能偷偷啟用本人核准** |
| 正式建商版 PDF | 不直接由核准動作發出 | 核准後仍需可信單筆請款資料、重新確認帳務版本／對外區域／備註隱私，再通過真正 PDF bytes 頁數與內容驗證 |
| 既有確認文件 | 不追溯阻擋 | 舊且未修改者沿用現有可列印規則；**另存新版本才進入新制度**，不能回寫既有請款／應收／發票／銀行／薪資 |

**不能代替公司決策的問題：** 是否要讓 admin 參與核准？如果公司只有同一位 owner 在編輯、核准，應如何授權第二位獨立核准者？歷史已有發票、已收款、不同月份發票及議價折讓的單據，哪些情況不得靠施工重編核准就視為金額修正？是否另設高額／重大折讓的雙重核准？本研究先給安全可比較的選項，未替負責人決定。

## 三、P40-16BB 的真正交付（只在隔離測試）

`.p40-16bb-tests/mock_policy_authority.cjs` 是**純函式、無網路、無資料庫、不持久化**的候選權限決策器。收到的 `principal`／`document` 都只能是 **FAKE 身分來源**及 **FAKE 文件**，**不是**正式伺服器已驗證身分；正式系統不能相信瀏覽器自行送的角色、核准、公司 ID 或文件快照。

- 固定操作契約 `view_current`、`view_history`、`edit`、`submit`、`approve`、`return`、`withdraw`、`release_to_pdf_gate`。從使用者端只能提交該操作必須的文件定位 ID／版次／來源指紋／退回理由，不收 `companyId`、角色、核准標記、原始發票、銀行／薪資及整份 ERP JSON。
- 假可信端每個動作重新檢查 `signatureVerified/issuerVerified/audienceVerified/expiryVerified/sessionValid`、AAL2、有效會員、公司、文件 ACL、角色，以及目前版本／原單指紋。**這些只是測試布林值，沒有任何真正的 JWT 密碼學驗證**。
- 若核准者與編輯者或送審者同人，無論 owner/admin 都拒絕；角色取消、公司權限更動、來源指紋漂移或版本過舊都拒絕。
- `release_to_pdf_gate` 只表示有資格進入**另一道** PDF bytes 安全產生／查核步驟，不是正式 PDF 已產生或已交付，亦不具「截住瀏覽器 File→Print」功能。
- 不追溯封鎖舊版：`legacy` 且從建立後未變更者只維持原列印契約；一旦版本更改，就不能沿用舊制度。歷史版本仍保留獨立、公司與文件授權的唯讀入口。
- 退回原因在模擬回傳中只記 SHA-256 摘要，不回傳可能包含私人票號的備註文字；**SHA-256 不是數位簽章或 WORM 稽核保證**。

`.p40-16bb-tests/test_policy_matrix.cjs` 以 **Node.js 原生測試**對比現行 `ROLE_PERMISSIONS` 與官方 `revision/history/printSaved`，測試跨公司、員工、MFA 假身份、權限撤銷、本人核准、owner-only 對照、來源／版次不符、客戶端夾帶敏感欄位、歷史只讀、舊文件相容及 PDF 閘門的安全拒絕。

`.p40-16bb-review/decision.json` 保留兩種候選政策、公司仍需決定的項目及正式上線硬性阻擋原因。

## 四、可信服務最小設計（**沒有實作，也沒有要求正式資料庫權限**）

如果未來另外授權實作，應先在完全獨立資料庫把*核准紀錄與當前文件版本*安全連結，提供**按公司＋文件 ID＋版次＋已核准來源 SHA-256 的單筆授權服務**，使用經真實 Supabase Auth 簽章驗證的身分與 MFA，再由可靠服務讀取**核定的單筆公共投影**，不能讓瀏覽器或 PDF Worker 上傳整份 ERP 快照當作可信來源。

- 核准紀錄需可持久化、具有受信任審查者身分、公司和文件授權、不可重複提交、後端原子版本 CAS、可稽核／不可任意覆寫的撤銷事件。
- Supabase 表與端點仍須同時設定**GRANT 最小化及 RLS**；`TO authenticated` 本身不表示公司或文件授權。視圖如果需要暴露，必須以真正呼叫者權限審查是否能遵守 RLS；不能因功能受阻便無條件使用 `SECURITY DEFINER`。
- 瀏覽器不持有 `service_role` 或 secret key；身份判斷不可使用可由本人修改的 `raw_user_meta_data`。不只驗 JWT 簽名，也應依敏感操作要求檢查有效 Session、目前公司會員、角色、文件 ACL 與 AAL2。
- 實際 PDF-bytes 交付前再次核對版本和權限，確保**建商拿到的檔案與已驗證內容為同一份 bytes**。舊 native browser print 路徑不能當作已有 PDF-bytes 閘門。

官方參考：[JWT 驗證](https://supabase.com/docs/guides/auth/jwts)、[MFA/AAL2](https://supabase.com/docs/guides/auth/auth-mfa)、[RLS 與安全視圖](https://supabase.com/docs/guides/database/postgres/row-level-security)、[保護 Data API](https://supabase.com/docs/guides/api/securing-your-api)。

## 五、正式發布一律 BLOCKED

目前缺少正式 Supabase 已受授權的**單筆資料來源**、真正 JWT/MFA／公司／文件 ACL/RLS、持久審查事件、經負責人核准的公司角色政策、PDF 交付同檔 bytes 閘門、任意自由文字敏感資訊確認，以及最新正式 `SYNCED`、完整可還原備份、全部實際手機／電腦、公司 LOGO／大小章、單頁 A4、全請款／發票／折讓／保留款／銀行／薪資抽成回歸及負責人**另外明確核准正式發布**。

**P40-16BB 結論：僅提出候選政策與安全合約，沒有任何正式 ERP 程式、請款、帳務、登入、資料庫或 PDF 變更。不得因 CI PASS 就合併 main／beta 或安裝核准入口。**
