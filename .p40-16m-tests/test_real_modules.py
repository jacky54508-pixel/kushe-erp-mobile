"""P40-16M actual unchanged ERP Store+CloudSync modules loaded by isolated localhost Chrome.

No real Supabase or customer records. Network deny-by-default; one synthetic
invalid DNS HTTPS host is mocked, not reachable outside Playwright. Browser
profile uses fixture localhost origin, never the user's production ERP origin.
"""
import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,Error as PlaywrightError

ROOT="http://127.0.0.1:8799"
URL=ROOT+"/.p40-16m-tests/actual_modules_fixture.html"
TESTNAME="SYNTHETIC-ONLY-CUSTOMER"
DB_NAME="KuSheERP25_Core34_DB"  # same name, BUT test-origin sandbox separate

class RealErpJsIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw=sync_playwright().start()
        cls.browser=cls.pw.chromium.launch(headless=True,args=["--no-sandbox"])
    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
    def setUp(self):
        self.contexts=[]
        self.calls=[]
        self.page=self.make_page()
    def tearDown(self):
        for ctx in self.contexts:
            ctx.close()
    def route_guard(self,ctx):
        def handler(route):
            url=urlparse(route.request.url)
            if url.hostname in ("127.0.0.1","localhost") and url.port==8799:
                route.continue_()
            elif url.hostname=="p40m-synthetic.invalid":
                self.calls.append({"url":url.path,"method":route.request.method})
                # Never send a real network packet, all fake APIs are mocked locally.
                route.fulfill(status=503,content_type="application/json",body='{"error":"synthetic offline"}')
            else:
                self.calls.append({"BLOCKED_UNKNOWN":route.request.url})
                route.abort("blockedbyclient")
        ctx.route("**/*",handler)
    def make_page(self):
        ctx=self.browser.new_context()
        self.contexts.append(ctx)
        self.route_guard(ctx)
        page=ctx.new_page()
        page.goto(URL,wait_until="load")
        page.wait_for_function("Boolean(window.KuSheERPStore && window.KusheCloudSync)")
        return page
    def ev(self,js):
        return self.page.evaluate(js)
    def seed(self):
        self.ev("async()=>{await KuSheERPStore.load();await KuSheERPStore.saveCustomer({name:'"+TESTNAME+"'});}")
    def test_modules_are_actual_unmodified_browser_globals(self):
        self.assertTrue(self.ev("()=>typeof KuSheERPStore.saveCustomer==='function'"))
        self.assertTrue(self.ev("()=>typeof KuSheERPStore.readCommittedSnapshot==='function'"))
        self.assertTrue(self.ev("()=>typeof KusheCloudSync.decideRemote==='function'"))
        self.assertTrue(self.ev("()=>typeof KusheCloudSync.inspect==='function'"))
        self.assertFalse(self.ev("()=>Boolean(window.KusheERPProdWriteAuthorized)"))
        self.assertFalse(self.calls)
    def test_real_store_native_idb_and_mirror_after_writer(self):
        self.seed()
        snap=self.ev("async()=>await KuSheERPStore.readCommittedSnapshot()")
        self.assertEqual(snap["data"]["customers"][0]["name"],TESTNAME)
        self.assertTrue(snap["revision"]["id"])
        details=self.ev("""async()=>{
          const db=await new Promise((ok,no)=>{
            const req=indexedDB.open('KuSheERP25_Core34_DB');
            req.onsuccess=()=>ok(req.result);req.onerror=()=>no(req.error);
          });
          const tx=db.transaction('erp','readonly'),store=tx.objectStore('erp');
          const request=store.get('main');
          return new Promise((ok,no)=>{
             request.onsuccess=()=>ok({
                customer:request.result?.customers?.[0]?.name,
                emergency:JSON.parse(localStorage.getItem('KuSheERP25_EMERGENCY'))?.customers?.[0]?.name,
                commit:Boolean(localStorage.getItem('KuSheERP25_LOCAL_COMMIT_TOKEN'))
             });request.onerror=()=>no(request.error);
          });
        }""")
        self.assertEqual(details["customer"],TESTNAME)
        self.assertEqual(details["emergency"],TESTNAME)
        self.assertTrue(details["commit"])
        diag=self.ev("async()=>await KuSheERPStore.storeTransactionDiagnostic()")
        self.assertTrue(diag["available"])
        self.assertFalse(diag["blocked"])
        self.assertEqual(diag["journal"]["phase"],"COMMIT_VERIFIED")
    def test_reload_uses_real_store_history_without_duplicate_customers(self):
        self.seed()
        self.page.reload(wait_until="load")
        self.page.wait_for_function("Boolean(window.KuSheERPStore)")
        snap=self.ev("async()=>{await KuSheERPStore.load();return await KuSheERPStore.readCommittedSnapshot()}")
        self.assertEqual(len([c for c in snap["data"]["customers"] if c["name"]==TESTNAME]),1)
        self.assertFalse(self.calls)
    def test_real_store_public_direct_persist_is_blocked(self):
        with self.assertRaises(PlaywrightError):
            self.ev("async()=>await KuSheERPStore.persist()")
        self.assertFalse(self.calls)
    def test_real_store_duplicate_customer_writer_refuses_not_rewrite(self):
        self.seed()
        before=self.ev("async()=>await KuSheERPStore.readCommittedSnapshot()")
        with self.assertRaises(PlaywrightError):
            self.ev("async()=>await KuSheERPStore.saveCustomer({name:'"+TESTNAME+"'})")
        after=self.ev("async()=>await KuSheERPStore.readCommittedSnapshot()")
        self.assertEqual(before["baseline"],after["baseline"])
        self.assertEqual(before["data"]["customers"],after["data"]["customers"])
    def test_real_remote_readiness_is_readonly_and_refuses_wrong_baseline(self):
        self.seed()
        ready=self.ev("async()=>await KuSheERPStore.remoteApplyReadiness()")
        self.assertTrue(ready["safe"],ready)
        stale=self.ev("async()=>await KuSheERPStore.remoteApplyReadiness('SYNTHETIC-WRONG-BASELINE')")
        self.assertFalse(stale["safe"],stale)
        self.assertIn(stale["code"],["STALE_STORE_STATE","STORE_UNVERIFIED"])
    def test_real_store_mirror_corruption_blocks_committed_read(self):
        self.seed()
        self.ev("""()=>localStorage.setItem('KuSheERP25_EMERGENCY','{"corrupt":true}')""")
        with self.assertRaises(PlaywrightError):
            self.ev("async()=>await KuSheERPStore.readCommittedSnapshot()")
        status=self.ev("async()=>await KuSheERPStore.remoteApplyReadiness()")
        self.assertFalse(status["safe"])
    def test_real_store_commit_token_corruption_fails_closed(self):
        self.seed()
        self.ev("()=>localStorage.setItem('KuSheERP25_LOCAL_COMMIT_TOKEN','not-json')")
        with self.assertRaises(PlaywrightError):
            self.ev("async()=>await KuSheERPStore.readCommittedSnapshot()")
        d=self.ev("async()=>await KuSheERPStore.storeTransactionDiagnostic()")
        self.assertFalse(d["available"])
    def test_real_cloud_decision_requires_verified_versions(self):
        f="a"*64
        b="b"*64
        def decision(remote,local,version=2):
            return self.page.evaluate("""x=>KusheCloudSync.decideRemote({
              userId:'SYNTH-USER',baseline:{userId:'SYNTH-USER',syncVersion:1,
               remoteFingerprint:'%s',localFingerprint:'%s'},
              remoteExists:true,remoteVersion:x.version,metadataValid:true,
              remoteFingerprint:x.remote,localFingerprint:x.local,
              storeSafe:true,editorSafe:true
            })"""%(f,f),{"remote":remote,"local":local,"version":version})
        newer=decision(b,f)
        self.assertEqual(newer["code"],"REMOTE_NEWER_SAFE")
        self.assertTrue(newer["eligibleApply"])
        conflict=decision(b,b)
        self.assertEqual(conflict["code"],"CONFLICT")
        self.assertFalse(conflict["eligibleApply"])
        same=decision(f,f,1)
        self.assertEqual(same["code"],"SYNCED")
    def test_real_cloud_decision_blocks_invalid_principal_or_dirty_editor(self):
        f="a"*64
        bad=self.ev("""()=>KusheCloudSync.decideRemote({
         userId:'SYNTH-A',baseline:{userId:'SYNTH-B',syncVersion:1},
         remoteExists:true,remoteVersion:1})""")
        self.assertEqual(bad["code"],"PRINCIPAL_MISMATCH")
        dirty=self.ev("""()=>KusheCloudSync.decideRemote({
         userId:'SYNTH-A',baseline:{userId:'SYNTH-A',syncVersion:1,
           remoteFingerprint:'%s',localFingerprint:'%s'},
         remoteExists:true,remoteVersion:2,metadataValid:true,
         remoteFingerprint:'%s',localFingerprint:'%s',
         storeSafe:true,editorSafe:false})"""%(f,f,f,f))
        self.assertEqual(dirty["code"],"EDITOR_DIRTY")
    def test_real_cloud_api_error_is_mocked_503_without_remote_connection(self):
        status=self.ev("async()=>await KusheCloudSync.inspect()")
        self.assertEqual(status["code"],"ERROR")
        self.assertTrue(self.calls)
        self.assertTrue(all(x.get("url","").startswith("/rest/v1/") for x in self.calls))
    def test_native_idb_is_exclusive_to_isolated_origin_not_production_host(self):
        self.seed()
        self.assertEqual(urlparse(self.page.url).hostname,"127.0.0.1")
        self.assertEqual(self.ev("()=>location.origin"),ROOT)
        self.assertFalse(self.calls)
    def test_source_filenames_match_git_main_and_no_override_in_fixture(self):
        src=Path(".p40-16m-tests/actual_modules_fixture.html").read_text()
        self.assertIn('src="/assets/js/erp-store.js"',src)
        self.assertIn('src="/assets/js/cloud-sync.js"',src)
        self.assertNotIn("p40-16m",Path("index.html").read_text())

if __name__=="__main__":
    unittest.main(verbosity=2)
