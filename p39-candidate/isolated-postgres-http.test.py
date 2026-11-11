"""P39-3E: real disposable PostgreSQL + HTTP two-device integration tests.
GitHub Actions runner only: no Supabase account, no external cloud, no real ERP data.
All requests/DB connections target loopback. This is NOT a remote Supabase acceptance.
"""
from __future__ import annotations
import concurrent.futures
import contextlib
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import threading
import urllib.error
import urllib.request
import unittest

import psycopg2

HERE=Path(__file__).resolve().parent
DSN=os.environ["P39_PG_DSN"]
MARKER="kushe-p39-3-synthetic-fixture-v1"
STORE_ID="SYN-LAB-ONLY"
DEVICE_TOKEN="P39-SYNTHETIC-TEST-ONLY"
VALID_DEVICES={"SYN-DEVICE-A","SYN-DEVICE-B"}
STATEMENT_LIMIT=120000

class LabError(Exception):
    def __init__(self,code,message,status=409):
        super().__init__(str(message))
        self.code,self.status=code,status

def conn():
    return psycopg2.connect(DSN,connect_timeout=5)

def node(mode,obj):
    run=subprocess.run(["node",str(HERE/"isolated-postgres-domain.js"),mode],
        input=json.dumps(obj,ensure_ascii=False),encoding="utf-8",
        capture_output=True,timeout=8,check=True)
    result=json.loads(run.stdout)
    if not result["ok"]:
        raise LabError(result["code"],result["message"],422)
    return result["result"]

def seed(variant="invoice_pending"):
    state=node("seed",{"variant":variant})
    assert state["__p39Synthetic"]==MARKER
    with contextlib.closing(conn()) as connection,connection:
        with connection.cursor() as cur:
            cur.execute("DELETE FROM p39_synthetic_operations")
            cur.execute("DELETE FROM p39_synthetic_snapshots")
            cur.execute("""INSERT INTO p39_synthetic_snapshots(store_id,revision,payload)
                           VALUES (%s,1,%s::jsonb)""",
                        (STORE_ID,json.dumps(state,ensure_ascii=False)))

def state_at(cur, lock=False):
    cur.execute("""SELECT revision,payload FROM p39_synthetic_snapshots
                  WHERE store_id=%s"""+(" FOR UPDATE" if lock else ""), (STORE_ID,))
    result=cur.fetchone()
    if not result:
        raise LabError("P39_PG_NO_SNAPSHOT","測試資料庫沒有虛構快照",404)
    return result[0],result[1]

def make_fingerprint(payload):
    normalized={k:payload.get(k) for k in ("billingId","intent","evidence")}
    return hashlib.sha256(json.dumps(normalized,sort_keys=True,
          ensure_ascii=False,separators=(",",":")).encode()).hexdigest()

def transactional_post(data):
    key=data.get("idempotencyKey")
    bill=data.get("billingId")
    revision=data.get("expectedRevision")
    if not isinstance(key,str) or not key.startswith("p39::SYN-") or \
       bill!="SYN-B" or type(revision) is not int or revision<1:
        raise LabError("P39_PG_INVALID_COMMAND","必須使用有效虛構操作識別與版本",422)
    digest=make_fingerprint(data)
    should_fail_after=bool(data.get("failAfterCommit"))
    with contextlib.closing(conn()) as connection,connection:
        with connection.cursor() as cur:
            current,stored=state_at(cur,lock=True)
            cur.execute("""SELECT intent_sha256,billing_id,committed_revision,ledger_id
                           FROM p39_synthetic_operations WHERE idempotency_key=%s""",(key,))
            previous=cur.fetchone()
            if previous:
                if previous[0]!=digest or previous[1]!=bill:
                    raise LabError("P39_PG_IDEMPOTENCY_CONFLICT",
                        "相同識別碼與原始操作不一致")
                return {"status":"REPLAYED_IDEMPOTENT","revision":previous[2],
                    "ledgerId":previous[3],"productionWrites":0}
            if revision!=current:
                raise LabError("P39_PG_STALE_REVISION","另一裝置已更新，舊資料不可覆蓋")
            if stored.get("__p39Synthetic")!=MARKER:
                raise LabError("P39_PG_SYNTHETIC_ONLY","禁止非虛構資料")
            output=node("apply",{"state":stored,"command":data})
            next_state=output["next"]
            if next_state["meta"]["revision"]!=stored["meta"]["revision"]+1:
                raise LabError("P39_PG_DOMAIN_REVISION_INVALID",
                    "業務版本與提交預期不一致")
            if data.get("failBeforeCommit") is True:
                raise LabError("P39_PG_PRECOMMIT_INJECTED",
                    "提交前模擬失敗，應立即回滾",503)
            cur.execute("""UPDATE p39_synthetic_snapshots SET
                      revision=revision+1,payload=%s::jsonb
                      WHERE store_id=%s AND revision=%s RETURNING revision""",
                        (json.dumps(next_state,ensure_ascii=False),STORE_ID,current))
            updated=cur.fetchone()
            if not updated:
                raise LabError("P39_PG_CAS_FAILED","CAS 防覆蓋失敗")
            cur.execute("""INSERT INTO p39_synthetic_operations
              (idempotency_key,billing_id,intent_sha256,committed_revision,ledger_id)
              VALUES (%s,%s,%s,%s,%s)""",
              (key,bill,digest,updated[0],output["ledgerId"]))
            response={"status":"COMMITTED_DISPOSABLE_POSTGRES_ONLY",
                "revision":updated[0],"ledgerId":output["ledgerId"],
                "productionWrites":0}
    if should_fail_after:
        # The prior transaction is already committed. An HTTP retry must replay.
        raise LabError("P39_PG_ACK_LOST","模擬提交成功後回應丟失",503)
    return response

