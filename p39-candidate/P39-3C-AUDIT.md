# P39-3C｜候選分支驗收與正式發布阻擋清單

驗收日：2026-11-11（Asia/Taipei）  
GitHub repository：jacky54508-pixel/kushe-erp-mobile  
工作分支：p39-3-allowance-candidate-20261111（不可直接合併整個 beta）  
候選基準：main 39b8d543d785f0e0e2c468bed16d8f2e2efaa0fb

## 開發及隔離原則

- 只在 P39-3 獨立候選分支建立、更新檔案。
- 無正式 Supabase DML、無正式資料匯入、無覆蓋實際請款／應收／發票／銀行。
- 獨立虛構 Store 過帳程式僅允許 localhost 或 127.0.0.1、p39-candidate 測試頁，以及受明確測試標記和假 ID 保護的資料。
- GitHub Pages 正式網站不接收上述虛構折讓過帳入口。
- 不碰原始 GitHub main / beta；正式發布 main 須另取得負責人明確同意。

## 完成且自動回歸 PASS

1. 憑證證據閘門：p39-candidate/voucher-review.js
   - 已開票：要求來源發票號碼及測試折讓單、買賣雙方證據與覆核者彼此一致；拒絕冒充外部正式稅務驗證。
   - 待開票、免開票：分開處理；不得混用電子折讓憑證。
   - 永遠標示 productionPostingAllowed=false、externallyVerified=false、formalTaxFilingUpdated=false。

2. P39-3C Store 虛構折讓交易：
   - 支援備份交易 journal / CAS 及核對版本和來源快照。
   - 可在受保護的 Store transaction draft 建立唯一合成折讓紀錄。
   - 不更改原始請款、原應收、原發票、銀行、施工紀錄、薪資或抽成。
   - 在虛構測試中可使用統一有效應收讀取器，阻擋超收及超收保留款。
   - Playwright 模擬預檢、過期來源、故意中斷、重送、兩個分頁版本競爭；通過後不會默默重複過帳。

3. 請款備註修訂：
   - 修訂原因、操作者、原備註與原對外備註留在修訂歷程。
   - P39 writer 同步更新 note 和 publicNote；PDF 原有 buildExternalView 會顯示新的外部備註。
   - Playwright 核對 PDF 產生器使用的新 publicNote，原有稅額、請款與應收總額均不變。

4. 試算對帳摘要：p39-candidate/reconciliation-statement.js
   - 原單未稅、稅額、含稅、保留款與應收 vs. 擬議折讓 vs. 有效金額。
   - 純內部列印 HTML 字串，不是統一發票、正式折讓證明單或正式已記帳報表。
   - 單獨保留原發票號碼及外部驗證未完成狀態；輸入輸出跳脫避免 HTML 注入。
   - 僅讀取合成已覆核的測試分錄；永不對真實 ERP 快照輸出正式折讓憑證。

5. 原 ERP 既有抽成／薪資歷史更正／權限／請款相關回歸測試不改行為。

本輪完整驗收：
https://github.com/jacky54508-pixel/kushe-erp-mobile/actions/runs/42963671101

## 重要阻擋：不可誤稱可正式使用

**P39-3C PASS 的範圍只限候選分支、虛構資料及自動測試。**

- 真實折讓 Store writer 尚未授權及實作正式發布流程（synthetic-only）。
- 未連接財政部電子發票整合平台或核准的加值中心，無官方折讓開立、傳輸、存證、實際合法性驗證功能。
- 尚未以正式多裝置雲端實際往返驗證交易競爭；目前有本機多視窗 CAS 模擬。
- 既有對外請款 PDF 仍顯示原始請款金額；不能把測試 HTML 對帳摘要當成已開立的正式折讓單。
- 正式稅務報表不應因測試分錄就直接減少已開立發票；待合法折讓證明及會計核實後另行設計。
- 未全面驗證所有已付款薪資抽成、已收款、支票、對外合併請款與跨年度稅務處理的正式過帳分流。
- 不得直接將 P37 beta 議價模組整包合併。

## 財政部正式外部資料（規定核實）

1. 已開立發票後銷貨折讓的文件要求：
   https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/business-tax/invoice/NELbx22
2. 電子發票實施作業要點：
   https://law-out.mof.gov.tw/LawContent.aspx?id=FL041411&media=print
3. 2024-12-12 財政部公告起自 2025-01-01 起之電子折讓單開立與傳輸：
   https://gazette.nat.gov.tw/EG_FileManager/eguploadpub/eg030233/ch04/type2/gov30/num9/Eg.pdf

**注意：上列參考資料不代表 ERP 已取得外部官方驗證，任何員工／負責人自行填寫的核准欄位亦不能取代法定電子憑證。**

## 下一階段 P39-3D

- 先定義「合法已開票折讓證明來源」及對帳附件的外部可靠識別/存證方法。
- 把正式議價方案分成：未開票未收款、免開票未收款、已開票持合法折讓憑證、已有收款或支票等高風險情境。
- 完成正式 Store 過帳與收款/保留款/PDF/報表/抽成的全模組一致性，維持原始單據與不可重複過帳、原子回滾。
- 使用全虛構資料，另做真正跨裝置雲端隔離環境測試；不得使用正式 Supabase。
- 取得負責人明確同意，才可發布 main 並做發布後實機驗收。
