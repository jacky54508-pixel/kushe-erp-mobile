"""P40-16AS only fictional fixture + real pinned-main source inspection.

No cloud API calls, JWT validation, SQL, schema edits, Supabase connection,
real invoices, ERP snapshot parsing, actual login or PDF print/download.
"""
from pathlib import Path
from dataclasses import replace
from copy import deepcopy
import unittest

from fake_single_document_boundary import (
    Blocked,FakeVerifiedIdentity,FakeSingleDocument,FakeVerifier,
    FakeDocumentScopedProvider,ReadonlyDocumentPreflight,
)

ROOT=Path(__file__).resolve().parent.parent
def source(path):
    return (ROOT/path).read_text(encoding="utf-8")

def fake_view():
    return {
        "schema":"kushe-external-document-v1",
        "documentType":"billing","title":"請款單","number":"",
        "customer":"FAKE 建商","project":"虛構 M 區",
        "date":"2026-11-18","taxMode":"未稅","pricingMode":"",
        "invoiceStatus":"invoice_pending",
        "lines":[
            {"house":"1A","item":"虛構門框修補","unit":"式",
             "qty":2,"price":100,"amount":200,
             "pricingType":"","sourcePricingType":"external-document"},
            {"house":"2B","item":"虛構牆面修補","unit":"式",
             "qty":1,"price":100,"amount":100,
             "pricingType":"","sourcePricingType":"external-document"},
        ],
        "salesAmount":300,"taxAmount":15,"totalAmount":315,
        "retentionAmount":15,"receivableAmount":300,
        "publicNote":"僅測試資料，禁止對外傳送",
        "company":{"name":"FAKE 室內裝修"},
        "fileName":"SYNTHETIC-A4-ONLY.pdf",
        "mergedBillingProjects":["虛構 M 區"],
        "isMergedExternalBilling":True
    }

def fixture():
    doc=FakeSingleDocument(
        document_id="SYNTHETIC-01",
        target_billing_id="FAKE-BILL-01",
        company_id="FAKE-COMPANY-01",
        revision="FAKE-REV-01",
        public_view=fake_view()
    )
    principal=FakeVerifiedIdentity(
        user_id="FAKE-USER-01",company_id=doc.company_id,
        active_membership=True,role="accounting",aal="aal2",
        session_active=True,
        allowed_documents=frozenset({doc.document_id})
    )
    verifier=FakeVerifier({"FAKE-HANDLE-OWNER":principal})
    provider=FakeDocumentScopedProvider(
        {doc.document_id:doc},
        single_document_capability=True,supported_rls_verified=True
    )
    gate=ReadonlyDocumentPreflight(verifier,provider)
    request={
        "documentType":"cross-zone-billing",
        "documentId":doc.document_id,
        "targetBillingId":doc.target_billing_id,
        "expectedRevision":doc.revision
    }
    return gate,provider,principal,doc,request

