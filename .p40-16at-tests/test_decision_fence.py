"""P40-16AT: offline only. This checks the captured, SANITIZED audit
decision and original source immutability; it DOES NOT query Supabase,
validate production RLS/JWT at runtime or certify a new billing API.
"""
import json
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
A=json.loads((ROOT/".p40-16at-review/decision.json").read_text(encoding="utf-8"))
C=A["finding_categories"]
def read(path):return (ROOT/path).read_text(encoding="utf-8")

class AuditDecisionTests(unittest.TestCase):
    def test_independent_production_metadata_audit_is_not_pdf_release(self):
        self.assertEqual(A["phase"],"P40-16AT")
        self.assertEqual(A["production_pdf_backend_release"],"BLOCKED")
        self.assertEqual(A["supported_conclusion"],"NO_VERIFIED_PRODUCTION_SINGLE_DOCUMENT_PDF_SOURCE")
        self.assertTrue(A["next_step_requires_separate_approval"])
    def test_no_real_business_rows_or_mutations_claimed(self):
        for key in ("live_business_rows_accessed","any_live_write","any_rls_or_schema_change","production_code_changed"):
            self.assertIs(A[key],False,key)
    def test_relevant_tables_are_rls_enabled(self):
        self.assertEqual(C["public_tables"],4)
        self.assertTrue(C["all_public_tables_rls_enabled"])
    def test_specific_document_pdf_data_source_not_found(self):
        self.assertFalse(C["application_pdf_single_document_table_found"])
        self.assertFalse(C["document_pdf_specific_rpc_found"])
        self.assertEqual(C["deployed_edge_functions"],0)
        self.assertFalse(C["dedicated_verified_server_document_authorization"])
    def test_company_full_json_is_not_unrestricted_select(self):
        self.assertFalse(C["company_state_data_select_granted_to_authenticated"])
        self.assertTrue(C["company_state_metadata_fields_have_select_grants"])
        self.assertTrue(C["user_state_rls_restricts_to_user_and_aal2"])
    def test_employee_projection_is_not_export_authorization(self):
        self.assertTrue(C["existing_employee_projection_rpc"])
        self.assertFalse(C["employee_projection_dedicated_to_billing_pdf"])
        self.assertFalse(C["live_jwt_and_role_simulations_performed"])
    def test_seven_unresolved_gates_stay_fail_closed(self):
        self.assertEqual([g["id"] for g in A["gates"]],["G1","G2","G3","G4","G5","G6","G7"])
        self.assertTrue(all(g["state"]=="BLOCK" for g in A["gates"]))
    def test_no_public_secrets_or_internal_project_ref_embedded(self):
        text=read(".p40-16at-review/README.md")+read(".p40-16at-review/decision.json")
        self.assertNotIn("jimcybsztnwfzrnvexsp",text)
        self.assertNotIn("ldktrfgzzzmklhsnfrol",text)
        for x in ("sb_secret_","service_role_key","Bearer eyJ","PRIVATE-INVOICE-08"):
            self.assertNotIn(x,text)
    def test_official_snapshot_code_has_no_single_document_api(self):
        cloud=read("assets/js/cloud-sync.js")
        self.assertIn("/rest/v1/erp_states?select=data%2Cupdated_at",cloud)
        self.assertIn("function readRemote(auth, options = {})",cloud)
        self.assertNotIn("get_single_billing_document_for_pdf",cloud)
    def test_original_auth_is_frontend_company_role_context(self):
        auth=read("assets/js/auth-gate.js")
        self.assertIn("/rest/v1/company_members?select=company_id,user_id",auth)
        self.assertIn("if (sessionAal(current)!=='aal2')",auth)
        self.assertIn("function canView(module)",auth)
    def test_report_explicitly_says_live_authorization_not_tested(self):
        text=read(".p40-16at-review/README.md")
        self.assertIn("沒有真實業務資料抽查",text)
        self.assertIn("正式發布仍然 BLOCKED",text)
        self.assertIn("CI 無法重新查核 Supabase 線上資料庫",text)
    def test_no_pdf_gateway_or_schema_migration_created_by_audit(self):
        self.assertFalse((ROOT/".p40-16ar-tests").exists())
        self.assertFalse((ROOT/"supabase/migrations/p40-16at.sql").exists())
        self.assertNotIn("p40-16at",read("index.html"))
        self.assertNotIn("p40-16at",read("billing-print.html"))
if __name__=="__main__":unittest.main()
