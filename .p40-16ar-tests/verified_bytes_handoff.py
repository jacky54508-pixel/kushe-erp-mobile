"""P40-16AR — LOOPBACK ONLY, SYNTHETIC ONLY, verified PDF byte handoff.

This is a testable *host-side* reference implementation, not an authorized
ERP service. There is NO real session validation, Supabase connection,
document retrieval, production endpoint, upload, or enterprise imagery.
The upstream fake repository is assembled from an official browser-projected
PUBLIC view of wholly fictitious sources; production MUST implement its own
trusted document fetch plus MFA/company-scoped authorization before adoption.

Guarantee inside this LAB: bytes issued == bytes checked by PyMuPDF/SHA256.
"""
from __future__ import annotations
from dataclasses import dataclass
from hashlib import sha256
import json
import re
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import fitz

PUBLIC_KEYS = frozenset({
    "schema", "documentType", "title", "number", "customer", "project",
    "date", "taxMode", "pricingMode", "invoiceStatus", "lines",
    "salesAmount", "taxAmount", "totalAmount", "retentionAmount",
    "receivableAmount", "publicNote", "company", "fileName",
    "mergedBillingProjects", "isMergedExternalBilling",
})
PUBLIC_LINE_KEYS = frozenset({
    "house", "item", "unit", "qty", "price", "amount",
    "pricingType", "sourcePricingType",
})
PUBLIC_COMPANY_KEYS = frozenset({
    "name", "englishName", "taxId", "address", "phone", "line",
})
AMOUNTS = {
    "salesAmount": "untaxed",
    "taxAmount": "tax",
    "totalAmount": "grossTotal",
    "retentionAmount": "retention",
    "receivableAmount": "receivable",
}
SENSITIVE_MARKERS = (
    "PRIVATE-INVOICE", "PRIVATE-BANK", "PRIVATE-SALARY",
    "PRIVATE-TOKEN", "PRIVATE-SNAPSHOT", "sourceSnapshots",
    "settlementSnapshots", "invoiceNo", "invoiceDate",
    "sourceInvoiceReferences", "access_token", "refresh_token",
    "service_role", "原請款／發票對照",
)


