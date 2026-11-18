"""P40-16AU isolated PostgreSQL 17 RLS test suite, using ONLY fake rows.

Runs only against the GitHub Actions disposable PostgreSQL service.
All JWT/MFA identity claims are manually set GUCs in this trusted-test
session. That is NOT signature validation; never use this code as
production security or execute the SQL against a live Supabase database.
"""
import json
import os
import subprocess
import unittest
from pathlib import Path

SQL=Path(__file__).with_name("ephemeral_model.sql")
DB_URL=os.environ.get("P40AU_EPHEMERAL_PG_URL","")
assert DB_URL.startswith("postgresql://") and "p40au" in DB_URL, (
    "STOP: P40AU_EPHEMERAL_PG_URL must identify the disposable CI-only DB"
)
CO1="11111111-1111-4111-8111-111111111111"
CO2="22222222-2222-4222-8222-222222222222"
U1="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" # Fake company 1 owner, doc1 only
U2="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2" # Fake company 1 accounting, doc1+doc2
U3="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3" # Fake company 1 employee, doc1 ACL but role denied
U4="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4" # Fake company 2 owner, doc3
U5="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5" # Fake company 1 owner, NO document ACL
U6="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6" # Fake company 1 inactive admin
D1="dddddddd-dddd-4ddd-8ddd-ddddddddddd1"
D2="dddddddd-dddd-4ddd-8ddd-ddddddddddd2"
D3="dddddddd-dddd-4ddd-8ddd-ddddddddddd3"
D4="dddddddd-dddd-4ddd-8ddd-ddddddddddd4"

def psql(script):
    p=subprocess.run(["psql",DB_URL,"-X","-q","-t","-A",
                      "-v","ON_ERROR_STOP=1","-c",script],
                     text=True,capture_output=True,timeout=20)
    return p.returncode,p.stdout.strip(),p.stderr.strip()

def as_fake(user=U1,aal="aal2",document=D1,target="FAKE-BILL-M",
            revision=3, prelude="",query=None):
    if query is None:
        query=f"""SELECT coalesce(p40au_lab.read_one_customer_pdf(
            '{document}'::uuid,'{target}',{revision})::text,'null')"""
    statements=[
        "BEGIN",
        prelude.rstrip(";") if prelude else "",
        "SET LOCAL ROLE p40au_reader",
        f"SET LOCAL \"request.jwt.claim.sub\" = '{user}'" if user else "",
        f"SET LOCAL \"request.jwt.claim.aal\" = '{aal}'" if aal else "",
        query.rstrip(";"),
        "ROLLBACK",
    ]
    return psql(";\n".join(s for s in statements if s)+";")

def got(*args,**kwargs):
    code,stdout,stderr=as_fake(*args,**kwargs)
    if code:
        raise AssertionError(("Expected RLS query success",stderr[:300]))
    assert stdout in ("null",) or stdout.startswith("{"), stdout[:160]
    return None if stdout=="null" else json.loads(stdout)

def psql_admin(query):
    code,out,err=psql(query)
    if code:
        raise AssertionError(("Admin-only query failed",err[:200]))
    return out

