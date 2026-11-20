# P40-16BU｜正式請款原版型不變：列印快照網址隱私修正（僅隔離候選）

**DRAFT / NO MERGE / NO DEPLOY / NO REAL ERP DATA.**

Stacked on PR #74 HEAD `838af8eb8641ea6ef857f69f116022bd30658ad7`, formal main `2ab9c9d5944b1360ba3eebf49695713168caca8a`, beta `62669539053a15174081ba8670b18248195c6f8c`.

本次**完全不更動** `billing-print.html` 原版型（參照負責人上傳「酷舍_請款單_達莉心閱_2026-11.pdf」），保留左上 LOGO、公司標頭、四格客戶／案場、戶別施工統計、施工項目彙總、右下請款金額、公司大小章及客戶簽章。

前版 `billing-groups.js` 把完整原單、原發票與收款快照編進 URL fragment。此候選改由父頁短期記憶體 `BroadcastChannel` 傳送資料給用一次性隨機 UUID ticket 打開的子頁。子頁在收到後立即移除 ticket，原有 `validate()` 仍須核對所有帳務快照，再將**只含公開欄位**的投影交給**未修改的原版** `billing-print.html`。不使用 localStorage、sessionStorage 或任何伺服器新資料列，請求最多 30 秒、一次性回覆。

安全的失效：沒有父頁、老式帶快照 URL、無 BroadcastChannel、權限不足、錯誤資料或逾時，直接拒絕**新**列印嘗試；不刪、不修改已保存的 ERP 請款與來源資料。過往舊 URL 可能失效，必須在測試環境實際驗證手機、電腦、快取、跨分頁與 popup 限制，不可直接發布。

**尚未證明：** 真實瀏覽器雙分頁相容性、A4 PDF 新傳輸端到端、真實請款與權限、正式 SYNCED/可還原備份、全部財務回歸、客戶分享網址及 owner 最終發布授權。即使假的 CI 通過，也不能合併或部署。**正式發布維持 BLOCKED**。