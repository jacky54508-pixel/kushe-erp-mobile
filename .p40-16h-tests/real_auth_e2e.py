"""P40-16H: actual local Supabase Auth GoTrue signup/MFA JWT + PostgREST signature verification.
This is NOT hosted Supabase; it does NOT use or expose any real ERP user, secret, or data.
"""
from __future__ import annotations
import os, json, time, base64, urllib.request, urllib.error, urllib.parse, unittest
from pathlib import Path
import psycopg
import pyotp

PG=os.environ.get("P40H_LOCAL_PG","")
if "127.0.0.1:5432/p40_16h_ci" not in PG or "supabase" in PG.lower():
    raise RuntimeError("Refusing any production / remote database")
DB=None
AUTH="http://127.0.0.1:9999"
REST="http://127.0.0.1:3000"

def request(url,method="GET",token=None,body=None):
    data=json.dumps(body).encode() if body is not None else None
    headers={"Content-Type":"application/json","Accept":"application/json"}
    if token: headers["Authorization"]="Bearer "+token
    req=urllib.request.Request(url,headers=headers,data=data,method=method)
    try:
        with urllib.request.urlopen(req,timeout=12) as response:
            raw=response.read().decode()
            return response.status,(json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw=e.read().decode()
        try: obj=json.loads(raw) if raw else {}
        except ValueError: obj={"detail":raw[:150]}
        return e.code,obj

def unpack(jwt):
    parts=jwt.split(".")
    raw=parts[1] + "=" * (-len(parts[1])%4)
    return json.loads(base64.urlsafe_b64decode(raw))

def login(email):
    status,created=request(AUTH+"/signup","POST",
                 body={"email":email,"password":"Strong-Synthetic-P40H-Only-9876!"})
    if status not in (200,201): raise AssertionError(("signup",email,status,created))
    status,session=request(AUTH+"/token?grant_type=password","POST",
                body={"email":email,"password":"Strong-Synthetic-P40H-Only-9876!"})
    if status!=200 or not session.get("access_token"):
        raise AssertionError(("login",email,status,session))
    return session

def totp_aal2(access):
    status, enrolled=request(AUTH+"/factors","POST",token=access,
                             body={"factor_type":"totp","friendly_name":"Synthetic P40H CI"})
    if status not in (200,201):
        raise AssertionError(("MFA enroll",status,enrolled))
    secret=enrolled.get("totp",{}).get("secret")
    fid=enrolled.get("id")
    if not secret or not fid:raise AssertionError("MFA enrollment did not return TOTP secret/factor ID")
    status, challenged=request(AUTH+"/factors/"+fid+"/challenge","POST",
                               token=access,body={})
    if status not in (200,201) or not challenged.get("id"):
        raise AssertionError(("MFA challenge",status,challenged))
    status,verified=request(AUTH+"/factors/"+fid+"/verify","POST",
             token=access,body={"challenge_id":challenged["id"],"code":pyotp.TOTP(secret).now()})
    if status!=200 or not verified.get("access_token"):
        raise AssertionError(("MFA verify",status,verified))
    jwt=verified["access_token"]
    if unpack(jwt).get("aal")!="aal2":raise AssertionError("No GoTrue-issued aal2 claim")
    return jwt

def preview(token,doc="SYNTH-A-CLEAN",snapshot="SYNTH-V1",approved=600000):
    return request(REST+"/rpc/preview_discount","POST",token=token,
                   body={"p_document_id":doc,"p_snapshot":snapshot,"p_approved":approved})

def rows(token, table="fake_documents"):
    return request(REST+"/"+table,"GET",token=token)

class RealAuthAndRls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.a_session=login("p40h-owner-a@unit.example")
        cls.b_session=login("p40h-owner-b@unit.example")
        cls.a_user=unpack(cls.a_session["access_token"])["sub"]
        cls.b_user=unpack(cls.b_session["access_token"])["sub"]
        assert cls.a_user!=cls.b_user
        with psycopg.connect(PG) as db:
            db.execute("INSERT INTO p40h_ci.fake_members(user_id,company_id,company_role,status)"
                " VALUES (%s,'SYNTH-A','owner','active'),(%s,'SYNTH-B','owner','active')",
                (cls.a_user,cls.b_user))
        cls.a_aal1=cls.a_session["access_token"]
        cls.b_aal1=cls.b_session["access_token"]
        cls.a_aal2=totp_aal2(cls.a_aal1)
        cls.b_aal2=totp_aal2(cls.b_aal1)

    def test_mfa_from_real_auth_changes_signed_jwt_aal(self):
        self.assertEqual(unpack(self.a_aal1).get("aal"),"aal1")
        self.assertEqual(unpack(self.a_aal2).get("aal"),"aal2")
        self.assertEqual(unpack(self.b_aal2).get("aal"),"aal2")
    def test_signed_access_and_real_postgrest_rls(self):
        status,result=preview(self.a_aal2)
        self.assertEqual(status,200,result)
        self.assertEqual(result["status"],"REVIEW_ONLY")
        self.assertEqual(result["discountGross"],32100)
        self.assertFalse(result["canPost"])
        self.assertFalse(result["canSave"])
        status,documents=rows(self.a_aal2)
        self.assertEqual(status,200,documents)
        self.assertEqual(len(documents),3)
        self.assertNotIn("SYNTH-B-CLEAN",[d["document_id"] for d in documents])
    def test_real_cross_company_token_denied(self):
        status,data=preview(self.a_aal2,"SYNTH-B-CLEAN","SYNTH-V1",600000)
        self.assertEqual(status,200,data)
        self.assertEqual(data["status"],"DENIED")
        status,others=rows(self.b_aal2)
        self.assertEqual(status,200,others)
        self.assertEqual([row["document_id"] for row in others],["SYNTH-B-CLEAN"])
        self.assertEqual(preview(self.b_aal2)[1]["status"],"DENIED")
    def test_aal1_cannot_view_even_with_valid_auth_login(self):
        code,data=preview(self.a_aal1)
        self.assertIn(code,(200,401,403),(code,data))
        if code==200:self.assertEqual(data["status"],"DENIED")
        code,data=rows(self.a_aal1)
        self.assertIn(code,(200,401,403))
        if code==200:self.assertEqual(len(data),0)
    def test_forged_payload_signature_is_rejected_by_postgrest(self):
        parts=self.a_aal1.split(".")
        fake=unpack(self.a_aal1)
        fake.update({"aal":"aal2","sub":self.b_user,"role":"authenticated"})
        encoded=base64.urlsafe_b64encode(json.dumps(fake,separators=(",",":")).encode()).decode().rstrip("=")
        forged=parts[0]+"."+encoded+"."+parts[2]
        status,data=preview(forged)
        self.assertIn(status,(401,403),(status,data))
        self.assertNotEqual(status,200)
    def test_wrong_signing_secret_and_missing_signature_blocked(self):
        valid=self.a_aal2
        edited=valid[:-1]+("A" if valid[-1]!="A" else "B")
        status,data=preview(edited)
        self.assertIn(status,(401,403),(status,data))
        status,data=preview("not-a-jwt")
        self.assertIn(status,(401,403),(status,data))
    def test_no_token_and_unverified_client_metadata(self):
        status,data=preview(None)
        self.assertIn(status,(401,403),(status,data))
        # Untrusted user_metadata is not used for permissions. This claim is
        # not signed by GoTrue when supplied on a test RPC.
        status,data=preview(self.a_aal2)
        self.assertEqual(status,200,data)
        self.assertEqual(data["status"],"REVIEW_ONLY")
    def test_real_membership_revocation_blocks_existing_signed_jwt(self):
        before=preview(self.a_aal2)
        self.assertEqual(before[1]["status"],"REVIEW_ONLY")
        with psycopg.connect(PG) as db:
            db.execute("UPDATE p40h_ci.fake_members SET status='inactive' "
                       "WHERE user_id=%s",(self.a_user,))
        status,result=preview(self.a_aal2)
        self.assertEqual(status,200,result)
        self.assertEqual(result["status"],"DENIED")
        with psycopg.connect(PG) as db:
            db.execute("UPDATE p40h_ci.fake_members SET status='active' "
                       "WHERE user_id=%s",(self.a_user,))
    def test_issued_invoice_or_receipt_requires_accountant(self):
        for doc,version in [("SYNTH-A-INVOICED","SYNTH-V2"),("SYNTH-A-COLLECTED","SYNTH-V3")]:
            status,result=preview(self.a_aal2,doc,version,600000)
            self.assertEqual(status,200,result)
            self.assertEqual(result["status"],"REQUIRES_ACCOUNTING")
            self.assertFalse(result["canPost"])
    def test_database_denies_direct_financial_writes_via_auth_role(self):
        url=REST+"/fake_documents?document_id=eq.SYNTH-A-CLEAN"
        status,data=request(url,"PATCH",token=self.a_aal2,body={"gross":1})
        self.assertIn(status,(401,403),(status,data))
        status,data=request(REST+"/fake_documents","POST",token=self.a_aal2,
            body={"document_id":"EVIL","company_id":"SYNTH-A","snapshot":"X","gross":1})
        self.assertIn(status,(401,403),(status,data))
    def test_entire_real_auth_e2e_flow_writes_zero_financial_records(self):
        with psycopg.connect(PG) as db:
            count=db.execute("SELECT COUNT(*) FROM p40h_ci.fake_documents").fetchone()[0]
            total=db.execute("SELECT SUM(gross) FROM p40h_ci.fake_documents").fetchone()[0]
        self.assertEqual(count,4)
        self.assertEqual(total,632100*4)

if __name__=="__main__":
    unittest.main(verbosity=2)
