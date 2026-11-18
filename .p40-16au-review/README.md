# P40-16AU｜完全隔離 PostgreSQL 單筆請款來源與 RLS／權限實作驗證

> **DRAFT／禁止合併／禁止部署／禁止對正式 Supabase 執行本 SQL。**  
> 2026-11-18 基準正式 `main`：`2ab9c9d5944b1360ba3eebf49695713168caca8a`，`beta`：`62669539053a15174081ba8670b18248195c6f8c`。本分支是**從正式 main 另外建立的研究分支**，沒有合併 AQ/AR/AT 任何版本。僅建立 `.p40-16au-tests/`、`.p40-16au-review/` 與單獨 CI；正式請款、發票、應收、銀行、薪資、抽成、PDF、IndexedDB、MFA、雲端同步及正式 Supabase 均不更動。

## 1. P40-16AT 已查核的真正限制

正式資料庫的 `erp_states.data` 與 `erp_company_states.data` 均是 ERP JSONB 狀態快照。正式 Supabase 已查到四張主要 public 表（全有 RLS），**尚無已確認的單筆請款專用授權表／RPC／Edge Function**。正式員工 `employee_erp_read_projection` 是員工資料投影，不能當建商請款資料來源。

**不可**把現有整份 ERP 快照交給 Cloudflare Worker、PDF 網站、客戶端新下載服務；不可只靠客戶端 `canView` 或自行解碼 JWT 當成伺服器授權。這也是本階段不直接設計正式表、也不連接正式 Supabase 的原因。

## 2. 此階段確實執行的隔離實作

`.p40-16au-tests/ephemeral_model.sql` **只能在 GitHub Actions 的臨時 `postgres:17` 容器資料庫執行**，CI 使用全虛構資料：

| 臨時資料結構 | 僅存的資料 | 安全用途 |
|---|---|---|
| `p40au_lab.memberships` | 假公司、假使用者、假角色、有效狀態 | 驗證使用者對公司的基本權限 |
| `p40au_lab.public_documents` | 假請款 ID、假公司、指定原單、版次、狀態、**單筆對外投影** `public_view` | 不包含完整 ERP JSON、銀行、薪資、發票來源快照 |
| `p40au_lab.document_acl` | 假使用者與假文件的逐筆授權關係 | **即使是同公司負責人，未授權的那一筆也不能讀** |
| `p40au_lab.read_one_customer_pdf(uuid,text,bigint)` | 只收文件 ID、指定原單及版次 | 僅輸出符合 RLS 的一筆建商版 `jsonb`；`SECURITY INVOKER`，不繞過 RLS |

三張表全部 `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`。臨時的 `p40au_reader` 是沒有超級管理權限、沒有 `BYPASSRLS`、沒有新增修改刪除資料表權限的測試角色；只有 SELECT 與特定函式 EXECUTE 的必要權限。查詢的 RLS 依假公司、假會員 `owner/admin/accounting`、MFA 假 AAL2、有效文件狀態、文件授權清單判斷，並在查詢中強制核對請款 ID、指定原單 ID 與版次。

**保護範圍說明：** 本測試角色對*已授權的多筆*文件仍可直接查詢 RLS 許可的行；真正對外服務只能暴露按單筆 ID 查詢的特定端點，部署時 schema 不得暴露給一般 Data API；並須配合可信伺服器 JWT 驗證及不接受任意客戶端 SQL。

## 3. CI 測試預期必須拒絕

- 跨公司，即使猜到真實文件 ID／原單 ID；
- 沒有 `document_acl` 的同公司 Owner；
- 有文件 ACL 但角色只有 Employee，或身分不再有效；
- 缺少 MFA（AAL1）或缺少登入使用者；
- 文件已封存、版次過舊、指定原單錯誤；
- 文件 ACL 被撤銷、公司會員失效、來源版次變更；
- 任意寫入／新增／刪除文件或建立新 schema；
- 非授權成員直接查整張資料表；
- 試圖把整份 `sourceSnapshots` 等私人欄位塞入頂層 `public_view`；
- 試圖把貼有私人快照的額外第四參數送進只有三參數的單筆 RPC。

測試也會核對正面案例：假 Owner 可讀自己的指定請款；假會計可讀獲個別授權的兩張；其他公司 Owner 只能讀自己公司的一張；正確版本的查詢回傳的確是唯一目標區，未包含來源發票、銀行、薪資等欄位。

**這份 CI 結果不是真實授權測試：** PostgreSQL 內的 `request.jwt.claim.sub` 與 `request.jwt.claim.aal` 在測試時由具特權的 CI 腳本**手動設定**，沒有使用真實 Supabase JWT、簽章／簽發者／受眾／到期／撤銷或伺服器 MFA 驗證。在正式 PostgREST 鏈路必須由可信服務驗證 token，嚴禁允許任意使用者自行設定這些值。任何真實使用者直接存取資料的方式都需要另外防護。

## 4. 尚未解決、不能直接發布的問題

1. **最大缺口：正式核定請款的可信來源與寫入流程。** 此虛構資料表裡已預先放入審核過的 `public_view`，但正式 ERP 目前只有狀態快照，**沒有**安全、原子且防竄改地將單筆請款轉成這份投影的流程。不能假設寫入無風險，更不能拿真實 ERP snapshot 外送。
2. **真實身分與 MFA：** 此為假 GUC，不是 Supabase Auth；正式必須驗證真實 JWT、AAL2、公司權限、session 和角色，並防跨公司 IDOR。
3. **財務來源不可變：** 未驗證從正式單據、折讓、保留款、稅金、多月發票及跨區合併來源核算出的數值和歷史狀態；不能用客戶端提供的 View 當真實核定資料。
4. **PDF 同檔安全交付：** P40-16AR 的 localhost PDF-first 模組尚未整合真實服務；舊版 `window.print()` 和鍵盤列印仍然存在。
5. **資料庫／RLS 變更要另行核准：** 此臨時 SQL **不是正式 migration**，不得直接複製到正式 Supabase。若要建正式表、函式、RLS 或權限，須最新 `SYNCED`、完整備份與回復檢查、隔離安全審查、真實手機／電腦及全財務 CI，最後另經負責人明確同意。
6. **假資料的白名單只是示範：** SQL 只檢查頂層敏感欄位與必要 schema，不能保證任意深度 JSON／備註不含私密資料；正式資料輸入流程及最終 PDF 交付都必須加上完整的來源對照、深度欄位 allowlist 與隱私驗證。

## 5. 結論

P40-16AU 的目標是用真正的臨時 PostgreSQL RLS 驗證「**無須讓 PDF 服務接觸整份 ERP 快照，也能按公司＋單筆請款授權取得對外資料**」這個**模型**是否可行。即使 GitHub CI 全綠，也只代表**虛構且已預先整理好的資料**的 ACL/RLS 原型 PASS，絕不表示正式 ERP 的單筆授權來源已存在。

**正式上線狀態：BLOCKED。此 PR 維持 DRAFT，不合併、不部署、不修改任何正式資料。**

官方參考：

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase JWT Claims](https://supabase.com/docs/guides/auth/jwts)
