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
此包包含虛構公司聯絡資訊及三種 PDF 測試浮水印，尚未部署。要手機跨裝置開啟，請先經安全審核後放在「全新獨立」的測試站，
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
# P39-3K-1: sanitize the ZIP output only; never modify the source ERP.
# The source CI-tested logic and data/financial modules stay untouched.
python - "$output" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1])
changes={
  "82980636":"00000000",
  "台中市豐原區瑞興路 62 號":"虛構測試地址",
  "eing0519":"TEST-ONLY"
}
watermark="""
/* P39-3K-1 synthetic-only print watermark, does not affect A4 layout. */
body::after{content:"虛構測試 · 禁止對外請款";position:fixed;left:50%;top:52%;transform:translate(-50%,-50%) rotate(-24deg);font-family:"Microsoft JhengHei",system-ui,sans-serif;font-size:30px;font-weight:900;letter-spacing:.18em;white-space:nowrap;color:rgba(133,75,75,.16);pointer-events:none;z-index:9999}
@media print{body::after{font-size:31px;color:rgba(122,69,69,.13);-webkit-print-color-adjust:exact;print-color-adjust:exact}}
"""
printed={"billing-print.html","billing-bundle-print.html","external-billing-print.html"}
for path in root.rglob("*"):
  if not path.is_file() or path.suffix not in (".html",".js",".css",".txt"):
    continue
  contents=path.read_text(encoding="utf-8")
  for old,new in changes.items():
    contents=contents.replace(old,new)
  if path.name in printed:
    if contents.count("</style>")!=1:
      raise SystemExit("HOLD: unexpected print layout source: "+path.name)
    contents=contents.replace("</style>",watermark+"</style>")

  if path.name in {"billing-print.html","billing-bundle-print.html"}:
    # Public UAT only: never ship the true seal or a broken img element.
    # The original ERP HTML and asset loading code remain unmodified.
    oldseal='<img class="seal" id="formalCompanySeal" alt="公司大小章" onerror="this.hidden=true">'
    if contents.count(oldseal)!=1:
      raise SystemExit("HOLD: expected exactly one synthetic seal image source in "+path.name)
    placeholder='<span class="synthetic-seal-placeholder" role="note">虛構測試｜未提供公司大小章</span>'
    contents=contents.replace(oldseal,placeholder)
    sealcss="""
.synthetic-seal-placeholder{display:inline-flex;align-items:center;justify-content:center;max-width:100%;padding:1.2mm 2.5mm;border:.2mm dashed #a6b8c9;border-radius:1.5mm;color:#667e91;font-size:8pt;line-height:1.35;font-weight:700;text-align:center;overflow-wrap:anywhere}
"""
    contents=contents.replace("</style>",sealcss+"</style>")
  if path.name=="billing-bundle-print.html":
    # Synthetic two-source, two-line UAT only. Preserve all source rows,
    # each per-source total, the final total, and signatures.
    # For longer real-style documents there is deliberately NO forced scaling.
    compactcss="""
@page{size:A4 portrait;margin:6mm 10mm 7mm}
@media print{
 .paper.uat-compact-bundle .head{padding-bottom:2mm}
 .paper.uat-compact-bundle .company h1{font-size:18pt}
 .paper.uat-compact-bundle .doc-title h2{font-size:19pt}
 .paper.uat-compact-bundle .info{margin:2.2mm 0 2.4mm;padding:1.6mm;gap:1mm 2mm}
 .paper.uat-compact-bundle .info>div{min-height:7.5mm;padding:1mm 1.8mm;font-size:8.5pt;line-height:1.18}
 .paper.uat-compact-bundle .info .label{font-size:7.2pt;width:18mm;margin-right:1.8mm}
 .paper.uat-compact-bundle .project-section{margin-top:2.6mm}
 .paper.uat-compact-bundle .project-heading{padding:1.6mm 2.5mm}
 .paper.uat-compact-bundle .project-heading h2{font-size:10.5pt}
 .paper.uat-compact-bundle .project-heading p{margin:.5mm 0 0;font-size:7.3pt}
 .paper.uat-compact-bundle .detail th,
 .paper.uat-compact-bundle .detail td{padding:1.1mm 1.2mm;font-size:8pt;line-height:1.25}
 .paper.uat-compact-bundle .project-footer{padding:1.7mm 2.3mm;gap:2mm}
 .paper.uat-compact-bundle .project-note{font-size:7.8pt;line-height:1.25}
 .paper.uat-compact-bundle .project-summary>div{padding:.7mm 0;font-size:7.9pt;line-height:1.2}
 .paper.uat-compact-bundle .grand-summary{margin:3mm 0 0 auto;width:min(100%,100mm)}
 .paper.uat-compact-bundle .grand-summary h2{font-size:9.3pt;padding:1.6mm 2.8mm}
 .paper.uat-compact-bundle .grand-summary>div{min-height:6.2mm;padding:.8mm 2.8mm;font-size:8.2pt;line-height:1.15}
 .paper.uat-compact-bundle .grand-summary strong{font-size:9.3pt}
 .paper.uat-compact-bundle .grand-summary .total strong,
 .paper.uat-compact-bundle .grand-summary .receivable strong{font-size:10.5pt}
 .paper.uat-compact-bundle .sign{margin-top:3mm;gap:10mm}
 .paper.uat-compact-bundle .client-sign{padding-top:5mm;font-size:8pt}
 .paper.uat-compact-bundle .seal-wrap{height:17mm}
}
"""
    contents=contents.replace("</style>",compactcss+"</style>")
    marker="    const autoPrint=new URLSearchParams(location.search).get('print')==='1';"
    if contents.count(marker)!=1:
      raise SystemExit("HOLD: legacy bundle print code changed, no safe compact hook")
    compactjs="""
    // P39-3K-7: only two tiny synthetic source bills may use single-page compact CSS.
    const uatCompact=(data.schema==='kushe-combined-billing-v1'&&billings.length===2&&
      billings.every(row=>Array.isArray(row.lines)&&row.lines.length>0&&row.lines.length<=2&&
        String(row.publicNote||'').length<=240));
    if(uatCompact)paper.classList.add('uat-compact-bundle');
"""
    contents=contents.replace(marker,compactjs+marker)
  path.write_text(contents,encoding="utf-8")
for path in root.rglob("*"):
  if path.is_file() and path.suffix in (".html",".js",".css",".txt"):
    contents=path.read_text(encoding="utf-8")
    if any(real in contents for real in changes):
      raise SystemExit("HOLD: live company contact field leaked in synthetic package: "+path.name)
for name in printed:
  contents=(root/name).read_text(encoding="utf-8")
  if contents.count("虛構測試 · 禁止對外請款")!=1:
    raise SystemExit("HOLD: test watermark missing in "+name)
for name in ("billing-print.html","billing-bundle-print.html"):
  contents=(root/name).read_text(encoding="utf-8")
  if contents.count("虛構測試｜未提供公司大小章")!=1 or '<img class="seal" id="formalCompanySeal"' in contents:
    raise SystemExit("HOLD: leaked or broken test seal in "+name)
contents=(root/"billing-bundle-print.html").read_text(encoding="utf-8")
if "uat-compact-bundle" not in contents:
  raise SystemExit("HOLD: synthetic two-source print fitting CSS missing")
print("PASS: no real stamp, no broken images, two-source print compact mode gated")

print("PASS: public test ZIP sanitizes business contact fields and watermarks every PDF",flush=True)
PY

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
