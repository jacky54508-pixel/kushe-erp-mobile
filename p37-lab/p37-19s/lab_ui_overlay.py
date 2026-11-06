"""P37-19S — SHA-pinned lab-only dashboard/report presentation overlay.

Creates temporary copies of the original dashboard.js and reports.js solely in
a disposable 127.0.0.1 Chromium test. Never modifies tracked ERP files.
"""
from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parents[2]
PINS = {
    "assets/js/dashboard.js": "7526d31ad66cea0716eaa5351d25b7ccc72c3a5f",
    "assets/js/reports.js": "ee8f75817113c825313c95b2c5942ce54d55b984",
    "assets/js/kpi-navigation.js": "5f38cde3656b1716050c5da5d3886e0274d0bf6c",
    "assets/js/erp-store.js": "1d74daabcf51a6f47b03bac9bbc5407ca881272d",
}
def fail(value):
    raise ValueError("P37-19S SOURCE_LOCK_REJECTED_" + value)

def pinned(relative):
    binary = (ROOT / relative).read_bytes()
    git_sha = hashlib.sha1(
        b"blob " + str(len(binary)).encode() + b"\0" + binary
    ).hexdigest()
    if git_sha != PINS[relative]:
        fail("PIN_MISMATCH_" + relative)
    return binary.decode("utf-8")

def exactly(src, needle, replacement, label):
    occurrences=src.count(needle)
    if occurrences!=1:fail(label+"_MATCHES_"+str(occurrences))
    return src.replace(needle,replacement)

def build():
    for filename in PINS:
        pinned(filename)
    dashboard=pinned("assets/js/dashboard.js")
    reports=pinned("assets/js/reports.js")
    dashboard=exactly(
        dashboard,
        "  }\n\n  function trendPoints(data, month, range) {",
        "    window.P37SReadOnlyDrilldown.tagKpiElements();\n"
        "  }\n\n  function trendPoints(data, month, range) {",
        "DASHBOARD_KPI_TAGGING"
    )
    dashboard=exactly(
        dashboard,
        "$('#notificationItems').innerHTML = attentionMarkup(vm.attentions.slice(0, 5));",
        "$('#notificationItems').innerHTML = attentionMarkup(vm.attentions.slice(0, 5));"
        "window.P37SReadOnlyDrilldown.tagAttentionElements();",
        "RETENTION_ATTENTION_TAGGING"
    )
    dashboard=exactly(
        dashboard,
        "const points = trendPoints(activeVm.data, activeVm.month, activeRange);",
        "const points = window.P37SReadOnlyDrilldown.chartPoints(activeVm,activeRange);",
        "ORIGINAL_CANVAS_CHART_DATA_SOURCE"
    )
    dashboard=exactly(
        dashboard,
        "function refresh() { const data = dashboardData(); render(derive(data, selectedMonth())); }",
        "function refresh() { render(window.P37RReadOnlyPreview.preview(selectedMonth()).dashboard); }",
        "DASHBOARD_REFRESH_SHARED_LEDGER"
    )
    reports=exactly(
        reports,
        "if(action==='ar')return window.KusheKpi.model('ar.open');",
        "if(action==='ar')return window.P37SReadOnlyDrilldown.details('ar',selectedMonth);",
        "REPORT_AR_DETAIL"
    )
    lines=reports.splitlines(keepends=True)
    indices=[i for i,line in enumerate(lines)
             if line.lstrip().startswith("if(action==='revenue')return {title:")]
    if len(indices)!=1:
        fail("REPORT_REVENUE_DETAIL_ORIGINAL_"+str(len(indices)))
    old=lines[indices[0]]
    if not old.rstrip().endswith("};return null;"):
        fail("REPORT_REVENUE_DETAIL_TRAILER_CHANGED")
    lines[indices[0]]=("    if(action==='revenue')return "
                      "window.P37SReadOnlyDrilldown.details('revenue',selectedMonth);"
                      "return null;\n")
    reports="".join(lines)
    for filename,value in [("dashboard",dashboard),("reports",reports)]:
        if "P37SReadOnlyDrilldown" not in value:
            fail("NOT_PATCHED_"+filename)
    return dashboard.encode("utf-8"),reports.encode("utf-8")

if __name__=="__main__":
    d,r=build()
    print("P37-19S EXACT ORIGINAL SOURCES LOCKED; temporary lab copies only",
          "dashboard bytes",len(d),"reports bytes",len(r))
