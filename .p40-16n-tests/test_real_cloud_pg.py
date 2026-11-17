"""P40-16N: original unchanged CloudSync/Store running in headless Chromium,
with browser HTTP bridge to a real disposable PostgreSQL CAS transaction.

All data/users are explicitly SYNTHETIC. No real Supabase URL, real JWT, real
customer data, or production IndexedDB is used. The HTTP bridge is a mock
PostgREST REST shape, NOT an actual deployed PostgREST server. Test database
always needs PostgreSQL service on 127.0.0.1 and name p40_16n_ci.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse,parse_qs
import copy
import json
import os
import threading
import unittest
import psycopg
from playwright.sync_api import sync_playwright,Error as BrowserError

SITE='http://127.0.0.1:8801'
FIXTURE=SITE+'/.p40-16n-tests/real_cloud_pg_fixture.html'
REMOTE='p40n-synthetic.invalid'
USER='SYNTH-P40N-OWNER'
DSN=os.environ.get('P40N_FAKE_PG_DSN','')
p=urlparse(DSN)
if p.hostname not in ('localhost','127.0.0.1') or p.path!='/p40_16n_ci':
    raise RuntimeError('P40-16N forbids any nonlocal or non-isolated PostgreSQL')
def connect():return psycopg.connect(DSN,connect_timeout=6)

def fake_cas(expected,data,mode='trusted',user=USER):
    with connect() as db:
        return db.execute(
            'SELECT status,sync_version,updated_at,last_writer_mode,last_base_sync_version '
            'FROM p40n_ci.fake_cas_write(%s,%s,%s::jsonb,%s)',
            (user,expected,json.dumps(data,separators=(',',':')),mode)).fetchone()

def current():
    with connect() as db:
        return db.execute('SELECT data,sync_version,updated_at,last_writer_mode,'
          'last_base_sync_version FROM p40n_ci.fake_erp_states WHERE user_id=%s',
          (USER,)).fetchone()
def fence():
    with connect() as db:
        return db.execute('SELECT ledger_version FROM p40n_ci.synthetic_ledger_fence '
                          'WHERE user_id=%s',(USER,)).fetchone()[0]
def ledger_event(op='SYNTH-N-EVENT'):
    with connect() as db:
        db.execute('INSERT INTO p40n_ci.synthetic_ledger_events(operation_key) '
                   'VALUES(%s) ON CONFLICT DO NOTHING',(op,))
        db.execute('UPDATE p40n_ci.synthetic_ledger_fence SET ledger_version='
                   'ledger_version+1 WHERE user_id=%s',(USER,))
def legacy_direct(data):
    with connect() as db:
        return db.execute('SELECT p40n_ci.fake_legacy_update(%s,%s::jsonb)',
                          (USER,json.dumps(data,separators=(',',':')))).fetchone()[0]

class RealCloudSyncPostgres(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as db:
            with psycopg.ClientCursor(db) as c:
                c.execute(Path('.p40-16n-tests/disposable_legacy_cas.sql').read_text())
        cls.pw=sync_playwright().start()
        cls.browser=cls.pw.chromium.launch(headless=True,args=['--no-sandbox'])
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.pw.stop()
    def setUp(self):
        with connect() as db:
            db.execute('TRUNCATE p40n_ci.fake_erp_states,'
                       'p40n_ci.synthetic_ledger_events')
            db.execute('UPDATE p40n_ci.synthetic_ledger_fence SET ledger_version=0')
        self.contexts=[]
        self.nonlocal_requests=[]
        self.api_requests=[]
        self.offline_labels=set()
        self.drop_next_cas=False
        self.race_before_next_cas=None
        self.page=self.make_page('SYNTH-PC')
        self.ev(self.page,"async()=>await KuSheERPStore.load()")
    def tearDown(self):
        for ctx in reversed(self.contexts):ctx.close()
    def response(self,route,status=200,body=None):
        headers={'Access-Control-Allow-Origin':'*',
                 'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer',
                 'Access-Control-Allow-Methods':'GET, POST, OPTIONS, PATCH',
                 'Access-Control-Max-Age':'0'}
        route.fulfill(status=status,headers=headers,content_type='application/json',
                      body='' if body is None else json.dumps(body,default=str))
    def pg_bridge(self,route,label):
        req=route.request
        uri=urlparse(req.url)
        if uri.hostname in ('localhost','127.0.0.1') and uri.port==8801:
            route.continue_();return
        if uri.hostname!=REMOTE:
            self.nonlocal_requests.append(req.url)
            route.abort('blockedbyclient');return
        if label in self.offline_labels:
            route.abort('internetdisconnected');return
        if req.method=='OPTIONS':
            self.response(route,204);return
        self.api_requests.append((label,req.method,uri.path))
        if req.headers.get('authorization')!='Bearer SYNTH-P40N-LOCAL-TOKEN' or (
                req.headers.get('apikey')!='SYNTH-P40N-LOCAL-KEY'):
            self.response(route,401,{'message':'SYNTHETIC_UNAUTHORIZED'});return
        if uri.path=='/rest/v1/erp_states' and req.method=='GET':
            params=parse_qs(uri.query)
            if params.get('user_id')!=['eq.'+USER]:
                self.response(route,403,{'message':'OWNER_MISMATCH'});return
            row=current()
            if row is None:self.response(route,200,[]);return
            data,version,updated,writer,base=row
            self.response(route,200,[{'data':data,'sync_version':version,
                'updated_at':updated.isoformat(),'last_writer_mode':writer,
                'last_base_sync_version':base}]);return
        if uri.path=='/rest/v1/rpc/erp_state_cas_write_v2' and req.method=='POST':
            try:
                body=json.loads(req.post_data or '{}')
                if self.race_before_next_cas:
                    self.race_before_next_cas()
                    self.race_before_next_cas=None
                row=fake_cas(body.get('expected_sync_version'),
                    body.get('new_data'),body.get('writer_mode'))
            except Exception as exc:
                self.response(route,403,{'message':'synthetic reject','error_type':type(exc).__name__});return
            if self.drop_next_cas:
                self.drop_next_cas=False
                route.abort('failed');return
            name,version,updated,writer,base=row
            self.response(route,200,[{'status':name,'sync_version':version,
                  'updated_at':updated.isoformat() if updated else None,
                  'last_writer_mode':writer,'last_base_sync_version':base}])
            return
        # Direct PATCH through the old REST table must not be exercised
        # through the browser integration fixture. A separate SQL-only
        # test demonstrates this bypass risk without a public HTTP route.
        self.response(route,403,{'message':'UNSUPPORTED_FIXTURE_ENDPOINT'})
    def make_page(self,label):
        ctx=self.browser.new_context()
        self.contexts.append(ctx)
        ctx.route('**/*',lambda route:self.pg_bridge(route,label))
        page=ctx.new_page()
        page.goto(FIXTURE,wait_until='load')
        page.wait_for_function('Boolean(window.KuSheERPStore&&window.KusheCloudSync)')
        return page
    def ev(self,page,js):return page.evaluate(js)
    def seed(self,page,n='SYNTH-PC-CUSTOMER'):
        return self.ev(page,"async()=>await KuSheERPStore.saveCustomer({name:'"+n+"'})")
    def inspect(self,page):
        return self.ev(page,'async()=>await KusheCloudSync.inspect()')
    def upload(self,page):
        self.ev(page,'()=>{window.confirm=()=>true}')
        return self.ev(page,'async()=>await KusheCloudSync.uploadLocal()')

    def test_01_modules_actual_formal_source_and_origin_isolation(self):
        self.assertTrue(self.ev(self.page,
            "()=>typeof KuSheERPStore.saveCustomer==='function'"))
        self.assertTrue(self.ev(self.page,
            "()=>typeof KusheCloudSync.uploadLocal==='function'"))
        self.assertEqual(self.ev(self.page,'()=>location.origin'),SITE)
        self.assertFalse(self.nonlocal_requests)
    def test_02_initial_remote_empty_then_real_cloud_sync_cas_insert(self):
        self.seed(self.page)
        status=self.inspect(self.page)
        self.assertEqual(status['code'],'REMOTE_EMPTY',status)
        result=self.upload(self.page)
        self.assertEqual(result['code'],'UPLOAD_COMPLETE',result)
        row=current()
        self.assertIsNotNone(row)
        self.assertEqual(row[1],1)
        self.assertEqual(row[3],'trusted')
        self.assertIsNone(row[4])
        self.assertEqual(row[0]['customers'][0]['name'],'SYNTH-PC-CUSTOMER')
        self.assertEqual(self.inspect(self.page)['code'],'SYNCED')
    def test_03_consent_is_false_by_default_on_fixture(self):
        self.seed(self.page)
        result=self.ev(self.page,'async()=>await KusheCloudSync.uploadLocal()')
        self.assertEqual(result['code'],'CANCELLED',result)
        self.assertIsNone(current())
    def test_04_real_pg_server_versioned_cas_rejects_old_browser_rpc(self):
        self.seed(self.page);self.assertEqual(self.upload(self.page)['code'],'UPLOAD_COMPLETE')
        row=current()
        r1=fake_cas(1,row[0]);r2=fake_cas(1,row[0])
        self.assertEqual(r1[0],'APPLIED')
        self.assertEqual(r1[1],2)
        self.assertEqual(r2[0],'CONFLICT')
        self.assertEqual(current()[1],2)
    def test_05_browser_reloaded_actual_store_cannot_write_cloud_without_fresh_baseline(self):
        self.seed(self.page);self.assertEqual(self.upload(self.page)['code'],'UPLOAD_COMPLETE')
        self.page.reload(wait_until='load')
        self.ev(self.page,'async()=>await KuSheERPStore.load()')
        snap=self.ev(self.page,'async()=>await KuSheERPStore.readCommittedSnapshot()')
        self.assertEqual(snap['data']['customers'][0]['name'],'SYNTH-PC-CUSTOMER')
        self.assertEqual(self.inspect(self.page)['code'],'SYNCED')
        self.assertEqual(current()[1],1)
    def test_06_two_isolated_chrome_profiles_share_only_fake_pg_remote(self):
        self.seed(self.page)
        self.assertEqual(self.upload(self.page)['code'],'UPLOAD_COMPLETE')
        phone=self.make_page('SYNTH-PHONE')
        self.ev(phone,'async()=>await KuSheERPStore.load()')
        observed=self.inspect(phone)
        self.assertIn(observed['code'],
            ('LOCAL_EMPTY_REMOTE_EXISTS','REMOTE_NEWER','UNKNOWN_CONFLICT'),observed)
        self.assertEqual(current()[1],1)
        self.assertEqual(current()[0]['customers'][0]['name'],'SYNTH-PC-CUSTOMER')
        phone_local=self.ev(phone,'async()=>await KuSheERPStore.readCommittedSnapshot()')
        self.assertEqual(len(phone_local['data']['customers']),0)
    def test_07_browser_network_offline_no_cloud_write_and_local_still_preserved(self):
        self.seed(self.page)
        self.offline_labels.add('SYNTH-PC')
        observed=self.inspect(self.page)
        self.assertNotEqual(observed['code'],'SYNCED')
        self.assertIsNone(current())
        self.offline_labels.remove('SYNTH-PC')
        self.assertEqual(self.upload(self.page)['code'],'UPLOAD_COMPLETE')
        self.assertEqual(current()[1],1)
    def test_08_remote_cas_preemption_refuses_manual_upload_race(self):
        self.seed(self.page)
        snapshot=self.ev(self.page,
            'async()=> (await KuSheERPStore.readCommittedSnapshot()).data')
        # Another transaction inserts exactly this fake snapshot immediately
        # before this browser's real CloudSync CAS function is delivered.
        self.race_before_next_cas=lambda:fake_cas(None,snapshot,mode='temporary')
        result=self.upload(self.page)
        self.assertIn(result['code'],
            ('RACE_BLOCKED','TRUSTED_PRIORITY_AVAILABLE','SERVER_ERROR'),result)
        self.assertEqual(current()[1],1)
        self.assertEqual(current()[3],'temporary')
    def test_09_unknown_outcome_after_pg_committed_never_double_applies(self):
        self.seed(self.page)
        self.drop_next_cas=True
        outcome=self.upload(self.page)
        self.assertNotEqual(outcome['code'],'UPLOAD_COMPLETE')
        self.assertEqual(current()[1],1)
        observed=self.inspect(self.page)
        self.assertEqual(observed['code'],'SYNCED',observed)
        # A repeated POST with the old null expected version returns conflict.
        local=self.ev(self.page,
            'async()=> (await KuSheERPStore.readCommittedSnapshot()).data')
        self.assertEqual(fake_cas(None,local)[0],'CONFLICT')
        self.assertEqual(current()[1],1)
    def test_10_real_cloud_inspection_is_readonly(self):
        self.seed(self.page)
        self.inspect(self.page);self.inspect(self.page)
        self.assertIsNone(current())
        self.assertTrue(self.api_requests)
        self.assertFalse(any(m=='POST' for _,m,_ in self.api_requests))
    def test_11_real_store_corruption_blocks_upload_before_any_sql(self):
        self.seed(self.page)
        self.ev(self.page,
            """()=>localStorage.setItem('KuSheERP25_EMERGENCY','{"broken":true}')""")
        result=self.upload(self.page)
        self.assertNotEqual(result['code'],'UPLOAD_COMPLETE')
        self.assertIsNone(current())
    def test_12_financial_payload_rejected_by_fake_pg_validation(self):
        self.seed(self.page)
        snap=self.ev(self.page,
            'async()=> (await KuSheERPStore.readCommittedSnapshot()).data')
        snap['invoices']=[{'id':'SYNTH-FAKE-INVOICE'}]
        with self.assertRaises(psycopg.Error):
            fake_cas(None,snap)
        self.assertIsNone(current())
    def test_13_ledger_event_can_be_bypassed_by_current_legacy_cas_contract(self):
        self.seed(self.page);self.assertEqual(self.upload(self.page)['code'],'UPLOAD_COMPLETE')
        before=current()
        ledger_event('SYNTH-LEDGER-N')
        self.assertEqual(fence(),1)
        # This is intentionally an UNRESOLVED and NEGATIVE safety proof:
        # current formal CAS only has sync_version and knows nothing
        # about the hypothetical future allowance ledger fence.
        applied=fake_cas(1,before[0])
        self.assertEqual(applied[0],'APPLIED')
        self.assertEqual(current()[1],2)
        self.assertEqual(fence(),1)
        self.assertEqual(current()[0]['customers'][0]['name'],'SYNTH-PC-CUSTOMER')
    def test_14_old_direct_full_jsonb_write_bypasses_ledger_fence(self):
        self.seed(self.page);self.assertEqual(self.upload(self.page)['code'],'UPLOAD_COMPLETE')
        ledger_event('SYNTH-UNCOORDINATED-LEDGER')
        before=current()
        old=copy.deepcopy(before[0])
        old.setdefault('meta',{})['syntheticStaleCache']={'effectiveGross':632100}
        next_version=legacy_direct(old)
        self.assertEqual(next_version,2)
        self.assertEqual(current()[3],'legacy')
        self.assertEqual(current()[0]['meta']['syntheticStaleCache']['effectiveGross'],632100)
        self.assertEqual(fence(),1)
        # Fake only. The actual ERP may have additional checks; it MUST be
        # separately verified. No real user finance data is involved.
    def test_15_two_concurrent_postgresql_cas_commands_exactly_one_applies(self):
        self.seed(self.page);self.assertEqual(self.upload(self.page)['code'],'UPLOAD_COMPLETE')
        row=current();barrier=threading.Barrier(2)
        def one():
            barrier.wait(timeout=8)
            return fake_cas(1,row[0])[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            x=[pool.submit(one) for _ in range(2)]
            results=[f.result(timeout=12) for f in x]
        self.assertCountEqual(results,['APPLIED','CONFLICT'])
        self.assertEqual(current()[1],2)
    def test_16_wrong_user_or_financial_direct_http_access_rejected(self):
        self.seed(self.page)
        result=self.ev(self.page, """async()=>{
         let url='https://p40n-synthetic.invalid/rest/v1/erp_states?user_id=eq.SYNTH-OTHER&limit=1';
         let response=await fetch(url,{headers:{
          apikey:'SYNTH-P40N-LOCAL-KEY',Authorization:'Bearer SYNTH-P40N-LOCAL-TOKEN'}});
         return response.status;
        }""")
        self.assertEqual(result,403)
        self.assertIsNone(current())
    def test_17_nonlocal_external_network_traffic_never_reaches_real_cloud(self):
        self.seed(self.page);self.upload(self.page)
        self.assertFalse(self.nonlocal_requests)
        self.assertEqual({m for _,m,_ in self.api_requests}, {'GET','POST'})
        self.assertTrue(all(url.startswith('/rest/v1/') for _,_,url in self.api_requests))

if __name__=='__main__':
    unittest.main(verbosity=2)
