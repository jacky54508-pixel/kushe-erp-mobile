# P40-16BK｜正式 ERP「單筆請款可信來源銜接」隔離契約測試

**DRAFT / FAKE ONLY / NO MERGE / NO DEPLOY / NO PRODUCTION SUPABASE ACCESS**  
台灣時間：2026-11-19；正式 `main` 基準 `2ab9c9d5944b1360ba3eebf49695713168caca8a`，`beta` 參考 `62669539053a15174081ba8670b18248195c6f8c`。僅新增 `.p40-16bk-tests/`、`.p40-16bk-review/` 與獨立 CI，無任何既有正式 ERP 程式、部署、PDF、schema、RLS 或業務資料修改。

## 真正的正式 ERP 事實（唯讀程式查核）

- `assets/js/erp-store.js`：跨區合併文件存在 `state.meta.externalBillingDocuments`，v2 `kushe-external-billing-group-v2` 保存 `sourceIds`、`targetBillingId`、`sourceSnapshots`、`settlementSnapshots`、`totals`、`unified`、`revision`；`externalBillingDocumentIndex()` 會檢查原單／收款資料是否變動。
- `assets/js/cloud-sync.js`：現在仍以 `erp_states.data` **整份 JSONB** 加上 `sync_version` 同步，沒有通用的資料庫內「從單筆正式請款驗證並生成精簡對外投影」入口。
- `assets/js/billing-groups.js`：現有 `printSaved()` 從瀏覽器 Store 組成列印內容，另有正式／歷史版本列印邏輯；此原型不得更動該入口，也不得把瀏覽器可提供的角色／版本字串當作真正的伺服器授權。
- `assets/js/external-billing-print.js`：正式當前版本的對外 PDF 以目標 `displayProjectName` 限定呈現單一區域；歷史保存版本另有舊列印路徑，禁止新原型一律封鎖舊文件。

## 本次測試新增了什麼

- `.p40-16bk-tests/source_bridge.cjs` 是**不接正式 ERP、不能部署**的單筆請款模擬銜接契約。模擬已由可信服務提供一份完整、版本固定的假 ERP Snapshot，從 `meta.externalBillingDocuments` 只選擇 **指定文件 ID、版次、來源 sync_version**。
- 檢查目標原單是否在來源清單內、唯一目標區及同一建商、各原單未稅＋稅額＝含稅、保留款、應收、已收、支票預留、施工列小計與原存合計。**沒有重算折讓、發票、薪資、抽成或帳務餘額；只拒絕不相符的保存資料。**
- 將假 `trustedIndexer()` 回傳的**當前原單／收款標準化資料**與保存的 `sourceSnapshots`／`settlementSnapshots` 比對；不同則立即停止。這是為正式 `externalBillingDocumentIndex()`／原帳務來源建立的模擬介面，並不代表正式資料投影已經存在。
- 假身份、Session、AAL2、會員與逐文件 ACL 都由測試宿主注入，**無實際 JWT**。假核准雜湊必須綁定指定文件、全原單快照、收款快照、發票資訊、目標區、對外備註、版次與 sync_version；來源或公開備註更新會使舊核准失效。
- **客戶欄位白名單**：只輸出案場／建商／日期／該文件對外施工列／已保存總金額／對外備註；不攜帶原發票號碼、B 區名稱、員工、薪資、銀行、重編原因與私有 JSONB。當前模型僅回傳 JSON 模擬投影與一個**不具權威的 SHA-256 測試指紋**，不產生 PDF bytes。
- 模擬兩次讀取的同步版本與整份假資料指紋「交付前一致」檢查；這**不能保證**真實服務在檢查到送出 PDF bytes 之間具有完全原子性，正式必須另外設計可靠交易／鎖／一致性讀取及送出同一份已驗證 PDF bytes。

## 可直接執行的離線驗收

在此候選分支執行：

```bash
node --check .p40-16bk-tests/source_bridge.cjs
node --check .p40-16bk-tests/test_source_bridge.cjs
node --test .p40-16bk-tests/test_source_bridge.cjs
```

本機 **40 個測試案例**：**39 PASS、0 FAIL、1 SKIP**；跳過的項目是本機沒有完整正式 GitHub repository checkout，所以只在 CI 比對正式 `erp-store.js`、`billing-groups.js`、`cloud-sync.js`、`external-billing-print.js`。GitHub CI 必須讓此項真正通過，不能以 SKIP 充當 PASS。

反例涵蓋：錯誤公司／權限／Session／AAL、附加整份 JSONB、假版本、重複文件、草稿／歷史版、原單變更、收款變更、跨區與跨建商、差額和施工小計錯誤、原票號或備註變更後沿用舊核准、讀取時資料競態、敏感內部欄位誤送。所有資料均為**虛構**，未讀任何正式業務列。

## 未解決，正式發布必須維持 BLOCKED

1. **最大缺口尚未解決：** `trustedSource()`／`trustedIndexer()`／`trustedApproval()` 都是離線測試注入的虛構權威。正式 ERP 尚未有經授權且與現行 `erp_states.data`／同步版本**同一交易綁定**的安全投影生成與核准保存流程。
2. 正式 Supabase 管理者截圖確認 **Current ECC P-256 = ES256**，但未驗證真正發出的使用者 JWT、可撤銷 Session、MFA、即時會員、文件 ACL 或核准者政策；正式服務不可拿前端宣稱的 `role` 或 `sessionAal` 直接當授權。
3. SHA-256 **不是身分簽名／持久核准／實際 PDF 完整性保障**；測試中 `publicNoteReviewed` 假旗標不會自動檢查公開備註是否包含私人資訊。
4. 單筆原請款、舊跨區合併、歷史保存文件仍須分開驗證相容性。不能把僅支援 v2 現行合併請款的模擬門禁安裝成正式所有 PDF 的共用門禁。
5. 尚未驗證真實完整安全備份與還原、最新 `SYNCED`、實際 PDF bytes 與 A4／明細彙總／LOGO／印章、手機及電腦、折讓、保留款、多月發票、應收、銀行、薪資與抽成全流程。
6. **任何正式 `main`、`beta`、Supabase schema/RLS、Edge、Cloudflare、PDF、業務資料或正式發布修改，必須公司負責人另行明確核准。**

**結論：P40-16BK 僅縮小可信來源銜接設計的風險，不能等同正式來源已建立；PR 保持 DRAFT / NO MERGE / NO DEPLOY。**
