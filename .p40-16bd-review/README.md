# P40-16BD｜真正簽章 JWT 的隔離驗證＋公司／單筆請款權限

> **GitHub DRAFT／禁止合併／禁止部署／全部假身分與假帳務。** 獨立從正式 `main` `2ab9c9d5944b1360ba3eebf49695713168caca8a` 建立；正式 `beta` `62669539053a15174081ba8670b18248195c6f8c`。這次不修改 ERP 請款、PDF、發票、折讓、應收、保留款、銀行、薪資、抽成、正式登入、Cloud Sync、Supabase 資料庫或任何正式資料。

## 這次真正增加了什麼？

之前 P40-16AU～BC 的權限模型只有**虛構布林值**（例如 `signatureVerified:true`），不能證明密碼學簽章。P40-16BD 改為在 GitHub CI 執行期間由 Node.js `crypto.generateKeyPairSync('rsa', {modulusLength:2048})` **臨時產生一組 RSA 私鑰與公鑰**：測試用**私鑰**只存在 CI 進程記憶體，不提交 GitHub、不用正式 Supabase secret；受信任的**公鑰 JWK** 放入本次測試 `JWKS`。

`.p40-16bd-tests/verify_fake_jwt.cjs` 以 Node `crypto.verify('RSA-SHA256',...) ` **真的驗證 RS256 簽章**。透過後端預先信任的固定、唯一 JWKS `kid` 找公鑰（不相信 token header 內宣稱的 `jku`、`jwk`、`x5u`），拒絕 `alg: none`、HS256、錯誤 RS256 簽章、重複 `kid`、變更內容、私鑰混入 JWKS、弱小公鑰等。必須通過預設的假 Supabase issuer／audience、`iat`、`nbf`（可選）、`exp`、假測試最大 token 時效、`role: authenticated`、非匿名使用者及 `aal2`。

### **簽章通過，不等於可核准**

只使用簽章驗證後的 `sub` 與 `session_id` 去查**隔離測試用的可信端登記冊**，再重新核對：

1. **Session**：與身分相符、尚未到期、未撤銷、未停用；即使未過期的已簽 JWT 也可能失去有效 Session。
2. **公司會員資格及職務**：向可信端登記冊查該使用者於**目標文件所屬公司**的有效會員資格與 owner/admin 角色；**不相信 JWT 的自填 `user_metadata`、`app_metadata`、`company_id` 或 `company_role`**。實際公司能否讓 admin 核准仍屬候選制度、不是公司已決定。
3. **單筆文件 ACL**：必須對指定 `documentId` 真正擁有核准權，只有同公司一般讀取權仍不足。
4. **文件版次及來源**：現行、待審、重編施工明細，`revision`／`sourceHash` 與可信端目前資料一致，且最近原單／收款未漂移，核准人不同於最後編輯者、送審者。
5. **拒絕敏感客戶端輸入**：只接受 `{action, documentId, revision, expectedHash}`，不能接收客戶端聲稱的角色、公司、核准物件、原發票或整份 ERP JSON 狀態當成可信核准。

本實驗成功只回傳 `ELIGIBLE_FOR_SEPARATE_APPROVAL_JOURNAL`，明確附上 `persistedApproval:false`、`pdfBytesDelivered:false`、`realBackendIntegrated:false`；**不會建立核准、發票、銀行交易、存資料庫或產生 PDF**。

## GitHub CI 驗收

`.p40-16bd-tests/test_signed_session.cjs` 使用測試期間動態產生的兩組**不同** RSA 金鑰，透過真正簽章測試：
- 正面：RSA-2048 + 設定一致的受信任 JWKS、issuer/audience/AAL2、目前有效假 session、公司 owner/admin、文件核准 ACL、非編輯者。
- **變造與演算法攻擊**：改 token payload、換公鑰或私鑰、錯誤 `kid`、重複 `kid`、`none`、HS256、ES256 及其他算法混淆、無簽章、header 引用惡意遠端 JWKS 等。
- **JWT 生命週期**：過期、過長 token、未到生效時間、issuer/audience 錯誤、缺少有效 `sub/session_id`、`aal1` 或匿名、過期 Session 及已撤銷 Session。
- **公司／文件的越權**：公司會員停用、跨公司、缺少文件 ACL、僅有會計或員工權限、核准者同時是編輯者/送審者、不同文件、過時版次、來源摘要不符、文件封存、已核准文件重新核准，以及自填 JSON/JWT 權限宣稱不生效。
- **正式來源只讀保護**：CI 固定原正式 `main`／`beta` SHA，嚴格確認分支只新增本階段的測試／報告／CI 檔案，不改原 `saveExternalBillingDocument`、`printSaved`、登入、Cloud Sync、HTML、PDF 或正式 GitHub Pages。

## **最重要的生產限制（全部仍阻擋）**

這個驗證器只是 **RS256 孤立原型**，不是可用於真實 Supabase 專案的多演算法 JWT 驗證服務：
- Supabase JWT 簽署鑰匙可能為 **RS256、ES256、HS256（legacy）** 等，且有輪替、快取及真正的 Supabase JWKS 取得與 issuer 專案識別。此原型不連線取得公鑰，也不支援目前正式專案的實際簽章模式，**不能把這段實驗原碼直接部署**。正式應使用可信 JWT 驗證函式庫或 Supabase Auth `getClaims()`（依官方適用範圍）並驗證鑰匙輪替與實際 JWT；切勿將 service_role/secret key 放進瀏覽器。
- **真實的 Session 有效性**無法只靠 JWT 簽章證明。這裡的 `registry.sessions` 是假資料；要能即時撤銷權限仍需有授權的受信任端查詢驗證有效 Session、有效會員、公司/文件 ACL 或其他明確審核的策略。
- 假文件 `trustedSourceCurrent:true` 也是虛構設定，**未解決 ERP 目前 JSONB 同步快照如何安全取得單筆已核定請款、原單金額、核准金額及來源版本**；仍不可把整份 ERP 備份送去 PDF 網關。
- 已有的 P40-16BB／BC 兩種候選公司角色政策都**沒有正式核准**。本次測試暫以 owner/admin 作為**假定**核准角色，不把此規則合併正式 ERP，也沒有核准者追溯、停用後合法性或歷史文件遷移決定。
- 沒有**真正的持久簽章核准紀錄、PDF bytes 生成與交付、對外備註敏感資料保護、原 A4 單頁／公司 LOGO／大小章驗收**。現有瀏覽器 `window.print()` 並未被此原型接管或驗證。
- 正式上線仍需最新 `SYNCED`、完整可還原備份、實際手機/電腦與會計完整回歸、全部 CI 及負責人**另行明確同意正式發布**。CI PASS **不等於**正式 ERP 能核准、能安全下載或已更新任何正式資料。

### 官方資訊確認

本階段在 2026-11-19 讀取 Supabase 文件（使用 Supabase 官方文件搜尋）：
- [Supabase JWT 驗證與 JWKS](https://supabase.com/docs/guides/auth/jwts)
- [JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)
- [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa)
- [Supabase Sessions](https://supabase.com/docs/guides/auth/sessions)

**結論：** 這次比前幾個階段前進到「真正公私鑰簽章驗證」的安全證據；但仍只針對測試金鑰和虛構身份，**正式核准來源、正式登入與正式 ERP 皆未改動**。
