# P40-16CB｜正式 main 基準的乾淨請款列印候選（禁止發布）

**候選狀態：DRAFT / NO MERGE / NO DEPLOY。** `main` 基準為 `2ab9c9d5944b1360ba3eebf49695713168caca8a`。這份候選不包含 PR #74－#80 之前的完整堆疊歷史；只複製已隔離驗證的三份請款**列印相關程式**。

## 允許改動的正式程式：3 檔
- `assets/js/billing-groups.js`：ERP 同來源分頁的臨時 BroadcastChannel，一次性 UUID 憑證；來源快照不進入新開列印網址。
- `assets/js/external-billing-print.js`：先核對原單、合併款與對外區域，再轉入原始 `billing-print.html`；歷史列印不展示私密發票／其他區原案資料。
- `billing-print.html`：**只有對外合併請款**用特定顯示旗標套用灰白色版型，一般請款及報價 PDF 維持原樣。

三個正式程式檔案與 PR #80 候選版本的 blob SHA 完全相符。沒有修改 ERP Store、雲端同步、主資料、薪資、抽成、應收、發票、保留款、材料或銀行。

## 只保留必需的 3 個測試（均為假資料）
- `.p40-16cb-tests/test_one_time_handoff.cjs`：14 個安全 URL／一次性資料傳遞／對外隱私模擬測試。
- `.p40-16cb-tests/real_chrome_reference.cjs`：Chrome 桌面 1280px、手機 390px 模擬的 A4 請款 PDF、一頁列印及純 CSS 樣式差異，不代表實體手機實測。
- `.p40-16cb-tests/real_full_workflow.cjs`：使用原始 ERP Store 在獨立 Chrome 以虛構資料驗證 28 項財務與 IndexedDB 等回歸，包含**折讓唯讀試算**，不包含折讓實際入帳。

檔案大小不得大於先前 CI 所用測試稿，真實備份**禁止提交 GitHub**。用戶上傳的正式達莉心閱 PDF 範本也保留在對話中，不放在公開 repo。

## 強制阻擋
1. 正式 main/beta 基準 SHA 變動或候選修改超過明確白名單。
2. 安全 URL／A4／版型／財務回歸任何一項失敗。
3. 真實正式站已輸入資料沒有當下 SYNCED、完整可還原備份及實際設備驗收。
4. 使用者尚未確認**最終請款版型 PASS**；也未授權合併正式 main／部署。

**不會因 CI SUCCESS 而自動部署；正式發布始終 BLOCKED，需另外明確授權。**
