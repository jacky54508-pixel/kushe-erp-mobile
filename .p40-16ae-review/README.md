# P40-16AE｜單筆請款來源與權限隔離查核

**READ-ONLY + 全虛構授權測試；不得合併 main/beta、不得部署、不得讀取或修改正式 Supabase/ERP 資料。**

基準：2026-11-17 正式 main = 2ab9c9d5944b1360ba3eebf49695713168caca8a，beta = 62669539053a15174081ba8670b18248195c6f8c。此分支直接自 main 建立。

## G1 真正發現的架構阻擋

正式 assets/js/cloud-sync.js：
- remotePath(userId) 使用 /rest/v1/erp_states?select=data%2Cupdated_at%2Csync_version%2Clast_writer_mode%2Clast_base_sync_version&user_id=eq.{userId}&limit=1
- readRemote(auth) 回傳整筆遠端 data 快照，不是 billingId + companyId + revision 的單筆請款公開查詢
- casWrite() 是整份 new_data 寫入流程，**不得**在 PDF 服務中呼叫

assets/js/auth-gate.js 目前可在前端查公司成員、MFA 與 erp_company_states 版本欄位；這**不是**服務端授權與正確來源的證明。未來後端須真正驗證 JWT 簽章／issuer／audience／expiry、有效 session、MFA、公司/文件最新權限，不得只解碼 JWT 或相信瀏覽器自填身份。

GitHub 正式程式**未能證明**正式 Supabase 存在可用單筆請款 ID＋公司＋版本、服務端隔離權限的專用只讀來源。本階段沒有讀取正式 Supabase schema 或 RLS，也不能斷言它一定不存在。

**G1 = BLOCKED（缺少安全來源證據）。** 不得把整份 erp_states.data、IndexedDB/Emergency 備份、內部發票快照、薪資、銀行或完整帳務送進 PDF 服務。

## G2 全虛構身分與文件授權模型

測試檔 .p40-16ae-tests/test_fake_single_document_authz.py 純 Python 標準函式庫，不連網、不接受真實 token，也不包含任何正式 API 密鑰。固定的 FakeIdentityVerifier 只模擬已由可信授權程序驗證的結果；**它不是 JWT 驗證器，絕不能部署**。

必須拒絕的模擬情況：
- 偽造或未知 token 標籤、session 過期、MFA 未完成
- 沒有請款權限的員工、停用的公司成員、跨公司查相同請款號
- 非指定區、舊修訂、雲端狀態非 SYNCED、封存請款、找不到文件
- 沒有符合公司與單筆文件索引的只讀 resolver 時，不得退回整份 snapshot API
- 任意要求讀取 sourceSnapshots、銀行、憑證等內部資料
- 金額矛盾、未授權的文件來源、混合真實資料

最小請求草稿只包含 documentType、billingId、targetProjectId、expectedRevision 四個字串。這些都是待核對的索引，**不能用來證明用戶擁有文件**。公司歸屬從已驗證的服務端身份＋成員權限取得。JWT 只可透過 HTTPS Authorization header 使用，不可置於 URL/query/log/PDF。

對外 view 應以白名單欄位組成，不包含 invoiceNo、invoiceDate、sourceSnapshots、settlementSnapshots、bank、salary、commission、access_token、refresh_token 或其他敏感資料。此測試使用簡單虛構計價，**未驗證** ERP 真實混合稅額／保留款／跨區合併商業規則。

## 架構決議與後續阻擋

1. 暫時**不部署** PDF 網關，也**不建立**正式資料表、RLS、Edge Function 或 Cloudflare Worker。
2. 在不連真實資料下完成 G2 單筆索引與公司權限測試；若仍只能讀整份 erp_states JSON，就保持 G1 BLOCKED，停止後端實作。
3. 若需正式 Supabase schema／RLS 唯讀查核或變更，應單獨取得所有者明確授權，嚴守不能動正式資料和 main 的既有約束。
4. 可研究受控前端最小 view 方案作備案，但瀏覽器自填金額不可視為可信賬務；不得將整份 ERP 快照送出去。
5. 真正發布前，從**屆時最新 main**另開最小候選；先備份、確認最新 SYNCED、全部 CI、手機電腦實際對外 PDF、發票隱私、完整章影和帳務回歸，再取得新的明確發布授權。

參考：
- https://supabase.com/docs/guides/functions/auth-headers
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/database/postgres/row-level-security

**結論：只有虛構授權契約 PASS 並不足以證明正式 Supabase 支援安全單筆請款查詢；正式整合仍 BLOCKED。**
