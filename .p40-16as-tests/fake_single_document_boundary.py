"""P40-16AS: MOCK-only document-scoped PDF authorization boundary.

This is a DENY-BY-DEFAULT architecture contract, not a Supabase Auth/Database
implementation. FakeAuthVerifier, FakeDocumentProvider and ALL input data are
synthetic. There is NO JWT signature verification, database query, RLS,
cloud-state read, network connection, real ERP data, or PDF download endpoint.
Do NOT deploy, import, or combine with production without separate approval.
"""
from dataclasses import dataclass
from copy import deepcopy
from typing import FrozenSet
import json

class Blocked(Exception):
    def __init__(self, reason):
        self.reason=reason
        super().__init__(reason)

@dataclass(frozen=True)
class FakeVerifiedIdentity:
    user_id: str
    company_id: str
    active_membership: bool
    role: str
    aal: str
    session_active: bool
    allowed_documents: FrozenSet[str]
    signature_verified_in_fixture: bool = True
    issuer_verified_in_fixture: bool = True
    audience_verified_in_fixture: bool = True
    expiry_verified_in_fixture: bool = True

@dataclass(frozen=True)
class FakeSingleDocument:
    document_id: str
    target_billing_id: str
    company_id: str
    revision: str
    public_view: dict
    active: bool = True

class FakeVerifier:
    """A narrow interface. All tokens are MOCK handles, never actual JWTs."""
    def __init__(self, sessions):
        self._sessions=dict(sessions)
    def authenticate(self, fake_handle):
        if not isinstance(fake_handle,str) or not fake_handle.startswith("FAKE-HANDLE-"):
            raise Blocked("UNTRUSTED_TOKEN_OR_UNVERIFIED_JWT")
        identity=self._sessions.get(fake_handle)
        if not isinstance(identity,FakeVerifiedIdentity):
            raise Blocked("UNTRUSTED_TOKEN_OR_UNVERIFIED_JWT")
        if not all((identity.signature_verified_in_fixture,
                    identity.issuer_verified_in_fixture,
                    identity.audience_verified_in_fixture,
                    identity.expiry_verified_in_fixture,
                    identity.session_active)):
            raise Blocked("INVALID_OR_EXPIRED_VERIFIED_SESSION")
        if identity.aal!="aal2":
            raise Blocked("MFA_AAL2_REQUIRED")
        if not identity.active_membership or not identity.company_id:
            raise Blocked("INACTIVE_COMPANY_MEMBERSHIP")
        # Same front-end-role categories observed in official auth-gate.js,
        # but this is still a SIMULATED permission gate.
        if identity.role not in {"owner","admin","accounting"}:
            raise Blocked("BILLING_READ_PERMISSION_DENIED")
        return identity

class FakeDocumentScopedProvider:
    """A hypothetical document-level adapter, NOT the official erp_states API."""
    def __init__(self, documents, *, single_document_capability=False,
                 supported_rls_verified=False):
        self.records=deepcopy(documents)
        self.single_document_capability=single_document_capability
        self.supported_rls_verified=supported_rls_verified
        self.read_calls=0
        self.read_surfaces=[]
    def read_one(self, identity, document_id, target_billing_id, expected_revision):
        if not (self.single_document_capability and self.supported_rls_verified):
            raise Blocked("NO_PROVEN_TRUSTED_SINGLE_DOCUMENT_SOURCE")
        if not document_id.startswith("SYNTHETIC-") or not target_billing_id.startswith("FAKE-BILL-"):
            raise Blocked("SYNTHETIC_LAB_ONLY")
        self.read_calls+=1
        self.read_surfaces.append((identity.company_id,document_id,target_billing_id))
        record=self.records.get(document_id)
        if not isinstance(record,FakeSingleDocument) or not record.active:
            raise Blocked("DOCUMENT_MISSING_OR_ARCHIVED")
        if record.company_id!=identity.company_id:
            raise Blocked("CROSS_COMPANY_DOCUMENT")
        if record.document_id not in identity.allowed_documents:
            raise Blocked("DOCUMENT_PERMISSION_DENIED")
        if record.target_billing_id!=target_billing_id:
            raise Blocked("TARGET_ORIGINAL_BILLING_MISMATCH")
        if record.revision!=expected_revision:
            raise Blocked("STALE_DOCUMENT_REVISION")
        return deepcopy(record)

