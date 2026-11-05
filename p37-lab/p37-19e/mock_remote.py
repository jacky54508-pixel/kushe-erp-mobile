"""P37-19E — loopback-only synthetic CAS server. NEVER touches Supabase or ERP."""
from __future__ import annotations
import copy
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

BASE = Path(__file__).resolve().parent
SCOPE = "P37-19E-SYNTHETIC-LOCAL-ONLY"
SOURCE = {
    "billingId": "P37-19-SYN-BILL",
    "receivableId": "P37-19-SYN-ARID",
    "invoiceNo": "P37-19-SYN-INVNO",
    "snapshotRevision": "P37-19-SYN-REV",
}
ORIGINAL = {"untaxed": 1248000, "tax": 62400, "gross": 1310400,
            "receivable": 1185600, "retention": 124800}
DISCOUNT = {"untaxed": 26000, "tax": 1300, "gross": 27300,
            "receivable": 24700, "retention": 2600}
EXPECTED = {"untaxed": 1222000, "tax": 61100, "gross": 1283100,
            "receivable": 1160900, "retention": 122200}
ACCOUNTS = {"P37-19-SYN-OWNER-A": "P37-19-SYN-OWNER",
            "P37-19-SYN-OWNER-B": "P37-19-SYN-OWNER"}
GUARD = {"billings": [], "receivables": [], "invoices": [], "receipts": [],
         "retentionReceipts": [], "bankTransactions": [], "payroll": [],
         "commissions": [], "customerDeductions": []}

class IsolatedRemote:
    def __init__(self):
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        with self.lock:
            self.value = {
                "scope": SCOPE, "simulated": True, "formalPostingEnabled": False,
                "version": 1, "fingerprint": "P37-19-SYN-FINGERPRINT-1",
                "source": copy.deepcopy(SOURCE), "original": copy.deepcopy(ORIGINAL),
                "allowances": [], "protected": copy.deepcopy(GUARD),
                "formalCloudWrites": 0, "formalBankEntries": 0
            }

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.value)

    def apply(self, body, principal):
        if not isinstance(body, dict) or set(body) != {
            "scope", "expectedVersion", "expectedFingerprint", "source",
            "discount", "idempotencyKey", "failAt"
        }:
            return 422, {"status": "BAD_REQUEST"}
        if body["scope"] != SCOPE or body["source"] != SOURCE:
            return 403, {"status": "FOREIGN_SCOPE_OR_SOURCE"}
        if not isinstance(body["expectedVersion"], int) or isinstance(body["expectedVersion"], bool):
            return 422, {"status": "BAD_VERSION"}
        key = body["idempotencyKey"]
        if not isinstance(key, str) or not key.startswith("P37-19-SYN-ACTION-") or len(key) > 100:
            return 422, {"status": "BAD_IDEMPOTENCY_KEY"}
        if not isinstance(body["discount"], dict) or body["discount"] != DISCOUNT:
            return 422, {"status": "AMOUNTS_NOT_BALANCED_OR_UNAPPROVED"}
        if body["failAt"] not in [None, "AFTER_APPEND", "AFTER_REVISION"]:
            return 422, {"status": "UNRECOGNIZED_FAULT"}
        with self.lock:
            v = self.value
            if any(a["idempotencyKey"] == key for a in v["allowances"]):
                return 409, {"status": "DUPLICATE", "version": v["version"]}
            if body["expectedVersion"] != v["version"] or body["expectedFingerprint"] != v["fingerprint"]:
                return 409, {"status": "CONFLICT", "version": v["version"]}
            if v["allowances"]:
                return 409, {"status": "ALLOWANCE_ALREADY_EXISTS"}
            candidate = copy.deepcopy(v)
            effective = {k: ORIGINAL[k] - DISCOUNT[k] for k in EXPECTED}
            if effective != EXPECTED or sum([effective["untaxed"], effective["tax"]]) != effective["gross"] or (
                effective["receivable"] + effective["retention"] != effective["gross"]
            ):
                return 422, {"status": "BALANCE_INVALID"}
            candidate["allowances"].append({
                "status": "SYNTHETIC_APPLIED_NOT_FORMAL",
                "source": copy.deepcopy(SOURCE),
                "idempotencyKey": key,
                "approved": effective,
                "discount": copy.deepcopy(DISCOUNT),
                "principal": principal,
                "officialVoucherVerified": False,
                "postedToERP": False
            })
            if body["failAt"] == "AFTER_APPEND":
                return 503, {"status": "INJECTED_ROLLBACK_AFTER_APPEND"}
            candidate["version"] += 1
            candidate["fingerprint"] = "P37-19-SYN-FINGERPRINT-" + str(candidate["version"])
            if body["failAt"] == "AFTER_REVISION":
                return 503, {"status": "INJECTED_ROLLBACK_AFTER_REVISION"}
            if candidate["original"] != v["original"] or candidate["protected"] != v["protected"]:
                return 500, {"status": "PROTECTED_DATA_CHANGED"}
            if candidate["formalCloudWrites"] or candidate["formalBankEntries"]:
                return 500, {"status": "FORMAL_WRITES_DETECTED"}
            self.value = candidate
            return 200, {"status": "SYNTHETIC_APPLIED_NOT_FORMAL",
                         "version": candidate["version"], "approved": effective,
                         "formalCloudWrites": 0, "formalBankEntries": 0}

def make_handler(remote: IsolatedRemote):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format_string, *args):
            return

        def response(self, status, payload, content_type="application/json"):
            data = json.dumps(payload, ensure_ascii=False).encode() if not isinstance(payload, bytes) else payload
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy",
                "default-src 'none'; script-src 'self'; connect-src 'self'; "
                "style-src 'none'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(data)

        def identity(self):
            token = self.headers.get("Authorization", "")
            if not token.startswith("Bearer "):
                return 401, None
            principal = ACCOUNTS.get(token[7:])
            if principal is None:
                return 403, None
            return 200, principal

        def do_GET(self):
            pathname = urlsplit(self.path).path
            if pathname == "/":
                return self.response(200, (BASE / "fixture.html").read_bytes(), "text/html; charset=utf-8")
            if pathname == "/client.js":
                return self.response(200, (BASE / "client.js").read_bytes(), "text/javascript; charset=utf-8")
            if pathname != "/api/state":
                return self.response(404, {"status": "NOT_FOUND"})
            status, principal = self.identity()
            if status != 200:
                return self.response(status, {"status": "AUTH_REQUIRED" if status == 401 else "NOT_ALLOWLISTED"})
            return self.response(200, remote.snapshot())

        def do_POST(self):
            if urlsplit(self.path).path != "/api/allowance":
                return self.response(404, {"status": "NOT_FOUND"})
            status, principal = self.identity()
            if status != 200:
                return self.response(status, {"status": "AUTH_REQUIRED" if status == 401 else "NOT_ALLOWLISTED"})
            try:
                n = int(self.headers.get("Content-Length", "-1"))
                if n < 1 or n > 4096:
                    return self.response(413, {"status": "BODY_SIZE_REJECTED"})
                payload = json.loads(self.rfile.read(n))
            except (ValueError, UnicodeDecodeError):
                return self.response(400, {"status": "INVALID_JSON"})
            code, result = remote.apply(payload, principal)
            return self.response(code, result)

    return Handler

def start_test_remote():
    remote = IsolatedRemote()
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(remote))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return remote, server, f"http://127.0.0.1:{server.server_port}"
