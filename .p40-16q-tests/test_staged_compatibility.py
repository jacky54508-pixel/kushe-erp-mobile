"""P40-16Q actual PostgreSQL 16 synthetic staged compatibility tests.

Single fictional tenant, fake devices, no real Supabase/ERP data. Explicitly
does NOT simulate complete legal financial posting or all real ERP business
invariants. Real financial writes after ledger event remain BLOCKED.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from urllib.parse import urlsplit
import copy
import json
import os
import unittest
import psycopg

ADMIN=os.getenv("P40Q_CI_ADMIN_DSN","")
CLIENT=os.getenv("P40Q_CI_CLIENT_DSN","")
for dsn,who in [(ADMIN,"postgres"),(CLIENT,"p40q_client")]:
    u=urlsplit(dsn)
    if u.hostname not in ("127.0.0.1","localhost") or u.path!="/p40_16q_ci" or u.username!=who:
        raise RuntimeError("P40-16Q must run on one-time localhost p40_16q_ci only")
OWNER="SYNTH-Q-OWNER"
BASE={"original":{"doc":"SYNTH-Q-BILL","gross":632100,"sourceIds":["SYNTH-A","SYNTH-B"]},
      "ledgerProjection":{"gross":632100},"ui":{"note":"base"},
      "daily":[],"projects":[],"billings":[],"receivables":[],"invoices":[],
      "receipts":[],"retentionReceipts":[],"materials":[],"payables":[],
      "payroll":[],"commissions":[],"bankTransactions":[],"settings":{}}
MODULES=("daily","projects","billings","receivables","invoices","receipts",
         "retentionReceipts","materials","payables","payroll","commissions",
         "bankTransactions")
def db(admin=False):
    return psycopg.connect(ADMIN if admin else CLIENT,connect_timeout=6)
def state():
    with db(admin=True) as c:
        return c.execute("SELECT phase,sync_version,ledger_version,snapshot "
          "FROM p40q_lab.fake_state WHERE owner=%s",(OWNER,)).fetchone()
def fake_events():
    with db(admin=True) as c:
        return c.execute("SELECT operation_key,kind,gross_delta,reversed_key "
          "FROM p40q_lab.fake_events ORDER BY created_at,operation_key").fetchall()
def write(kind,expected_sync,expected_ledger=None,payload=None,owner=OWNER):
    with db() as c:
        if kind=="legacy":
            return c.execute("SELECT * FROM p40q_lab.legacy_write(%s,%s,%s::jsonb)",
               (owner,expected_sync,json.dumps(payload if payload is not None else BASE))).fetchone()
        if kind=="modern":
            return c.execute("SELECT * FROM p40q_lab.modern_write(%s,%s,%s,%s::jsonb)",
               (owner,expected_sync,expected_ledger,
                json.dumps(payload if payload is not None else BASE))).fetchone()
        raise ValueError(kind)
def ack(client,version=2,pending=0,verified=True):
    with db(admin=True) as c:
        return c.execute("SELECT p40q_lab.admin_ack(%s,%s,%s,%s)",
                         (client,version,pending,verified)).fetchone()[0]
def phase(target,approved=False):
    with db(admin=True) as c:
        return c.execute("SELECT p40q_lab.admin_phase(%s,%s)",
                         (target,approved)).fetchone()[0]
def posted(key="SYNTH-Q-DISCOUNT",kind="discount",amount=32100,reverse=None,
           expected_sync=None,expected_ledger=None):
    s=state()
    sync=s[1] if expected_sync is None else expected_sync
    ledger=s[2] if expected_ledger is None else expected_ledger
    with db(admin=True) as c:
        return c.execute("SELECT * FROM p40q_lab.admin_fake_ledger(%s,%s,%s,%s,%s,%s)",
           (key,kind,amount,reverse,sync,ledger)).fetchone()
def updated(field=None,marker="SYNTH-ITEM-1",note="new"):
    v=copy.deepcopy(state()[3]);v["ui"]["note"]=note
    if field:v[field].append({"id":marker,"description":"synthetic entry","amount":100})
    return v
def ready():
    for client in ("SYNTH-PC","SYNTH-PHONE"):
        ack(client)
def guard():
    phase("shadow")
    ready()
    return phase("guarded",True)

class StagedCompatibility(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with db(admin=True) as conn:
            with psycopg.ClientCursor(conn) as cur:
                cur.execute(Path(".p40-16q-tests/staged_compatibility.sql").read_text())
    def setUp(self):
        with db(admin=True) as c:
            c.execute("DELETE FROM p40q_lab.fake_events")
            c.execute("UPDATE p40q_lab.fake_state SET phase='legacy',"
              "sync_version=1,ledger_version=0,snapshot=%s::jsonb WHERE owner=%s",
              (json.dumps(BASE),OWNER))
            c.execute("UPDATE p40q_lab.fake_clients SET generation=1,pending=0,"
              "backup_verified=false,last_ack_sync=NULL,last_ack_ledger=NULL")
    def test_01_initial_legacy_modules_and_versions(self):
        self.assertEqual(state(),("legacy",1,0,BASE))
        self.assertEqual(fake_events(),[])
    def test_02_full_twelve_synthetic_business_collections_legacy_supported(self):
        for n,module in enumerate(MODULES):
            s=state()
            v=updated(module,marker=f"SYNTH-{module}-{n}",note="legacy normal")
            self.assertEqual(write("legacy",s[1],payload=v)[0],"LEGACY_APPLIED")
        x=state()
        self.assertEqual(x[1],1+len(MODULES))
        for module in MODULES:self.assertEqual(len(x[3][module]),1)
        self.assertEqual(x[3]["ledgerProjection"]["gross"],632100)
    def test_03_shadow_mode_keeps_old_clients_operating_before_any_ledger(self):
        self.assertEqual(phase("shadow"),"SHADOW_ENABLED")
        s=state();v=updated("daily")
        self.assertEqual(write("legacy",s[1],payload=v)[0],"LEGACY_APPLIED")
        self.assertEqual(state()[3]["daily"][0]["id"],"SYNTH-ITEM-1")
        self.assertEqual(state()[0],"shadow")
    def test_04_new_modern_client_can_edit_12_modules_during_shadow(self):
        phase("shadow")
        for n,module in enumerate(MODULES):
            s=state()
            v=updated(module,marker=f"SYNTH-{module}-{n}",note="modern shadow")
            self.assertEqual(write("modern",s[1],s[2],v)[0],"MODERN_APPLIED")
        self.assertEqual(state()[1],2+len(MODULES))
        for module in MODULES:self.assertEqual(len(state()[3][module]),1)
    def test_05_modern_write_pre_shadow_is_denied(self):
        self.assertEqual(write("modern",1,0,updated())[0],"UPGRADE_NOT_STAGED")
        self.assertEqual(state()[1],1)
    def test_06_activation_requires_explicit_operator_ack(self):
        phase("shadow");ready()
        with self.assertRaises(psycopg.Error):phase("guarded",False)
        self.assertEqual(state()[0],"shadow")
    def test_07_activation_fails_if_any_device_unupgraded(self):
        phase("shadow")
        ack("SYNTH-PC")
        with self.assertRaises(psycopg.Error):phase("guarded",True)
        self.assertEqual(state()[0],"shadow")
    def test_08_activation_fails_if_offline_phone_has_unsynced_draft(self):
        phase("shadow")
        ack("SYNTH-PC")
        ack("SYNTH-PHONE",pending=2)
        with self.assertRaises(psycopg.Error):phase("guarded",True)
        self.assertEqual(state()[0],"shadow")
    def test_09_activation_fails_if_backup_unverified(self):
        phase("shadow")
        ack("SYNTH-PC")
        ack("SYNTH-PHONE",verified=False)
        with self.assertRaises(psycopg.Error):phase("guarded",True)
    def test_10_activation_fails_if_cloud_sync_newer_than_client_ack(self):
        phase("shadow");ready()
        s=state()
        self.assertEqual(write("legacy",s[1],payload=updated("projects"))[0],"LEGACY_APPLIED")
        with self.assertRaises(psycopg.Error):phase("guarded",True)
        # Re-acknowledging after last accepted business write permits staged gate.
        ready()
        self.assertEqual(phase("guarded",True),"GUARD_ENABLED_AFTER_DEVICE_DRAIN")
    def test_11_new_guard_retains_all_existing_business_modules(self):
        phase("shadow")
        s=state();v=updated("billings",note="existing fake invoice flow")
        write("legacy",s[1],payload=v)
        ready();phase("guarded",True)
        self.assertEqual(state()[3]["billings"],v["billings"])
        self.assertEqual(state()[3]["ui"],v["ui"])
    def test_12_pre_ledger_guard_rejects_old_client_and_preserves_draft(self):
        guard()
        old=updated("daily",note="offline old client")
        before=state()
        self.assertEqual(write("legacy",before[1],payload=old)[0],"UPGRADE_REQUIRED")
        self.assertEqual(state(),before)
        self.assertNotEqual(old["daily"],state()[3]["daily"])
    def test_13_new_guarded_client_accepts_pre_ledger_business_mutation(self):
        guard()
        s=state()
        self.assertEqual(write("modern",s[1],s[2],updated("receipts"))[0],"MODERN_APPLIED")
        self.assertEqual(state()[3]["receipts"][0]["id"],"SYNTH-ITEM-1")
    def test_14_fence_checks_both_versions_and_rejects_stale_data(self):
        guard();s=state()
        self.assertEqual(write("modern",s[1]-1,s[2],updated())[0],"CONFLICT")
        self.assertEqual(write("modern",s[1],s[2]+1,updated())[0],"CONFLICT")
        self.assertEqual(state(),s)
    def test_15_unauthorized_financial_projection_overwrite_blocked(self):
        guard()
        s=state();v=updated("daily")
        v["ledgerProjection"]["gross"]=1
        with self.assertRaises(psycopg.Error):write("modern",s[1],s[2],v)
        self.assertEqual(state(),s)
    def test_16_unknown_real_document_data_blocked_before_ledger(self):
        guard();s=state()
        for field in ("customers","fakeRLS","unapprovedLedger"):
            v=updated()
            v[field]=[{"id":"SYNTH-ADDED"}]
            with self.assertRaises(psycopg.Error):write("modern",s[1],s[2],v)
        v=updated("daily",marker="REAL-BILLING")
        with self.assertRaises(psycopg.Error):write("modern",s[1],s[2],v)
    def test_17_posted_synthetic_event_is_atomic_and_original_unchanged(self):
        guard()
        s=state()
        self.assertEqual(posted()[0],"POSTED_SYNTHETIC")
        t=state()
        self.assertEqual(t[1],s[1]+1)
        self.assertEqual(t[2],1)
        self.assertEqual(t[3]["ledgerProjection"]["gross"],600000)
        self.assertEqual(t[3]["original"],BASE["original"])
        self.assertEqual(len(fake_events()),1)
    def test_18_legacy_writes_after_ledger_fenced(self):
        guard();posted();s=state()
        self.assertEqual(write("legacy",s[1],payload=updated("payroll"))[0],"UPGRADE_REQUIRED")
        self.assertEqual(state(),s)
    def test_19_business_writes_after_ledger_block_not_false_claim_of_feature_support(self):
        guard();posted();s=state()
        for field in MODULES:
            with self.subTest(field=field):
                with self.assertRaises(psycopg.Error):
                    write("modern",s[1],s[2],updated(field))
        self.assertEqual(state(),s)
    def test_20_after_ledger_new_client_can_update_only_ui_note(self):
        guard();posted();s=state()
        self.assertEqual(write("modern",s[1],s[2],updated(note="safe UI note"))[0],
                         "MODERN_APPLIED")
        self.assertEqual(state()[3]["ledgerProjection"]["gross"],600000)
        self.assertEqual(len(fake_events()),1)
    def test_21_settings_write_after_ledger_blocked(self):
        guard();posted();s=state()
        v=updated();v["settings"]["taxSetting"]=0
        with self.assertRaises(psycopg.Error):write("modern",s[1],s[2],v)
    def test_22_posting_without_guard_blocked(self):
        with self.assertRaises(psycopg.Error):posted()
        self.assertEqual(fake_events(),[])
    def test_23_guard_rollback_only_before_any_event(self):
        guard()
        self.assertEqual(phase("shadow"),"PRE_LEDGER_ROLLBACK")
        s=state()
        self.assertEqual(write("legacy",s[1],payload=updated("materials"))[0],"LEGACY_APPLIED")
        self.assertEqual(phase("legacy"),"PRE_LEDGER_ROLLBACK")
    def test_24_guard_rollback_after_event_fails_closed(self):
        guard();posted()
        with self.assertRaises(psycopg.Error):phase("shadow")
        with self.assertRaises(psycopg.Error):phase("legacy")
        self.assertEqual(state()[0],"guarded")
    def test_25_replay_existing_operation_does_not_double_post(self):
        guard();posted()
        s=state()
        self.assertEqual(posted(expected_sync=1,expected_ledger=0)[0],"REPLAY")
        self.assertEqual(state(),s)
    def test_26_replay_key_different_amount_blocked(self):
        guard();posted()
        with self.assertRaises(psycopg.Error):posted(amount=1)
        self.assertEqual(len(fake_events()),1)
    def test_27_discount_and_reversal_append_and_original_unchanged(self):
        guard();posted()
        self.assertEqual(posted("SYNTH-Q-REVERSE","reversal",32100,"SYNTH-Q-DISCOUNT")[0],
                         "POSTED_SYNTHETIC")
        self.assertEqual(state()[3]["ledgerProjection"]["gross"],632100)
        self.assertEqual([x[1] for x in fake_events()],["discount","reversal"])
        self.assertEqual(state()[3]["original"],BASE["original"])
    def test_28_double_reversal_blocked(self):
        guard();posted()
        posted("SYNTH-Q-REVERSE","reversal",32100,"SYNTH-Q-DISCOUNT")
        with self.assertRaises(psycopg.Error):
            posted("SYNTH-Q-REVERSE-2","reversal",32100,"SYNTH-Q-DISCOUNT")
        self.assertEqual(len(fake_events()),2)
    def test_29_wrong_owner_or_direct_table_dml_denied(self):
        s=state()
        with self.assertRaises(psycopg.Error):
            write("legacy",s[1],owner="SYNTH-OTHER")
        for cmd in (
         "UPDATE p40q_lab.fake_state SET sync_version=99",
         "DELETE FROM p40q_lab.fake_state",
         "INSERT INTO p40q_lab.fake_events(operation_key,kind,gross_delta)"
         " VALUES('SYNTH-BYPASS','discount',100)"
        ):
            with self.assertRaises(psycopg.Error):
                with db() as c:c.execute(cmd)
        self.assertEqual(state(),s)
    def test_30_client_cannot_modify_phase_or_fake_post_via_function(self):
        for sql in (
            "SELECT p40q_lab.admin_phase('guarded',true)",
            "SELECT p40q_lab.admin_ack('SYNTH-PC',2,0,true)",
            "SELECT * FROM p40q_lab.admin_fake_ledger("
               "'SYNTH-BYPASS','discount',10,NULL,1,0)",
        ):
            with self.assertRaises(psycopg.Error):
                with db() as c:c.execute(sql)
        self.assertEqual(state()[0],"legacy")
    def test_31_two_modern_clients_compete_one_wins(self):
        guard();s=state();barrier=Barrier(2)
        def f(n):
            barrier.wait(timeout=12)
            return write("modern",s[1],s[2],updated("projects",marker="SYNTH-"+n))[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            fs=[pool.submit(f,n) for n in ("PC","PHONE")]
            out=[v.result(timeout=20) for v in fs]
        self.assertCountEqual(out,["MODERN_APPLIED","CONFLICT"])
        self.assertEqual(state()[1],s[1]+1)
    def test_32_posted_ledger_and_modern_write_compete_one_wins(self):
        guard();s=state();barrier=Barrier(2)
        def put():
            barrier.wait(timeout=12)
            return write("modern",s[1],s[2],updated("projects"))[0]
        def book():
            barrier.wait(timeout=12)
            return posted(expected_sync=s[1],expected_ledger=s[2])[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(put),pool.submit(book)]
            results=[x.result(timeout=20) for x in futures]
        self.assertEqual(results.count("CONFLICT"),1)
        self.assertEqual(results.count("MODERN_APPLIED")+results.count("POSTED_SYNTHETIC"),1)
        self.assertEqual(state()[1],s[1]+1)
    def test_33_shadow_no_finance_event_until_guard(self):
        phase("shadow")
        with self.assertRaises(psycopg.Error):posted()
        self.assertEqual(state()[2],0)
    def test_34_status_prerequisites_not_automatically_satisfied_by_known_user_only(self):
        phase("shadow")
        ack("SYNTH-PC",2,0,True)
        ack("SYNTH-PHONE",1,0,True)
        with self.assertRaises(psycopg.Error):phase("guarded",True)
    def test_35_unknown_devices_cannot_be_guaranteed_by_ci_register(self):
        # This is intentionally only a known-device registry; a real old
        # offline phone unknown to the system is NOT provably absent.
        with db(admin=True) as c:
            count=c.execute("SELECT count(*) FROM p40q_lab.fake_clients").fetchone()[0]
        self.assertEqual(count,2)
        self.assertNotIn("unknown_clients",state()[3])
    def test_36_test_sql_never_touches_public_erp_or_financial_real_data(self):
        src=Path(".p40-16q-tests/staged_compatibility.sql").read_text()
        self.assertNotIn("public.erp_states",src)
        self.assertNotIn("supabase.co",src)
        self.assertNotIn("jimcybsztnwfzrnvexsp",src)
        self.assertNotIn("KuSheERP25_Core34_DB",src)

if __name__=="__main__":
    unittest.main(verbosity=2)