class MockSingleDocumentBoundary(unittest.TestCase):
    def refused(self,gate,request,code,handle="FAKE-HANDLE-OWNER"):
        with self.assertRaises(Blocked) as caught:
            gate.inspect(handle,request)
        self.assertEqual(caught.exception.reason,code)

    def test_current_source_sync_is_an_entire_json_snapshot(self):
        cloud=source("assets/js/cloud-sync.js")
        self.assertIn("const BUSINESS_COLLECTIONS = [",cloud)
        self.assertIn("'billings', 'receivables', 'payables'",cloud)
        self.assertIn("function remotePath(userId)",cloud)
        self.assertIn(
            "/rest/v1/erp_states?select=data%2Cupdated_at%2Csync_version",
            cloud
        )
        self.assertIn("&user_id=eq.",cloud)
        self.assertIn("function readRemote(auth, options = {})",cloud)
        self.assertIn("const rows = await request(remotePath(auth.user.id)",cloud)
        self.assertIn("snapshotInfo(row.data",cloud)
        self.assertIn("/rest/v1/rpc/erp_state_cas_write_v2",cloud)
        # Static evidence does NOT establish a real PDF document-scoped API.
        self.assertNotIn("readOneBillingForPdf",cloud)
        self.assertNotIn("/rest/v1/billing_public_pdf_documents",cloud)

    def test_auth_source_uses_company_roles_mfa_and_metadata_not_document_acl(self):
        auth=source("assets/js/auth-gate.js")
        self.assertIn("function sessionAal(",auth)
        self.assertIn("if (sessionAal(current)!=='aal2')",auth)
        self.assertIn("/rest/v1/company_members?select=company_id,user_id",auth)
        self.assertIn("/rest/v1/erp_company_states?select=company_id,sync_version",auth)
        self.assertIn("function canView(module)",auth)
        self.assertIn("function canWrite(module)",auth)
        self.assertIn("employee:Object.freeze({",auth)
        self.assertIn("view:Object.freeze(['projects','materials','commissions'])",auth)
        self.assertIn("owner:Object.freeze({",auth)
        self.assertIn("accounting:Object.freeze({",auth)
        self.assertIn("function decodeJwtPayload(token)",auth)
        # Decoding a JWT for browser UI is NOT equivalent to server validation.
        self.assertNotIn("verifyPdfJwtSignatureOnServer",auth)

    def test_real_pdf_builder_is_client_side_and_snapshot_based(self):
        groups=source("assets/js/billing-groups.js")
        public=source("assets/js/external-billing-print.js")
        self.assertIn("const g=index().documents.find(",groups)
        self.assertIn("const historical=historyOnly",groups)
        self.assertIn("const payload={schema:'kushe-external-billing-print-v1'",groups)
        self.assertIn("url.hash=encodeURIComponent(btoa(",groups)
        self.assertIn("function originalTemplateView(payload,d)",public)
        self.assertIn("const mergedBillingProjects=[String(d.displayProjectName",public)
        self.assertIn("sourceInvoiceReferences=window.KusheExternalBillingInvoice.project",public)

    def test_denied_snapshot_only_source_even_if_user_is_owner(self):
        gate,p,owner,doc,req=fixture()
        p.single_document_capability=False
        self.refused(gate,req,"NO_PROVEN_TRUSTED_SINGLE_DOCUMENT_SOURCE")
        self.assertEqual(p.read_calls,0)

    def test_denied_unverified_rls_document_provider(self):
        gate,p,owner,doc,req=fixture()
        p.supported_rls_verified=False
        self.refused(gate,req,"NO_PROVEN_TRUSTED_SINGLE_DOCUMENT_SOURCE")
        self.assertEqual(p.read_calls,0)

    def test_accepts_single_fixture_document_not_entire_erp_state(self):
        gate,p,owner,doc,req=fixture()
        result=gate.inspect("FAKE-HANDLE-OWNER",req)
        self.assertTrue(result["allowed"])
        self.assertEqual(result["publicView"]["lines"],fake_view()["lines"])
        self.assertEqual(result["companyIdFromVerifiedFixture"],owner.company_id)
        self.assertEqual(p.read_calls,1)
        self.assertEqual(p.read_surfaces,[(
            owner.company_id,doc.document_id,doc.target_billing_id)])
        self.assertNotIn("sourceSnapshots",str(result))
        self.assertNotIn("bankTransactions",str(result))
        self.assertNotIn("payroll",str(result))

    def test_client_cannot_post_erp_snapshot(self):
        gate,p,owner,doc,req=fixture()
        req["data"]={"billings":[{"id":"PRIVATE-BILL"}],"payroll":"SECRET"}
        self.refused(gate,req,"REQUEST_WHITELIST_VIOLATION")
        self.assertEqual(p.read_calls,0)

    def test_client_cannot_post_private_view_or_company_authorization(self):
        for field in ("publicView","companyId","sourceSnapshots","invoiceNo",
                      "access_token","user_metadata","role","approvedByTrustedCaller"):
            gate,p,owner,doc,req=fixture()
            req[field]="FORGED"
            self.refused(gate,req,"REQUEST_WHITELIST_VIOLATION")
            self.assertEqual(p.read_calls,0)

    def test_client_cannot_post_unknown_or_legacy_document(self):
        gate,p,owner,doc,req=fixture()
        req["documentType"]="historical-billing"
        self.refused(gate,req,"UNSUPPORTED_DOCUMENT_CATEGORY")

    def test_client_missing_expected_revision_is_denied(self):
        gate,p,owner,doc,req=fixture()
        del req["expectedRevision"]
        self.refused(gate,req,"REQUEST_WHITELIST_VIOLATION")

    def test_only_fake_verified_identity_allowed(self):
        gate,p,owner,doc,req=fixture()
        self.refused(gate,req,"UNTRUSTED_TOKEN_OR_UNVERIFIED_JWT",handle="UNSIGNED.JWT.TOKEN")
        self.refused(gate,req,"UNTRUSTED_TOKEN_OR_UNVERIFIED_JWT",handle="FAKE-HANDLE-UNKNOWN")
        self.assertEqual(p.read_calls,0)

    def test_rejects_missing_signature_or_issuer_or_audience_or_expiry_verification(self):
        for field in (
            "signature_verified_in_fixture","issuer_verified_in_fixture",
            "audience_verified_in_fixture","expiry_verified_in_fixture",
            "session_active"
        ):
            gate,p,owner,doc,req=fixture()
            gate.verifier._sessions["FAKE-HANDLE-OWNER"]=replace(owner,**{field:False})
            self.refused(gate,req,"INVALID_OR_EXPIRED_VERIFIED_SESSION")
            self.assertEqual(p.read_calls,0)

    def test_denies_absent_verified_mfa(self):
        gate,p,owner,doc,req=fixture()
        gate.verifier._sessions["FAKE-HANDLE-OWNER"]=replace(owner,aal="aal1")
        self.refused(gate,req,"MFA_AAL2_REQUIRED")
        self.assertEqual(p.read_calls,0)

    def test_denies_employee_and_inactive_membership(self):
        for new_owner,reason in [
            (lambda x:replace(x,role="employee"),"BILLING_READ_PERMISSION_DENIED"),
            (lambda x:replace(x,active_membership=False),"INACTIVE_COMPANY_MEMBERSHIP"),
            (lambda x:replace(x,role="unknown"),"BILLING_READ_PERMISSION_DENIED")
        ]:
            gate,p,owner,doc,req=fixture()
            gate.verifier._sessions["FAKE-HANDLE-OWNER"]=new_owner(owner)
            self.refused(gate,req,reason)

    def test_denies_cross_company_even_same_billing_document_id(self):
        gate,p,owner,doc,req=fixture()
        gate.verifier._sessions["FAKE-HANDLE-OWNER"]=replace(
            owner,company_id="FAKE-OTHER-COMPANY")
        self.refused(gate,req,"CROSS_COMPANY_DOCUMENT")

    def test_denies_document_not_in_approved_access_list(self):
        gate,p,owner,doc,req=fixture()
        gate.verifier._sessions["FAKE-HANDLE-OWNER"]=replace(
            owner,allowed_documents=frozenset())
        self.refused(gate,req,"DOCUMENT_PERMISSION_DENIED")

    def test_denies_stale_version_and_wrong_target_original_bill(self):
        gate,p,owner,doc,req=fixture()
        req["expectedRevision"]="FAKE-REV-OLD"
        self.refused(gate,req,"STALE_DOCUMENT_REVISION")
        req["expectedRevision"]=doc.revision
        req["targetBillingId"]="FAKE-BILL-WRONG"
        self.refused(gate,req,"TARGET_ORIGINAL_BILLING_MISMATCH")

    def test_denies_archived_or_missing_document(self):
        gate,p,owner,doc,req=fixture()
        p.records[doc.document_id]=replace(p.records[doc.document_id],active=False)
        self.refused(gate,req,"DOCUMENT_MISSING_OR_ARCHIVED")
        p.records={}
        self.refused(gate,req,"DOCUMENT_MISSING_OR_ARCHIVED")

    def test_denies_non_synthetic_real_document_ids(self):
        gate,p,owner,doc,req=fixture()
        req["documentId"]="REAL-BILL-ID"
        self.refused(gate,req,"SYNTHETIC_LAB_ONLY")

    def test_denies_injected_source_snapshots_in_public_view(self):
        gate,p,owner,doc,req=fixture()
        p.records[doc.document_id].public_view["sourceSnapshots"]=[
            {"invoiceNo":"PRIVATE-INVOICE-08"}]
        self.refused(gate,req,"PUBLIC_FIELD_ALLOWLIST_FAILED")

    def test_denies_private_invoice_number_inside_public_note(self):
        gate,p,owner,doc,req=fixture()
        p.records[doc.document_id].public_view["publicNote"]+=" PRIVATE-INVOICE-08"
        self.refused(gate,req,"PRIVATE_FIELD_OR_SENTINEL_IN_PUBLIC_PROJECTION")

    def test_denies_cross_region_target_mismatch(self):
        gate,p,owner,doc,req=fixture()
        p.records[doc.document_id].public_view["mergedBillingProjects"]=["虛構 K 區"]
        self.refused(gate,req,"NOT_ACTIVE_SINGLE_TARGET_CROSS_ZONE_VIEW")

    def test_denies_changed_approved_receivable(self):
        gate,p,owner,doc,req=fixture()
        p.records[doc.document_id].public_view["receivableAmount"]=900
        self.refused(gate,req,"FINANCIAL_TOTAL_RELATION_FAILED")

    def test_protects_output_copy_from_source_mutation(self):
        gate,p,owner,doc,req=fixture()
        first=gate.inspect("FAKE-HANDLE-OWNER",req)
        first["publicView"]["lines"][0]["item"]="REPLACED"
        second=gate.inspect("FAKE-HANDLE-OWNER",req)
        self.assertEqual(second["publicView"]["lines"][0]["item"],"虛構門框修補")

    def test_no_database_write_network_service_or_snapshot_fetch_in_lab(self):
        code=source(".p40-16as-tests/fake_single_document_boundary.py")
        self.assertNotIn("supabase.createClient(",code)
        self.assertNotIn("service_role_key =",code)
        self.assertNotIn("requests.get(",code)
        self.assertNotIn("requests.post(",code)
        self.assertNotIn("execute_sql(",code)
        self.assertNotIn("from supabase",code)

if __name__=="__main__":
    unittest.main(verbosity=2)