class Refused(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class FakePrincipal:
    """SIMULATED context, NOT a validated Supabase JWT or MFA claim."""
    principal_id: str
    company_id: str
    visible_documents: frozenset[str]
    signed_in: bool = True
    mfa: bool = True
    synced: bool = True


@dataclass
class SyntheticRecord:
    document_id: str
    company_id: str
    revision: str
    private_payload: dict
    approved_public_view: dict
    enabled: bool = True


@dataclass(frozen=True)
class VerifiedTicket:
    opaque_id: str
    digest: str


def compact(text: str) -> str:
    return re.sub(r"\s+", "", text)


class SyntheticReadOnlyStore:
    """Tests only: never accepts or queries real ERP IDs or snapshots."""
    def __init__(self):
        self.documents: dict[str, SyntheticRecord] = {}

    def add(self, record: SyntheticRecord) -> None:
        if record.document_id in self.documents:
            raise Refused("DUPLICATE_DOCUMENT_ID")
        if not record.document_id.startswith("SYNTHETIC-"):
            raise Refused("NON_SYNTHETIC_DOCUMENT_FORBIDDEN")
        if not record.company_id.startswith("FAKE-"):
            raise Refused("NON_SYNTHETIC_COMPANY_FORBIDDEN")
        if not record.revision.startswith("FAKE-REV-"):
            raise Refused("NON_SYNTHETIC_REVISION_FORBIDDEN")
        self.documents[record.document_id] = record

    def get_authorized(self, who: FakePrincipal, document_id: str,
                       expected_revision: str) -> SyntheticRecord:
        if not isinstance(who, FakePrincipal) or not who.signed_in:
            raise Refused("NO_FAKE_SESSION")
        if not who.mfa or not who.synced:
            raise Refused("FAKE_MFA_OR_SYNC_NOT_OK")
        if document_id not in who.visible_documents:
            raise Refused("NOT_IN_FAKE_DOCUMENT_ACCESS_LIST")
        source = self.documents.get(document_id)
        if source is None or not source.enabled:
            raise Refused("SOURCE_NOT_AVAILABLE")
        if source.company_id != who.company_id:
            raise Refused("CROSS_COMPANY_REQUEST")
        if source.revision != expected_revision:
            raise Refused("STALE_DOCUMENT_REVISION")
        return source


class VerifiedPdfHandoff:
    """SHA256-locked, one-use, same-document/same-simulated-session handoff."""
    def __init__(self, store: SyntheticReadOnlyStore):
        self.store = store
        self._entries: dict[str, dict] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _check_public_view(record: SyntheticRecord) -> tuple[dict,dict]:
        v = record.approved_public_view
        raw = record.private_payload["document"]
        if not isinstance(v,dict) or set(v) != PUBLIC_KEYS:
            raise Refused("UNEXPECTED_PUBLIC_VIEW_SCHEMA")
        if v.get("schema") != "kushe-external-document-v1" or \
           v.get("documentType") != "billing" or \
           v.get("isMergedExternalBilling") is not True or \
           v.get("number") != "":
            raise Refused("NOT_CUSTOMER_CROSS_ZONE_VIEW")
        selected = raw.get("displayProjectName")
        if not selected or v.get("project") != selected or \
           v.get("mergedBillingProjects") != [selected]:
            raise Refused("PUBLIC_TARGET_ZONE_MISMATCH")
        if raw.get("status") != "active" or raw.get("detailMode") != "unified" or \
           raw.get("schema") != "kushe-external-billing-group-v2":
            raise Refused("ARCHIVED_OR_UNSUPPORTED_SOURCE")
        if not isinstance(v.get("company"),dict) or \
           not set(v["company"]).issubset(PUBLIC_COMPANY_KEYS):
            raise Refused("PUBLIC_COMPANY_WHITELIST_FAILED")
        lines = v.get("lines")
        expected_lines = raw.get("unified",{}).get("lines",[])
        if not isinstance(lines,list) or not (1 <= len(lines) <= 50) or \
           len(lines) != len(expected_lines):
            raise Refused("PUBLIC_ORIGINAL_LINES_MISSING")
        for line,original in zip(lines,expected_lines):
            if not isinstance(line,dict) or set(line) != PUBLIC_LINE_KEYS:
                raise Refused("PUBLIC_LINE_WHITELIST_FAILED")
            if any(line.get(field) != original.get(field)
                   for field in ("house","item","unit","qty","price","amount")):
                raise Refused("ORIGINAL_LINE_DATA_TAMPERED")
        for key,source_key in AMOUNTS.items():
            if v.get(key) != raw.get("totals",{}).get(source_key):
                raise Refused("APPROVED_AMOUNT_TAMPERED")
        if v["salesAmount"]+v["taxAmount"] != v["totalAmount"] or \
           v["totalAmount"]-v["retentionAmount"] != v["receivableAmount"]:
            raise Refused("APPROVED_TOTAL_RELATION_BROKEN")
        approved_detail = v["totalAmount"] if v["taxMode"]=="含稅" else v["salesAmount"]
        if abs(sum(line["amount"] for line in lines)-approved_detail) > .01:
            raise Refused("DETAIL_AND_TOTAL_MISMATCH")
        if any(flag in json.dumps(v,ensure_ascii=False)
               for flag in SENSITIVE_MARKERS):
            raise Refused("PRIVATE_FIELD_IN_PUBLIC_VIEW")
        other_projects = set(str(s.get("projectName",""))
                             for s in raw.get("sourceSnapshots",[]))-{selected}
        for project in other_projects:
            if project and project in json.dumps(v,ensure_ascii=False):
                raise Refused("OTHER_ZONE_LEAKED_IN_PUBLIC_VIEW")
        return v,{"other_projects":other_projects,
                   "source_invoice_numbers":[
                       str(s.get("invoiceNo",""))
                       for s in raw.get("sourceSnapshots",[]) if s.get("invoiceNo")
                   ]}

    @staticmethod
    def _validate_pdf_bytes(blob:bytes,record:SyntheticRecord) -> str:
        if not isinstance(blob,bytes) or not blob.startswith(b"%PDF-"):
            raise Refused("NOT_A_PDF")
        v,private = VerifiedPdfHandoff._check_public_view(record)
        try:
            doc=fitz.open(stream=blob,filetype="pdf")
        except Exception:
            raise Refused("PDF_CANNOT_BE_OPENED")
        try:
            if len(doc)!=1:
                raise Refused("NOT_EXACTLY_ONE_A4_PAGE")
            p=doc[0]
            if not 594.4<p.rect.width<596 or not 841<p.rect.height<843:
                raise Refused("NOT_A4_DIMENSIONS")
            text=p.get_text(sort=True)
            normalized=compact(text)
            required=["請款單","客戶簽章","施工項目彙總",v["project"],v["customer"]]
            if len(v["lines"])>12:
                required.extend(["施工明細","原施工明細合計"])
            else:
                required.append("戶別施工統計")
            if any(compact(term) not in normalized for term in required):
                raise Refused("REQUIRED_PRINT_SECTION_MISSING")
            for line in v["lines"]:
                if compact(line["house"]) not in normalized or \
                   compact(line["item"]) not in normalized:
                    raise Refused("ORIGINAL_CONSTRUCTION_LINE_MISSING")
            for key in AMOUNTS:
                value=v[key]
                if value:
                    formatted=f"{value:,.0f}".replace(",","")
                    if formatted not in normalized.replace(",",""):
                        raise Refused("APPROVED_MONEY_NOT_PRINTED")
            if v["publicNote"] and compact(v["publicNote"]) not in normalized:
                raise Refused("PUBLIC_NOTE_NOT_PRINTED")
            for forbidden in list(SENSITIVE_MARKERS)+list(private["other_projects"])+\
                    private["source_invoice_numbers"]:
                if forbidden and forbidden in text:
                    raise Refused("PRIVATE_SOURCE_INFORMATION_PRINTED")
            spans=[]
            for block in p.get_text("dict")["blocks"]:
                for line in block.get("lines",[]):
                    for s in line.get("spans",[]):
                        if not s["text"].strip():continue
                        spans.append(s)
                        x0,y0,x1,y1=s["bbox"]
                        if x0<-.6 or y0<-.6 or x1>p.rect.width+.6 or y1>p.rect.height+.6:
                            raise Refused("PDF_TEXT_OUTSIDE_A4")
            if not spans or min(s["size"] for s in spans)<7.75:
                raise Refused("RENDERED_PDF_LEGIBILITY_BELOW_BASELINE")
            return sha256(blob).hexdigest()
        finally:
            doc.close()

    def approve(self,who:FakePrincipal,document_id:str,expected_revision:str,
                rendered_pdf:bytes) -> VerifiedTicket:
        record=self.store.get_authorized(who,document_id,expected_revision)
        digest=self._validate_pdf_bytes(rendered_pdf,record)
        ticket=secrets.token_urlsafe(32)
        with self._lock:
            self._entries[ticket]={
                "digest":digest,
                "bytes":rendered_pdf,
                "principal":who.principal_id,
                "company":who.company_id,
                "document":document_id,
                "revision":expected_revision
            }
        return VerifiedTicket(ticket,digest)

    def redeem(self,who:FakePrincipal,ticket:VerifiedTicket) -> bytes:
        if not isinstance(ticket,VerifiedTicket):
            raise Refused("BAD_VERIFIED_TICKET")
        with self._lock:
            entry=self._entries.get(ticket.opaque_id)
            if not entry:
                raise Refused("UNAPPROVED_OR_ALREADY_REDEEMED")
            if entry["digest"] != ticket.digest:
                raise Refused("TICKET_DIGEST_MISMATCH")
            if who.principal_id != entry["principal"] or \
               who.company_id != entry["company"]:
                raise Refused("FAKE_PRINCIPAL_NOT_TICKET_OWNER")
            self.store.get_authorized(who,entry["document"],entry["revision"])
            blob=entry["bytes"]
            if sha256(blob).hexdigest()!=entry["digest"]:
                raise Refused("STORED_BYTES_CHANGED_AFTER_VERIFICATION")
            del self._entries[ticket.opaque_id]
            return blob

    def simulated_corrupt_store_for_test(self,ticket:VerifiedTicket) -> None:
        """Adversarial test helper; never exists in any production route."""
        with self._lock:
            self._entries[ticket.opaque_id]["bytes"] += b"TAMPER"


class LabTicketHttpServer:
    """One local POST endpoint; fake sessions are test-only, never JWT."""
    def __init__(self,gate:VerifiedPdfHandoff,sessions:dict[str,FakePrincipal]):
        self.gate=gate
        self.sessions=sessions
        gate_ref=gate
        sessions_ref=sessions
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_args):
                pass  # no URL, token, private view, PDF content logs
            def do_POST(self):
                if self.path!="/lab-only/verified-pdf":
                    self.send_error(404)
                    return
                try:
                    length=int(self.headers.get("Content-Length","0"))
                    if not 0<length<=512:
                        raise Refused("INVALID_POST_LENGTH")
                    data=json.loads(self.rfile.read(length))
                    if not isinstance(data,dict) or set(data)!={"ticket","digest","session"}:
                        raise Refused("INVALID_REDEEM_REQUEST")
                    principal=sessions_ref.get(data["session"])
                    if principal is None:
                        raise Refused("INVALID_FAKE_SESSION_HANDLE")
                    ticket=VerifiedTicket(str(data["ticket"]),str(data["digest"]))
                    pdf=gate_ref.redeem(principal,ticket)
                    self.send_response(200)
                    self.send_header("Content-Type","application/pdf")
                    self.send_header("Content-Disposition",
                                     'attachment; filename="FAKE-CROSS-ZONE-VERIFIED.pdf"')
                    self.send_header("Content-Length",str(len(pdf)))
                    self.send_header("Cache-Control","no-store")
                    self.send_header("X-Content-Type-Options","nosniff")
                    self.send_header("X-SHA256",sha256(pdf).hexdigest())
                    self.end_headers()
                    self.wfile.write(pdf)
                except (ValueError,TypeError,json.JSONDecodeError,Refused):
                    self.send_response(403)
                    self.send_header("Cache-Control","no-store")
                    self.send_header("Content-Length","0")
                    self.end_headers()
            def do_GET(self):
                self.send_response(405)
                self.send_header("Content-Length","0")
                self.end_headers()
        self.server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
        self.address=f"http://127.0.0.1:{self.server.server_port}"
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)

    def start(self):
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
