"""P37-19U only on disposable 127.0.0.1 Chromium origin.

Loads the ACTUAL unmodified Store and T read-only module. Dashboard and
Reports are SHA-pinned temporary presentation copies only, not deployments.
No production data, Auth login, cloud API or private credentials.
"""
from pathlib import Path
import tempfile
import importlib.util

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
N=ROOT/"p37-lab"/"p37-19n"
O=ROOT/"p37-lab"/"p37-19o"
P=ROOT/"p37-lab"/"p37-19p"
R=ROOT/"p37-lab"/"p37-19r"
spec=importlib.util.spec_from_file_location("p37_19r_u_verified_server",R/"server.py")
if not spec or not spec.loader:
 raise RuntimeError("P37-19U ORIGINAL_R_SERVER_MISSING")
R_SERVER=importlib.util.module_from_spec(spec)
spec.loader.exec_module(R_SERVER)
from lab_presentation_overlay import generate

def start():
 R_SERVER.verify_originals()
 dashboard,reports=generate()
 tmp=tempfile.TemporaryDirectory(prefix="p37-19u-synthetic-browser-")
 dash=Path(tmp.name)/"dashboard-isolated-only.js"
 report=Path(tmp.name)/"reports-isolated-only.js"
 dash.write_bytes(dashboard)
 report.write_bytes(reports)
 R_SERVER.original.ALLOWED={
  "/":(HERE/"fixture.html","text/html; charset=utf-8"),
  "/n-synthetic-fixture.js":(N/"synthetic-fixture.js","text/javascript; charset=utf-8"),
  "/o-augmentation.js":(O/"o-augmentation.js","text/javascript; charset=utf-8"),
  "/p-augmentation.js":(P/"p-augmentation.js","text/javascript; charset=utf-8"),
  "/r-augmentation.js":(R/"r-augmentation.js","text/javascript; charset=utf-8"),
  "/u-augmentation.js":(HERE/"u-augmentation.js","text/javascript; charset=utf-8"),
  "/original-erp-store.js":(ROOT/"assets/js/erp-store.js","text/javascript; charset=utf-8"),
  "/effective-ledger.js":(ROOT/"assets/js/p37-billing-effective-ledger.js","text/javascript; charset=utf-8"),
  "/formal-readonly-ledger.js":(ROOT/"assets/js/p37-billing-formal-readonly-projection.js","text/javascript; charset=utf-8"),
  "/original-kpi-navigation.js":(ROOT/"assets/js/kpi-navigation.js","text/javascript; charset=utf-8"),
  "/lab-dashboard.js":(dash,"text/javascript; charset=utf-8"),
  "/candidate-t.js":(ROOT/"assets/js/p37-19t-readonly-integration-candidate.js","text/javascript; charset=utf-8"),
  "/u-controller.js":(HERE/"u-controller.js","text/javascript; charset=utf-8"),
  "/lab-reports.js":(report,"text/javascript; charset=utf-8")
 }
 try:
  server,origin=R_SERVER.original.start()
  return server,origin,tmp
 except BaseException:
  tmp.cleanup()
  raise
