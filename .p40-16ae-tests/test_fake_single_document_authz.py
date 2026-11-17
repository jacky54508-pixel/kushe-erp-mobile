"""P40-16AE isolated authorization & one-document source contract.

NO network, Supabase client, real JWT, cloud queries, PDF generation, or live data.
The FakeIdentityVerifier simulates outcomes of a *future* cryptographically
verified JWT + server-side MFA/session validation. It is intentionally NOT
a JWT verifier and MUST NEVER be deployed.

For real service, require both trusted authn and a server-side tenant-scoped
single-document resolver. Current ERP cloud sync exposes a whole-state JSON
row; it is not an approved single-document backend.
"""
from dataclasses import dataclass
from copy import deepcopy
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
REQUEST_KEYS = frozenset({"documentType", "billingId", "targetProjectId", "expectedRevision"})
PUBLIC_LINE_KEYS = ("house", "item", "unit", "qty", "price", "amount")
PUBLIC_KEYS = ("schema", "documentType", "title", "customer", "project", "date",
               "taxMode", "invoiceStatus", "salesAmount", "taxAmount", "totalAmount",
               "retentionAmount", "receivableAmount", "publicNote")
DENIED = "BLOCKED"  # Return no sensitive reason or source record to caller.

class Blocked(Exception):
    pass

@dataclass(frozen=True)
class VerifiedPrincipal:
    # Could only be supplied by a trusted identity verifier in a future design.
    user_id: str
    company_id: str
    aal: str
    session_active: bool

class FakeIdentityVerifier:
    """Fixed fake users ONLY. No untrusted header/JSON to identity conversion."""
    def __init__(self):
        self.fixtures = {
            "owner": VerifiedPrincipal("U-A", "COMP-A", "aal2", True),
            "accounting": VerifiedPrincipal("U-ACC", "COMP-A", "aal2", True),
            "employee": VerifiedPrincipal("U-EMP", "COMP-A", "aal2", True),
            "other-company": VerifiedPrincipal("U-B", "COMP-B", "aal2", True),
            "mfa-missing": VerifiedPrincipal("U-A", "COMP-A", "aal1", True),
            "expired": VerifiedPrincipal("U-A", "COMP-A", "aal2", False),
        }
    def mock_verify(self, fake_scenario):
        if fake_scenario not in self.fixtures:
            raise Blocked(DENIED)
        return self.fixtures[fake_scenario]

class MockTenantDocuments:
    """Only a per-company per-document lookup is accepted. Not a production DB."""
    def __init__(self):
        self.roles = {
            ("COMP-A", "U-A"): ("owner", "active"),
            ("COMP-A", "U-ACC"): ("accounting", "active"),
            ("COMP-A", "U-EMP"): ("employee", "active"),
            ("COMP-B", "U-B"): ("owner", "active")
        }
        base = {
            "schema": "kushe-external-document-v1",
            "documentType": "billing", "title": "請款單", "customer": "虛構建商",
            "project": "M區", "date": "2026-11-17", "taxMode": "未稅",
            "invoiceStatus": "invoice_pending",
            "lines": [{"house": "F01", "item": "虛構修補", "unit": "式",
                       "qty": 1, "price": 100, "amount": 100,
                       "invoiceNo": "PRIVATE-INVOICE-08", "bank": "PRIVATE"}],
            "salesAmount": 100, "taxAmount": 5, "totalAmount": 105,
            "retentionAmount": 0, "receivableAmount": 105,
            "publicNote": "虛構資料", "company": {"name": "SYNTH COMPANY",
                           "bank": "PRIVATE", "taxId": "00000000"},
            "sourceSnapshots": [{"invoiceNo": "PRIVATE-ORIGINAL"}],
            "salary": "PRIVATE-SALARY", "commission": "PRIVATE",
            "project_internal_notes": "PRIVATE"
        }
        self.documents = {
            ("COMP-A", "BILL-001"): dict(deepcopy(base),
                                       companyId="COMP-A", status="active",
                                       revision="REV-5", sync_state="SYNCED"),
            ("COMP-B", "BILL-001"): dict(deepcopy(base),
                                       companyId="COMP-B", status="active",
                                       revision="REV-6", sync_state="SYNCED"),
            ("COMP-A", "BILL-ARCH"): dict(deepcopy(base),
                                        companyId="COMP-A", status="archived",
                                        revision="REV-1", sync_state="SYNCED"),
            ("COMP-A", "BILL-STALE"): dict(deepcopy(base),
                                         companyId="COMP-A", status="active",
                                         revision="REV-1", sync_state="REMOTE_NEWER"),
        }
        self.lookups = []

    def role_for(self, company_id, user_id):
        return self.roles.get((company_id, user_id))

    def read_single(self, company_id, billing_id):
        self.lookups.append((company_id, billing_id))
        return deepcopy(self.documents.get((company_id, billing_id)))

