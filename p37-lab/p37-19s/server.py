"""P37-19S: serve only SHA-pinned temporary Dashboard/Reports copies to
localhost Chromium; original Store and P21 KPI-navigation are unmodified.
Never uses Supabase, production accounts, or installed user's browser.
"""
from pathlib import Path
import importlib.util
import tempfile

ROOT=Path(__file__).resolve().parents[2]
LAB=Path(__file__).resolve().parent
N=ROOT/"p37-lab"/"p37-19n"
O=ROOT/"p37-lab"/"p37-19o"
P=ROOT/"p37-lab"/"p37-19p"
R=ROOT/"p37-lab"/"p37-19r"
spec=importlib.util.spec_from_file_location("p37_19r_original_server_guard",R/"server.py")
if not spec or not spec.loader:
 raise RuntimeError("P37-19S ORIGINAL_R_SERVER_MISSING")
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
from lab_ui_overlay import build, pinned

def start():
 base.verify_originals()
 dash,reports=build()
 temp=tempfile.TemporaryDirectory(prefix="p37-19s-localhost-only-")
 directory=Path(temp.name)
 dashboard_file=directory/"temporary-dashboard.js"
 reports_file=directory/"temporary-reports.js"
 dashboard_file.write_bytes(dash)
 reports_file.write_bytes(reports)
 base.original.ALLOWED={
  "/":(LAB/"fixture.html","text/html; charset=utf-8"),
  "/n-synthetic-fixture.js":(N/"synthetic-fixture.js","text/javascript; charset=utf-8"),
  "/o-augmentation.js":(O/"o-augmentation.js","text/javascript; charset=utf-8"),
  "/p-augmentation.js":(P/"p-augmentation.js","text/javascript; charset=utf-8"),
  "/r-augmentation.js":(R/"r-augmentation.js","text/javascript; charset=utf-8"),
  "/s-augmentation.js":(LAB/"s-augmentation.js","text/javascript; charset=utf-8"),
  "/original-erp-store.js":(ROOT/"assets/js/erp-store.js","text/javascript; charset=utf-8"),
  "/effective-ledger.js":(ROOT/"assets/js/p37-billing-effective-ledger.js","text/javascript; charset=utf-8"),
  "/formal-readonly-ledger.js":(ROOT/"assets/js/p37-billing-formal-readonly-projection.js","text/javascript; charset=utf-8"),
  "/original-kpi-navigation.js":(ROOT/"assets/js/kpi-navigation.js","text/javascript; charset=utf-8"),
  "/lab-dashboard.js":(dashboard_file,"text/javascript; charset=utf-8"),
  "/effective-kpi-reader.js":(R/"effective-kpi-reader.js","text/javascript; charset=utf-8"),
  "/r-controller.js":(R/"r-controller.js","text/javascript; charset=utf-8"),
  "/s-controller.js":(LAB/"s-controller.js","text/javascript; charset=utf-8"),
  "/lab-reports.js":(reports_file,"text/javascript; charset=utf-8")
 }
 try:
  server,origin=base.original.start()
  return server,origin,temp
 except BaseException:
  temp.cleanup()
  raise