class API(BaseHTTPRequestHandler):
    server_version="P39-Isolated-PG-Lab"
    def log_message(self,fmt,*args):
        pass
    def _send(self,status,obj):
        body=json.dumps(obj,ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def _authorized(self):
        if self.headers.get("X-P39-Device") not in VALID_DEVICES or \
           self.headers.get("X-P39-Token")!=DEVICE_TOKEN:
            self._send(403,{"ok":False,"code":"P39_PG_TEST_ACCESS_DENIED"})
            return False
        return True
    def do_GET(self):
        if not self._authorized():
            return
        if self.path!="/snapshot":
            self._send(404,{"ok":False,"code":"NOT_FOUND"})
            return
        try:
            with contextlib.closing(conn()) as connection,connection:
                with connection.cursor() as cur:
                    revision,state=state_at(cur)
                    cur.execute("SELECT count(*) FROM p39_synthetic_operations")
                    committed=cur.fetchone()[0]
            self._send(200,{"ok":True,"revision":revision,"state":state,
                "operations":committed,"provider":"DISPOSABLE_POSTGRES_LOCAL_ONLY"})
        except LabError as exc:
            self._send(exc.status,{"ok":False,"code":exc.code,"message":str(exc)})
    def do_POST(self):
        if not self._authorized():
            return
        if self.path!="/commit":
            self._send(404,{"ok":False,"code":"NOT_FOUND"})
            return
        try:
            size=int(self.headers.get("Content-Length","0"))
            if not 0<size<=STATEMENT_LIMIT:
                raise LabError("P39_PG_INVALID_BODY","提交資料大小超出限制",422)
            body=json.loads(self.rfile.read(size))
            if not isinstance(body,dict):
                raise LabError("P39_PG_INVALID_BODY","提交內容必須為 JSON 物件",422)
            result=transactional_post(body)
            self._send(200,{"ok":True,"result":result})
        except LabError as exc:
            self._send(exc.status,{"ok":False,"code":exc.code,"message":str(exc)})
        except (ValueError,TypeError) as exc:
            self._send(422,{"ok":False,"code":"P39_PG_INVALID_JSON"})

def request(url,device,method="GET",data=None,token=DEVICE_TOKEN):
    headers={"X-P39-Device":device,"X-P39-Token":token}
    if data is not None:
        headers["Content-Type"]="application/json"
        body=json.dumps(data,ensure_ascii=False).encode("utf-8")
    else:
        body=None
    query=urllib.request.Request(url,method=method,headers=headers,data=body)
    try:
        with urllib.request.urlopen(query,timeout=8) as response:
            return response.status,json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code,json.loads(error.read())

def command(revision=1,gross=94500):
    return {"billingId":"SYN-B","expectedRevision":revision,
        "idempotencyKey":"p39::SYN-B::unissued",
        "intent":{"role":"owner","approvedGross":gross,"reason":"虛構建商議價"},
        "evidence":{"synthetic":True,"agreementRef":"SYN-AGREEMENT-001",
                    "reviewerRef":"SYN-OWNER-001","reviewedAt":"2026-11-11"}}

class PostgresDeviceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with contextlib.closing(conn()) as connection,connection:
            with connection.cursor() as cur:
                cur.execute((HERE/"isolated-postgres-schema.sql").read_text(encoding="utf-8"))
        cls.server=ThreadingHTTPServer(("127.0.0.1",0),API)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.root=f"http://127.0.0.1:{cls.server.server_address[1]}"
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)
    def setUp(self):
        seed()
    def snapshot(self,device="SYN-DEVICE-A",base=None):
        status,obj=request((base or self.root)+"/snapshot",device)
        self.assertEqual(status,200,obj)
        return obj
    def commit(self,cmd,device="SYN-DEVICE-A",base=None):
        return request((base or self.root)+"/commit",device,"POST",cmd)
    def test_two_devices_concurrent_same_operation_single_post(self):
        a=self.snapshot("SYN-DEVICE-A");b=self.snapshot("SYN-DEVICE-B")
        self.assertEqual(a["revision"],b["revision"])
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            calls=[pool.submit(self.commit,command(a["revision"]),d) for d in VALID_DEVICES]
            results=[f.result() for f in calls]
        self.assertEqual(sorted(x[1]["result"]["status"] for x in results),
            ["COMMITTED_DISPOSABLE_POSTGRES_ONLY","REPLAYED_IDEMPOTENT"])
        final=self.snapshot()
        self.assertEqual(final["operations"],1)
        self.assertEqual(len(final["state"]["billingAllowances"]),1)
        self.assertEqual(final["revision"],2)
        self.assertEqual(final["state"]["receivables"][0]["amount"],100000)
        self.assertEqual(final["state"]["invoices"][0]["grossAmount"],105000)
        self.assertEqual(final["state"]["bankTransactions"],[])
    def test_stale_version_denied(self):
        self.assertEqual(self.commit(command())[0],200)
        cmd=command();cmd["idempotencyKey"]="p39::SYN-B::other"
        status,result=self.commit(cmd,"SYN-DEVICE-B")
        self.assertEqual(status,409,result)
        self.assertEqual(result["code"],"P39_PG_STALE_REVISION")
        self.assertEqual(self.snapshot()["operations"],1)
    def test_same_key_different_amount_denied(self):
        self.assertEqual(self.commit(command())[0],200)
        status,result=self.commit(command(gross=95550),"SYN-DEVICE-B")
        self.assertEqual(status,409,result)
        self.assertEqual(result["code"],"P39_PG_IDEMPOTENCY_CONFLICT")
        self.assertEqual(self.snapshot()["operations"],1)
    def test_precommit_failure_rolls_back(self):
        before=self.snapshot()
        payload={**command(),"failBeforeCommit":True}
        status,error=self.commit(payload)
        self.assertEqual(status,503,error)
        self.assertEqual(error["code"],"P39_PG_PRECOMMIT_INJECTED")
        after=self.snapshot()
        self.assertEqual(after,before)
    def test_ack_lost_can_replay_after_commit(self):
        status,error=self.commit({**command(),"failAfterCommit":True})
        self.assertEqual(status,503,error)
        self.assertEqual(error["code"],"P39_PG_ACK_LOST")
        self.assertEqual(self.snapshot()["operations"],1)
        status,out=self.commit(command(),"SYN-DEVICE-B")
        self.assertEqual(status,200,out)
        self.assertEqual(out["result"]["status"],"REPLAYED_IDEMPOTENT")
        self.assertEqual(self.snapshot()["operations"],1)
    def test_no_invoice_effective_retention_and_tax_zero(self):
        seed("no_invoice")
        before=self.snapshot()
        data=command(gross=90000)
        status,result=self.commit(data)
        self.assertEqual(status,200,result)
        end=self.snapshot()
        row=end["state"]["billingAllowances"][0]
        self.assertEqual(row["effective"]["tax"],0)
        self.assertEqual(row["effective"]["receivable"],85500)
        self.assertEqual(row["effective"]["retention"],4500)
        self.assertEqual(end["state"]["invoices"],[])
        self.assertEqual(end["state"]["receivables"],before["state"]["receivables"])
    def test_issued_collected_commission_cheque_all_blocked(self):
        for variant in ("invoiced","collected","commission","cheque"):
            with self.subTest(variant=variant):
                seed(variant)
                before=self.snapshot()
                status,result=self.commit(command())
                self.assertEqual(status,422,result)
                self.assertEqual(result["code"],"P39_PG_SCENARIO_BLOCKED")
                self.assertEqual(self.snapshot(),before)
    def test_invalid_credentials_and_real_identifier_rejected(self):
        status,body=request(self.root+"/snapshot","SYN-DEVICE-A",token="NOT-ALLOWED")
        self.assertEqual(status,403,body)
        status,body=request(self.root+"/snapshot","NON-SYN-DEVICE")
        self.assertEqual(status,403,body)
        req=command();req["billingId"]="PRODUCTION-ID"
        status,body=self.commit(req)
        self.assertEqual(status,422,body)
        self.assertEqual(self.snapshot()["operations"],0)
    def test_persistence_after_http_gateway_restart(self):
        status,response=self.commit(command())
        self.assertEqual(status,200,response)
        other=ThreadingHTTPServer(("127.0.0.1",0),API)
        worker=threading.Thread(target=other.serve_forever,daemon=True)
        worker.start()
        try:
            base=f"http://127.0.0.1:{other.server_address[1]}"
            reread=self.snapshot("SYN-DEVICE-B",base)
            self.assertEqual(reread["revision"],2)
            self.assertEqual(reread["operations"],1)
            self.assertEqual(len(reread["state"]["billingAllowances"]),1)
        finally:
            other.shutdown();other.server_close();worker.join(timeout=3)

if __name__=="__main__":
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(PostgresDeviceTests)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)
    print("PASS: disposable PostgreSQL HTTP two-device integration (not remote Supabase)")
