"""P40-16F: test roles, RLS, protected RPC and synthetic AR projection on
DISPOSABLE LOCAL PostgreSQL only. Never connects to production Supabase/ERP.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit
import threading
import unittest
import os
import psycopg

BASE=os.getenv("P40F_CI_ADMIN_DSN","")
if not BASE:
    raise RuntimeError("Explicit disposable P40F CI database required")
u=urlsplit(BASE)
if u.hostname not in ("127.0.0.1","localhost") or u.path!="/p40_16f_ci":
    raise RuntimeError("Refusing any external database or real ERP connection")

APP_DATABASE="p40_16f_ci"
def connect(role="postgres"):
    if role=="postgres":
        dsn=BASE
    elif role in ("p40f_company_a","p40f_company_b"):
        pw="synthetic-a-ci-only" if role.endswith("_a") else "synthetic-b-ci-only"
        dsn=f"postgresql://{role}:{pw}@127.0.0.1:5432/{APP_DATABASE}"
    else:
        raise RuntimeError("Unsupported synthetic identity")
    return psycopg.connect(dsn,connect_timeout=7)

def allocations():
    # Deliberately fictional allocation; NOT accountant-approved real project values.
    return [
        {"source_id":"SYNTH-A-1","untaxed":20000,"tax":1000,
         "gross_total":21000,"retention":0,"receivable":21000},
        {"source_id":"SYNTH-A-2","untaxed":10571,"tax":529,
         "gross_total":11100,"retention":0,"receivable":11100},
    ]

def submit(role="p40f_company_a",doc="SYNTH-A-DOC",event="SYNTH-EVENT-1",
           op="SYNTH-OP-1",rev=0,snap="SNAP-A",approved=600000,
           rows=None,confirmed=True):
    import json
    if rows is None: rows=allocations()
    with connect(role) as conn:
        return conn.execute(
            "SELECT p40_16f_lab.simulate_approved_adjustment"
            "(%s,%s,%s,%s,%s,%s,%s::jsonb,%s)",
            (doc,event,op,rev,snap,approved,json.dumps(rows),confirmed)
        ).fetchone()[0]

def read_admin(sql,args=()):
    with connect() as conn:
        return conn.execute(sql,args).fetchall()

def reset_test_data():
    with connect() as conn:
        conn.execute("TRUNCATE p40_16f_lab.fake_events,"
                     "p40_16f_lab.fake_sources,"
                     "p40_16f_lab.fake_documents CASCADE")
        for doc,tenant,gross,snapshot in [
            ("SYNTH-A-DOC","SYNTH-A",632100,"SNAP-A"),
            ("SYNTH-B-DOC","SYNTH-B",632100,"SNAP-B"),
            ("SYNTH-A-ISSUED","SYNTH-A",100000,"SNAP-ISSUED"),
            ("SYNTH-A-COLLECTED","SYNTH-A",100000,"SNAP-COLLECTED")
        ]:
            conn.execute("INSERT INTO p40_16f_lab.fake_documents "
                         "(document_id,tenant_id,revision,snapshot_token,gross_total) "
                         "VALUES (%s,%s,0,%s,%s)",
                         (doc,tenant,snapshot,gross))
        for row in [
            ("SYNTH-A-DOC","SYNTH-A","SYNTH-A-1",524000,26200,550200,0,550200,"pending",0,0,0),
            ("SYNTH-A-DOC","SYNTH-A","SYNTH-A-2",78000,3900,81900,0,81900,"pending",0,0,0),
            ("SYNTH-B-DOC","SYNTH-B","SYNTH-B-1",524000,26200,550200,0,550200,"pending",0,0,0),
            ("SYNTH-B-DOC","SYNTH-B","SYNTH-B-2",78000,3900,81900,0,81900,"pending",0,0,0),
            ("SYNTH-A-ISSUED","SYNTH-A","ISSUED-1",95238,4762,100000,0,100000,"issued",0,0,0),
            ("SYNTH-A-COLLECTED","SYNTH-A","COLLECTED-1",95238,4762,100000,0,100000,"pending",12000,0,0)
        ]:
            conn.execute("INSERT INTO p40_16f_lab.fake_sources "
                "(document_id,tenant_id,source_id,untaxed,tax,gross_total,retention,"
                "receivable,invoice_state,received,retention_received,cheque_reserved)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",row)

class SecurityAndReconciliationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as conn:
            with psycopg.ClientCursor(conn) as cursor:
                cursor.execute(Path(__file__).with_name("isolated_roles_rls_rpc.sql").read_text())
    def setUp(self):
        reset_test_data()
    def test_rls_select_only_sees_own_tenant(self):
        for role,tenant,names in [
            ("p40f_company_a","SYNTH-A",3),
            ("p40f_company_b","SYNTH-B",1)
        ]:
            with connect(role) as conn:
                rows=conn.execute("SELECT DISTINCT document_id,tenant_id "
                    "FROM p40_16f_lab.fake_documents ORDER BY document_id").fetchall()
                self.assertEqual(len(rows),names)
                self.assertTrue(all(t==tenant for _,t in rows))
                self.assertEqual(conn.execute("SELECT COUNT(*) "
                    "FROM p40_16f_lab.fake_sources").fetchone()[0],4 if names==3 else 2)
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM "
                    "p40_16f_lab.fake_ar_projection").fetchone()[0],names)

    def test_private_tables_reject_direct_insert_update_delete(self):
        for role in ("p40f_company_a","p40f_company_b"):
            for command in (
                "UPDATE p40_16f_lab.fake_documents SET revision=101 WHERE document_id='SYNTH-A-DOC'",
                "DELETE FROM p40_16f_lab.fake_sources WHERE document_id='SYNTH-A-DOC'",
                "INSERT INTO p40_16f_lab.fake_events (event_id) VALUES ('SYNTH-EVIL')",
                "CREATE TABLE p40_16f_lab.injected_table (id int)"
            ):
                with self.assertRaises(psycopg.Error):
                    with connect(role) as conn:
                        conn.execute(command)
        self.assertEqual(read_admin("SELECT COUNT(*) FROM p40_16f_lab.fake_events")[0][0],0)

    def test_guarded_rpc_and_read_only_ar_projection(self):
        before=read_admin("SELECT source_id,invoice_state,received,receivable "
            "FROM p40_16f_lab.fake_sources WHERE document_id='SYNTH-A-DOC' ORDER BY source_id")
        self.assertEqual(submit(),"SYNTHETIC_RECORDED")
        self.assertEqual(read_admin("SELECT revision FROM p40_16f_lab.fake_documents "
            "WHERE document_id='SYNTH-A-DOC'")[0][0],1)
        self.assertEqual(read_admin("SELECT source_id,invoice_state,received,receivable "
            "FROM p40_16f_lab.fake_sources WHERE document_id='SYNTH-A-DOC' ORDER BY source_id"),before)
        with connect("p40f_company_a") as conn:
            p=conn.execute("SELECT original_receivable,approved_reduction,adjusted_receivable,"
                           "tax_impact_for_review,retention_impact_for_review "
                           "FROM p40_16f_lab.fake_ar_projection WHERE document_id='SYNTH-A-DOC'").fetchone()
            self.assertEqual(p,(632100,32100,600000,1529,0))
        with connect("p40f_company_b") as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM p40_16f_lab.fake_events").fetchone()[0],0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM p40_16f_lab.fake_ar_projection "
                "WHERE document_id='SYNTH-A-DOC'").fetchone()[0],0)

    def test_same_command_replay_and_conflicting_reuse(self):
        self.assertEqual(submit(),"SYNTHETIC_RECORDED")
        self.assertEqual(submit(rev=0),"REPLAY")
        with self.assertRaises(psycopg.Error):
            submit(event="SYNTH-DIFFERENT-EVENT",rev=0)
        changed=allocations()
        changed[0]["untaxed"]=19999
        changed[0]["tax"]=1001
        with self.assertRaises(psycopg.Error):
            submit(rows=changed)
        self.assertEqual(read_admin("SELECT COUNT(*) FROM p40_16f_lab.fake_events")[0][0],1)

    def test_wrong_revision_snapshot_and_reviewer_gate(self):
        for override in [dict(rev=1),dict(snap="STALE"),
                         dict(confirmed=False),dict(approved=632100)]:
            with self.assertRaises(psycopg.Error):
                submit(**override)
        self.assertEqual(read_admin("SELECT COUNT(*) FROM p40_16f_lab.fake_events")[0][0],0)

    def test_cross_tenant_attempt_is_blocked_even_with_real_id(self):
        with self.assertRaises(psycopg.Error):
            submit(role="p40f_company_b",doc="SYNTH-A-DOC",snap="SNAP-A")
        self.assertEqual(read_admin("SELECT COUNT(*) FROM p40_16f_lab.fake_events")[0][0],0)
        with self.assertRaises(psycopg.Error):
            submit(role="p40f_company_a",doc="SYNTH-B-DOC",snap="SNAP-B")

    def test_issued_invoice_or_collected_source_is_denied(self):
        for doc,source,snapshot,net,tax in [
            ("SYNTH-A-ISSUED","ISSUED-1","SNAP-ISSUED",10000,500),
            ("SYNTH-A-COLLECTED","COLLECTED-1","SNAP-COLLECTED",10000,500)
        ]:
            alloc=[{"source_id":source,"untaxed":net,"tax":tax,
                "gross_total":net+tax,"retention":0,"receivable":net+tax}]
            with self.assertRaises(psycopg.Error):
                submit(doc=doc,op="OP-"+doc,event="EV-"+doc,
                    snap=snapshot,approved=100000-net-tax,rows=alloc)
        self.assertEqual(read_admin("SELECT COUNT(*) FROM p40_16f_lab.fake_events")[0][0],0)

    def test_wrong_source_count_and_unbalanced_split_denied(self):
        with self.assertRaises(psycopg.Error):
            submit(rows=allocations()[:1])
        bad=allocations()
        bad[0]["tax"]=1001
        with self.assertRaises(psycopg.Error):
            submit(rows=bad)
        bad=allocations()
        bad[1]["source_id"]="SYNTH-A-1"
        with self.assertRaises(psycopg.Error):
            submit(rows=bad)

    def test_concurrent_same_command_only_one_insert(self):
        barrier=threading.Barrier(2)
        def call():
            barrier.wait(timeout=6)
            return submit()
        with ThreadPoolExecutor(max_workers=2) as pool:
            fs=[pool.submit(call) for _ in range(2)]
            results=[f.result(timeout=15) for f in fs]
        self.assertCountEqual(results,["SYNTHETIC_RECORDED","REPLAY"])
        self.assertEqual(read_admin("SELECT COUNT(*) FROM p40_16f_lab.fake_events")[0][0],1)

    def test_concurrent_different_keys_old_revision_blocked(self):
        barrier=threading.Barrier(2)
        def call(n):
            barrier.wait(timeout=6)
            try:
                return submit(event=f"SYNTHEVENT-{n}",op=f"SYNTHOP-{n}")
            except psycopg.Error:
                return "REJECTED"
        with ThreadPoolExecutor(max_workers=2) as pool:
            fs=[pool.submit(call,n) for n in (1,2)]
            out=[f.result(timeout=15) for f in fs]
        self.assertCountEqual(out,["SYNTHETIC_RECORDED","REJECTED"])

    def test_unprivileged_role_cannot_invoke_superuser_bypass(self):
        with self.assertRaises(psycopg.Error):
            submit(role="postgres")
        with connect() as conn:
            info=conn.execute("SELECT p.prosecdef,p.proowner::regrole::text "
             "FROM pg_proc p WHERE p.oid='p40_16f_lab.simulate_approved_adjustment"
             "(text,text,text,bigint,text,bigint,jsonb,boolean)'::regprocedure").fetchone()
            self.assertEqual(info,(True,"p40f_executor"))
            executor=conn.execute("SELECT rolsuper,rolbypassrls,rolcanlogin "
                "FROM pg_roles WHERE rolname='p40f_executor'").fetchone()
            self.assertEqual(executor,(False,False,False))
            self.assertFalse(conn.execute("SELECT has_schema_privilege('p40f_company_a',"
                "'p40_16f_lab','CREATE')").fetchone()[0])
            self.assertFalse(conn.execute("SELECT has_table_privilege('p40f_company_a',"
                "'p40_16f_lab.fake_events','INSERT')").fetchone()[0])

    def test_no_real_invoice_bank_payroll_tables_in_ci_schema(self):
        with connect() as conn:
            tables={a[0] for a in conn.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname='p40_16f_lab'").fetchall()}
            self.assertEqual(tables,{"fake_documents","fake_sources","fake_events"})
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM p40_16f_lab.fake_events").fetchone()[0],0)

if __name__=="__main__":
    unittest.main(verbosity=2)
