# P41-44K-24：受控復原失敗後的安全重試候選

## 問題與修正範圍

K23 已在隔離瀏覽器重現：受控復原的鏡像寫入失敗後，雖然系統繼續封鎖一般操作，回滾 Journal 卻省略原始 checkpoint，且復原嘗試的 operationId 與保護標記的原始 owner 不一致，導致重新預覽與重試被拒絕。

這個候選保留受控復原完整的 before checkpoint、recoveryEvidence 與原始 recoveryOf；新的復原嘗試有獨立 operationId。重試仍使用最初已核對的 checkpoint 業務內容，以當前版本為父版本提交新的單調遞增版本。一般業務交易的精簡回滾格式保持原樣。

同時，受控復原必須等私有載入驗證與最後 marker CAS 成功才發布業務記憶體。若提交已完成而 marker 清除失敗，下一次明確確認可續接已驗證的提交，不新增版本或 audit。

## 固定來源與識別

- 基準 main commit：`09939153538416cfdc3a532b3ec0cd2af5e19238`
- 原 Store SHA-256：`316829fa8d9418a901c9f849e792516604a02d1f686924db8c377f661464097e`
- 原 Store Git blob：`95773d5264d54fe1e1d1cfe54b37a2a2656a9fab`
- 候選 Store SHA-256：`6d0753fb4c24febbc368d5fcca360e77972331b2c16d4a811841ccb81fe5b94e`
- 候選 Store Git blob：`8e15b2f1c5ddec9d6120920ae024ca0ce9a1bf25`
- 獨立候選分支：`p41-k24-recovery-retry-20261126`

`FIXTURE_MANIFEST.json` 固定三份 K21 原始中斷觀察與各自的基準資料。所有資料均為既有 SYN 合成驗收資料。測試前後比對原始位元組；Windows checkout 禁用換行轉換。

## 實際瀏覽器驗證

先以未修改的原 Store 重現 K23 缺陷，再以候選 Store 執行 28 組案例。預期原版缺陷紀錄與候選結果分開保存，不把原版失敗當成候選成功。

| 類別 | 案例群組數 |
| --- | ---: |
| 原三個復原與正常關閉重開案例 | 3 |
| 原有舊預覽、身分變更、外來或未知資料拒絕 | 6 |
| 三份中斷觀察 × 三個鏡像寫入錯誤後重試 | 9 |
| 連續兩次復原失敗後重試 | 1 |
| 復原失敗且主資料回滾也失敗後重試 | 1 |
| 復原失敗後的舊觀察與外來標記拒絕 | 2 |
| 修正前已遺失 checkpoint 的舊 Journal 拒絕 | 1 |
| 一般業務寫入回滾與後續正常提交 | 1 |
| 提交後標記清除失敗與重新開啟續接 | 1 |
| 巢狀 owner、版本及深度邊界拒絕 | 3 |
| **合計** | **28** |

深度 7／8 是以實際單次故障輸出建立的結構 fixture，驗證解析及預先拒絕邊界；沒有宣稱已執行七次真實故障。

Linux 與 Windows 分別使用獨立的本機瀏覽器 profile。瀏覽器只允許測試伺服器的兩個 loopback 資源；登入身分為固定的合成測試身分，這不是正式登入或 Supabase RLS 驗證。

另於 Linux 執行既有且未修改的 P33-4、P34 與 P39-INV-1 Store 回歸，涵蓋抽成、歷史付款保護、回滾與發票 Store 隔離。

## 執行與證據

此分支專用 workflow：`.github/workflows/p41-k24-recovery-retry.yml`。

先執行 `source_guard.py` 以確認分支、基準、允許差異、Store 及 fixture 位元組，再執行：

```bash
python .p41-k24-tests/k24_browser_recovery.py \
  --baseline-store artifacts/p41-k24-linux/baseline-erp-store.js \
  --candidate-store assets/js/erp-store.js \
  --candidate-sha256 6d0753fb4c24febbc368d5fcca360e77972331b2c16d4a811841ccb81fe5b94e \
  --evidence .p41-k24-tests/fixtures \
  --output artifacts/p41-k24-linux
```

Windows 使用相同參數與自己的輸出目錄。CI artifact 保存 `RESULT.json`、各步原始觀察與 console，實際 PASS／FAIL 以對應 commit 的 CI 證據為準。

## 限制與發布狀態

本次是獨立候選修正與合成資料驗證。main、beta、正式資料及正式網站發布不在執行範圍。先前報價模板的發布授權不延伸至這次 Store 核心修正。

外來 marker、未知版本、身分變更、過期預覽、CAS 衝突與深度上限仍須拒絕。已在修正前遺失 checkpoint 的活躍 Journal 仍封鎖，不能由缺失內容推測重建。瀏覽器測試不等同停電、磁碟故障或所有平台耐久性保證。
