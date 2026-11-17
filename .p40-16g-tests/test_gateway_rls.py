"""P40-16G simulated trusted Auth gateway + PostgreSQL RLS in DISPOSABLE CI DB.
IMPORTANT: PostgreSQL's request.jwt.claim.* GUCs are NOT signed or verified here.
These tests simulate a trusted PostgREST gateway, not end-to-end JWT security.
Never run on any real Supabase or customer ERP database.
"""
from __future__ import annotations
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit
import unittest
import psycopg

DSN=os.getenv("P40G_CI_ADMIN_DSN","")
u=urlsplit(DSN)
if u.hostname not in ("127.0.0.1","localhost") or u.path!="/p40_16g_ci":
    raise RuntimeError("P40-16G refuses any real or nonlocal database")
if not DSN or "supabase" in DSN.lower() or "pooler" in DSN.lower():
    raise RuntimeError("No Supabase or remote DSN is allowed")
USERS={n:f"00000000-0000-4000-8000-{i:012d}" for i,n in enumerate(
    ("owner_a","accountant_a","employee_a","owner_b","inactive_a","ambiguous","admin_a"),start=1)}

def connect():
    return psycopg.connect(DSN,connect_timeout=7)

def reset():
    with connect() as db:
        db.execute("TRUNCATE p40g_ci.fake_receipts,p40g_ci.fake_invoices,"
                   "p40g_ci.fake_sources,p40g_ci.fake_documents,p40g_ci.fake_members CASCADE")
        rows=[
          ("owner_a","SYNTH-A","owner","active"),
          ("accountant_a","SYNTH-A","accounting","active"),
          ("employee_a","SYNTH-A","employee","active"),
          ("owner_b","SYNTH-B","owner","active"),
          ("inactive_a","SYNTH-A","owner","inactive"),
          ("ambiguous","SYNTH-A","owner","active"),
          ("ambiguous","SYNTH-B","admin","active"),
          ("admin_a","SYNTH-A","admin","active"),
        ]
        for user,company,role,status in rows:
            db.execute("INSERT INTO p40g_ci.fake_members(user_id,company_id,app_role,status)"
                       " VALUES (%s,%s,%s,%s)",(USERS[user],company,role,status))
        for doc,company,snapshot,gross in [
          ("FAKE-A-CLEAN","SYNTH-A","V-A-1",100000),
          ("FAKE-A-MERGED","SYNTH-A","V-A-2",632100),
          ("FAKE-A-PAID","SYNTH-A","V-A-3",100000),
          ("FAKE-B-CLEAN","SYNTH-B","V-B-1",200000)]:
            db.execute("INSERT INTO p40g_ci.fake_documents"
                       "(document_id,company_id,snapshot_version,gross) VALUES (%s,%s,%s,%s)",
                       (doc,company,snapshot,gross))
        sources=[
          ("SYNTH-A","FAKE-A-CLEAN","FAKE-A-C1",95238,4762,100000,0,100000),
          ("SYNTH-A","FAKE-A-MERGED","FAKE-A-M1",524000,26200,550200,0,550200),
          ("SYNTH-A","FAKE-A-MERGED","FAKE-A-M2",78000,3900,81900,0,81900),
          ("SYNTH-A","FAKE-A-PAID","FAKE-A-P1",95238,4762,100000,0,100000),
          ("SYNTH-B","FAKE-B-CLEAN","FAKE-B-C1",190476,9524,200000,0,200000)]
        for row in sources:
            db.execute("INSERT INTO p40g_ci.fake_sources"
                       "(company_id,document_id,source_id,untaxed,tax,gross,retention,receivable)"
                       " VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",row)
        for row in [
          ("SYNTH-A","FAKE-A-CLEAN","FAKE-A-C1","pending"),
          ("SYNTH-A","FAKE-A-MERGED","FAKE-A-M1","pending"),
          ("SYNTH-A","FAKE-A-MERGED","FAKE-A-M2","issued"),
          ("SYNTH-A","FAKE-A-PAID","FAKE-A-P1","pending"),
          ("SYNTH-B","FAKE-B-CLEAN","FAKE-B-C1","pending")]:
            db.execute("INSERT INTO p40g_ci.fake_invoices(company_id,document_id,source_id,status)"
                       " VALUES (%s,%s,%s,%s)",row)
        db.execute("INSERT INTO p40g_ci.fake_receipts"
                   "(receipt_id,company_id,document_id,source_id,amount)"
                   " VALUES ('FAKE-RECEIPT','SYNTH-A','FAKE-A-PAID','FAKE-A-P1',8000)")

