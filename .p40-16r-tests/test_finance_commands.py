"""P40-16R disposable PostgreSQL: synthetic source-linked accounting operations.

This tests the proposed safety principles, NOT full ERP business semantics.
Only connects to GitHub CI database p40_16r_ci on localhost. Never Supabase.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from urllib.parse import urlsplit
import os
import json
import unittest
import psycopg

USERS = {"admin": "postgres", "operator": "p40r_operator", "viewer": "p40r_viewer"}
DSNS = {label:os.getenv(f"P40R_{label.upper()}_DSN","") for label in USERS}
for label,dsn in DSNS.items():
    u=urlsplit(dsn)
    if u.hostname not in ("localhost","127.0.0.1") or u.path!="/p40_16r_ci" or u.username!=USERS[label]:
        raise RuntimeError(f"DISALLOWED_NONISOLATED_DATABASE:{label}")
DOC="SYNTH-R-BILL"
def db(role="admin"):return psycopg.connect(DSNS[role],connect_timeout=6)

def state():
    with db() as c:
        cur=c.execute("SELECT * FROM p40r_lab.fake_summary WHERE doc_id=%s",(DOC,))
        return dict(zip([col.name for col in cur.description],cur.fetchone()))
def events():
    with db() as c:
        return c.execute("SELECT operation_key,kind,source_key,amount,evidence "
            "FROM p40r_lab.fake_events ORDER BY id").fetchall()
def action(kind,key,amount,source="SYNTH-R-BILL",evidence=None,role="operator",
           sync=None,ledger=None,doc=DOC):
    if sync is None or ledger is None:
        s=state()
        sync=s["sync_version"] if sync is None else sync
        ledger=s["ledger_version"] if ledger is None else ledger
    with db(role) as c:
        return c.execute(
            "SELECT * FROM p40r_lab.post_action(%s,%s,%s,%s,%s,%s,%s,%s::jsonb)",
            (doc,key,kind,source,amount,sync,ledger,json.dumps({} if evidence is None else evidence))
        ).fetchone()

def discount(amount=32100,key="SYNTH-R-ALLOWANCE"):
    return action("APPROVE_DISCOUNT",key,amount,evidence={"approval_ref":"SYNTH-APPROVAL-1"})
def invoice(amount=632100,key="SYNTH-R-INVOICE"):
    return action("ISSUE_INVOICE",key,amount)
def credit(amount=32100,key="SYNTH-R-CREDIT",
           source="SYNTH-R-INVOICE",evidence=None):
    if evidence is None:evidence={"approval_ref":"SYNTH-APPROVAL-2","credit_evidence_ref":"SYNTH-CREDIT-2026"}
    return action("CREDIT_NOTE_DISCOUNT",key,amount,source,evidence)
def retention(amount=30000,key="SYNTH-R-RETENTION"):
    return action("SET_RETENTION",key,amount)
def receive_ar(amount,key="SYNTH-R-AR"):
    return action("RECEIVE_AR",key,amount,"SYNTH-R-INVOICE")
def receive_retention(amount,key="SYNTH-R-RET-PAY"):
    return action("RECEIVE_RETENTION",key,amount,"SYNTH-R-RETENTION")
def payable(amount=10000,key="SYNTH-R-VENDOR-BILL"):
    return action("REGISTER_PAYABLE",key,amount,"SYNTH-VENDOR")
def pay_vendor(amount,key="SYNTH-R-VENDOR-PAID",source="SYNTH-R-VENDOR-BILL"):
    return action("PAY_VENDOR",key,amount,source)
def payroll(amount=4000,key="SYNTH-R-PAYROLL"):
    return action("REGISTER_PAYROLL",key,amount,"SYNTH-EMPLOYEE")
def pay_salary(amount,key="SYNTH-R-SALARY-PAID",source="SYNTH-R-PAYROLL"):
    return action("PAY_SALARY",key,amount,source)
def commission(amount=7000,key="SYNTH-R-COMMISSION",rate=5000,base=14000,approved=True):
    evidence={"untaxed_base":base,"rate_bps":rate}
    if approved:evidence["review_ref"]="SYNTH-REVIEW-APPROVED"
    return action("ACCRUE_COMMISSION",key,amount,"SYNTH-EMPLOYEE",evidence)

class AccountingCommands(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with db() as c:
            with psycopg.ClientCursor(c) as client:
                client.execute(Path(".p40-16r-tests/isolated_accounting_commands.sql").read_text())
    def setUp(self):
        with db() as c:
            c.execute("TRUNCATE p40r_lab.fake_events RESTART IDENTITY")
            c.execute("UPDATE p40r_lab.fake_summary SET "
                "original_gross=632100,effective_gross=632100,invoice_gross=0,"
                "credit_note_total=0,discount_total=0,ar_received=0,"
                "retention_hold=0,retention_received=0,vendor_due=0,"
                "vendor_paid=0,payroll_due=0,payroll_paid=0,"
                "commission_accrued=0,bank_in=0,bank_out=0,"
                "sync_version=1,ledger_version=0 WHERE doc_id=%s",(DOC,))
    def test_01_initial_financial_projection(self):
        s=state()
        self.assertEqual((s["original_gross"],s["effective_gross"]), (632100,632100))
        self.assertEqual((s["sync_version"],s["ledger_version"]), (1,0))
        self.assertEqual(events(),[])
    def test_02_daily_and_material_work_remain_possible_after_discount(self):
        discount()
        self.assertEqual(action("RECORD_DAILY","SYNTH-R-DAILY",1)[0],"SYNTHETIC_APPLIED")
        self.assertEqual(action("RECORD_MATERIAL","SYNTH-R-MATERIAL",2)[0],"SYNTHETIC_APPLIED")
        self.assertEqual(state()["effective_gross"],600000)
        self.assertEqual(len(events()),3)
    def test_03_preinvoice_discount_preserves_original_gross(self):
        discount()
        s=state()
        self.assertEqual(s["original_gross"],632100)
        self.assertEqual((s["discount_total"],s["effective_gross"]), (32100,600000))
    def test_04_discount_without_builder_approval_ref_blocked(self):
        with self.assertRaises(psycopg.Error):
            action("APPROVE_DISCOUNT","SYNTH-NO-APPROVAL",32100)
        self.assertEqual(state()["effective_gross"],632100)
    def test_05_preinvoice_discount_rejects_missing_and_too_large_amount(self):
        for amount in (632100,700000):
            with self.assertRaises(psycopg.Error):
                action("APPROVE_DISCOUNT","SYNTH-TOO-BIG",amount,
                       evidence={"approval_ref":"SYNTH-APPROVAL-1"})
        self.assertEqual(events(),[])
    def test_06_second_discount_same_doc_requires_further_explicit_review(self):
        discount()
        with self.assertRaises(psycopg.Error):
            action("APPROVE_DISCOUNT","SYNTH-SECOND",100,
                   evidence={"approval_ref":"SYNTH-APPROVAL-1"})
        self.assertEqual(state()["discount_total"],32100)
    def test_07_invoice_issued_after_discount_uses_verified_net_gross(self):
        discount()
        self.assertEqual(invoice(600000)[0],"SYNTHETIC_APPLIED")
        self.assertEqual(state()["invoice_gross"],600000)
    def test_08_invoice_wrong_total_blocked(self):
        discount()
        with self.assertRaises(psycopg.Error):invoice(632100)
        self.assertEqual(state()["invoice_gross"],0)
    def test_09_duplicate_invoice_issued_again_under_new_operation_key_blocked(self):
        invoice()
        with self.assertRaises(psycopg.Error):
            invoice(key="SYNTH-SECOND-INVOICE")
        self.assertEqual(state()["invoice_gross"],632100)
    def test_10_issued_invoice_demands_credit_note_for_discount(self):
        invoice()
        with self.assertRaises(psycopg.Error):discount()
        self.assertEqual(state()["effective_gross"],632100)
        self.assertEqual(state()["credit_note_total"],0)
    def test_11_credit_note_needs_original_invoice_source(self):
        invoice()
        with self.assertRaises(psycopg.Error):
            credit(source="SYNTH-WRONG-INVOICE")
        self.assertEqual(state()["credit_note_total"],0)
    def test_12_credit_note_needs_documented_credit_evidence(self):
        invoice()
        with self.assertRaises(psycopg.Error):
            credit(evidence={"approval_ref":"SYNTH-APPROVAL-2"})
    def test_13_credit_note_after_issued_invoice_atomically_reconciles(self):
        invoice()
        self.assertEqual(credit()[0],"SYNTHETIC_APPLIED")
        s=state()
        self.assertEqual((s["original_gross"],s["invoice_gross"],
                          s["credit_note_total"],s["effective_gross"]),
                         (632100,632100,32100,600000))
        self.assertEqual([x[1] for x in events()],["ISSUE_INVOICE","CREDIT_NOTE_DISCOUNT"])
    def test_14_discount_after_incoming_cash_requires_accounting_review(self):
        invoice();receive_ar(10000)
        with self.assertRaises(psycopg.Error):credit()
        self.assertEqual(state()["effective_gross"],632100)
    def test_15_receipt_without_invoice_reference_rejected(self):
        with self.assertRaises(psycopg.Error):
            receive_ar(1000)
        self.assertEqual(state()["bank_in"],0)
    def test_16_receipt_wrong_source_rejected(self):
        invoice()
        with self.assertRaises(psycopg.Error):
            action("RECEIVE_AR","SYNTH-R-AR-WRONG",1000,"SYNTH-WRONG")
    def test_17_receipt_payment_and_bank_inflow_are_same_transaction(self):
        invoice();receive_ar(120000)
        s=state()
        self.assertEqual((s["ar_received"],s["bank_in"]), (120000,120000))
        self.assertEqual(len(events()),2)
    def test_18_receive_ar_rejects_overpayment_without_partial_bank_event(self):
        invoice()
        with self.assertRaises(psycopg.Error):
            receive_ar(632101)
        self.assertEqual(state()["bank_in"],0)
        self.assertEqual(len(events()),1)
    def test_19_retention_explicit_holdback_and_ar_cap(self):
        invoice();retention(30000)
        with self.assertRaises(psycopg.Error):
            receive_ar(632100)
        self.assertEqual(receive_ar(602100)[0],"SYNTHETIC_APPLIED")
        self.assertEqual(state()["bank_in"],602100)
    def test_20_retention_released_receipt_and_bank_atomically(self):
        invoice();retention(30000);receive_ar(602100)
        self.assertEqual(receive_retention(30000)[0],"SYNTHETIC_APPLIED")
        s=state()
        self.assertEqual((s["retention_received"],s["bank_in"]),(30000,632100))
        self.assertEqual(s["ar_received"]+s["retention_received"],s["effective_gross"])
    def test_21_duplicate_or_excess_retention_receipt_blocked(self):
        invoice();retention(30000);receive_retention(20000)
        with self.assertRaises(psycopg.Error):
            receive_retention(20000,key="SYNTH-R-RET-PAY-2")
        self.assertEqual(state()["retention_received"],20000)
    def test_22_cannot_rewrite_retention_after_cash_received(self):
        invoice();receive_ar(1000)
        with self.assertRaises(psycopg.Error):retention()
        self.assertEqual(state()["retention_hold"],0)
    def test_23_after_discount_regular_receipts_and_retention_still_work(self):
        discount();invoice(600000);retention(30000)
        receive_ar(570000);receive_retention(30000)
        s=state()
        self.assertEqual((s["bank_in"],s["effective_gross"]), (600000,600000))
    def test_24_vendor_bill_and_payment_atomically_affect_bank_out(self):
        discount();payable(10000);pay_vendor(10000)
        s=state()
        self.assertEqual((s["vendor_due"],s["vendor_paid"],s["bank_out"]),(10000,10000,10000))
        self.assertEqual(s["effective_gross"],600000)
    def test_25_vendor_payment_wrong_source_rejected(self):
        payable(10000)
        with self.assertRaises(psycopg.Error):
            pay_vendor(10000,source="SYNTH-OTHER-VENDOR-BILL")
    def test_26_vendor_overpayment_blocked(self):
        payable(10000)
        with self.assertRaises(psycopg.Error):pay_vendor(10001)
        self.assertEqual(state()["bank_out"],0)
    def test_27_salary_registration_and_paid_bank_outflow_atomic(self):
        discount();payroll(4000);pay_salary(4000)
        s=state()
        self.assertEqual((s["payroll_due"],s["payroll_paid"],s["bank_out"]),(4000,4000,4000))
    def test_28_salary_payment_requires_existing_source_record(self):
        with self.assertRaises(psycopg.Error):pay_salary(4000)
        self.assertEqual(state()["payroll_paid"],0)
    def test_29_salary_overpayment_blocked_without_bank_change(self):
        payroll(4000)
        with self.assertRaises(psycopg.Error):pay_salary(5000)
        self.assertEqual(state()["bank_out"],0)
    def test_30_paid_salary_not_automatically_recomputed_by_discount(self):
        payroll(4000);pay_salary(4000);discount()
        s=state()
        self.assertEqual((s["payroll_paid"],s["payroll_due"],s["effective_gross"]),
                         (4000,4000,600000))
        self.assertEqual(s["bank_out"],4000)
    def test_31_original_payroll_event_cannot_be_updated_or_deleted(self):
        payroll(4000);pay_salary(4000)
        for query in (
            "UPDATE p40r_lab.fake_events SET amount=1 WHERE kind='PAY_SALARY'",
            "DELETE FROM p40r_lab.fake_events WHERE kind='PAY_SALARY'"
        ):
            with self.assertRaises(psycopg.Error):
                with db() as c:c.execute(query)
        self.assertEqual(state()["payroll_paid"],4000)
    def test_32_commission_bases_on_untaxed_14000_at_50pct_7000(self):
        discount()
        commission()
        s=state()
        self.assertEqual(s["commission_accrued"],7000)
        self.assertEqual(s["payroll_paid"],0)
        self.assertEqual(s["bank_out"],0)
    def test_33_two_worker_share_50pct_as_two_25pct_records(self):
        commission(3500,"SYNTH-R-COMMISSION-WORKER-A",rate=2500)
        commission(3500,"SYNTH-R-COMMISSION-WORKER-B",rate=2500)
        self.assertEqual(state()["commission_accrued"],7000)
        self.assertEqual(state()["payroll_due"],0)
    def test_34_commission_mismatch_or_missing_review_rejected(self):
        for kwargs in (
            {"amount":8000},{"amount":7000,"approved":False},
            {"amount":7000,"rate":6000}
        ):
            with self.assertRaises(psycopg.Error):commission(**kwargs)
        self.assertEqual(state()["commission_accrued"],0)
    def test_35_duplicate_operation_key_idempotent_even_with_stale_version(self):
        original=payable()
        again=action("REGISTER_PAYABLE","SYNTH-R-VENDOR-BILL",10000,"SYNTH-VENDOR",
                     sync=1,ledger=0)
        self.assertEqual((original[0],again[0]),("SYNTHETIC_APPLIED","REPLAY"))
        self.assertEqual(len(events()),1)
    def test_36_key_reuse_with_changed_payload_rejected(self):
        payable()
        with self.assertRaises(psycopg.Error):
            payable(9999)
        self.assertEqual(state()["vendor_due"],10000)
    def test_37_stale_sync_and_ledger_versions_both_rejected(self):
        payable()
        s=state()
        for sync,ledger in ((1,s["ledger_version"]),
                            (s["sync_version"],0)):
            self.assertEqual(action("RECORD_DAILY","SYNTH-R-OLD-VERSION",
               1,sync=sync,ledger=ledger)[0],"CAS_CONFLICT")
        self.assertEqual(len(events()),1)
    def test_38_multi_action_payment_and_discount_are_serialized(self):
        s=state()
        barrier=Barrier(2)
        def work(which):
            barrier.wait(timeout=8)
            if which=="discount":
                return action("APPROVE_DISCOUNT","SYNTH-R-ALLOWANCE",32100,
                  evidence={"approval_ref":"SYNTH-APPROVAL-1"},
                  sync=s["sync_version"],ledger=s["ledger_version"])[0]
            return action("REGISTER_PAYABLE","SYNTH-R-VENDOR-BILL",10000,
              "SYNTH-VENDOR",sync=s["sync_version"],ledger=s["ledger_version"])[0]
        with ThreadPoolExecutor(max_workers=2) as ex:
            fs=[ex.submit(work,k) for k in ("discount","vendor")]
            results=[f.result(timeout=15) for f in fs]
        self.assertCountEqual(results,["SYNTHETIC_APPLIED","CAS_CONFLICT"])
        self.assertEqual(len(events()),1)
        self.assertEqual(state()["sync_version"],s["sync_version"]+1)
    def test_39_viewer_is_readonly_and_cannot_call_posting(self):
        with db("viewer") as c:
            row=c.execute("SELECT original_gross FROM p40r_lab.fake_summary").fetchone()
            self.assertEqual(row[0],632100)
            self.assertFalse(c.execute("SELECT has_function_privilege("
              "current_user,'p40r_lab.post_action(text,text,text,text,integer,bigint,bigint,jsonb)',"
              "'EXECUTE')").fetchone()[0])
        with self.assertRaises(psycopg.Error):
            action("RECORD_DAILY","SYNTH-VIEWER-BYPASS",1,role="viewer")
    def test_40_operator_cannot_directly_update_summary_or_events(self):
        for sql in (
            "UPDATE p40r_lab.fake_summary SET effective_gross=5",
            "INSERT INTO p40r_lab.fake_events(operation_key,doc_id,kind,"
            "source_key,amount) VALUES('SYNTH-UNAUTH','SYNTH-R-BILL',"
            "'RECORD_DAILY','SYNTH-R-BILL',1)",
        ):
            with self.assertRaises(psycopg.Error):
                with db("operator") as c:c.execute(sql)
    def test_41_wrong_document_and_non_synthetic_source_rejected(self):
        with self.assertRaises(psycopg.Error):
            action("RECORD_DAILY","SYNTH-WRONG-DOC",1,doc="SYNTH-ANOTHER")
        with self.assertRaises(psycopg.Error):
            action("RECORD_DAILY","SYNTH-R-DAILY",1,source="REAL-CUSTOMER")
    def test_42_full_synthetic_workflow_consistent_in_one_ledger(self):
        discount();invoice(600000);retention(30000)
        receive_ar(570000);receive_retention(30000)
        payable(10000);pay_vendor(10000)
        payroll(4000);pay_salary(4000)
        commission()
        action("RECORD_DAILY","SYNTH-R-DAILY",1)
        action("RECORD_MATERIAL","SYNTH-R-MATERIAL",1)
        s=state()
        self.assertEqual((s["original_gross"],s["effective_gross"]), (632100,600000))
        self.assertEqual((s["invoice_gross"],s["bank_in"],s["bank_out"]),(600000,600000,14000))
        self.assertEqual(s["payroll_paid"],4000)
        self.assertEqual(s["commission_accrued"],7000)
        self.assertEqual(len(events()),12)
        self.assertEqual(s["ledger_version"],12)
        self.assertEqual(s["sync_version"],13)
    def test_43_no_public_execute_for_sensitive_functions(self):
        with db() as c:
            for role in ("p40r_viewer","p40r_operator"):
                self.assertFalse(c.execute("SELECT has_function_privilege(%s,"
                   "'p40r_lab.ref_exists(text,text)','EXECUTE')",(role,)).fetchone()[0])
            self.assertTrue(c.execute("SELECT has_function_privilege("
                "'p40r_operator','p40r_lab.post_action(text,text,text,text,integer,bigint,bigint,jsonb)',"
                "'EXECUTE')").fetchone()[0])
    def test_44_report_no_production_erp_migration_or_data(self):
        source=Path(".p40-16r-tests/isolated_accounting_commands.sql").read_text()
        for bad in ("public.erp_states","p40r_service_role","supabase.co",
                    "KuSheERP25_Core34_DB","耀時代","jacky54508"):
            self.assertNotIn(bad,source)
        self.assertNotIn("p40-16r",Path("index.html").read_text())
if __name__=="__main__":
    unittest.main(verbosity=2)