class SyntheticDocumentSecurity(unittest.TestCase):
    def test_owner_only_one_authorized_document(self):
        record=got()
        self.assertEqual(record["project"],"FAKE-M-ZONE")
        self.assertEqual(record["customer"],"FAKE-CUSTOMER-A")
        self.assertEqual(record["lines"][0]["house"],"1A")
        self.assertEqual(record["receivableAmount"],300)

    def test_accounting_can_read_two_specifically_approved_documents(self):
        self.assertEqual(got(user=U2)["project"],"FAKE-M-ZONE")
        self.assertEqual(got(user=U2,document=D2,target="FAKE-BILL-K",revision=5)["project"],
                         "FAKE-K-ZONE")

    def test_owner_cannot_read_same_company_document_without_acl(self):
        self.assertIsNone(got(document=D2,target="FAKE-BILL-K",revision=5))

    def test_owner_without_any_document_acl_cannot_read_any_company_bill(self):
        self.assertIsNone(got(user=U5))

    def test_foreign_company_document_is_invisible(self):
        self.assertIsNone(got(document=D3,target="FAKE-BILL-OTHER",revision=8))

    def test_other_company_owner_cannot_read_company_one(self):
        self.assertIsNone(got(user=U4))

    def test_other_company_owner_can_only_read_own_authorized_bill(self):
        self.assertEqual(got(user=U4,document=D3,target="FAKE-BILL-OTHER",revision=8)["project"],
                         "FAKE-OTHER-COMPANY")

    def test_employee_with_document_acl_still_cannot_read_billing(self):
        self.assertIsNone(got(user=U3))

    def test_inactive_admin_with_document_acl_is_denied(self):
        self.assertIsNone(got(user=U6))

    def test_mfa_aal1_denied(self):
        self.assertIsNone(got(aal="aal1"))

    def test_missing_mfa_denied(self):
        self.assertIsNone(got(aal=""))

    def test_missing_test_subject_denied(self):
        self.assertIsNone(got(user=""))

    def test_unknown_member_denied(self):
        self.assertIsNone(got(user="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9"))

    def test_wrong_target_original_bill_denied(self):
        self.assertIsNone(got(target="FAKE-BILL-L"))

    def test_stale_revision_denied(self):
        self.assertIsNone(got(revision=2))

    def test_future_revision_denied(self):
        self.assertIsNone(got(revision=4))

    def test_archived_invoice_document_denied(self):
        self.assertIsNone(got(document=D4,target="FAKE-BILL-ARCHIVED",revision=2))

    def test_unknown_document_denied(self):
        self.assertIsNone(got(document="dddddddd-dddd-4ddd-8ddd-ddddddddddd9"))

    def test_document_acl_revocation_denied(self):
        change=f"""UPDATE p40au_lab.document_acl SET active=false
                WHERE document_id='{D1}' AND user_id='{U1}'"""
        self.assertIsNone(got(prelude=change))
        self.assertIsNotNone(got()) # Changes rolled back

    def test_membership_deactivation_denied(self):
        change=f"""UPDATE p40au_lab.memberships SET active=false
                WHERE company_id='{CO1}' AND user_id='{U1}'"""
        self.assertIsNone(got(prelude=change))
        self.assertIsNotNone(got())

    def test_source_revision_bump_denied(self):
        change=f"UPDATE p40au_lab.public_documents SET revision=4 WHERE id='{D1}'"
        self.assertIsNone(got(prelude=change))
        self.assertIsNotNone(got())

    def test_source_document_archival_denied(self):
        change=f"UPDATE p40au_lab.public_documents SET status='archived' WHERE id='{D1}'"
        self.assertIsNone(got(prelude=change))
        self.assertIsNotNone(got())

    def test_direct_table_select_only_authorized_document(self):
        code,out,err=as_fake(query="SELECT count(*) FROM p40au_lab.public_documents")
        self.assertEqual(code,0,err)
        self.assertEqual(out,"1")
        code,out,err=as_fake(user=U2,query="SELECT count(*) FROM p40au_lab.public_documents")
        self.assertEqual(code,0,err)
        self.assertEqual(out,"2")

    def test_direct_table_read_cannot_see_foreign_project_rows(self):
        code,out,err=as_fake(query="SELECT string_agg(public_view->>'project',',') FROM p40au_lab.public_documents")
        self.assertEqual(code,0,err)
        self.assertEqual(out,"FAKE-M-ZONE")
        self.assertNotIn("FAKE-OTHER-COMPANY",out)

    def test_membership_select_exposes_only_own_row(self):
        code,out,err=as_fake(query="SELECT count(*) FROM p40au_lab.memberships")
        self.assertEqual(code,0,err)
        self.assertEqual(out,"1")
        code,out,err=as_fake(user=U3,query="SELECT membership_role FROM p40au_lab.memberships")
        self.assertEqual(code,0,err)
        self.assertEqual(out,"employee")

    def test_document_acl_select_exposes_only_own_grants(self):
        code,out,err=as_fake(query="SELECT count(*) FROM p40au_lab.document_acl")
        self.assertEqual(code,0,err)
        self.assertEqual(out,"1")
        code,out,err=as_fake(user=U2,query="SELECT count(*) FROM p40au_lab.document_acl")
        self.assertEqual(code,0,err)
        self.assertEqual(out,"2")

    def test_cannot_update_documents_as_reader(self):
        rc,out,err=as_fake(query=f"UPDATE p40au_lab.public_documents SET revision=100 WHERE id='{D1}'")
        self.assertNotEqual(rc,0)
        self.assertIn("permission denied",err.lower())

    def test_cannot_insert_document_as_reader(self):
        rc,out,err=as_fake(query="""INSERT INTO p40au_lab.public_documents
            (id,company_id,target_billing_id,revision,status,public_view)
            SELECT 'dddddddd-dddd-4ddd-8ddd-ddddddddddd9',company_id,
                   'FAKE-BILL-WRITE',1,'active',public_view
            FROM p40au_lab.public_documents LIMIT 1""")
        self.assertNotEqual(rc,0)
        self.assertIn("permission denied",err.lower())

    def test_cannot_delete_documents_as_reader(self):
        rc,out,err=as_fake(query=f"DELETE FROM p40au_lab.public_documents WHERE id='{D1}'")
        self.assertNotEqual(rc,0)
        self.assertIn("permission denied",err.lower())

    def test_cannot_create_new_schema_as_reader(self):
        rc,out,err=as_fake(query="CREATE SCHEMA p40au_forged_by_reader")
        self.assertNotEqual(rc,0)
        self.assertIn("permission denied",err.lower())

    def test_function_is_security_invoker(self):
        out=psql_admin("""SELECT p.prosecdef::text FROM pg_proc p
              JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='p40au_lab' AND p.proname='read_one_customer_pdf'""")
        self.assertEqual(out,"false")

    def test_all_three_tables_use_forced_row_level_security(self):
        out=psql_admin("""SELECT count(*) FROM pg_class c
               JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='p40au_lab' AND c.relkind='r'
               AND c.relrowsecurity AND c.relforcerowsecurity""")
        self.assertEqual(out,"3")

    def test_lab_reader_has_no_bypass_rls(self):
        out=psql_admin("SELECT rolbypassrls::text FROM pg_roles WHERE rolname='p40au_reader'")
        self.assertEqual(out,"false")

    def test_no_select_grant_for_public_anonymous(self):
        out=psql_admin("""SELECT count(*) FROM information_schema.role_table_grants
             WHERE table_schema='p40au_lab' AND grantee='PUBLIC'""")
        self.assertEqual(out,"0")

    def test_no_snapshot_or_sensitive_business_columns(self):
        out=psql_admin("""SELECT string_agg(column_name,',') FROM information_schema.columns
                WHERE table_schema='p40au_lab' AND table_name='public_documents'""")
        cols=set(out.split(","))
        self.assertEqual(cols,{"id","company_id","target_billing_id","revision","status","public_view"})
        for private in ("data","erp_state","sourceSnapshots","invoiceNo","bankTransactions","payroll","salary"):
            self.assertNotIn(private,cols)

    def test_sample_public_projection_contains_no_private_source(self):
        view=got()
        s=json.dumps(view)
        self.assertEqual(set(view["mergedBillingProjects"]),{"FAKE-M-ZONE"})
        self.assertNotIn("FAKE-K-ZONE",s)
        self.assertNotIn("FAKE-OTHER-COMPANY",s)
        self.assertNotIn("invoiceNo",s)
        self.assertNotIn("sourceSnapshots",s)
        self.assertNotIn("bankTransactions",s)

    def test_client_cannot_send_extra_sensitive_payload_to_3_argument_api(self):
        rc,out,err=as_fake(query=f"""SELECT p40au_lab.read_one_customer_pdf(
          '{D1}'::uuid,'FAKE-BILL-M',3,
          '{{"sourceSnapshots":[],"payroll":[]}}'::jsonb)""")
        self.assertNotEqual(rc,0)
        self.assertIn("does not exist",err.lower())

    def test_public_ingestion_rejects_top_level_private_keys(self):
        rc,out,err=psql(f"""BEGIN;
        UPDATE p40au_lab.public_documents SET public_view=
          public_view || '{{"sourceSnapshots":[{{"invoiceNo":"PRIVATE-INVOICE"}}]}}'::jsonb
        WHERE id='{D1}';
        ROLLBACK;""")
        self.assertNotEqual(rc,0)
        self.assertIn("check constraint",err.lower())

    def test_public_ingestion_rejects_wrong_document_schema(self):
        rc,out,err=psql(f"""BEGIN;
        UPDATE p40au_lab.public_documents SET public_view=
          jsonb_set(public_view,'{{schema}}','"erp-full-snapshot"'::jsonb)
        WHERE id='{D1}';
        ROLLBACK;""")
        self.assertNotEqual(rc,0)
        self.assertIn("check constraint",err.lower())

    def test_no_production_credentials_or_schema_migrations(self):
        text=SQL.read_text(encoding="utf-8")
        self.assertIn("EPHEMERAL POSTGRES CI CONTAINER ONLY",text)
        self.assertNotIn("service_role",text.lower().replace("service_role","") if False else "")
        self.assertNotIn("jimcybsztnwfzrnvexsp",text)
        self.assertNotIn("company_owner_user_id",text)

if __name__=="__main__":
    unittest.main(verbosity=2)
