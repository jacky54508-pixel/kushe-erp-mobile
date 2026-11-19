# P40-16BH｜可信單筆請款來源的原子版本與授權隔離模型

**DRAFT / FAKE ONLY / NO MERGE / NO DEPLOY / NO PRODUCTION DATABASE ACCESS**

- 日期：2026-11-19（台灣）。正式 `main` 基準：`2ab9c9d5944b1360ba3eebf49695713168caca8a`；`beta` 參考基準：`62669539053a15174081ba8670b18248195c6f8c`。
- 本階段只用 Node.js 本機記憶體與虛構資料驗證設計契約。絕不讀取或修改正式請款、發票、銀行、薪資、抽成、公司資料、Supabase Auth/JWT、PostgreSQL 資料列與正式 ERP 程式。
- 先前管理者 Dashboard 截圖已顯示正式 Supabase **Current ECC (P-256)，即 ES256**；以前使用 HS256。這是經授權畫面上的設定證據，**不是**本測試取得或驗證的真實 Access Token／Session，不能拿來替代後端身分驗證。

## 為何需要獨立實驗

正式 ERP 的 `assets/js/cloud-sync.js` 使用 `erp_states.data` 整份 JSONB 同步；`assets/js/billing-groups.js` 的 `printSaved()` 從瀏覽器 ERP Store 建立合併請款對外列印。正式 `erp_company_states.data` 沒有供一般 authenticated 使用者讀取整欄的 SELECT grant。這些現況**不足以構成**新的「文件級、可信、原子版本綁定」PDF 後端。**禁止**將整份 JSONB 快照傳給任何 PDF Worker 或將 service_role 暴露給客戶端。

## 離線原型內容

`.p40-16bh-tests/test_atomic_document_gateway.cjs` 是可讀的 Node 原始碼；GitHub 測試附件為無損 gzip＋base64 UTF-8 文字編碼，使用 `base64 -d .p40-16bh-tests/test_atomic_document_gateway.cjs.gz.b64 | gzip -dc > /tmp/p40bh_test.cjs` 還原測試。執行方式：`node --test .p40-16bh-tests/test_atomic_document_gateway.cjs`。

隔離模型做了以下處理：

1. **限制輸出欄位**：從虛構的已核准來源只投影目標區、客戶、對外備註、施工行及金額；使用明確 allowlist，不輸出來源請款 ID 陣列、其他區名稱、原發票、銀行、薪資、員工、內部重編原因。
2. **阻擋版本錯置**：以虛構 `syncVersion`、`revision`、`targetBillingId`、來源版本和 SHA-256 指紋建立綁定；讀取時再驗證對應版本一致。
3. **模擬原子更新**：先把整份候選虛構狀態和所有單筆投影建好，任何驗證或模擬提交失敗都不得改動已存在的測試狀態；成功更新後舊版核准不能直接授權新版。
4. **權限拒絕**：模擬已驗證身分、有效 Session、AAL2、公司有效會員、owner/admin/accounting 角色、指定文件 ACL、當版核准；缺任一條件都拒絕。
5. **現有對外承諾**：不重算折讓、保留款、稅額、應收或抽成；僅複製虛構可信來源金額作輸出，目標區限定一區，保留施工明細；不合併其他區名稱。

## 本階段離線執行紀錄

- Node.js v22，`node --test ...`：**11 tests / 11 PASS / 0 FAIL**。
- 正面：正確公司、目標區、文件版本與 ACL 才能取得白名單資料。
- 反面：跨公司、同公司未授權 owner、employee、AAL1、已失效 session、錯誤 target、過期 revision、來源版本漂移、錯誤資料格式、模擬原子提交失敗、其他區和內部敏感欄位外洩均被拒絕或未輸出。

## 絕對不能誤認為已通過的事項

此模型 `fakeIssuerVerified`、`sessionActive`、會員 ACL 和核准都是**記憶體虛構值**，可被測試建立，**不是**安全的身分伺服器。`commitTrustedSnapshot` 假設呼叫者已是可信來源；它**沒有**解決正式 ERP 如何產生、核定、原子寫入正式投影的真正信任邊界。SHA-256 不是簽章；記憶體 Map 不是持久、防竄改的稽核證據。對外備註 `publicNoteReviewed` 也是虛構核對旗標，不能保證使用者不會主動填寫敏感文字。未產生、解析或交付任何 PDF bytes；未驗證真實 Supabase Auth/JWT、RLS、公司角色資料列、真實手機/電腦、最新 SYNCED、可還原備份、財務回歸。

**正式發布：BLOCKED。** 後續須先由正式來源可信產生單筆對外版本、可靠審查與交易一致性，再依最新完整備份、權限、隱私、完整 PDF bytes 與所有帳務回歸進行獨立驗收；涉及 `main`、正式 Supabase schema/RLS/Edge 或部署，均須負責人另行明確授權。