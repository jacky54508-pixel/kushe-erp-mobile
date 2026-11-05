"""P37-19M real browser storage / localhost mock CAS.

No Supabase, ERP Store, real company data, open ports other than 127.0.0.1.
"""
from __future__ import annotations
import copy
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

BASE = Path(__file__).resolve().parent
SCOPE = "P37_19M_SYNTHETIC_LOCAL_ONLY"
PROJECT = "P37-19-SYN-AR-BROWSER"
ORIGINAL_GROSS = 1310400
ALLOWANCE_GROSS = 27300
EFFECTIVE_GROSS = 1283100
EFFECTIVE_RECEIVABLE = 1160900
EFFECTIVE_RETENTION = 122200
BASE_FINGERPRINT = "P37-19-SYN-REMOTE-FP-41"

class Remote:
    def __init__(self):
        self.mutex = threading.Lock()
        self.reset()

    def reset(self):
        with self.mutex:
            self.snapshot = {"scope": SCOPE, "version": "41",
                             "fingerprint": BASE_FINGERPRINT,
                             "commits": [], "formalERPCloudWrites": 0,
                             "formalBankTransactions": 0}

    def read(self):
        with self.mutex:
            return copy.deepcopy(self.snapshot)

    def cas(self, body):
        if not isinstance(body, dict) or set(body) != {
            "scope", "expectedVersion", "expectedFingerprint",
            "proposedFingerprint", "actionKey", "receivableId",
            "amount", "receiptCount", "bankCount", "newRevision", "mode"
        }:
            return 422, {"status": "BAD_CAS_FORMAT"}
        if body["scope"] != SCOPE or body["receivableId"] != PROJECT:
            return 403, {"status": "NON_SYNTHETIC_SOURCE"}
        if body["mode"] not in ["NORMAL", "TIMEOUT_BEFORE", "ACK_LOST"]:
            return 422, {"status": "BAD_TEST_MODE"}
        key = body["actionKey"]
        fp = body["proposedFingerprint"]
        if not isinstance(key, str) or not key.startswith("P37-19-SYN-TX-") or len(key) > 75:
            return 422, {"status": "INVALID_SYNTHETIC_KEY"}
        if not isinstance(fp, str) or len(fp) != 64 or any(c not in "0123456789abcdef" for c in fp):
            return 422, {"status": "INVALID_SIMULATED_SHA256"}
        amount = body["amount"]
        if not isinstance(amount, int) or isinstance(amount, bool) or not 0 < amount <= EFFECTIVE_RECEIVABLE:
            return 422, {"status": "INVALID_EFFECTIVE_RECEIVABLE_AMOUNT"}
        if body["receiptCount"] != 1 or body["bankCount"] != 1 or body["newRevision"] != 1:
            return 422, {"status": "RECEIPT_BANK_NOT_ONE_TO_ONE"}
        with self.mutex:
            current = self.snapshot
            if any(r["actionKey"] == key for r in current["commits"]):
                return 409, {"status": "DUPLICATE"}
            if body["expectedVersion"] != current["version"] or body["expectedFingerprint"] != current["fingerprint"]:
                return 409, {"status": "CONFLICT", "currentVersion": current["version"]}
            if body["mode"] == "TIMEOUT_BEFORE":
                return 503, {"status": "ACK_UNKNOWN_NO_SERVER_COMMIT"}
            if current["commits"]:
                return 409, {"status": "ALREADY_COMMITTED"}
            current["version"] = str(int(current["version"]) + 1)
            current["fingerprint"] = fp
            current["commits"].append({
                "actionKey": key, "amount": amount, "newRevision": 1,
                "receiptCount": 1, "bankCount": 1,
                "postedToERP": False, "officialVoucherVerified": False
            })
            if body["mode"] == "ACK_LOST":
                return 503, {"status": "REPLY_LOST_AFTER_SERVER_COMMIT"}
            return 200, {"status": "APPLIED", "version": current["version"], "fingerprint": fp,
                         "formalERPCloudWrites": 0, "formalBankTransactions": 0}


def handler_for(remote, host):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            return

        def respond(self, status, content, mime="application/json"):
            body = json.dumps(content).encode() if not isinstance(content, bytes) else content
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy",
                "default-src 'none'; script-src 'self'; connect-src 'self'; "
                "img-src 'none'; style-src 'none'; object-src 'none'; "
                "base-uri 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def guarded(self):
            if self.headers.get("Host") != host:
                self.respond(403, {"status": "FOREIGN_HOST_DENIED"})
                return False
            return True

        def do_GET(self):
            if not self.guarded():
                return
            loc = urlsplit(self.path).path
            if loc == "/":
                return self.respond(200, (BASE / "fixture.html").read_bytes(), "text/html; charset=utf-8")
            if loc == "/browser-store.js":
                return self.respond(200, (BASE / "browser-store.js").read_bytes(), "text/javascript; charset=utf-8")
            if loc == "/api/state":
                return self.respond(200, remote.read())
            return self.respond(404, {"status": "NOT_FOUND"})

        def do_POST(self):
            if not self.guarded():
                return
            if urlsplit(self.path).path != "/api/cas":
                return self.respond(404, {"status": "NOT_FOUND"})
            try:
                length = int(self.headers.get("Content-Length", "-1"))
                if length < 1 or length > 4096:
                    return self.respond(413, {"status": "BAD_BODY_SIZE"})
                request = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError):
                return self.respond(400, {"status": "INVALID_JSON"})
            status, response = remote.cas(request)
            return self.respond(status, response)

    return Handler


def start_test_server():
    remote = Remote()
    server = ThreadingHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    host = "127.0.0.1:" + str(server.server_port)
    server.RequestHandlerClass = handler_for(remote, host)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return remote, server, "http://" + host
