# 酷舍 ERP｜P39-3D 隔離候選開發驗收紀錄

**日期：2026-11-11（Asia/Taipei）**

## 隔離範圍

- Repository：jacky54508-pixel/kushe-erp-mobile
- 候選分支：p39-3-allowance-candidate-20261111
- 基準正式 main：39b8d543d785f0e0e2c468bed16d8f2e2efaa0fb
- 原始 beta：62669539053a15174081ba8670b18248195c6f8c
- 本輪只有候選分支增修，沒有合併、沒有 main 發布，也未存取／修改正式 Supabase 的真實資料。

## P39-3D 新增功能

### 1. 真實議價風險的「虛構資料分類模型」
檔案：p39-candidate/scenario-gate.js

- 僅讀取符合 P39 synthetic fixture marker 的虛構資料。
- 在請款/應收相互關聯不一致、找不到唯一來源、欄位格式不正確時停止。
- 未開票未收款、免開票未收款，在沒有其他業務阻擋時，允許**合成測試流程**。
- 已開票、已收款或已收保留款、存在歷史收款、銀行流水、支票、建商扣款、對外合併文件及重複折讓，一律停止合成過帳。
- 同案場或同來源的抽成、已結算抽成、薪資及發薪資料，一律列入人工覆核，不自動重算既有員工款項。
- 每一個分類結果的 productionPostingAllowed 永遠 false；不等於核准真實交易。

### 2. 候選 Store 的安全閘門
檔案：assets/js/erp-store.js（**只改候選分支**）

- p39SyntheticAllowancePreflight 必須先通過 scenario gate，否則拒絕進入合成記帳交易。
- 仍維持 localhost/127.0.0.1、p39-candidate/ 頁面、所有主檔使用合成 ID、合成快照標記四項保護。
- 不變更原請款、原發票、應收主檔、原薪資與銀行交易。
- 正式 ERP 不得使用合成折讓 writer。

### 3. 模擬兩台裝置競爭（**不是真正雲端**）
檔案：p39-candidate/virtual-cloud-lab.js

- 使用單一記憶體假伺服器，讓兩個虛構裝置用 CAS 版本驗證提交。
- 版本過期時停止舊裝置覆蓋。
- 兩台裝置同時用同一 idempotencyKey 送出時，僅建立一筆虛構帳。
- 同識別碼不同金額拒絕。
- 可注入「提交前失敗」確認完全不寫入。
- 可注入「已提交卻收不到回應」確認重試只返回原結果。
- 對已開票、已有收款、相關抽成薪資資料，一律停止候選操作。
- 沒有 HTTP、資料庫、Supabase SDK、正式憑證，也沒有真實跨裝置雲端測試。

## 測試

GitHub workflow：.github/workflows/p39-3-candidate.yml

- P39-3D 場景分類：17 個 Node 測試情境
- P39-3D 虛構雙裝置記憶體 CAS：9 個 Node 測試情境
- P39-3C 既有電子發票憑證模擬審查、折讓金額、有效應收、備註與 PDF 以及 Playwright 原 ERP 權限、薪資、抽成等回歸。

所有通過狀態應以同一個候選 HEAD 對應的 GitHub Actions 結果為準。

## 仍未完成、不得發布

1. **正式 Store 折讓 writer 尚未開放**。目前只接受 localhost 合成快照，不能用於現有建商或真實已開發票的請款。
2. **沒有與財政部電子發票平台或合格加值中心串接。** 已開立的電子發票需依法開立、傳輸、存證電子折讓單；不能用本系統的「模擬憑證驗證」代替。
3. **目前沒有實際的隔離雲端資料庫測試。** 本輪兩裝置測試為同一程序的記憶體 CAS 模擬，不能宣稱真實 Supabase 多裝置同步已 PASS。
4. **PDF 區分**：原請款 PDF 保留原始金額；P39-3C 的對帳摘要非合法稅務折讓單。正式議價後對外 PDF 必須以一致且可追溯的展示方式另行設計驗收。
5. **薪資抽成**：不允許因折讓自動改變已核算或已付款的抽成。需另外建立可追溯的調整方案並經人工核對。
6. **真實資料**：未針對正式快照執行任何寫入／修復／匯入。正式發布前需另作資料遷移相容性、備份及多端實機回歸。
7. **main 發布**：必須由負責人再次明確同意。不得將 P37 beta 整體合併。

## 2026 年現行法規來源

- 財政部電子發票實施作業要點： https://law-out.mof.gov.tw/LawContent.aspx?id=FL041411&media=print
- 財政部營業人發生退回折讓說明： https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/business-tax/invoice/NELbx22
- 財政部折讓應由賣方電子開立並傳輸（自 2025-01-01 起）： https://gazette.nat.gov.tw/EG_FileManager/eguploadpub/eg030233/ch04/type2/gov30/num9/Eg.htm

本報告只記錄候選分支自動驗證，不是法律或會計人員對個別請款折讓的審查意見。