class WholeSnapshotOnly:
    """Existing erp_states data shape is NOT an approved PDF source adapter."""
    def __init__(self):
        self.data = {"data": {"billings": [], "payroll": ["PRIVATE"]}}
    def read_all(self, user_id):
        raise AssertionError("Whole snapshot retrieval must never occur")

def validate_request(request):
    if not isinstance(request, dict) or set(request) != REQUEST_KEYS:
        raise Blocked(DENIED)
    if request.get("documentType") != "billing":
        raise Blocked(DENIED) # historical/other merged modes need separate tests
    for key in ("billingId", "targetProjectId", "expectedRevision"):
        value = request.get(key)
        if (not isinstance(value, str) or not value or len(value) > 128
            or any(ord(c) < 32 for c in value)):
            raise Blocked(DENIED)
    return request

def public_view(source, zone):
    # Only exact allowlisted fields. NEVER pass the source snapshot.
    try:
        result = {key: deepcopy(source[key]) for key in PUBLIC_KEYS}
        result["lines"] = [
            {key: deepcopy(line[key]) for key in PUBLIC_LINE_KEYS}
            for line in source["lines"]
        ]
        result["company"] = {key: deepcopy(source["company"][key])
                             for key in ("name", "taxId")}
        result["mergedBillingProjects"] = [zone]
        result["isMergedExternalBilling"] = True
        if not result["lines"] or result["project"] != zone:
            raise Blocked(DENIED)
        if sum(line["qty"] * line["price"] for line in result["lines"]) != result["salesAmount"]:
            raise Blocked(DENIED)
        if result["salesAmount"] + result["taxAmount"] != result["totalAmount"]:
            raise Blocked(DENIED)
        if result["totalAmount"] - result["retentionAmount"] != result["receivableAmount"]:
            raise Blocked(DENIED)
    except (TypeError, KeyError, ValueError, OverflowError):
        raise Blocked(DENIED)
    return result

def fictional_gateway(request, principal, source):
    """Not a deployable server. Does not accept a bearer token or direct snapshot."""
    validate_request(request)
    if (not isinstance(principal, VerifiedPrincipal)
        or not principal.session_active or principal.aal != "aal2"):
        raise Blocked(DENIED)
    if not hasattr(source, "read_single") or not hasattr(source, "role_for"):
        raise Blocked(DENIED) # do NOT fall back to .read_all()
    company_id = principal.company_id # from trusted verifier, NEVER client request
    membership = source.role_for(company_id, principal.user_id)
    if (not membership or membership[1] != "active"
        or membership[0] not in ("owner", "admin", "accounting")):
        raise Blocked(DENIED)
    record = source.read_single(company_id, request["billingId"])
    if (not record or record.get("companyId") != company_id
        or record.get("status") != "active"
        or record.get("revision") != request["expectedRevision"]
        or record.get("sync_state") != "SYNCED"
        or record.get("project") != request["targetProjectId"]):
        raise Blocked(DENIED)
    return public_view(record, request["targetProjectId"])

def request_for(billing="BILL-001", zone="M區", revision="REV-5"):
    return {"documentType": "billing", "billingId": billing,
            "targetProjectId": zone, "expectedRevision": revision}

