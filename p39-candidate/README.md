# P39-3｜請款備註修訂與議價折讓獨立候選

**正式 main 未合併；原始 beta 未合併；正式 Supabase 未修改；真實業務資料未匯入。**

- 候選分支：p39-3-allowance-candidate-20261111
- 建立基準：main commit 39b8d543d785f0e0e2c468bed16d8f2e2efaa0fb
- 本候選分支不是正式網站，也未接入 GitHub Pages 自動部署（pages.yml 只發布 main/beta）。

## 已實作

1. assets/js/erp-store.js 僅候選分支：p39BillingNoteRevisionContext / saveP39BillingNoteRevision。對外備註使用原 Store transaction（排隊、CAS、journal、Emergency mirror 和失敗復原），保留原文字、修訂原因、作者與版本。將請款金額、發票、應收、收款、銀行、薪資、抽成列入不可改變的保護集合，不通過則拒絕提交。
2. assets/js/billing.js + index.html 僅候選分支：在原請款明細視窗加入獨立備註修訂面板。原請款編輯、發票和列印操作保留。
3. p39-candidate/core.js：議價折讓引擎僅接受 kushe-p39-3-synthetic-fixture-v1 虛構資料，提供三種發票狀態試算、5% 稅額、保留款、獨立折讓帳、重複入帳阻擋、版本/來源檢查、無收款前置檢查，並不會將擬議減項寫回原帳。
4. p39-candidate/sandbox.html：獨立虛構操作頁。沒有 ERP Store、雲端、正式帳號、正式發票或真實資料匯入功能。頁面所有資料停留在記憶體，重新整理消失。
5. .github/workflows/p39-3-candidate.yml：在候選分支上執行 Node 虛構交易回歸、Playwright 新舊 ERP 回歸與分支範圍保護檢查。

## 嚴格區分已完成與尚未完成

- 備註修訂：已存在候選 Store writer + UI；仍需獨立授權發布至正式 main。
- 議價折讓：**只有虛構交易核心與 UI 範例，尚非正式折讓入帳功能。**
- 已開正式發票：候選核心只認虛構憑證；尚未接入官方折讓憑證查驗或正式稅務申報。
- 既有 ERP 應收、收款上限、保留款、銀行、報表、薪資抽成：尚未接入正式折讓有效金額讀取端，因此 **不允許在真實資料執行折讓入帳**。
- 真正跨裝置寫入競爭、雲端同步回復：正式交易仍未完成獨立測試。未做任何正式 Supabase 寫入或 schema 修改。
- 不允許把目前 P37 beta 整體併入 main。

## 下一階段 Gate

1. 設計同源有效應收欄位與兼容舊版 PDF、收款和月結讀取邏輯。
2. 以合成資料驗證正式 Store 內原子寫入與重複入帳防護、跨裝置版本競爭與回滾。
3. 逐項修正並通過新舊功能回歸與實機手動驗收。
4. 逐張真實已開票折讓仍須以會計核實的合法憑證及權限決定；不得讓使用者僅憑模擬頁面提交。
5. 取得使用者新的 **正式 main 發布授權** 後才可進入發布程序。

**操作警語：** 不要把真正的請款單、薪資、發票或密碼貼到 sandbox。本候選不是正式 ERP。
