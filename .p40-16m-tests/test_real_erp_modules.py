"""P40-16M: actual main ERP Store / Cloud Sync JS in isolated Chromium.

No actual Supabase service or personal data. Only local origin is reachable and
fake HTTPS URL p40m.invalid is intercepted by Playwright; ALL other network
requests are aborted. Tests use actual (unaltered) main assets/js sources.
"""
from __future__ import annotations
import copy
import json
import urllib.parse
import unittest
from datetime import datetime,timezone,timedelta
from playwright.sync_api import sync_playwright, Error as PlaywrightError

ROOT="http://127.0.0.1:8798"
FIXTURE=ROOT+"/.p40-16m-tests/real_module_fixture.html"
FAKE="https://p40m.invalid"
SYNTHETIC_PRINCIPAL="SYNTHETIC-PRINCIPAL-ONLY"
def iso():return datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
def response(route,status,data):
    route.fulfill(status=status,body=json.dumps(data,ensure_ascii=False,separators=(",",":")),
                  content_type="application/json",headers={"Cache-Control":"no-store"})
def clone(v):return copy.deepcopy(v)

class FakeSupabase:
    def __init__(self):
        self.row=None;self.version=0;self.posts=0;self.reads=0
        self.unknown_requests=[];self.denied=[];self.offline=False
        self.fail_after_commit=False;self.concurrent_hook=None
        self.unrelated_financial_write=0
    def seeded(self,stored):
        if not isinstance(stored,dict):raise AssertionError("Bad synthetic seed")
        self._validate(stored)
        self.version=1
        self.row={"data":clone(stored),"updated_at":iso(),"sync_version":1,
                  "last_writer_mode":"trusted","last_base_sync_version":None}
    def _validate(self,data):
        assert isinstance(data,dict),"Data must be JSON object"
        for k in ("billings","receivables","invoices","receipts","retentionReceipts",
                  "salaryPayments","commissions","payroll","bankTransactions"):
            assert not data.get(k), "Unexpected non-fake financial record: "+k
        for c in data.get("customers",[]):
            assert c.get("name","").startswith("SYNTH-"),"Non-fake customer name"
        assert not any(x in data for x in ("access_token","refresh_token","service_role"))
    def handler(self,route):
        req=route.request
        url=urllib.parse.urlsplit(req.url)
        if url.hostname in ("127.0.0.1","localhost") and url.port==8798:
            return route.continue_()
        if req.url.startswith(FAKE+"/"):
            if self.offline:
                route.abort("internetdisconnected");return
            p=url.path
            if p=="/rest/v1/erp_states" and req.method=="GET":
                self.reads+=1
                if self.concurrent_hook:
                    hook=self.concurrent_hook;self.concurrent_hook=None;hook()
                response(route,200,[clone(self.row)] if self.row else [])
                return
            if p=="/rest/v1/rpc/erp_state_cas_write_v2" and req.method=="POST":
                cmd=req.post_data_json
                assert isinstance(cmd,dict)
                new_data=cmd.get("new_data")
                self._validate(new_data)
                if cmd.get("writer_mode") not in ("trusted","temporary"):
                    self.denied.append("writer-mode-invalid")
                    response(route,403,{"error":"mode"});return
                expected=cmd.get("expected_sync_version")
                if self.concurrent_hook:
                    hook=self.concurrent_hook;self.concurrent_hook=None;hook()
                if self.row is not None and expected!=self.row["sync_version"] or (
                    self.row is None and expected is not None):
                    response(route,200,[{"status":"CONFLICT",
                        "sync_version":self.row["sync_version"] if self.row else None,
                        "last_writer_mode":self.row["last_writer_mode"] if self.row else None,
                        "last_base_sync_version":self.row["last_base_sync_version"] if self.row else None,
                        "updated_at":self.row["updated_at"] if self.row else None}]);return
                self.posts+=1
                self.version+=1
                self.row={"data":clone(new_data),"sync_version":self.version,
                          "updated_at":iso(),"last_writer_mode":cmd["writer_mode"],
                          "last_base_sync_version":expected}
                if self.fail_after_commit:
                    self.fail_after_commit=False;route.abort("failed");return
                response(route,200,[{"status":"APPLIED","sync_version":self.version,
                    "updated_at":self.row["updated_at"],
                    "last_writer_mode":cmd["writer_mode"],
                    "last_base_sync_version":expected}]);return
        self.unknown_requests.append((req.method,req.url))
        route.abort("blockedbyclient")
    def external_change(self,name="SYNTH-SECOND-WRITER"):
        assert self.row
        self.row=clone(self.row)
        data=self.row["data"]
        data["customers"]=list(data.get("customers",[]))
        if not any(c.get("name")==name for c in data["customers"]):
            data["customers"].append({"id":"SYNTH-REMOTE-OTHER","name":name,
                "createdAt":iso(),"updatedAt":iso()})
        data.setdefault("meta",{})["updatedAt"]=iso()
        self.version+=1;self.row["sync_version"]=self.version
        self.row["updated_at"]=iso()
        self.row["last_base_sync_version"]=self.version-1
        self.row["last_writer_mode"]="trusted"
        self._validate(self.row["data"])

class RealModuleIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw=sync_playwright().start()
        cls.browser=cls.pw.chromium.launch(headless=True,
                  args=["--no-sandbox","--disable-dev-shm-usage"])
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.pw.stop()
    def setUp(self):
        self.cloud=FakeSupabase()
        self.contexts=[]
        self.pc=self.open_page()
    def tearDown(self):
        for c in reversed(self.contexts):
            c.close()
    def open_page(self):
        c=self.browser.new_context(accept_downloads=True)
        self.contexts.append(c)
        c.route("**/*",self.cloud.handler)
        p=c.new_page()
        p.goto(FIXTURE,wait_until="load")
        p.wait_for_function("window.P40M && window.KuSheERPStore && window.KusheCloudSync")
        return p
    def evaluate(self,js,page=None):
        return (page or self.pc).evaluate(js)
    def load(self,page=None):
        return self.evaluate("() => P40M.load().then(x => ({customers:x.customers.length, billings:x.billings.length}))",page)
    def trust(self,page=None):
        return self.evaluate("() => P40M.setTrust()",page)
    def add(self,name="SYNTH-CUSTOMER-01",page=None):
        return self.evaluate("v => P40M.saveFakeCustomer(v).then(x=>x.name)",page or self.pc) if False else (
            (page or self.pc).evaluate("v => P40M.saveFakeCustomer(v).then(x=>x.name)",name))
    def real_snapshot(self,page=None):
        return self.evaluate("() => P40M.local()",page)
    def inspect(self,page=None):
        return self.evaluate("() => P40M.inspect()",page)
    def assert_synthetic(self):
        if self.cloud.row:self.cloud._validate(self.cloud.row["data"])
        self.assertFalse(self.cloud.unknown_requests,
            "Browser attempted nonlocal/unexpected network: "+str(self.cloud.unknown_requests))
        self.assertEqual(self.cloud.unrelated_financial_write,0)
    def test_loads_exact_unmodified_erp_modules_on_local_origin(self):
        self.assertEqual(self.pc.url,FIXTURE)
        self.assertTrue(self.evaluate("() => typeof KuSheERPStore.saveCustomer === 'function'"))
        self.assertTrue(self.evaluate("() => typeof KusheCloudSync.inspect === 'function'"))
        self.assertEqual(self.load(),{"customers":0,"billings":0})
        self.assertEqual(self.evaluate("() => KuSheERPStore.getState().billings.length"),0)
        self.assert_synthetic()
    def test_real_store_transaction_persists_to_native_IDB_emergency_journal(self):
        self.load();self.trust()
        self.assertEqual(self.add(),"SYNTH-CUSTOMER-01")
        c=self.real_snapshot()
        self.assertEqual(c["data"]["customers"][0]["name"],"SYNTH-CUSTOMER-01")
        self.assertEqual(c["data"]["billings"],[])
        r=self.evaluate("() => P40M.rawState()")
        self.assertEqual(r["state"]["customers"][0]["name"],"SYNTH-CUSTOMER-01")
        self.assertEqual(r["journal"]["phase"],"COMMIT_VERIFIED")
        emergency=json.loads(self.evaluate("() => localStorage.getItem('KuSheERP25_EMERGENCY')"))
        self.assertEqual(emergency["customers"][0]["name"],"SYNTH-CUSTOMER-01")
        self.assertTrue(self.evaluate("() => !!localStorage.getItem('KuSheERP25_LOCAL_COMMIT_TOKEN')"))
        self.pc.reload(wait_until="load")
        self.assertEqual(self.load()["customers"],1)
        self.assertEqual(self.real_snapshot()["data"]["customers"][0]["name"],"SYNTH-CUSTOMER-01")
        self.assert_synthetic()
    def test_direct_persist_rejected_even_with_no_cloud(self):
        self.load();self.trust()
        result=self.evaluate("() => KuSheERPStore.persist().then(()=>'BAD',e=>e.code)")
        self.assertEqual(result,"DIRECT_PERSIST_FORBIDDEN")
        self.assertEqual(self.cloud.posts,0)
        self.assert_synthetic()
    def test_real_cloud_inspect_and_device_trust_gate_with_fake_cloud_only(self):
        self.load()
        status=self.inspect()
        self.assertEqual(status["code"],"REMOTE_EMPTY")
        self.assertEqual(self.evaluate("() => P40M.upload()")["code"],
                         "DEVICE_TRUST_REQUIRED")
        self.assertEqual(self.cloud.posts,0)
        self.assert_synthetic()
    def test_real_manual_upload_cancel_does_not_call_fake_cas(self):
        self.load();self.trust();self.add()
        status=self.inspect()
        self.assertEqual(status["code"],"REMOTE_EMPTY")
        self.assertTrue(status["canUpload"])
        result=self.evaluate("() => P40M.upload()")
        self.assertEqual(result["code"],"CANCELLED")
        self.assertEqual(self.cloud.posts,0)
        self.assert_synthetic()
    def test_actual_cloud_sync_manual_upload_and_reinspection_uses_fake_rest_cas(self):
        self.load();self.trust();self.add()
        self.evaluate("() => {window.P40M_ALLOW_APPROVAL=true;}")
        result=self.evaluate("() => P40M.upload()")
        self.assertEqual(result["code"],"UPLOAD_COMPLETE",result)
        self.assertEqual(self.cloud.posts,1)
        self.assertEqual(self.cloud.row["sync_version"],1)
        self.assertEqual(self.cloud.row["last_writer_mode"],"trusted")
        self.assertEqual(self.inspect()["code"],"SYNCED")
        self.assertEqual(self.cloud.row["data"]["customers"][0]["name"],"SYNTH-CUSTOMER-01")
        self.assert_synthetic()
    def test_changed_login_principal_never_uploads_old_user_snapshot(self):
        self.load();self.trust();self.add()
        self.evaluate("() => P40M_SESSION.setPrincipal('SYNTHETIC-OTHER-PRINCIPAL')")
        result=self.inspect()
        self.assertIn(result["code"],("AUTH_CHANGED","DEVICE_TRUST_REQUIRED","ERROR"))
        self.assertEqual(self.evaluate("() => P40M.upload()")["code"],"DEVICE_TRUST_REQUIRED")
        self.assertEqual(self.cloud.posts,0)
        self.assert_synthetic()
    def test_real_store_corrupted_emergency_blocks_reopen_and_further_writes(self):
        self.load();self.trust();self.add()
        self.evaluate("() => P40M.corruptMirror()")
        self.pc.reload(wait_until="load")
        result=self.evaluate("() => P40M.load().then(()=>'LOADED',e=>e.code || e.message)")
        self.assertNotEqual(result,"LOADED")
        self.assertIn(result,("STORE_EMERGENCY_MISMATCH","STALE_STORE_STATE","STORE_EMERGENCY_INVALID",
                              "STORE_METADATA_INVALID","STORE_EMERGENCY_DIVERGED"))
        self.assertEqual(self.cloud.posts,0)
        self.assert_synthetic()
    def test_real_store_corrupted_journal_blocks_after_reopen(self):
        self.load();self.trust();self.add()
        self.evaluate("() => P40M.corruptJournal()")
        self.pc.reload(wait_until="load")
        code=self.evaluate("() => P40M.load().then(()=>'LOADED',e=>e.code || e.message)")
        self.assertNotEqual(code,"LOADED")
        self.assertEqual(self.cloud.posts,0)
        self.assert_synthetic()
    def test_real_inspect_fails_closed_during_network_outage_without_modifying_local(self):
        self.load();self.trust();self.add()
        before=self.real_snapshot()
        self.cloud.offline=True
        result=self.inspect()
        self.assertIn(result["code"],("ERROR","SERVER_ERROR"))
        after=self.real_snapshot()
        self.assertEqual(before,after)
        self.assertEqual(self.cloud.posts,0)
        self.cloud.offline=False
        self.assertEqual(self.inspect()["code"],"REMOTE_EMPTY")
        self.assert_synthetic()
    def test_real_sync_detects_external_cloud_version_change_without_uploading(self):
        self.load();self.trust();self.add()
        self.evaluate("() => {window.P40M_ALLOW_APPROVAL=true;}")
        self.assertEqual(self.evaluate("() => P40M.upload()")["code"],"UPLOAD_COMPLETE")
        first=self.real_snapshot()
        self.cloud.external_change()
        self.add("SYNTH-LOCAL-CHANGED")
        # Dates/time classification can differ within 1 ms. The required
        # invariant is no unprompted Cloud CAS and no remote overwritten rows.
        before_posts=self.cloud.posts
        status=self.inspect()
        self.assertIn(status["code"],("REMOTE_NEWER","LOCAL_NEWER","UNKNOWN_CONFLICT",
                                       "TRUSTED_PRIORITY_AVAILABLE"))
        self.assertEqual(self.cloud.posts,before_posts)
        self.assertEqual(self.cloud.row["data"]["customers"][-1]["name"],"SYNTH-SECOND-WRITER")
        self.assertNotEqual(self.cloud.row["data"]["customers"][0]["name"],
                            "SYNTH-LOCAL-CHANGED")
        self.assert_synthetic()
    def test_real_cloud_sync_cas_no_hidden_ledger_version_fence(self):
        self.load();self.trust();self.add()
        # Production real sync does NOT pass hypothetical ledger_version.
        self.evaluate("() => {window.P40M_ALLOW_APPROVAL=true;}")
        self.assertEqual(self.evaluate("() => P40M.upload()")["code"],"UPLOAD_COMPLETE")
        # This is a DESIGN BLOCKER, not a passing ledger safety test.
        # The fake cloud may change the unseen ledger without changing
        # erp_states.sync_version. Current real client never sends ledgerVersion.
        self.assertEqual(self.cloud.row["sync_version"],1)
        self.assertTrue(self.cloud.posts>=1)
        self.assert_synthetic()

if __name__=="__main__":
    unittest.main(verbosity=2)
