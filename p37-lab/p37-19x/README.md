# P37-19X｜Windows 真實雙登入唯讀預檢工具

**目前未執行真實 Auth HTTP 登入。** 本階段只是把 P37-19W 已審查的驗證入口，做成適用 Windows 的本機操作工具。正式 ERP、beta、main、公司帳務和 Supabase 正式專案不變；不建立任何合成請款或折讓。

## 預先確認

這個工具只能在 **kushe-auth-lab**（專案 `ldktrfgzzzmklhsnfrol`）使用。需要一個**專門測試用的** Supabase Auth 帳號（電子郵件與密碼）、該測試專案的 `sb_publishable_` Key，以及 Node.js 20 以上版本。不要用正式 ERP 登入資訊、service_role/secret Key；不要把帳密或 JWT 貼在聊天室、GitHub Issue 或儲存成文字檔。

工具必須在下載完整的 `p37-19x-trusted-windows-auth-preflight-20261107` 分支資料夾內執行。不可只複製 PowerShell 檔案，因為它需要既有的 P37-19G/H/V/W 驗證及來源指紋門禁。

## 在自己的 Windows 電腦操作

在完整專案資料夾開啟可信任的 PowerShell 終端機，先執行**完全不連網**的自我檢查：

```powershell
powershell.exe -NoProfile -File .\p37-lab\p37-19x\Run_ReadOnly_Auth_Preflight.ps1 -SelfTest
```

預期輸出：`P37-19X SOURCE_GUARD_AND_NO_GO_PASS`，接著 `P37-19X SELFTEST_PASS - no network, no login, no account writes.`

只有自我檢查 PASS、測試專案後台確認 0 筆請款／0 筆折讓，而且已拿到**測試專用**登入資料，才能執行：

```powershell
powershell.exe -NoProfile -File .\p37-lab\p37-19x\Run_ReadOnly_Auth_Preflight.ps1
```

依序輸入 `LAB ONLY`、測試專案的 Publishable Key、測試用電子郵件、測試用密碼（密碼輸入不顯示）。指令會將敏感值僅放在當次子程序環境變數內，不使用命令列參數、不寫入檔案，結束後清空所設的環境變數；請務必在安全、獨立的使用者環境操作，因為執行期間本機同權限程序仍可能取得環境資訊。

如果 PowerShell 因執行原則阻擋，應先由受信任的管理員檢查原則與來源；**不要為了執行此工具直接取消整台電腦的安全政策**。

## 唯讀預檢實際會做的事

它會先使用 P37-19W 的來源指紋驗證、確認所有正式發布門禁仍是 NO-GO，才讓受信任的 Node 子程序依序執行 P37-19H/V/W：

1. 在獨立 Supabase 測試專案登入兩次。
2. 驗證不同的 `session_id` JWT 宣告及 Auth API 的登入使用者資料。
3. 查測試專案 RLS 會員名單、合成請款與折讓是否 0／0。
4. 不論成功或失敗，嘗試登出兩個已取得的測試工作階段。
5. 只回傳不含帳密的安全結果，絕不進行折讓 RPC、建立請款或清除任何帳務。

必須同時看到 `LAB_SIGNED_AUTH_READ_ONLY_PREFLIGHT_PASS` 所代表的上游 Auth 驗證和 `P37-19X READ_ONLY_REAL_AUTH_PREFLIGHT_PASS`，才可認定**真實兩次登入唯讀預檢**通過。這仍不是雙客戶端 RPC 競爭通過，也無法發布正式 ERP。

## 後續

真實登入預檢成功後，**先不要自行建立合成資料**。下一階段仍需要由管理員確認測試資料為 0／0、完成精確的合成測試資料建立、真正的同版本 RPC 競爭、來源核對及最後清理。所有金融正式寫入依舊 NO-GO。若無法取得測試用密碼，結果維持 BLOCKED，不能宣稱真實登入 PASS。

這份 PowerShell 腳本在 GitHub Actions 的 Windows CI **只跑 `-SelfTest`，不執行真實網路登入**；Linux CI 跑 Node 安全測試。這些 CI 測試絕不可當作真實雙登入證據。
