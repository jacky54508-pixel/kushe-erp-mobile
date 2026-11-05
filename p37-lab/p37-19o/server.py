"""P37-19O serves EXACT original ERP Store in a disposable loopback-only test.

Reuses the SHA-verified P37-19N HTTP server; overrides its allowlisted
fixture routes before instantiating the server. No production URL or data.
"""
from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parents[2]
N = ROOT / "p37-lab" / "p37-19n"
spec = importlib.util.spec_from_file_location("p37_19n_original_server", N / "server.py")
if not spec or not spec.loader:
    raise RuntimeError("P37-19O ORIGINAL_TEST_SERVER_MISSING")
n_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(n_server)

HERE = Path(__file__).resolve().parent
n_server.ALLOWED = {
    "/": (HERE / "fixture.html", "text/html; charset=utf-8"),
    "/n-synthetic-fixture.js": (
        N / "synthetic-fixture.js", "text/javascript; charset=utf-8"),
    "/o-augmentation.js": (
        HERE / "o-augmentation.js", "text/javascript; charset=utf-8"),
    "/original-erp-store.js": (
        ROOT / "assets/js/erp-store.js", "text/javascript; charset=utf-8")
}


def start():
    n_server.original_source_verified()
    return n_server.start()


def original_source_verified():
    return n_server.original_source_verified()