def actor(user="owner_a",role="authenticated",aal="aal2",exp=None,
          user_metadata=None,app_metadata=None):
    """Simulates verified JWT claims *only when sourced by a trusted gateway*.
    Because DB GUCs are user-settable over raw SQL, these tests do NOT
    establish JWT signature validation or safe direct SQL connection.
    """
    db=connect()
    db.execute("SET LOCAL ROLE p40g_"+role)
    claims={
        "sub":USERS.get(user,user),
        "role":role,
        "aal":aal,
        "exp":str(int(time.time())+3600 if exp is None else exp),
        "user_metadata":json.dumps(user_metadata or {}),
        "app_metadata":json.dumps(app_metadata or {}),
    }
    for k,v in claims.items():
        db.execute("SELECT set_config(%s,%s,true)",(f"request.jwt.claim.{k}",str(v)))
    return db

def preview(db,doc="FAKE-A-CLEAN",snapshot="V-A-1",approved=90000):
    return db.execute("SELECT p40g_ci.preview_discount(%s,%s,%s)",
                      (doc,snapshot,approved)).fetchone()[0]

class GatewayAuthorizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as db:
            with psycopg.ClientCursor(db) as cursor:
                cursor.execute(Path(__file__).with_name("isolated_gateway_rls.sql").read_text())
    def setUp(self):
        reset()

    def test_verified_aal2_owner_and_accountant_may_preview_but_never_post(self):
        for user in ("owner_a","accountant_a","admin_a"):
            with actor(user) as db:
                result=preview(db)
                self.assertEqual(result["status"],"REVIEW_ONLY")
                self.assertEqual(result["grossDiscount"],10000)
                self.assertFalse(result["canPost"])
                self.assertFalse(result["canSave"])
                self.assertEqual(result["sourceCount"],1)
                self.assertEqual(result["taxResolution"],"UNVERIFIED")
                self.assertEqual(db.execute("SELECT count(*) FROM p40g_ci.fake_documents")
                                 .fetchone()[0],3)

    def test_live_membership_not_client_user_metadata_controls_access(self):
        with actor("employee_a",user_metadata={"role":"owner","company_id":"SYNTH-A"},
                   app_metadata={"role":"owner","company_id":"SYNTH-A"}) as db:
            self.assertEqual(preview(db)["status"],"DENIED")
            self.assertEqual(db.execute("SELECT count(*) FROM p40g_ci.fake_documents")
                             .fetchone()[0],0)

    def test_cross_company_access_and_visible_AR_are_isolated(self):
        with actor("owner_a") as db:
            self.assertEqual(preview(db,"FAKE-B-CLEAN","V-B-1",180000)["status"],"DENIED")
            rows=db.execute("SELECT document_id,open_ar FROM p40g_ci.fake_ar_summary").fetchall()
            self.assertCountEqual([name for name,amount in rows],
                 ["FAKE-A-CLEAN","FAKE-A-MERGED","FAKE-A-PAID"])
            self.assertEqual(dict(rows)["FAKE-A-PAID"],92000)
        with actor("owner_b") as db:
            self.assertEqual(preview(db)["status"],"DENIED")
            self.assertEqual(preview(db,"FAKE-B-CLEAN","V-B-1",190000)["grossDiscount"],10000)
            self.assertEqual(db.execute("SELECT count(*) FROM p40g_ci.fake_ar_summary")
                             .fetchone()[0],1)

    def test_anon_cannot_read_tables_or_call_authenticated_rpc(self):
        with actor("owner_a",role="anon") as db:
            with self.assertRaises(psycopg.Error):
                db.execute("SELECT * FROM p40g_ci.fake_documents")
        with actor("owner_a",role="anon") as db:
            with self.assertRaises(psycopg.Error):
                preview(db)

    def test_aal1_or_expired_jwt_claims_fail_closed(self):
        with actor("owner_a",aal="aal1") as db:
            self.assertEqual(preview(db)["status"],"DENIED")
            self.assertEqual(db.execute("SELECT count(*) FROM p40g_ci.fake_documents")
                             .fetchone()[0],0)
        with actor("owner_a",exp=int(time.time())-100) as db:
            self.assertEqual(preview(db)["status"],"DENIED")

    def test_inactive_ambiguous_and_unknown_memberships_are_denied(self):
        for who in ("inactive_a","ambiguous","00000000-0000-4000-8000-999999999999"):
            with actor(who) as db:
                self.assertEqual(preview(db)["status"],"DENIED")
                self.assertEqual(db.execute("SELECT count(*) FROM p40g_ci.fake_documents")
                                 .fetchone()[0],0)

    def test_database_membership_revoke_blocks_next_request_with_same_claims(self):
        with actor("owner_a") as db:
            self.assertEqual(preview(db)["status"],"REVIEW_ONLY")
        with connect() as admin:
            admin.execute("UPDATE p40g_ci.fake_members SET status='inactive'"
                          " WHERE user_id=%s AND company_id='SYNTH-A'",(USERS["owner_a"],))
        with actor("owner_a") as db:
            self.assertEqual(preview(db)["status"],"DENIED")

    def test_issued_invoice_and_recorded_receipt_never_auto_post(self):
        with actor("owner_a") as db:
            merged=preview(db,"FAKE-A-MERGED","V-A-2",600000)
            self.assertEqual(merged["status"],"REQUIRES_ACCOUNTING")
            self.assertEqual(merged["grossDiscount"],32100)
            self.assertEqual(merged["issuedCount"],1)
            self.assertEqual(merged["sourceCount"],2)
            self.assertFalse(merged["canPost"])
            paid=preview(db,"FAKE-A-PAID","V-A-3",90000)
            self.assertEqual(paid["status"],"REQUIRES_ACCOUNTING")
            self.assertEqual(paid["receiptTotal"],8000)
            self.assertFalse(paid["canSave"])

    def test_old_version_and_invalid_amount_are_blocked_without_data(self):
        with actor("owner_a") as db:
            for kwargs in [
                dict(snapshot="OLD",approved=90000),
                dict(snapshot="V-A-1",approved=100000),
                dict(snapshot="V-A-1",approved=0)]:
                self.assertEqual(preview(db,**kwargs)["status"],"BLOCKED")

    def test_invalid_claim_sub_does_not_grant_access(self):
        for invalid in ("not-a-uuid",""):
            with actor(invalid) as db:
                self.assertEqual(preview(db)["status"],"DENIED")

    def test_untrusted_metadata_cannot_override_company_or_mfa(self):
        forged={"role":"owner","company_id":"SYNTH-A","aal":"aal2"}
        with actor("owner_b",user_metadata=forged,app_metadata=forged,aal="aal1") as db:
            self.assertEqual(preview(db)["status"],"DENIED")
        with actor("employee_a",user_metadata=forged,app_metadata=forged) as db:
            self.assertEqual(preview(db)["status"],"DENIED")

    def test_rpc_is_security_invoker_and_tables_are_read_only_to_client(self):
        with connect() as db:
            owner,definer=db.execute(
               "SELECT proowner::regrole::text,prosecdef FROM pg_proc "
               "WHERE oid='p40g_ci.preview_discount(text,text,bigint)'::regprocedure"
            ).fetchone()
            self.assertFalse(definer)
            for role in ("p40g_authenticated","p40g_anon"):
                can_login,can_bypass=db.execute(
                    "SELECT rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname=%s",
                    (role,)).fetchone()
                self.assertFalse(can_login);self.assertFalse(can_bypass)
            self.assertFalse(db.execute(
                "SELECT has_function_privilege('p40g_anon',"
                "'p40g_ci.preview_discount(text,text,bigint)','EXECUTE')").fetchone()[0])
        for cmd in [
            "UPDATE p40g_ci.fake_documents SET gross=1 WHERE document_id='FAKE-A-CLEAN'",
            "INSERT INTO p40g_ci.fake_members(user_id,company_id,app_role,status)"
             " VALUES ('00000000-0000-4000-8000-000000999999','SYNTH-A','owner','active')",
            "DELETE FROM p40g_ci.fake_receipts WHERE receipt_id='FAKE-RECEIPT'",
            "CREATE TABLE p40g_ci.fake_spoofed(id integer)",
        ]:
            with actor("owner_a") as db:
                with self.assertRaises(psycopg.Error):
                    db.execute(cmd)

    def test_preview_does_not_mutate_any_business_rows(self):
        def state():
            with connect() as db:
                return {
                  table:db.execute(f"SELECT count(*) FROM p40g_ci.{table}").fetchone()[0]
                  for table in ("fake_members","fake_documents","fake_sources",
                                "fake_invoices","fake_receipts")}
        before=state()
        with actor("owner_a") as db:
            for doc,snap,amount in [
                ("FAKE-A-CLEAN","V-A-1",90000),
                ("FAKE-A-MERGED","V-A-2",600000),
                ("FAKE-A-PAID","V-A-3",90000)]:
                result=preview(db,doc,snap,amount)
                self.assertFalse(result["canPost"])
        self.assertEqual(before,state())

    def test_synthetic_schema_contains_no_erp_production_tables(self):
        with connect() as db:
            tables={r[0] for r in db.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname='p40g_ci'").fetchall()}
            self.assertEqual(tables,{
               "fake_members","fake_documents","fake_sources","fake_invoices","fake_receipts"})

if __name__=="__main__":
    unittest.main(verbosity=2)
