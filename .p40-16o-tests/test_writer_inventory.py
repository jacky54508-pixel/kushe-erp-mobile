"""P40-16O static scanner regression. Tests are entirely in memory, never
writing into the ERP tree or connecting to GitHub/Supabase/real data.
"""
from __future__ import annotations
import copy
import importlib.util
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("p40o_inventory",HERE/"audit_writers.py")
assert SPEC and SPEC.loader
audit=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)
ROOT=HERE.parent

class WriterInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original=audit.read_code(ROOT)
    def audit(self,mut=None):
        src=copy.deepcopy(self.original)
        if mut:mut(src)
        return audit.classify(ROOT,src)

    def test_actual_formal_main_source_has_only_reviewed_writer_anchors(self):
        data=self.audit()
        self.assertFalse(data["errors"],data["errors"])
        self.assertFalse(data["production_posting_safe"])
        self.assertFalse(data["formal_erp_ledger_version_integrated"])
        self.assertTrue(data["requires_manual_review"])
        self.assertGreaterEqual(data["scanned_js_files"],40)
        self.assertGreaterEqual(len(data["anchors"]),25)
        self.assertGreaterEqual(data["counts"]["fetch"],3)
        self.assertIn("assets/js/cloud-sync.js",data["network_source_files"])
        self.assertIn("assets/js/auth-gate.js",data["network_source_files"])
        self.assertIn("assets/js/employee-shell.js",data["network_source_files"])

    def test_new_unreviewed_http_writer_in_another_module_blocks(self):
        def bad(x):
            x["assets/js/reports.js"] += (
                "\nasync function shadowSend(){ return fetch('/rest/v1/erp_states',"
                "{method:'PATCH',body:'evil'}); }\n")
        data=self.audit(bad)
        self.assertTrue(any("UNREVIEWED_FETCH:assets/js/reports.js" in x for x in data["errors"]))
        self.assertTrue(any("UNREVIEWED_REST:assets/js/reports.js" in x for x in data["errors"]))
    def test_new_rest_path_in_other_module_blocks_even_without_fetch(self):
        def bad(x):
            x["assets/js/invoices.js"]+="\nconst directDb='/rest/v1/erp_states';\n"
        self.assertTrue(any("UNREVIEWED_REST:assets/js/invoices.js" in z
                            for z in self.audit(bad)["errors"]))
    def test_unsupported_xhr_network_api_blocks(self):
        def bad(x):x["assets/js/banks.js"]+="\nconst req=new XMLHttpRequest();\n"
        self.assertTrue(any("UNREVIEWED_NETWORK_API:assets/js/banks.js" in z
                            for z in self.audit(bad)["errors"]))
    def test_cas_rpc_renamed_requires_manual_review(self):
        def bad(x):
            x["assets/js/cloud-sync.js"]=x["assets/js/cloud-sync.js"].replace(
                "'/rest/v1/rpc/erp_state_cas_write_v2'",
                "'/rest/v1/rpc/not_audited_write'")
        errors=self.audit(bad)["errors"]
        self.assertIn("CAS_RPC_UNEXPECTED_CARDINALITY",errors)
        self.assertTrue(any("ANCHOR_ABSENT:" in s and ":cas_rpc:" in s for s in errors))
    def test_cas_payload_changed_to_unfenced_requires_review(self):
        def bad(x):
            x["assets/js/cloud-sync.js"]=x["assets/js/cloud-sync.js"].replace(
                "expected_sync_version: expected, new_data: data, writer_mode: writerMode",
                "new_data: data, writer_mode: writerMode")
        self.assertIn("CAS_REQUEST_CONTRACT_CHANGED",self.audit(bad)["errors"])
    def test_new_ledger_version_in_real_cloudsync_is_not_auto_approved(self):
        def bad(x):
            x["assets/js/cloud-sync.js"]+="\nconst ledgerVersion=100;\n"
        self.assertIn("NEW_LEDGER_FENCE_MUST_BE_REVIEWED",self.audit(bad)["errors"])
    def test_missing_critical_recovery_function_blocks(self):
        def bad(x):
            x["assets/js/erp-store.js"]=x["assets/js/erp-store.js"].replace(
                "async function recoverStore(confirmation={})",
                "async function unsafeRestore(confirmation={})")
        errors=self.audit(bad)["errors"]
        self.assertIn("CONTROLLED_RECOVERY_CHANGED",errors)
        self.assertTrue(any(":controlled_recovery:" in x for x in errors))
    def test_existing_raw_idb_and_local_rollback_paths_are_visible(self):
        entries=self.audit()["lexical_hits"]
        idb=[x for x in entries if x["path"]=="assets/js/erp-store.js"
             and x["kind"]=="raw_idb_write"]
        self.assertGreaterEqual(len(idb),15)
        local=[x for x in entries if x["path"]=="assets/js/erp-store.js"
               and x["kind"]=="local_write"]
        self.assertGreaterEqual(len(local),15)
        labels={x["label"] for x in self.audit()["anchors"]}
        for name in ("receipt_rollback","payable_delete_fallback",
                     "salary_delete_fallback","project_merge_fallback",
                     "remote_replace","controlled_recovery","auto_write",
                     "trusted_priority_write"):
            self.assertIn(name,labels)
    def test_auth_post_and_read_projection_separated_from_business_cas(self):
        src=self.original
        cloud=src["assets/js/cloud-sync.js"]
        auth=src["assets/js/auth-gate.js"]
        employee=src["assets/js/employee-shell.js"]
        self.assertIn("'/rest/v1/rpc/erp_state_cas_write_v2'",cloud)
        self.assertNotIn("erp_state_cas_write_v2",auth)
        self.assertNotIn("erp_state_cas_write_v2",employee)
        self.assertIn("employee_erp_read_projection",employee)
    def test_local_rollback_is_not_claimed_to_be_transactional_ledger_write(self):
        a=self.audit()
        self.assertTrue(any(x["kind"]=="FINANCE_LOCAL_ROLLBACK" for x in a["anchors"]))
        self.assertFalse(a["production_posting_safe"])
        # Nothing in an independent scanner executes ERP JS.
        txt=(HERE/"audit_writers.py").read_text()
        self.assertNotIn("subprocess",txt)
        self.assertNotIn("psycopg",txt)
        self.assertNotIn("https://jimcybsztnwfzrnvexsp",txt)
    def test_scan_never_mutates_real_source_text(self):
        original=self.original["assets/js/cloud-sync.js"]
        self.audit(lambda x:x.__setitem__("assets/js/cloud-sync.js",
              x["assets/js/cloud-sync.js"]+"\nconst ledgerVersion=1;"))
        self.assertEqual(original,self.original["assets/js/cloud-sync.js"])
        self.assertFalse((ROOT/"assets/js/cloud-sync.js").read_text()!=original)

if __name__=="__main__":
    unittest.main(verbosity=2)
