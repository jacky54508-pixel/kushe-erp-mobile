# P40-16L｜真實 Chromium IndexedDB / localStorage 及瀏覽器重開 — 隔離安全驗收

**此驗收完全在 GitHub CI 執行虛構瀏覽器頁面，未修改／開啟正式 ERP，也未讀取或寫入真實 Supabase、任何客戶交易、發票或銀行資料。**

## 核心變更

- `.p40-16l-tests/browser_fixture.html` + `browser_fixture.js`：完全獨立於 `index.html` 的純測試站，使用 Chromium **真正** IndexedDB、localStorage、Web Crypto SHA-256、瀏覽器下載功能和現實 HTTP `fetch`；資料庫名固定 `P40L_SYNTH_BROWSER_20261116`，非正式 ERP 的 `KuSheERP25_Core34_DB`。
- `.p40-16l-tests/test_chromium_storage.py`：Playwright Python 將測試頁載入 Chromium headless 的多個獨立 BrowserContext；以 local Python route-backend 供應與更新虛構 JSON 資料（只允許 `SYNTHETIC-UI-ONLY`，不允許 finance mutation）；真正測試關閉／開啟瀏覽器 persistent profile、IndexedDB/LocalStorage 持久化、不同裝置競態、網路失聯、異常上傳回讀、備份下載、故障注入還原與手動從備份重新載入。
- `.github/workflows/p40-16l-native-chromium.yml`：獨立候選分支專用 fail-closed CI，精確檢查 main/beta SHA、四個測試檔案白名單、原應用程式檔 SHA。只在本地 `127.0.0.1` 啟動測試網頁與 GitHub Action 的一次性 PG 16 資料庫，執行本階段 Playwright 及前期 K/J/A-D/I regression。
- 不使用任何真實ERP登入資料、Supabase JWT、service_role、IndexedDB 資料匯入或金融資產，不會在真實前端出現新按鈕。

## 測試的具體行為

1. Chromium 重整後，實際 IndexedDB `main`、`journal` 與 localStorage Emergency／token 必須一致；另用 persistent Chrome profile 結束後重開證明資料仍存在。
2. 在真實 Chrome BrowserContext 中切換網路離線並保存本機 UI 備註；在線時應用虛構伺服器 CAS 成功後回讀確認。server 若已寫入但回應中斷，不可把操作當成成功，必須另行回讀 fingerprints。
3. 電腦、手機兩個隔離 Chrome profile 同時編輯共用虛構雲端；前一個寫入成功，後一個舊版同步拒絕覆蓋。模擬未來 `ledgerVersion` 變動也須拒絕過期基準。
4. 還原前必須透過真實瀏覽器下載測試備份 JSON，檢查檔內 SHA-256、用戶、當前本機 fingerprint，且以 marker 綁定雲端版本與 30 分鐘過期條件。
5. 雲端還原前兩次 GET；第二次若版本變動則停止。故意在 IndexedDB commit 之後或 Emergency 更新之後中斷，關閉/重新開啟頁面仍須封鎖不完整 journal；**不會自動用雲端覆蓋未確認內容**。
6. 在提供明確下載的虛構備份後，可執行**測試專用**手動還原。實際正式 ERP 恢復仍有自己的權限、日誌、使用者、瀏覽器資料與業務欄位，不能把此測試函式當成正式復原入口。
7. Emergency/token 損毀、編輯器 dirty、臨時裝置不可寫入持久資料、假請款原始 632,100 欄位不能修改。
8. P40-16J 的真 PostgreSQL 雙版本 CAS 與 append-only ledger 交易、P40-16K 的純 JS 24 項模擬，以及 P40-16A-D/I 的 31 項安全關聯測試再做回歸。

## 需要知道的限制

- **真實瀏覽器 ≠ 正式 ERP E2E。** P40-16L 使用自製隔離測試頁及真實 Chromium 儲存 API，但沒有載入正式 `assets/js/cloud-sync.js`、`assets/js/erp-store.js`、正式版完整業務 JSONB 或正式 IndexedDB DB Name。
- 虛構雲端由 Playwright Route 的 Python 記憶體 CAS 模擬，不是實際 Supabase 的 `erp_state_cas_write_v2`；真正 PostgreSQL 交易另由 P40-16J 獨立測試覆蓋，但兩者沒有組成正式系統級交易。
- 測試用檔案 SHA-256 僅能發現備份損毀，不能認證建商核定、帳務合法性或保護不可信瀏覽器環境。備份下載只是合成檔案，非正式可還原資料備份。
- 本階段沒有真實斷電、OS 強制殺程序、Chrome 在實體手機記憶體不足、Android/iOS Safari 行為或舊 ERP migration 測試。也不測真實網路跨實體裝置，只用獨立 BrowserContext 模擬。
- 正式 `erp_states` 舊 direct UPDATE/INSERT 權限仍存在；真實 `ledgerVersion` 尚未接入正式同步。**P40-16L 不能解除 P40-16J 的重大 blocker。**
- 法定折讓憑證、發票對應/稅額、已收款／保留款、銀行、薪資抽成仍未經人工核定，全部禁止自動修改。

## 真正上線之前

1. 針對最新正式 main 建立**只讀模式的整合 E2E**，不使用任何真正客戶資料；驗證完整本機庫及 journal 與跨裝置同步，在一個已隔離的新測試 origin 運行，不能讓測試程式對正式雲端送出資料。
2. 排除全部直接 `erp_states` 舊版寫入路徑，設計平滑轉換、權限收斂、遷移和回復；不能直接在現在正式 Supabase 執行撤權。
3. 逐原單和會計確認合法折讓憑證、申報／銷項稅額、已收款退款／保留款、已付薪資／抽成及對外請款 PDF。
4. 獨立取得明確正式寫入／部署授權、最新 SYNCED 及完整可還原安全備份、CI、真實 ERP 手機／電腦的回歸 PASS；所有未完成門檻一律禁止入帳。

**本階段草稿不應合併 main/beta，不產生正式折讓交易。**
