# P40-16BI｜可信單筆請款隔離整合：ES256＋SQL 原子交易

**DRAFT / FAKE ONLY / NO MERGE / NO DEPLOY / NO PRODUCTION DATABASE ACCESS**

日期：2026-11-19（台灣）；基準正式 `main`：`2ab9c9d5944b1360ba3eebf49695713168caca8a`，先前記錄的 `beta`：`62669539053a15174081ba8670b18248195c6f8c`。此候選只新增隔離測試、報告、決策檔及 CI，沒有合併 P40-16BH，也沒有碰任何正式 ERP JS/HTML、請款 PDF、IndexedDB、Supabase schema/RLS/Auth/Edge Functions、發票、薪資、抽成、應收、銀行、真實資料。

## 實際執行了什麼

使用 **Node.js v22 內建 `crypto`** 產生一次性**虛構**的 P-256 私鑰，實際簽署並驗證 **ES256** 格式測試 JWT（`issuer` 是 `.invalid` 網域，`kid` 為虛構值；**沒有取得或使用任何正式 Token、私鑰或 JWT Secret**）。嚴格檢查簽章、`alg`、`kid`、`iss`、`aud`、`sub`、`session_id`、`exp/nbf/iat` 和 `aal2`。完成簽章驗證後，再到**獨立的 SQLite 記憶體測試資料庫**核對假 Session 有效狀態、公司會員角色及**指定單筆文件** ACL，不接受前端自行提供「已驗證」布林值當授權。

SQLite (`node:sqlite`) 建有假 `root_states`、`projections`、`approvals`、`memberships`、`document_acl`、`sessions`。測試專用的 `commitFakeSnapshot` 在 `BEGIN IMMEDIATE` 到 `COMMIT` 的**單一實際本機 SQL transaction** 中，同步保存假來源快照與假請款對外投影；提供競爭版次拒絕及兩個失敗注入點，確認失敗後 `ROLLBACK`。最新文件版本、指定對外案場及 SHA-256 來源雜湊不一致時，拒絕讀取。模擬核准資訊與來源版本綁定，改版後必須重新模擬核准。

對外讀取端只回傳白名單欄位：客戶、**指定對外區域**、文件日期、經假流程確認的對外備註、施工明細、已保存合計。測試假資料中植入「其他區域名稱／發票／銀行／員工／薪資／抽成／內部核對理由」作哨兵，驗證回傳資料中**沒有這些測試哨兵**。原合計由已輸入的假資料複製並核對加總一致，不自行重新計算真實折讓、稅金、保留款、應收或抽成。

執行：

```bash
node --test .p40-16bi-tests/test_trusted_gateway.cjs
```

本機驗收：**19 tests / 19 PASS / 0 FAIL**（Node.js v22.16.0）。這是離線假資料測試，**GitHub Actions CI 尚須獨立確認成功**。

## 無法通過正式發布的關鍵缺口

1. **信任入口未建立：** `commitFakeSnapshot` 故意是只被測試呼叫的假內部方法；它**沒有**從正式 ERP `erp_states.data` 可信地產生、核准、同步更新正式單筆投影。**禁止**把整份 ERP JSONB 交給 PDF Worker；不得以 `service_role` 或 `SECURITY DEFINER` 繞過授權。
2. **不是 Supabase 認證／授權測試：** 真實 Supabase Dashboard Current Key 顯示 ECC (P-256)/ES256，但本原型用的都是獨立生成的假簽章。沒有驗證真實 Auth、JWKS 更新、Token 撤銷、Session、PostgREST、RLS、公司會員／ACL、身份識別與密碼輪替。SQLite 沒有 PostgreSQL RLS，因此通過不代表正式 RLS PASS。
3. **核准制度未獲正式決定：** 假 `approveFromFakeTrustedProcess` 不具獨立審查人權限、雙人覆核、防竄改持久稽核及實際核准簽章，不能用於任何真實建商文件或金額調整。
4. **PDF 沒有整合：** 沒有產生、驗證、交付任何真實 PDF bytes。跨區只顯示指定區、底部施工彙總、原請款歷史格式、LOGO/大小章、A4 單頁、手機／電腦均尚未在此階段驗證；對外備註的假 `publicNoteReviewed` 不是對真實敏感文字的可靠審查。
5. **帳務不可改：** 正式請款、折讓、稅額、保留款、已開與多月發票、應收、收款、銀行、薪資抽成、原歷史文件皆維持原樣；沒有進行真實財務驗算。正式 `SYNCED`、完整可還原備份和手機／電腦實機驗收也未執行。

## 下一個安全階段 P40-16BJ

若繼續，只能在**完全隔離的臨時 PostgreSQL 17 容器**用虛構資料測試交易鎖、RLS/最小權限、文件級投影及版本競態；仍需避免連線正式 Supabase。通過後另行設計可信來源寫入與公司負責人核准制度。**任何正式 schema/RLS/Edge、main/beta 或部署變更都必須另行明確授權**，且無條件維持正式資料不動。

**正式發布狀態：BLOCKED。**