#!/usr/bin/env bash
# P39-3K synthetic UAT package from P39-3J candidate.
set -euo pipefail
cd "$(dirname "$0")/.."
output="$1"
if test -z "$output"; then output="/tmp/p39-3k-uat-dist"; fi
rm -rf "$output"
mkdir -p "$output/assets/js" "$output/assets/css" "$output/assets/img"
cp p39-3k-uat/uat.html "$output/index.html"
cp .p39-3i-tests/fixture.html "$output/note-fixture.html"
cp .p39-inv1-tests/fixture.html "$output/group-fixture.html"
for p in billing-print.html billing-bundle-print.html external-billing-print.html; do
  cp "$p" "$output/$p"
done
for p in \
  erp-store.js billing-print.js billing-bundle-print.js display-sort.js p39-note-revision.js \
  external-billing-print.js external-billing-invoice.js external-billing-invoice-ui.js \
  invoices.js billing-groups.js; do
  cp "assets/js/$p" "$output/assets/js/$p"
done
for p in p39-note-revision.css billing-groups.css; do
  cp "assets/css/$p" "$output/assets/css/$p"
done
# Public logo only; no company seal, login, production credentials or backups.
if test -f assets/img/kushe-logo.png; then
  cp assets/img/kushe-logo.png "$output/assets/img/kushe-logo.png"
fi
cat > "$output/_headers" <<'EOF'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store
  Content-Security-Policy: default-src 'self' data: blob:; connect-src 'none'; img-src 'self' data: blob:; frame-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; base-uri 'none'; form-action 'none'; object-src 'none'
EOF
cat > "$output/robots.txt" <<'EOF'
User-agent: *
Disallow: /
EOF
cat > "$output/驗收須知.txt" <<'EOF'
酷舍 ERP P39-3K｜純虛構資料、獨立測試版

來源：P39-3J 獨立候選版；嚴格封鎖正式 Supabase、Cloud Sync 與真實客戶資料。
所有虛構操作僅在本測試網站的瀏覽器環境，不得用來對外請款。
「對外備註」只改 publicNote；「內部備註」不動；議價折讓尚未開放。

一、桌機測試
此包須經本機 HTTP 伺服器或獨立測試站開啟，不能直接以 file:// 雙擊 HTML。
如 Windows 已安裝 Python，在資料夾開啟終端機執行：py -m http.server 8797 --bind 127.0.0.1
再開啟 http://127.0.0.1:8797/

二、手機實機
此包尚未部署。要手機跨裝置開啟，請先經安全審核後放在「全新獨立」的測試站，
例如 Cloudflare Pages Direct Upload；絕對不要覆蓋正式 GitHub Pages 或 P37 測試站。
發佈前須再次核對 _headers CSP 及完整的檔案白名單。

三、驗收
修改對外備註 → 填修訂原因 → 存檔 → 檢查內部備註及原應收未變。
打開單一請款、18 筆合併、歷史保存、原單合併四種 PDF。
確認原發票號碼、日期、狀態及發票對照表不顯示；金額保持原始虛構數值。
手機無橫向跑版，字體清晰；A4 PDF 與 18 筆施工明細、彙總完整。
任何不符合立即停止，不要修改正式 ERP。

重要：此為離線虛構 UAT 包，不是正式 ERP 網址，不進行任何正式發布。
EOF
for bad in config.js cloud-sync.js auth-gate.js app.js settings.js; do
  if test -e "$output/assets/js/$bad"; then
    echo "HOLD: forbidden business/config module in synthetic bundle $bad" >&2;exit 1
  fi
done
if grep -R -n -i -E 'https?://[^[:space:]"<>]+\.supabase\.co|service_role|SUPABASE_SERVICE_ROLE' \
 "$output" --include="*.html" --include="*.js" --include="*.css"; then
  echo "HOLD: cloud endpoint or service-role text in package" >&2;exit 1
fi
for p in note-fixture.html group-fixture.html billing-print.html billing-bundle-print.html \
 external-billing-print.html assets/js/erp-store.js assets/js/p39-note-revision.js \
 assets/js/display-sort.js assets/js/billing-bundle-print.js assets/js/external-billing-print.js assets/css/p39-note-revision.css; do
  test -s "$output/$p" || { echo "HOLD: missing artifact $p";exit 1; }
done
# Static HTML script/stylesheet/iframe refs must all resolve inside the synthetic package.
python - "$output" <<'PY'
from pathlib import Path
from urllib.parse import urlsplit
import re,sys
root=Path(sys.argv[1])
for html in root.glob("*.html"):
    source=html.read_text(encoding="utf-8")
    for raw in re.findall(r'<(?:script|link|iframe)\b[^>]*?(?:src|href)\s*=\s*"([^"]+)"',source,re.I):
        local=urlsplit(raw).path
        if not local or raw.startswith(("https:","http:","//","data:")):
            continue
        file=root/local.lstrip("/") if local.startswith("/") else html.parent/local
        if not file.is_file():
            raise SystemExit("HOLD: missing referenced static asset: %s in %s"%(local,html.name))
print("PASS: every HTML script/link/iframe reference is bundled locally")
PY
echo "PASS: P39-3K synthetic-only static UAT package at $output"