class IsolatedTests(unittest.TestCase):
    def setUp(self):
        self.auth = FakeIdentityVerifier()
        self.source = MockTenantDocuments()
    def invoke(self, identity="owner", req=None, source=None):
        return fictional_gateway(req or request_for(),
                                self.auth.mock_verify(identity),
                                self.source if source is None else source)
    def assertDenied(self, identity="owner", req=None, source=None):
        with self.assertRaises(Blocked):
            self.invoke(identity, req, source)

    def test_owner_reads_only_own_single_document(self):
        v=self.invoke()
        self.assertEqual(self.source.lookups, [("COMP-A", "BILL-001")])
        self.assertEqual(v["totalAmount"],105)
        self.assertEqual(v["mergedBillingProjects"],["M區"])
    def test_accounting_can_read(self):
        self.assertEqual(self.invoke("accounting")["project"], "M區")
    def test_employee_no_billing_read(self):
        self.assertDenied("employee")
        self.assertEqual(self.source.lookups,[])
    def test_cross_company_even_same_document_id(self):
        self.assertDenied("other-company")
        self.assertEqual(self.source.lookups,[("COMP-B","BILL-001")])
    def test_client_cannot_supply_company_or_whole_snapshot(self):
        for injected in ({"companyId":"COMP-B"},
                         {"sourceSnapshots":[{"invoiceNo":"PRIVATE"}]},
                         {"bank":"PRIVATE"},
                         {"access_token":"FORGED"}):
            self.assertDenied(req={**request_for(),**injected})
        self.assertEqual(self.source.lookups,[])
    def test_unknown_or_fake_jwt_is_not_authenticated(self):
        for fake in ("forged-token","missing","unsigned"):
            with self.assertRaises(Blocked):
                self.auth.mock_verify(fake)
    def test_expired_session(self):
        self.assertDenied("expired")
    def test_mfa_required(self):
        self.assertDenied("mfa-missing")
    def test_unauthorized_project(self):
        self.assertDenied(req=request_for(zone="L區"))
    def test_stale_document_revision(self):
        self.assertDenied(req=request_for(revision="REV-4"))
    def test_sync_conflict(self):
        self.assertDenied(req=request_for(billing="BILL-STALE",revision="REV-1"))
    def test_historical_archived_not_automatically_allowed(self):
        self.assertDenied(req=request_for(billing="BILL-ARCH",revision="REV-1"))
    def test_missing_document(self):
        self.assertDenied(req=request_for(billing="MISSING"))
    def test_whole_state_is_not_a_single_doc_resolver(self):
        # CANNOT accidentally retrieve the complete user's ERP record.
        self.assertDenied(source=WholeSnapshotOnly())
    def test_inactive_membership(self):
        self.source.roles[("COMP-A","U-A")]=("owner","inactive")
        self.assertDenied()
    def test_no_privacy_leak_in_public_projection(self):
        public=self.invoke()
        text=repr(public)
        for term in ("PRIVATE","sourceSnapshots","salary","commission",
                     "bank","invoiceNo","userId"):
            self.assertNotIn(term,text)
    def test_bad_amount_must_fail(self):
        self.source.documents[("COMP-A","BILL-001")]["salesAmount"]=999
        self.assertDenied()
    def test_client_identity_object_is_not_accepted(self):
        self.assertDenied(source=WholeSnapshotOnly())
        with self.assertRaises(Blocked):
            fictional_gateway(request_for(), {"user_id":"U-A","company_id":"COMP-A"},
                              self.source)
    def test_reject_non_billing_or_different_request_shape(self):
        self.assertDenied(req={**request_for(),"documentType":"archived"})
        self.assertDenied(req={**request_for(),"expectedRevision":""})
    def test_repo_actual_source_is_whole_state(self):
        # Source observation, not a live schema/permission verification.
        text=(ROOT/"assets/js/cloud-sync.js").read_text()
        self.assertIn("/rest/v1/erp_states?select=data%2Cupdated_at",text)
        self.assertIn("function readRemote(auth",text)
        self.assertIn("return Array.isArray(rows) && rows.length ? rows[0] : null",text)
        self.assertIn("function casWrite(",text)
        auth=(ROOT/"assets/js/auth-gate.js").read_text()
        self.assertIn("/rest/v1/company_members?",auth)
        self.assertIn("/rest/v1/erp_company_states?",auth)

if __name__=="__main__":
    unittest.main(verbosity=2)
