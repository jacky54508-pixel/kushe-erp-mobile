"""P39-3F / DISPOSABLE LOCAL SUPABASE Auth + RLS + RPC integration test.

ONLY for local Supabase CLI inside an ephemeral GitHub Actions runner.
Never accept a hosted Supabase URL or real ERP credentials.
All test people, companies, amounts and IDs are synthetic.
"""
from __future__ import annotations

import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid

import psycopg2

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TENANT_A = "00000000-0000-4000-8000-0000000000a1"
TENANT_B = "00000000-0000-4000-8000-0000000000b2"
SYNTHETIC = "kushe-p39-3-synthetic-fixture-v1"
LAB_PASSWORD = "P39-LOCAL-TEST-ONLY-2026!do-not-reuse"
OP_KEY = "p39::SYN-B::unissued"

def read_env(path):
    data = {}
    for entry in Path(path).read_text(encoding="utf-8").splitlines():
        entry = entry.strip()
        if not entry or entry.startswith("#") or "=" not in entry:
            continue
        key, val = entry.split("=", 1)
        data[key] = val.strip().strip("'").strip('"')
    return data

settings = read_env(sys.argv[1])
API_URL = settings.get("API_URL", settings.get("SUPABASE_URL", ""))
ANON_KEY = settings.get("ANON_KEY", settings.get("PUBLISHABLE_KEY", ""))
SERVICE_KEY = settings.get("SERVICE_ROLE_KEY", settings.get("SECRET_KEY", ""))
DB_URL = settings.get("DB_URL", "")
for name,value in (("API_URL",API_URL),("ANON_KEY",ANON_KEY),
                   ("SERVICE_ROLE_KEY",SERVICE_KEY),("DB_URL",DB_URL)):
    if not value:
        raise RuntimeError(f"Missing LOCAL test credential: {name}")
parsed_api = urllib.parse.urlparse(API_URL)
parsed_db = urllib.parse.urlparse(DB_URL)
if parsed_api.scheme != "http" or parsed_api.hostname not in ("127.0.0.1","localhost"):
    raise RuntimeError("Refusing non-local Supabase API URL")
if parsed_db.hostname not in ("127.0.0.1","localhost"):
    raise RuntimeError("Refusing non-local Supabase database")
if os.getenv("SUPABASE_ACCESS_TOKEN"):
    raise RuntimeError("Cloud token must not be present for local tests")

def request(method, path, token=ANON_KEY, *, data=None, apikey=ANON_KEY):
    headers={"apikey":apikey,"Authorization":f"Bearer {token}",
             "Accept":"application/json"}
    body=None
    if data is not None:
        headers["Content-Type"]="application/json"
        body=json.dumps(data,ensure_ascii=False,separators=(",",":")).encode("utf-8")
    req=urllib.request.Request(API_URL+path,method=method,headers=headers,data=body)
    try:
        with urllib.request.urlopen(req,timeout=20) as resp:
            raw=resp.read().decode("utf-8")
            return resp.status,json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as err:
        raw=err.read().decode("utf-8")
        try:
            result=json.loads(raw)
        except json.JSONDecodeError:
            result={"message":raw[:180]}
        return err.code,result

def create_test_user(key):
    email=f"p39-{key}@local-test.example.com"
    status,created=request("POST","/auth/v1/admin/users",SERVICE_KEY,
        apikey=SERVICE_KEY,data={"email":email,
            "password":LAB_PASSWORD,"email_confirm":True})
    if status not in (200,201):
        raise RuntimeError(f"Local Auth fixture creation failed for {key}: HTTP {status}")
    if not isinstance(created,dict) or not created.get("id"):
        raise RuntimeError(f"Local Auth did not return user ID for {key}")
    return {"id":created["id"],"email":email}

def login(email,password=LAB_PASSWORD):
    result,body=request("POST","/auth/v1/token?grant_type=password",
        data={"email":email,"password":password})
    return result,body

