"""P40-16J: disposable localhost Postgres JSONB sync vs ledger race tests.

All SYNTH-* records fictional. No Supabase credentials, JWTs, browser storage,
real invoices, customer payments, commissions or paid payroll are involved.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit
import json
import os
import threading
import unittest
import psycopg

DSN=os.getenv("P40J_EPHEMERAL_DSN","")
parts=urlsplit(DSN)
if not DSN or parts.hostname not in ("localhost","127.0.0.1") or parts.path!="/p40_16j_ci":
    raise RuntimeError("Never connect outside CI local synthetic PostgreSQL")
def connect():
    return psycopg.connect(DSN,connect_timeout=7)

def invoke(role,proc,args):
    if role not in ("p40j_client","p40j_operator"):
        raise RuntimeError("Synthetic privilege role required")
    with connect() as db:
        db.execute("SET LOCAL ROLE "+role)
        sig=", ".join(["%s"]*len(args))
        return db.execute("SELECT p40j_ci."+proc+"("+sig+")",args).fetchone()[0]

def payload(note="synthetic note"):
    return {"original":{"untaxed":602000,"tax":30100,"gross":632100,
                        "retention":0,"receivable":632100},
            "ui":{"note":note}}
def sync(expected_sync=1,expected_ledger=0,note="updated",body=None):
    return invoke("p40j_client","safe_snapshot_sync",(
        "SYNTH-MERGED-A",expected_sync,expected_ledger,
        json.dumps(payload(note) if body is None else body)))
def allowance(expected_sync=1,expected_ledger=0,
              event="SYNTH-ALLOW-1",key="SYNTH-ALLOW-KEY",gross=32100,
              doc="SYNTH-MERGED-A"):
    return invoke("p40j_operator","simulate_allowance",(
        doc,expected_sync,expected_ledger,event,key,gross))
def reversal(expected_sync=1,expected_ledger=1,
             event="SYNTH-REVERSE-1",key="SYNTH-REVERSE-KEY",
             parent="SYNTH-ALLOW-1",doc="SYNTH-MERGED-A"):
    return invoke("p40j_operator","simulate_reversal",(
        doc,expected_sync,expected_ledger,parent,event,key))
def state(doc="SYNTH-MERGED-A"):
    with connect() as db:
        return db.execute("SELECT original_gross,net_discount,projected_gross,"
            "event_count,sync_version,ledger_version "
            "FROM p40j_ci.fake_projection WHERE document_id=%s",(doc,)).fetchone()
def audit():
    with connect() as db:
        return db.execute("SELECT event_id,event_kind,gross_delta,reverses_event_id "
            "FROM p40j_ci.fake_ledger ORDER BY created_at,event_revision").fetchall()

class JsonbLedgerRace(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as db:
            with psycopg.ClientCursor(db) as c:
                c.execute(Path(__file__).with_name("isolated_sync_ledger.sql").read_text())
    def setUp(self):
        with connect() as db:
            db.execute("TRUNCATE p40j_ci.fake_ledger")
            db.execute("UPDATE p40j_ci.fake_snapshots SET "
                       "data=%s::jsonb,sync_version=1,ledger_version=0 "
                       "WHERE document_id='SYNTH-MERGED-A'",(json.dumps(payload("synthetic baseline")),))
            b={"original":{"untaxed":400000,"tax":20000,"gross":420000,
                           "retention":0,"receivable":420000},
               "ui":{"note":"second synthetic document"}}
            db.execute("UPDATE p40j_ci.fake_snapshots SET data=%s::jsonb,"
                       "sync_version=1,ledger_version=0 "
                       "WHERE document_id='SYNTH-MERGED-B'",(json.dumps(b),))

    def test_one_synthetic_allowance_projects_without_original_change(self):
        self.assertEqual(allowance(),"SIMULATED_ALLOWANCE_APPENDED")
        self.assertEqual(state(),(632100,32100,600000,1,1,1))
        with connect() as db:
            data=db.execute("SELECT data FROM p40j_ci.fake_snapshots "
                            "WHERE document_id='SYNTH-MERGED-A'").fetchone()[0]
        self.assertEqual(data["original"]["gross"],632100)
        self.assertNotIn("adjustedReceivable",data)
        self.assertNotIn("discount",data)
    def test_duplicate_command_same_content_replays_and_changed_payload_fails(self):
        self.assertEqual(allowance(),"SIMULATED_ALLOWANCE_APPENDED")
        self.assertEqual(allowance(),"REPLAY")
        for kwargs in ({"gross":32000},{"event":"SYNTH-CHANGED"}):
            with self.assertRaises(psycopg.Error):
                allowance(**kwargs)
        self.assertEqual(state(),(632100,32100,600000,1,1,1))
    def test_stale_full_jsonb_snapshot_after_ledger_update_blocked(self):
        allowance()
        with self.assertRaises(psycopg.Error):
            sync(expected_sync=1,expected_ledger=0)
        self.assertEqual(state(),(632100,32100,600000,1,1,1))
    def test_reloaded_finance_version_allows_only_note_edit(self):
        allowance()
        self.assertEqual(sync(1,1,"safe note"),"SYNTHETIC_SYNCED")
        self.assertEqual(state(),(632100,32100,600000,1,2,1))
        with connect() as db:
            value=db.execute("SELECT data->'ui'->>'note' FROM p40j_ci.fake_snapshots "
                             "WHERE document_id='SYNTH-MERGED-A'").fetchone()[0]
        self.assertEqual(value,"safe note")
    def test_legacy_snapshot_cannot_directly_put_discount_or_effective_ar(self):
        altered=payload()
        altered["adjustedReceivable"]=600000
        for bad in (
            altered,
            {"original":{**payload()["original"],"gross":600000},"ui":{"note":"bad"}},
            {"original":payload()["original"],"ui":{"note":"bad","effectiveAr":600000}},
            {"original":payload()["original"],"ui":{"note":4}},
        ):
            with self.assertRaises(psycopg.Error):
                sync(body=bad)
        self.assertEqual(state(),(632100,0,632100,0,1,0))
    def test_client_can_read_but_direct_snapshot_event_dml_denied(self):
        for statement in (
            "UPDATE p40j_ci.fake_snapshots SET data='{}'::jsonb "
            "WHERE document_id='SYNTH-MERGED-A'",
            "INSERT INTO p40j_ci.fake_ledger (event_id) VALUES ('SYNTH-EVIL')",
            "DELETE FROM p40j_ci.fake_snapshots WHERE document_id='SYNTH-MERGED-A'",
            "CREATE TABLE p40j_ci.rogue_table(id text)"
        ):
            with self.assertRaises(psycopg.Error):
                with connect() as db:
                    db.execute("SET LOCAL ROLE p40j_client")
                    db.execute(statement)
        with self.assertRaises(psycopg.Error):
            invoke("p40j_client","simulate_allowance",(
                "SYNTH-MERGED-A",1,0,"SYNTH-EVENT","SYNTH-KEY",1000))
        self.assertEqual(state(),(632100,0,632100,0,1,0))
    def test_operator_cannot_rewrite_entire_snapshot(self):
        with self.assertRaises(psycopg.Error):
            invoke("p40j_operator","safe_snapshot_sync",(
                "SYNTH-MERGED-A",1,0,json.dumps(payload())))
    def test_simultaneous_legacy_sync_and_new_allowance_are_serialized(self):
        barrier=threading.Barrier(2)
        def task(which):
            barrier.wait(timeout=8)
            try:
                return sync(note="race") if which=="sync" else allowance()
            except psycopg.Error:
                return "CAS_REJECTED"
        with ThreadPoolExecutor(max_workers=2) as pool:
            fs=[pool.submit(task,what) for what in ("sync","allowance")]
            result=[f.result(timeout=17) for f in fs]
        self.assertIn(result,[
            ["SYNTHETIC_SYNCED","CAS_REJECTED"],
            ["CAS_REJECTED","SIMULATED_ALLOWANCE_APPENDED"]])
        self.assertIn(state(),[
            (632100,0,632100,0,2,0),
            (632100,32100,600000,1,1,1)])
    def test_two_identical_concurrent_allowances_are_idempotent(self):
        barrier=threading.Barrier(2)
        def call():
            barrier.wait(timeout=8)
            return allowance()
        with ThreadPoolExecutor(max_workers=2) as pool:
            fs=[pool.submit(call) for _ in range(2)]
            out=[f.result(timeout=17) for f in fs]
        self.assertCountEqual(out,["SIMULATED_ALLOWANCE_APPENDED","REPLAY"])
        self.assertEqual(state(),(632100,32100,600000,1,1,1))
    def test_two_different_events_same_version_conflict(self):
        barrier=threading.Barrier(2)
        def call(n):
            barrier.wait(timeout=8)
            try:
                return allowance(event=f"SYNTH-ALLOW-{n}",key=f"SYNTH-KEY-{n}")
            except psycopg.Error:
                return "CAS_REJECTED"
        with ThreadPoolExecutor(max_workers=2) as pool:
            fs=[pool.submit(call,n) for n in (1,2)]
            out=[f.result(timeout=17) for f in fs]
        self.assertCountEqual(out,["SIMULATED_ALLOWANCE_APPENDED","CAS_REJECTED"])
        self.assertEqual(state(),(632100,32100,600000,1,1,1))
    def test_sync_then_old_version_allowance_fails(self):
        self.assertEqual(sync(note="newer UI"),"SYNTHETIC_SYNCED")
        with self.assertRaises(psycopg.Error):allowance()
        self.assertEqual(state(),(632100,0,632100,0,2,0))
    def test_reversal_is_separate_immutable_event_net_zero(self):
        allowance()
        self.assertEqual(reversal(),"SIMULATED_REVERSAL_APPENDED")
        self.assertEqual(reversal(),"REPLAY")
        self.assertEqual(state(),(632100,0,632100,2,1,2))
        ev=audit()
        self.assertEqual(len(ev),2)
        self.assertEqual(ev[0][1],"SIMULATED_ALLOWANCE")
        self.assertEqual(ev[1][1],"SIMULATED_REVERSAL")
        self.assertEqual(ev[1][3],"SYNTH-ALLOW-1")
        with self.assertRaises(psycopg.Error):
            reversal(expected_ledger=2,event="SYNTH-REVERSE-TWO",
                     key="SYNTH-REVERSE-KEY-2")
    def test_reversal_and_sync_old_finance_version_race(self):
        allowance()
        barrier=threading.Barrier(2)
        def call(which):
            barrier.wait(timeout=8)
            try:
                return reversal() if which=="reverse" else sync(1,1,"during reverse")
            except psycopg.Error:return "CAS_REJECTED"
        with ThreadPoolExecutor(max_workers=2) as pool:
            fs=[pool.submit(call,x) for x in ("reverse","sync")]
            out=[f.result(timeout=17) for f in fs]
        self.assertIn(out,[
            ["SIMULATED_REVERSAL_APPENDED","CAS_REJECTED"],
            ["CAS_REJECTED","SYNTHETIC_SYNCED"]])
    def test_immutable_ledger_no_update_delete_even_by_admin(self):
        allowance()
        for query in (
            "UPDATE p40j_ci.fake_ledger SET gross_delta=1 WHERE event_id='SYNTH-ALLOW-1'",
            "DELETE FROM p40j_ci.fake_ledger WHERE event_id='SYNTH-ALLOW-1'",
        ):
            with self.assertRaises(psycopg.Error):
                with connect() as db:
                    db.execute(query)
        self.assertEqual(state(),(632100,32100,600000,1,1,1))
    def test_unprotected_legacy_admin_path_produces_divergence_and_is_not_fixed(self):
        """Demonstrate why a new ledger alone DOES NOT protect existing full JSONB writes.

        Only the ephemeral CI admin demonstrates this bypass and ROLLBACKs;
        legacy API grants must be removed/controlled in a separate release.
        """
        allowance()
        with connect() as db:
            before=db.execute("SELECT data FROM p40j_ci.fake_snapshots "
                 "WHERE document_id='SYNTH-MERGED-A'").fetchone()[0]
            # Contradiction: stale client writes an old effective AR into JSONB.
            db.execute("UPDATE p40j_ci.fake_snapshots SET "
                       "data=jsonb_set(data,'{ui,cachedGross}','632100'::jsonb) "
                       "WHERE document_id='SYNTH-MERGED-A'")
            after=db.execute("SELECT data FROM p40j_ci.fake_snapshots "
                "WHERE document_id='SYNTH-MERGED-A'").fetchone()[0]
            self.assertNotIn("cachedGross",before["ui"])
            self.assertEqual(after["ui"]["cachedGross"],632100)
            self.assertEqual(state()[2],600000)
            self.assertNotEqual(after["ui"]["cachedGross"],state()[2])
            db.rollback()  # unsafe hypothetical manipulation never committed
        with connect() as db:
            current=db.execute("SELECT data FROM p40j_ci.fake_snapshots "
                 "WHERE document_id='SYNTH-MERGED-A'").fetchone()[0]
        self.assertNotIn("cachedGross",current["ui"])
    def test_different_document_isolation_and_no_other_accounts(self):
        allowance()
        self.assertEqual(state("SYNTH-MERGED-B"),(420000,0,420000,0,1,0))
        with connect() as db:
            tables=[r[0] for r in db.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname='p40j_ci'").fetchall()]
        self.assertCountEqual(tables,["fake_snapshots","fake_ledger"])
    def test_original_immutable_fields_and_no_real_financial_modules(self):
        with connect() as db:
            allowed=db.execute("SELECT has_table_privilege('p40j_client',"
                "'p40j_ci.fake_snapshots','UPDATE')").fetchone()[0]
            self.assertFalse(allowed)
        from pathlib import Path
        folder=Path(__file__).parent
        sql=(folder/"isolated_sync_ledger.sql").read_text()
        assert "erp_states" not in sql and "erp_company_states" not in sql
        assert "public." not in sql
        assert "service_role" not in sql

if __name__=='__main__':
    unittest.main(verbosity=2)
