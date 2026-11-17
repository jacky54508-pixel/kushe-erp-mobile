"""P40-16P real PostgreSQL 16 disposable test. PostgreSQL admin/limited
client are BOTH synthetic. NEVER connect to actual Supabase or real ERP.
This one-tenant lab validates dual-version fencing, NOT Supabase Auth/JWT.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse
from threading import Barrier
import copy
import json
import os
import unittest
import psycopg

ADMIN_DSN=os.environ.get("P40P_LOCAL_ADMIN_DSN","")
CLIENT_DSN=os.environ.get("P40P_LOCAL_CLIENT_DSN","")
def assert_local_dsn(dsn, user):
    v=urlparse(dsn)
    if v.hostname not in ("127.0.0.1","localhost") or v.path!="/p40_16p_ci" or v.username!=user:
        raise RuntimeError("P40-16P refuses connection to nonisolated PostgreSQL")
assert_local_dsn(ADMIN_DSN,"postgres")
assert_local_dsn(CLIENT_DSN,"p40p_client")

TENANT="SYNTH-OWNER-P40P"
BASE={
 "original":{"documentId":"SYNTH-BILLING-P40P","gross":632100,
             "sourceIds":["SYNTH-A","SYNTH-B"]},
 "financialProjection":{"gross":632100},
 "ui":{"note":"baseline"},
}
def conn(admin=False):
    return psycopg.connect(ADMIN_DSN if admin else CLIENT_DSN,connect_timeout=5)
def snapshot():
    with conn(admin=True) as db:
        return db.execute(
         "SELECT sync_version,ledger_version,mode,data FROM p40p_lab.fake_snapshot "
         "WHERE tenant=%s",(TENANT,)).fetchone()
def events():
    with conn(admin=True) as db:
        return db.execute("SELECT operation_key,kind,amount,reverses_key "
            "FROM p40p_lab.fake_events ORDER BY id").fetchall()
def legacy(expected,data=None,tenant=TENANT):
    with conn() as db:
        return db.execute(
         "SELECT * FROM p40p_lab.legacy_sync(%s,%s,%s::jsonb)",
         (tenant,expected,json.dumps(BASE if data is None else data))).fetchone()
def fenced(expected_sync,expected_ledger,data=None,tenant=TENANT):
    with conn() as db:
        return db.execute(
         "SELECT * FROM p40p_lab.fenced_sync(%s,%s,%s,%s::jsonb)",
         (tenant,expected_sync,expected_ledger,
          json.dumps(BASE if data is None else data))).fetchone()
def toggle(on=True):
    with conn(admin=True) as db:
        return db.execute("SELECT p40p_lab.admin_set_guard(%s)",(on,)).fetchone()[0]
def post(key="SYNTH-DISCOUNT-1",kind="discount",amount=32100,
         reverse=None,sync=None,ledger=None):
    if sync is None or ledger is None:
        s=snapshot()
        if sync is None:sync=s[0]
        if ledger is None:ledger=s[1]
    with conn(admin=True) as db:
        return db.execute("SELECT * FROM p40p_lab.admin_post_event(%s,%s,%s,%s,%s,%s)",
         (key,kind,amount,reverse,sync,ledger)).fetchone()
def edited(note):
    v=copy.deepcopy(BASE);v["ui"]["note"]=note;return v

class FencedSyntheticSync(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with conn(admin=True) as db:
            # SQL can include multiple commands/CREATE FUNCTION in ClientCursor;
            # it runs on a fresh disposable CI PG service, never elsewhere.
            with psycopg.ClientCursor(db) as cursor:
                cursor.execute(Path(".p40-16p-tests/disposable_all_writers_fence.sql").read_text())
    def setUp(self):
        with conn(admin=True) as db:
            db.execute("DELETE FROM p40p_lab.fake_events")
            db.execute("UPDATE p40p_lab.fake_snapshot SET "
             "sync_version=1,ledger_version=0,mode='legacy_compatible',"
             "data=%s::jsonb,updated_at=clock_timestamp() WHERE tenant=%s",
             (json.dumps(BASE),TENANT))

    def test_01_fake_pg_uses_its_own_schema_and_tenant(self):
        self.assertEqual(snapshot()[:3],(1,0,"legacy_compatible"))
        self.assertEqual(snapshot()[3],BASE)
        self.assertEqual(events(),[])
    def test_02_regular_legacy_sync_before_activation_is_available(self):
        self.assertEqual(legacy(1,edited("client preguard")),( "APPLIED_LEGACY",2,0))
        self.assertEqual(snapshot()[3]["ui"]["note"],"client preguard")
    def test_03_stale_legacy_CAS_fails_without_overwriting_state(self):
        legacy(1,edited("committed"))
        self.assertEqual(legacy(1,edited("stale"))[0],"CONFLICT")
        self.assertEqual(snapshot()[3]["ui"]["note"],"committed")
    def test_04_missing_ledger_version_not_allowed_in_guarded_mode(self):
        toggle(True)
        s=snapshot()
        self.assertEqual(legacy(s[0],edited("unsafe old"))[0],"UPGRADE_REQUIRED")
        self.assertEqual(snapshot()[3]["ui"]["note"],"baseline")
    def test_05_pre_activation_guarded_RPC_refuses_new_client(self):
        self.assertEqual(fenced(1,0,edited("modern"))[0],"GUARD_NOT_ENABLED")
        self.assertEqual(snapshot()[0],1)
    def test_06_after_guard_dual_version_modern_UI_sync_succeeds(self):
        toggle(True)
        s=snapshot()
        self.assertEqual(fenced(s[0],s[1],edited("modern safe"))[0],"APPLIED_GUARDED")
        s2=snapshot()
        self.assertEqual(s2[:3],(s[0]+1,0,"guarded"))
        self.assertEqual(s2[3]["ui"]["note"],"modern safe")
        self.assertEqual(s2[3]["financialProjection"]["gross"],632100)
    def test_07_guarded_RPC_requires_the_real_current_sync_version(self):
        toggle(True);s=snapshot()
        self.assertEqual(fenced(1,s[1],edited("old"))[0],"CONFLICT")
        self.assertEqual(snapshot()[3]["ui"]["note"],"baseline")
    def test_08_guarded_RPC_checks_ledger_even_with_matching_sync(self):
        toggle(True);post()
        s=snapshot()
        self.assertEqual(fenced(s[0],0,edited("wrong ledger"))[0],"CONFLICT")
        self.assertEqual(snapshot()[3]["ui"]["note"],"baseline")
    def test_09_ledger_event_atomically_updates_projection_and_dual_versions(self):
        toggle(True);s=snapshot()
        v=post(sync=s[0],ledger=s[1])
        self.assertEqual(v[0],"POSTED")
        after=snapshot()
        self.assertEqual(after[0],s[0]+1)
        self.assertEqual(after[1],s[1]+1)
        self.assertEqual(after[3]["original"],BASE["original"])
        self.assertEqual(after[3]["financialProjection"]["gross"],600000)
        self.assertEqual(events(),[("SYNTH-DISCOUNT-1","discount",32100,None)])
    def test_10_pending_legacy_offline_snapshot_rejected_after_event(self):
        old=edited("offline-from-old-phone")
        toggle(True);post()
        s=snapshot()
        self.assertEqual(legacy(s[0],old)[0],"UPGRADE_REQUIRED")
        self.assertEqual(snapshot()[3]["financialProjection"]["gross"],600000)
    def test_11_posted_projection_is_read_only_to_client_even_modern(self):
        toggle(True);post()
        s=snapshot();malicious=copy.deepcopy(s[3])
        malicious["financialProjection"]["gross"]=632100
        with self.assertRaises(psycopg.Error):
            fenced(s[0],s[1],malicious)
        self.assertEqual(snapshot()[3]["financialProjection"]["gross"],600000)
    def test_12_client_cannot_modify_issued_or_payroll_like_new_keys(self):
        toggle(True)
        s=snapshot()
        for key in ("billings","receivables","invoices","bankTransactions",
                    "payroll","salaryPayments","commissions","retentionReceipts"):
            with self.subTest(key=key):
                malicious=copy.deepcopy(s[3]);malicious[key]=[{"amount":999999}]
                with self.assertRaises(psycopg.Error):
                    fenced(s[0],s[1],malicious)
        self.assertEqual(snapshot()[0],s[0])
        self.assertEqual(events(),[])
    def test_13_event_operation_key_idempotent_and_does_not_duplicate(self):
        toggle(True);a=post()
        b=post(sync=2,ledger=0) # duplicate key even with stale versions
        self.assertEqual((a[0],b[0]),("POSTED","DUPLICATE"))
        self.assertEqual(len(events()),1)
        self.assertEqual(snapshot()[1],1)
    def test_14_same_key_with_different_payload_is_rejected(self):
        toggle(True);post()
        with self.assertRaises(psycopg.Error):
            post(amount=1)
        self.assertEqual(snapshot()[3]["financialProjection"]["gross"],600000)
    def test_15_reversal_appends_compensating_event_and_restores_projection(self):
        toggle(True);post()
        a=post(key="SYNTH-REVERSAL-1",kind="reversal",amount=32100,
               reverse="SYNTH-DISCOUNT-1")
        self.assertEqual(a[0],"POSTED")
        self.assertEqual(snapshot()[3]["financialProjection"]["gross"],632100)
        self.assertEqual(snapshot()[1],2)
        self.assertEqual([x[1] for x in events()],["discount","reversal"])
    def test_16_double_reversal_disallowed_even_with_different_op_key(self):
        toggle(True);post()
        post(key="SYNTH-REVERSAL-1",kind="reversal",reverse="SYNTH-DISCOUNT-1")
        with self.assertRaises(psycopg.Error):
            post(key="SYNTH-REVERSAL-2",kind="reversal",reverse="SYNTH-DISCOUNT-1")
        self.assertEqual(snapshot()[1],2)
        self.assertEqual(len(events()),2)
    def test_17_invalid_reversal_aborts_entire_transaction(self):
        toggle(True);post()
        before=snapshot()
        with self.assertRaises(psycopg.Error):
            post(key="SYNTH-REVERSE-INVALID",kind="reversal",amount=5000,
                 reverse="SYNTH-DISCOUNT-1")
        self.assertEqual(snapshot(),before)
        self.assertEqual(len(events()),1)
    def test_18_stale_post_conflicts_without_adding_event(self):
        toggle(True);s=snapshot()
        fenced(s[0],s[1],edited("newer UI"))
        self.assertEqual(post(sync=s[0],ledger=s[1])[0],"CONFLICT")
        self.assertEqual(events(),[])
    def test_19_can_revert_compatibility_mode_only_before_any_ledger_event(self):
        self.assertEqual(toggle(True),"GUARD_ENABLED")
        self.assertEqual(toggle(False),"GUARD_DISABLED_PRE_LEDGER")
        s=snapshot();self.assertEqual(s[2],"legacy_compatible")
        self.assertEqual(legacy(s[0],edited("legacy works again"))[0],"APPLIED_LEGACY")
    def test_20_guard_reversal_after_ledger_is_blocked(self):
        toggle(True);post()
        with self.assertRaises(psycopg.Error):toggle(False)
        self.assertEqual(snapshot()[2],"guarded")
        self.assertEqual(len(events()),1)
    def test_21_client_has_select_but_no_direct_dml_or_ledger_rpc(self):
        with conn() as db:
            c=db.execute("SELECT has_table_privilege(current_user,'p40p_lab.fake_snapshot','SELECT'),"
              "has_table_privilege(current_user,'p40p_lab.fake_snapshot','UPDATE'),"
              "has_table_privilege(current_user,'p40p_lab.fake_snapshot','INSERT'),"
              "has_table_privilege(current_user,'p40p_lab.fake_events','INSERT'),"
              "has_function_privilege(current_user,"
              "'p40p_lab.admin_post_event(text,text,integer,text,bigint,bigint)','EXECUTE')").fetchone()
        self.assertEqual(c,(True,False,False,False,False))
    def test_22_client_direct_update_insert_delete_all_denied(self):
        sqls=[
          "UPDATE p40p_lab.fake_snapshot SET sync_version=9 WHERE tenant=%s",
          "DELETE FROM p40p_lab.fake_snapshot WHERE tenant=%s",
          "INSERT INTO p40p_lab.fake_events(tenant,operation_key,kind,amount) "
          "VALUES(%s,'SYNTH-BYPASS','discount',1)",
        ]
        for sql in sqls:
            with self.subTest(sql=sql):
                with self.assertRaises(psycopg.Error):
                    with conn() as db:db.execute(sql,(TENANT,))
        self.assertEqual(snapshot()[:2],(1,0))
    def test_23_client_cannot_call_server_only_guard_or_post_event(self):
        for sql,params in [
            ("SELECT p40p_lab.admin_set_guard(true)",()),
            ("SELECT * FROM p40p_lab.admin_post_event(%s,%s,%s,%s,%s,%s)",
               ("SYNTH-UNAUTHORIZED","discount",10,None,1,0)),
        ]:
            with self.subTest(sql=sql):
                with self.assertRaises(psycopg.Error):
                    with conn() as db:db.execute(sql,params)
        self.assertEqual(snapshot()[2],"legacy_compatible")
    def test_24_wrong_tenant_is_rejected_by_either_client_RPC(self):
        for submit in [
            lambda:legacy(1,tenant="SYNTH-OTHER"),
            lambda:fenced(1,0,tenant="SYNTH-OTHER"),
        ]:
            with self.assertRaises(psycopg.Error):submit()
    def test_25_shared_claim_GUC_is_not_mistaken_for_verified_authority(self):
        with conn() as db:
            db.execute("SELECT set_config('request.jwt.claim.sub','SYNTH-ADMIN',false)")
            with self.assertRaises(psycopg.Error):
                db.execute("SELECT p40p_lab.admin_set_guard(true)")
        self.assertEqual(snapshot()[2],"legacy_compatible")
    def test_26_two_concurrent_guarded_writers_are_serialized_by_row_lock(self):
        toggle(True);s=snapshot();barrier=Barrier(2)
        def work(name):
            barrier.wait(timeout=10)
            return fenced(s[0],s[1],edited(name))[0]
        with ThreadPoolExecutor(max_workers=2) as ex:
            fs=[ex.submit(work,x) for x in ["PC","PHONE"]]
            out=[x.result(timeout=20) for x in fs]
        self.assertCountEqual(out,["APPLIED_GUARDED","CONFLICT"])
        self.assertEqual(snapshot()[0],s[0]+1)
    def test_27_ledger_post_and_guarded_writer_with_old_snapshot_compete(self):
        toggle(True);s=snapshot();barrier=Barrier(2)
        def app():
            barrier.wait(timeout=10)
            return fenced(s[0],s[1],edited("from PC"))[0]
        def book():
            barrier.wait(timeout=10)
            return post(sync=s[0],ledger=s[1])[0]
        with ThreadPoolExecutor(max_workers=2) as ex:
            tasks=[ex.submit(app),ex.submit(book)]
            out=[x.result(timeout=20) for x in tasks]
        self.assertEqual(out.count("CONFLICT"),1)
        self.assertEqual(out.count("POSTED")+out.count("APPLIED_GUARDED"),1)
        self.assertEqual(snapshot()[0],s[0]+1)
        self.assertEqual(snapshot()[1],1 if "POSTED" in out else 0)
    def test_28_two_concurrent_same_key_bookings_are_idempotent(self):
        toggle(True);s=snapshot();barrier=Barrier(2)
        def book():
            barrier.wait(timeout=10)
            return post(sync=s[0],ledger=s[1])[0]
        with ThreadPoolExecutor(max_workers=2) as ex:
            vals=[ex.submit(book) for _ in range(2)]
            outcomes=[v.result(timeout=20) for v in vals]
        self.assertCountEqual(outcomes,["POSTED","DUPLICATE"])
        self.assertEqual(snapshot()[1],1)
        self.assertEqual(len(events()),1)
    def test_29_post_event_does_not_enable_unauthorized_client_finance_changes(self):
        toggle(True);post()
        s=snapshot()
        # A clean current snapshot with ONLY non-financial UI change is allowed.
        new=copy.deepcopy(s[3]);new["ui"]["note"]="note after fictitious discount"
        self.assertEqual(fenced(s[0],s[1],new)[0],"APPLIED_GUARDED")
        self.assertEqual(snapshot()[3]["financialProjection"]["gross"],600000)
        self.assertEqual(len(events()),1)
    def test_30_no_real_erp_module_or_migration_in_test_sql(self):
        src=Path(".p40-16p-tests/disposable_all_writers_fence.sql").read_text()
        self.assertIn("NOT A SUPABASE MIGRATION",src)
        self.assertNotIn("public.erp_states",src)
        self.assertNotIn("jimcybsztnwfzrnvexsp",src)
        self.assertFalse(Path("index.html").read_text().find("p40-16p")>=0)

if __name__=="__main__":
    unittest.main(verbosity=2)
