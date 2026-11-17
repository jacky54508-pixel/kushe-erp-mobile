"""P40-16AF: pure offline metadata-contract denial tests.

This is a fixed, NON-CONNECTED *schema summary* captured during a read-only
metadata check. It contains no actual customer rows or authentication secrets.
No network, Supabase client, real ERP data or migration.
"""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

VISIBLE_PUBLIC_TABLES = {
    "erp_states": {"user_id", "data", "sync_version", "updated_at", "last_writer_mode", "last_base_sync_version"},
    "erp_company_states": {"company_id", "data", "sync_version", "updated_at", "last_writer_mode", "last_base_sync_version"},
    "companies": {"id", "name", "owner_user_id", "legacy_source_user_id", "created_at", "updated_at"},
    "company_members": {"company_id", "user_id", "employee_id", "role", "status", "created_at", "updated_at"}
}
VISIBLE_STATE_FUNCTIONS = {
    "erp_state_cas_write", "erp_state_cas_write_v2",
    "erp_states_enforce_sync_version"
}
REQUIRED_DOCUMENT_FIELDS = {
    "company_id", "billing_id", "document_type", "expected_revision",
    "target_project_id", "public_payload"
}

class SourceUnavailable(Exception):
    pass

def vet_single_document_source(table_columns, function_names):
    """Fail closed if no *dedicated* public-only document source exists."""
    for table, cols in table_columns.items():
        if table in ("erp_states", "erp_company_states"):
            continue
        if REQUIRED_DOCUMENT_FIELDS.issubset(cols):
            return ("NEEDS_REAL_RLS_AND_AUTHZ_REVIEW", table)
    if any("billing" in function or "pdf_document" in function for function in function_names):
        return ("NEEDS_REAL_RLS_AND_AUTHZ_REVIEW", "rpc")
    raise SourceUnavailable("G1_BLOCKED_NO_TRUSTED_SINGLE_DOCUMENT_SOURCE")

def strict_select_request(req):
    """Demonstrate input minimization; DOES NOT authenticate/authorize."""
    allowed = {"documentType", "billingId", "targetProjectId", "expectedRevision"}
    if not isinstance(req, dict) or set(req) != allowed:
        raise ValueError("Only document references are allowed")
    if req["documentType"] not in ("billing",):
        raise ValueError("Unknown document route must not fall through")
    if any(not isinstance(req[k], str) or not req[k].strip() for k in allowed):
        raise ValueError("Missing document reference")
    return {k: req[k] for k in sorted(allowed)}

class MetadataGateTests(unittest.TestCase):
    def test_public_schema_does_not_prove_single_document_source(self):
        with self.assertRaisesRegex(SourceUnavailable, "G1_BLOCKED"):
            vet_single_document_source(VISIBLE_PUBLIC_TABLES, VISIBLE_STATE_FUNCTIONS)

    def test_whole_state_json_is_disallowed_even_if_rls_enabled(self):
        for source in ("erp_states", "erp_company_states"):
            self.assertIn("data", VISIBLE_PUBLIC_TABLES[source])
            self.assertFalse(REQUIRED_DOCUMENT_FIELDS.issubset(VISIBLE_PUBLIC_TABLES[source]))

    def test_staff_membership_table_not_billing_source(self):
        self.assertFalse(REQUIRED_DOCUMENT_FIELDS.issubset(VISIBLE_PUBLIC_TABLES["company_members"]))

    def test_future_dedicated_table_needs_real_authorization_review(self):
        future = dict(VISIBLE_PUBLIC_TABLES, dedicated_billing_documents=REQUIRED_DOCUMENT_FIELDS)
        decision = vet_single_document_source(future, VISIBLE_STATE_FUNCTIONS)
        self.assertEqual(decision, ("NEEDS_REAL_RLS_AND_AUTHZ_REVIEW", "dedicated_billing_documents"))
        self.assertNotEqual(decision[0], "PRODUCTION_APPROVED")

    def test_whole_snapshot_cannot_enter_pdf_request(self):
        base={"documentType":"billing", "billingId":"FAKE-01",
              "targetProjectId":"FAKE-M", "expectedRevision":"FAKE-R1"}
        self.assertEqual(len(strict_select_request(base)), 4)
        for key in ("data","sourceSnapshots","companyId","bank","salary","invoiceNo","session","access_token"):
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    strict_select_request({**base,key:"FAKE"})

    def test_unknown_document_type_blocks(self):
        with self.assertRaises(ValueError):
            strict_select_request({"documentType":"archived","billingId":"FAKE-01",
                 "targetProjectId":"FAKE-M","expectedRevision":"R1"})

    def test_existing_cloud_adapter_reads_entire_data_field(self):
        code=(ROOT/"assets/js/cloud-sync.js").read_text()
        self.assertIn("/rest/v1/erp_states?select=data%2Cupdated_at",code)
        self.assertIn("function readRemote(auth",code)
        self.assertIn("function casWrite(",code)
        self.assertIn("new_data: data",code)

    def test_github_pages_not_a_private_pdf_backend(self):
        deploy=(ROOT/".github/workflows/pages.yml").read_text()
        self.assertIn("Deploy main and beta to GitHub Pages",deploy)
        print_page=(ROOT/"billing-print.html").read_text()
        self.assertIn("window.print()",print_page)

if __name__=="__main__":
    unittest.main(verbosity=2)
