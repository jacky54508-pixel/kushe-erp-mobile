# P40-16BS｜GitHub Chromium 實際 A4 PDF 煙霧測試（全虛構）

**DRAFT / NO MERGE / NO DEPLOY / NO REAL DATA。**

- 只新增測試與 CI，正式 main 2ab9c9d5944b1360ba3eebf49695713168caca8a、beta 62669539053a15174081ba8670b18248195c6f8c、Supabase、ERP Store、財務與正式 PDF 均不變。
- 目標是 PR #74 固定 SHA 84aca677b786c15e0e33a41aff8881a2b6944846；先前 GitHub #44649095081 已驗證 15 PASS / 0 FAIL / 0 SKIP 的 Node VM 測試。
- GitHub runner 以 Chrome 載入真實候選 HTML/JS，加上完全虛構的歷史合併請款。生成 A4 PDF 與窄螢幕/桌面 PNG；檢查指定 M 區、施工明細、底部彙總、歷史標籤，阻止假 L 區/假發票/銀行資訊出現在 DOM/PDF。
- GitHub 成功只代表虛構資料在該瀏覽器的煙霧測試，不代表真實單據、手機實機、LOGO 大小章、雲端 SYNCED、備份回復或全財務回歸。PNG 與 PDF 仍須人工視覺檢查無裁切跑版。
- 既有列印 URL 中途仍有來源快照 fragment 風險，不得分享 ERP 列印頁網址給建商。
- 正式發布維持 BLOCKED；任何合併/部署/真實資料更動需另行明確授權。