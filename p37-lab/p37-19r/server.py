"""P37-19R serves ORIGINAL Store, dashboard, reports and verified P37
readers only on ephemeral 127.0.0.1 origin with strict source SHA checks.
"""
from pathlib import Path
import importlib.util

ROOT=Path(__file__).resolve().parents[2]
LAB=Path(__file__).resolve().parent
N=ROOT/"p37-lab"/"p37-19n"
O=ROOT/"p37-lab"/"p37-19o"
P=ROOT/"p37-lab"/"p37-19p"
spec=importlib.util.spec_from_file_location("p37_19n_r_original_server",N/"server.py")
if not spec or not spec.loader:
 raise RuntimeError("P37-19R ORIGINAL_SERVER_MISSING")
original=importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
from hashlib import sha1

KNOWN={
 "assets/js/erp-store.js":"1d74daabcf51a6f47b03bac9bbc5407ca881272d",
 "assets/js/dashboard.js":"7526d31ad66cea0716eaa5351d25b7ccc72c3a5f",
 "assets/js/reports.js":"ee8f75817113c825313c95b2c5942ce54d55b984",
 "assets/js/p37-billing-formal-readonly-projection.js":"25a9ccd74871dab63894e7c0cce3ee63239dfe4d"
}

def verify_originals():
 for name,expected in KNOWN.items():
  data=(ROOT/name).read_bytes()
  digest=sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
  if digest!=expected:
   raise RuntimeError("P37-19R SOURCE_CHANGED "+name)
 return len(KNOWN)

def start():
 verify_originals()
 original.ALLOWED={
  "/":(LAB/"fixture.html","text/html; charset=utf-8"),
  "/n-synthetic-fixture.js":(N/"synthetic-fixture.js","text/javascript; charset=utf-8"),
  "/o-augmentation.js":(O/"o-augmentation.js","text/javascript; charset=utf-8"),
  "/p-augmentation.js":(P/"p-augmentation.js","text/javascript; charset=utf-8"),
  "/r-augmentation.js":(LAB/"r-augmentation.js","text/javascript; charset=utf-8"),
  "/original-erp-store.js":(ROOT/"assets/js/erp-store.js","text/javascript; charset=utf-8"),
  "/effective-ledger.js":(ROOT/"assets/js/p37-billing-effective-ledger.js","text/javascript; charset=utf-8"),
  "/formal-readonly-ledger.js":(ROOT/"assets/js/p37-billing-formal-readonly-projection.js","text/javascript; charset=utf-8"),
  "/original-dashboard.js":(ROOT/"assets/js/dashboard.js","text/javascript; charset=utf-8"),
  "/original-reports.js":(ROOT/"assets/js/reports.js","text/javascript; charset=utf-8"),
  "/effective-kpi-reader.js":(LAB/"effective-kpi-reader.js","text/javascript; charset=utf-8"),
  "/r-controller.js":(LAB/"r-controller.js","text/javascript; charset=utf-8")
 }
 return original.start()
