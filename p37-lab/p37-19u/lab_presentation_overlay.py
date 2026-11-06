"""P37-19U: temporary presentation copies ONLY inside GitHub CI localhost.

Exact Git blobs of the original Dashboard, Reports, Store, and P21 KPI engine
are pinned. This generator NEVER edits assets/js or published HTML.
"""
from pathlib import Path
import hashlib

ROOT=Path(__file__).resolve().parents[2]
PINS={
 "assets/js/dashboard.js":"7526d31ad66cea0716eaa5351d25b7ccc72c3a5f",
 "assets/js/reports.js":"ee8f75817113c825313c95b2c5942ce54d55b984",
 "assets/js/erp-store.js":"1d74daabcf51a6f47b03bac9bbc5407ca881272d",
 "assets/js/kpi-navigation.js":"5f38cde3656b1716050c5da5d3886e0274d0bf6c",
 "assets/js/p37-19t-readonly-integration-candidate.js":"d74f741614ec0494ccf926638c54e0704a35369a"
}

def source(rel):
    raw=(ROOT/rel).read_bytes()
    actual=hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()
    if actual!=PINS[rel]:
        raise ValueError("P37-19U ORIGINAL_SOURCE_FINGERPRINT_CHANGED_"+rel)
    return raw.decode("utf-8")

def replace(src,old,new,label):
    n=src.count(old)
    if n!=1:
        raise ValueError("P37-19U ORIGINAL_UI_ANCHOR_CHANGED_"+label+"_"+str(n))
    return src.replace(old,new)

def generate():
    for name in PINS:
        source(name)
    dash=source("assets/js/dashboard.js")
    reports=source("assets/js/reports.js")
    dash=replace(
        dash,
        "  }\n\n  function trendPoints(data, month, range) {",
        "    window.P37UReviewAdapter.tagKpiCards();\n"
        "  }\n\n  function trendPoints(data, month, range) {",
        "RENDER_KPI"
    )
    dash=replace(
        dash,
        "$('#notificationItems').innerHTML = attentionMarkup(vm.attentions.slice(0, 5));",
        "$('#notificationItems').innerHTML = attentionMarkup(vm.attentions.slice(0, 5));"
        "window.P37UReviewAdapter.tagRetentionAlert();",
        "ATTENTION_KPI"
    )
    dash=replace(
        dash,
        "const points = trendPoints(activeVm.data, activeVm.month, activeRange);",
        "const points = window.P37UReviewAdapter.chartPoints(activeVm,activeRange);",
        "CANVAS_CHART"
    )
    dash=replace(
        dash,
        "function refresh() { const data = dashboardData(); render(derive(data, selectedMonth())); }",
        "function refresh() { render(window.P37UReviewAdapter.view(selectedMonth()).dashboard); }",
        "DASHBOARD_REFRESH"
    )
    reports=replace(
        reports,
        "if(action==='ar')return window.KusheKpi.model('ar.open');",
        "if(action==='ar')return window.P37UReviewAdapter.details('ar',selectedMonth);",
        "REPORT_AR"
    )
    items=reports.splitlines(keepends=True)
    match=[n for n,line in enumerate(items)
        if line.lstrip().startswith("if(action==='revenue')return {title:")]
    if len(match)!=1 or not items[match[0]].rstrip().endswith("};return null;"):
        raise ValueError("P37-19U REPORT_REVENUE_SOURCE_CHANGED")
    items[match[0]]=("    if(action==='revenue')return "
        "window.P37UReviewAdapter.details('revenue',selectedMonth);return null;\n")
    reports="".join(items)
    if "P37UReviewAdapter" not in dash or "P37UReviewAdapter" not in reports:
        raise ValueError("P37-19U ADAPTER_NOT_CONNECTED_TO_BOTH_READERS")
    return dash.encode("utf-8"),reports.encode("utf-8")

if __name__=="__main__":
    d,r=generate()
    print("P37-19U original SHA pins PASS; disposable UI overlay bytes",len(d),len(r))
