"""P37-19N original ERP Store loaded only on 127.0.0.1 isolated browser.

This server serves the exact historical erp-store.js blob unmodified; it does
NOT expose index.html, Cloud Sync, real Supabase, or data from any user.
"""
from __future__ import annotations

import hashlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
LAB = Path(__file__).resolve().parent
ERP = ROOT / "assets" / "js" / "erp-store.js"
EXPECTED_ERP_GIT_BLOB = "1d74daabcf51a6f47b03bac9bbc5407ca881272d"
ALLOWED = {
    "/": (LAB / "fixture.html", "text/html; charset=utf-8"),
    "/synthetic-fixture.js": (LAB / "synthetic-fixture.js", "text/javascript; charset=utf-8"),
    "/original-erp-store.js": (ERP, "text/javascript; charset=utf-8"),
}


def original_source_verified():
    data = ERP.read_bytes()
    sha = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if sha != EXPECTED_ERP_GIT_BLOB:
        raise ValueError("P37-19N REAL_ERP_SOURCE_SHA_CHANGED")
    return len(data)


def start():
    original_source_verified()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                self.send_error(403)
                return
            path = urlsplit(self.path).path
            if path not in ALLOWED:
                self.send_error(404)
                return
            filename, mime = ALLOWED[path]
            data = filename.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy",
                "default-src 'none'; script-src 'self'; connect-src 'none'; "
                "img-src 'none'; object-src 'none'; frame-ancestors 'none'; "
                "base-uri 'none'; form-action 'none'")
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}"
