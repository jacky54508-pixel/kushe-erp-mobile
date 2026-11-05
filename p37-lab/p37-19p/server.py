"""P37-19P on-the-fly patched Store, strict loopback-only ephemeral tempfile.

No modification of tracked assets/js/erp-store.js. All financial content synthetic.
"""
from pathlib import Path
import importlib.util
import tempfile

ROOT=Path(__file__).resolve().parents[2]
LAB=Path(__file__).resolve().parent
N=ROOT/"p37-lab"/"p37-19n"
O=ROOT/"p37-lab"/"p37-19o"
spec=importlib.util.spec_from_file_location("p37_19n_guarded_base_server",N/"server.py")
if not spec or not spec.loader:
    raise RuntimeError("P37-19P BASE_SERVER_NOT_FOUND")
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

from lab_overlay import build


def start():
    base.original_source_verified()
    temporary=tempfile.TemporaryDirectory(prefix="p37-19p-ephemeral-only-")
    generated=Path(temporary.name)/"sandbox-only-patched-store.js"
    generated.write_bytes(build())
    base.ALLOWED={
        "/":(LAB/"fixture.html","text/html; charset=utf-8"),
        "/n-synthetic-fixture.js":(N/"synthetic-fixture.js","text/javascript; charset=utf-8"),
        "/o-augmentation.js":(O/"o-augmentation.js","text/javascript; charset=utf-8"),
        "/p-augmentation.js":(LAB/"p-augmentation.js","text/javascript; charset=utf-8"),
        "/effective-ledger.js":(ROOT/"assets/js/p37-billing-effective-ledger.js","text/javascript; charset=utf-8"),
        "/p-lab-store.js":(generated,"text/javascript; charset=utf-8")
    }
    try:
        server,origin=base.start()
        return server,origin,temporary
    except BaseException:
        temporary.cleanup()
        raise
