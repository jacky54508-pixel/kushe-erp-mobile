# K23 唯讀復原預覽

這組工具只計算已保存的 K21 合成 `saveCustomer` 中斷證據。核心沒有瀏覽器、資料庫、網路或復原寫入 API。候選一律維持 `allowApply=false`、`canPost=false`、`publishGate=BLOCKED`；它不是正式系統的恢復按鈕。

## 執行

需要 Node.js 18 或以上，不需安裝 npm 套件。路徑參數可使用相對於工作目錄的路徑或絕對路徑。

```bash
node run_preview.cjs EVIDENCE_ROOT PINNED_STORE_FILE > K23_CANDIDATES.json
node test_preview.cjs EVIDENCE_ROOT PINNED_STORE_FILE OUTPUT_DIRECTORY
```

- `EVIDENCE_ROOT`：原始 `evidence_bundle` 目錄，內含三個 K21 scenario 目錄。
- `PINNED_STORE_FILE`：固定 Store 原始碼。執行前同時核對 SHA-256 與 Git blob；不符合即拒絕。
- `OUTPUT_DIRECTORY`：測試結果目錄。提供時產生 `K23_PREVIEW_TESTS.json` 及 `K23_PREVIEW_TESTS.log`，並保留終端輸出。省略時只輸出到終端。

前兩個參數省略時，保留開發環境的相對路徑預設值：`../../k21_work/evidence_v4_20261124_214334_e42ecb/evidence_bundle` 與 `../../k21_work/reference/erp-store.js`，相對於此程式目錄。

每案計算只讀取 `evidence/08_raw_after_crash_before_any_store_script.json`。測試另外讀取 `evidence/05_baseline_ready_for_crash.json`，獨立核對 checkpoint 是否等於已正常重開的基準。計算核心不讀取 baseline 或 expected-stage 檔案。

## 結果與界線

三案的業務內容來源都是 `Journal.before.state`（sequence 2）。這是可審閱的來源證據，不是可以直接寫回資料庫的完整恢復結果。日後真正恢復須由正式 commit kernel 建立全新 sequence 4、保留中斷版本的關聯與原始證據，並重新產生鏡像與 token。

47 個離線測試涵蓋三案候選及損壞 checkpoint、版本與操作歸屬不符、未知鏡像、recovery marker、非合成資料和超出本案的財務資料等拒絕條件。這些測試不代表實際瀏覽器／IndexedDB 恢復、突然終止持久化、真實財務入帳或 Supabase CAS 已通過。

固定版本：commit `edf1c1886aac09958caa9e4b304502cca44f6937`；Store Git blob `95773d5264d54fe1e1d1cfe54b37a2a2656a9fab`；Store SHA-256 `316829fa8d9418a901c9f849e792516604a02d1f686924db8c377f661464097e`。