ALLOWED_REQUEST_KEYS=frozenset({
    "documentType","documentId","targetBillingId","expectedRevision"
})
PUBLIC_FIELDS=frozenset({
    "schema","documentType","title","number","customer","project","date",
    "taxMode","pricingMode","invoiceStatus","lines","salesAmount",
    "taxAmount","totalAmount","retentionAmount","receivableAmount",
    "publicNote","company","fileName","mergedBillingProjects",
    "isMergedExternalBilling"
})
PUBLIC_ITEM_FIELDS=frozenset({
    "house","item","unit","qty","price","amount","pricingType",
    "sourcePricingType"
})
PUBLIC_COMPANY_FIELDS=frozenset({
    "name","englishName","taxId","address","phone","line"
})
PRIVATE_TOKENS=(
    "PRIVATE-INVOICE","PRIVATE-BANK","PRIVATE-SALARY",
    "PRIVATE-SNAPSHOT","PRIVATE-TOKEN","sourceSnapshots",
    "settlementSnapshots","invoiceNo","invoiceDate",
    "sourceInvoiceReferences","refresh_token","access_token",
    "service_role","原請款／發票對照"
)

class ReadonlyDocumentPreflight:
    """Paper interface requiring independently secured REAL implementations."""
    def __init__(self, verifier, provider):
        self.verifier=verifier
        self.provider=provider

    def inspect(self, fake_handle, client_request):
        # Client inputs must be document locator + revision ONLY. Never accept
        # a posted ERP snapshot, customer View, data or company authorization.
        if not isinstance(client_request,dict) or set(client_request)!=ALLOWED_REQUEST_KEYS:
            raise Blocked("REQUEST_WHITELIST_VIOLATION")
        if client_request["documentType"]!="cross-zone-billing":
            raise Blocked("UNSUPPORTED_DOCUMENT_CATEGORY")
        doc_id=client_request["documentId"]
        target_id=client_request["targetBillingId"]
        revision=client_request["expectedRevision"]
        if not all(isinstance(v,str) and 0<len(v)<=150
                   for v in (doc_id,target_id,revision)):
            raise Blocked("INVALID_DOCUMENT_LOCATOR")
        identity=self.verifier.authenticate(fake_handle)
        # The provider MUST read ONE trusted document only, already scoped by
        # company/user/revision + a proven RLS and authorization mechanism.
        # Official main's erp_states?select=data is NOT this provider.
        source=self.provider.read_one(identity,doc_id,target_id,revision)
        v=source.public_view
        if not isinstance(v,dict) or set(v)!=PUBLIC_FIELDS:
            raise Blocked("PUBLIC_FIELD_ALLOWLIST_FAILED")
        if v["schema"]!="kushe-external-document-v1" or \
           v["documentType"]!="billing" or \
           v["isMergedExternalBilling"] is not True or \
           v["number"]!="" or \
           v["mergedBillingProjects"]!=[v["project"]]:
            raise Blocked("NOT_ACTIVE_SINGLE_TARGET_CROSS_ZONE_VIEW")
        if not isinstance(v["lines"],list) or not 1<=len(v["lines"])<=50:
            raise Blocked("INVALID_PUBLIC_ITEM_LIST")
        if any(not isinstance(line,dict) or set(line)!=PUBLIC_ITEM_FIELDS
               for line in v["lines"]):
            raise Blocked("PUBLIC_ITEM_ALLOWLIST_FAILED")
        if not isinstance(v["company"],dict) or not set(v["company"]).issubset(PUBLIC_COMPANY_FIELDS):
            raise Blocked("PUBLIC_COMPANY_ALLOWLIST_FAILED")
        for k in ("salesAmount","taxAmount","totalAmount",
                  "retentionAmount","receivableAmount"):
            if not isinstance(v[k],(int,float)) or isinstance(v[k],bool) or v[k]<0:
                raise Blocked("INVALID_APPROVED_MONEY")
        if round(v["salesAmount"]+v["taxAmount"]-v["totalAmount"],2)!=0 or \
           round(v["totalAmount"]-v["retentionAmount"]-v["receivableAmount"],2)!=0:
            raise Blocked("FINANCIAL_TOTAL_RELATION_FAILED")
        original=json.dumps(v,ensure_ascii=False)
        if any(x in original for x in PRIVATE_TOKENS):
            raise Blocked("PRIVATE_FIELD_OR_SENTINEL_IN_PUBLIC_PROJECTION")
        return {
            "allowed":True,
            "source":"FAKE_DOCUMENT_SCOPED_PROVIDER_ONLY",
            "documentId":source.document_id,
            "targetBillingId":source.target_billing_id,
            "expectedRevision":source.revision,
            "companyIdFromVerifiedFixture":identity.company_id,
            "publicView":deepcopy(v)
        }