def synthetic_state(variant):
    completed=subprocess.run(
        ["node",str(ROOT/"isolated-postgres-domain.js"),"seed"],
        input=json.dumps({"variant":variant}),text=True,capture_output=True,
        timeout=12,check=True)
    data=json.loads(completed.stdout)
    assert data["ok"],data.get("code")
    assert data["result"]["__p39Synthetic"]==SYNTHETIC
    return data["result"]

def database():
    return psycopg2.connect(DB_URL,connect_timeout=8)

USERS={}
TOKENS={}

class LocalSupabaseSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for key in ("owner-a","approver-a","employee-a","owner-b"):
            USERS[key]=create_test_user(key)
            status,login_data=login(USERS[key]["email"])
            if status!=200 or not login_data.get("access_token"):
                raise RuntimeError(f"Local GoTrue password auth failed for {key}")
            TOKENS[key]=login_data["access_token"]
            token_status,user=request("GET","/auth/v1/user",TOKENS[key])
            if token_status!=200 or user.get("id")!=USERS[key]["id"]:
                raise RuntimeError(f"Local GoTrue token identity invalid for {key}")
        with database() as db,db.cursor() as cur:
            cur.execute("DELETE FROM public.p39f_members")
            for who,tenant,role in [
                ("owner-a",TENANT_A,"owner"),
                ("approver-a",TENANT_A,"approver"),
                ("employee-a",TENANT_A,"employee"),
                ("owner-b",TENANT_B,"owner")
            ]:
                cur.execute("""INSERT INTO public.p39f_members
                    (tenant_id,user_id,member_role) VALUES (%s,%s,%s)""",
                    (tenant,USERS[who]["id"],role))
    def setUp(self):
        self.seed("invoice_pending")
    def seed(self,variant):
        state=synthetic_state(variant)
        with database() as db,db.cursor() as cur:
            cur.execute("DELETE FROM public.p39f_allowances")
            cur.execute("DELETE FROM public.p39f_snapshots")
            for tenant in (TENANT_A,TENANT_B):
                cur.execute("""INSERT INTO public.p39f_snapshots
                    (tenant_id,revision,state) VALUES (%s,1,%s::jsonb)""",
                    (tenant,json.dumps(state,ensure_ascii=False)))
    def select(self,table,who="owner-a",*,tenant=TENANT_A):
        url=f"/rest/v1/{table}?select=*&tenant_id=eq.{tenant}"
        return request("GET",url,TOKENS[who])
    def rpc(self,who="owner-a",*,gross=94500,reason="虛構建商議價",
            tenant=TENANT_A,version=1,key=OP_KEY,fail=False):
        return request("POST","/rest/v1/rpc/p39f_apply_discount",
            TOKENS[who],data={
                "p_tenant":tenant,"p_expected_revision":version,
                "p_key":key,"p_approved_gross":gross,
                "p_reason":reason,"p_fail_before_commit":fail
            })
    def assert_empty(self):
        status,rows=self.select("p39f_allowances")
        self.assertEqual(status,200,rows)
        self.assertEqual(rows,[])
        status,rows=self.select("p39f_snapshots")
        self.assertEqual(status,200,rows)
        self.assertEqual(rows[0]["revision"],1)
        self.assertEqual(rows[0]["state"]["billings"][0]["grossTotal"],105000)

    def test_auth_real_password_session_and_bad_password(self):
        status,data=login(USERS["owner-a"]["email"],"incorrect-synthetic-password")
        self.assertIn(status,(400,401,422),data)
        status,user=request("GET","/auth/v1/user",TOKENS["owner-a"])
        self.assertEqual(status,200,user)
        self.assertEqual(user["id"],USERS["owner-a"]["id"])
        self.assert_empty()

    def test_rls_member_read_cross_tenant_and_anon(self):
        for who,tenant in (("owner-a",TENANT_A),("employee-a",TENANT_A),
                           ("owner-b",TENANT_B)):
            status,rows=self.select("p39f_snapshots",who,tenant=tenant)
            self.assertEqual(status,200,rows)
            self.assertEqual(len(rows),1,rows)
        status,foreign=self.select("p39f_snapshots","owner-b",tenant=TENANT_A)
        self.assertEqual(status,200,foreign)
        self.assertEqual(foreign,[])
        status,foreign=self.select("p39f_snapshots","employee-a",tenant=TENANT_B)
        self.assertEqual(status,200,foreign)
        self.assertEqual(foreign,[])
        status,anonymous=request("GET","/rest/v1/p39f_snapshots?select=*")
        self.assertIn(status,(401,403),anonymous)

    def test_rls_membership_not_editable_by_authenticated(self):
        status,rows=request("GET","/rest/v1/p39f_members?select=*",
                            TOKENS["employee-a"])
        self.assertEqual(status,200,rows)
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["member_role"],"employee")
        body={"tenant_id":TENANT_A,"user_id":USERS["owner-b"]["id"],
              "member_role":"owner"}
        status,error=request("POST","/rest/v1/p39f_members",
                             TOKENS["employee-a"],data=body)
        self.assertIn(status,(401,403),error)
        self.assert_empty()

    def test_employee_and_foreign_owner_cannot_change_allowance(self):
        for who,tenant in (("employee-a",TENANT_A),("owner-b",TENANT_A)):
            status,error=self.rpc(who,tenant=tenant)
            self.assertGreaterEqual(status,400,error)
            self.assertIn("P39F_ROLE_DENIED",json.dumps(error))
        self.assert_empty()
        status,rows=self.select("p39f_allowances","owner-b",tenant=TENANT_A)
        self.assertEqual(status,200,rows)
        self.assertEqual(rows,[])

    def test_direct_original_snapshot_payload_change_blocked(self):
        fake={"__p39Synthetic":SYNTHETIC,
              "meta":{"p39SyntheticSchema":SYNTHETIC},
              "billings":[{"id":"SYN-B","grossTotal":1}],
              "receivables":[{"id":"SYN-AR"}]}
        status,error=request("PATCH",
            f"/rest/v1/p39f_snapshots?tenant_id=eq.{TENANT_A}",
            TOKENS["owner-a"],data={"state":fake})
        self.assertIn(status,(400,401,403),error)
        self.assert_empty()

    def test_two_authenticated_clients_concurrent_same_key_one_ledger(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures=[executor.submit(self.rpc,who)
                     for who in ("owner-a","approver-a")]
            output=[f.result() for f in futures]
        for status,value in output:
            self.assertEqual(status,200,value)
        statuses=sorted(result["status"] for _,result in output)
        self.assertEqual(statuses,["REPLAYED_IDEMPOTENT","SYNTHETIC_LOCAL_ONLY"])
        status,ledger=self.select("p39f_allowances")
        self.assertEqual(status,200,ledger)
        self.assertEqual(len(ledger),1)
        self.assertEqual(ledger[0]["discount_gross"],10500)
        self.assertEqual(ledger[0]["effective_receivable"],90000)
        self.assertEqual(ledger[0]["effective_retention"],4500)
        status,rows=self.select("p39f_snapshots")
        self.assertEqual(status,200,rows)
        self.assertEqual(rows[0]["revision"],2)
        self.assertEqual(rows[0]["state"]["billings"][0]["grossTotal"],105000)
        self.assertEqual(rows[0]["state"]["receivables"][0]["amount"],100000)
        self.assertEqual(rows[0]["state"]["bankTransactions"],[])
        # Cross-tenant RLS: owner B cannot read A's committed allowance.
        status,invisible=self.select("p39f_allowances","owner-b",tenant=TENANT_A)
        self.assertEqual(status,200,invisible)
        self.assertEqual(invisible,[])

    def test_stale_version_after_other_client_revision_advance(self):
        # Simulate another authorized client advancing a different local snapshot
        # operation. The pending discount must use a fresh expectedRevision.
        status,data=request("PATCH",
            f"/rest/v1/p39f_snapshots?tenant_id=eq.{TENANT_A}",
            TOKENS["owner-a"],data={"revision":2})
        self.assertIn(status,(200,204),data)
        status,rejected=self.rpc("approver-a",version=1)
        self.assertGreaterEqual(status,400,rejected)
        self.assertIn("P39F_STALE_VERSION",json.dumps(rejected))
        status,ledger=self.select("p39f_allowances")
        self.assertEqual(status,200,ledger)
        self.assertEqual(ledger,[])
        status,snapshot=self.select("p39f_snapshots")
        self.assertEqual(snapshot[0]["revision"],2)

    def test_idempotency_key_same_key_changed_gross_rejected(self):
        status,created=self.rpc()
        self.assertEqual(status,200,created)
        status,error=self.rpc("approver-a",gross=95550)
        self.assertGreaterEqual(status,400,error)
        self.assertIn("P39F_IDEMPOTENCY_CONFLICT",json.dumps(error))

    def test_injected_failed_write_rolls_back_all_changes(self):
        status,failure=self.rpc(fail=True)
        self.assertGreaterEqual(status,400,failure)
        self.assertIn("P39F_INJECTED_PRECOMMIT_FAILURE",json.dumps(failure))
        self.assert_empty()
        status,successful=self.rpc("approver-a")
        self.assertEqual(status,200,successful)

    def test_issued_invoice_collected_and_commission_all_blocked(self):
        for variant in ("invoiced","collected","commission","cheque"):
            with self.subTest(scenario=variant):
                self.seed(variant)
                status,result=self.rpc()
                self.assertGreaterEqual(status,400,result)
                self.assert_empty()
        self.seed("invoice_pending")

    def test_no_invoice_does_not_create_tax_and_computes_retention(self):
        self.seed("no_invoice")
        status,data=self.rpc(gross=90000)
        self.assertEqual(status,200,data)
        self.assertEqual(data["effectiveReceivable"],85500)
        self.assertEqual(data["effectiveRetention"],4500)
        status,ledger=self.select("p39f_allowances")
        self.assertEqual(ledger[0]["original_gross"],100000)
        self.assertEqual(ledger[0]["approved_gross"],90000)
        self.assertEqual(ledger[0]["discount_gross"],10000)
        status,snapshot=self.select("p39f_snapshots")
        self.assertEqual(snapshot[0]["state"]["invoices"],[])

    def test_ack_lost_then_new_client_replays_same_operation(self):
        # Simulate an HTTP response lost after DB commit: don't inspect the first result.
        self.rpc("owner-a")
        status,replay=self.rpc("approver-a")
        self.assertEqual(status,200,replay)
        self.assertEqual(replay["status"],"REPLAYED_IDEMPOTENT")
        status,ledger=self.select("p39f_allowances")
        self.assertEqual(len(ledger),1)
        status,snapshot=self.select("p39f_snapshots")
        self.assertEqual(snapshot[0]["revision"],2)

    def test_no_origin_or_hosted_project_connections(self):
        self.assertEqual(parsed_api.hostname in ("localhost","127.0.0.1"),True)
        self.assertEqual(parsed_db.hostname in ("localhost","127.0.0.1"),True)
        with database() as db,db.cursor() as cur:
            cur.execute("""select relrowsecurity from pg_class
                where oid='public.p39f_snapshots'::regclass""")
            self.assertEqual(cur.fetchone()[0],True)
            cur.execute("""select prosecdef from pg_proc
                where oid='public.p39f_apply_discount(uuid,bigint,text,bigint,text,boolean)'::regprocedure""")
            self.assertEqual(cur.fetchone()[0],False)

def main():
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(LocalSupabaseSafety)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        sys.exit(1)
    print("PASS: local Supabase GoTrue sessions, RLS cross-tenant security, "
          "two-client PostgREST RPC CAS and rollback; zero hosted project writes")

if __name__=="__main__":
    main()
