"""P40-16S fake cross-area multi-invoice, credit, settlement and public PDF safety.
Only disposable PostgreSQL 16 p40_16s_ci on 127.0.0.1.
No production ERP, billing records, real invoice numbers or Supabase access.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from urllib.parse import urlparse
import copy
import json
import os
import unittest
import psycopg

ROLES={"admin":"postgres","clerk":"p40s_clerk","public":"p40s_public"}
DSNS={name:os.getenv("P40S_"+name.upper()+"_DSN","") for name in ROLES}
for name,dsn in DSNS.items():
    u=urlparse(dsn)
    if u.hostname not in ("127.0.0.1","localhost") or u.path!="/p40_16s_ci" or u.username!=ROLES[name]:
        raise RuntimeError("CI-only PostgreSQL p40_16s_ci required: "+name)
GROUP="SYNTH-GROUP-1"
SOURCE={"L":"SYNTH-L","M":"SYNTH-M"}
INVOICE={"L":"SYNTH-INV-AUG","M":"SYNTH-INV-OCT"}
def db(role="admin"):
    return psycopg.connect(DSNS[role],connect_timeout=6)
def dictrow(cur):
    return dict(zip([x.name for x in cur.description],cur.fetchone()))
def header():
    with db() as c:
        return dictrow(c.execute("SELECT * FROM p40s_lab.fake_group WHERE id=%s",(GROUP,)))
def sources():
    with db() as c:
        return c.execute("SELECT id,area,original_untaxed,original_tax,original_gross "
         "FROM p40s_lab.fake_sources ORDER BY id").fetchall()
def invoices():
    with db() as c:
        return c.execute("SELECT source_id,invoice_number,invoice_month,original_gross "
         "FROM p40s_lab.fake_invoices ORDER BY invoice_month").fetchall()
def balances():
    with db() as c:
        cur=c.execute("SELECT * FROM p40s_lab.fake_source_balance ORDER BY source_id")
        names=[x.name for x in cur.description]
        return {x[0]:dict(zip(names,x)) for x in cur.fetchall()}
def events():
    with db() as c:
        return c.execute("SELECT operation_key,source_id,invoice_id,kind,amount,payload "
          "FROM p40s_lab.fake_event ORDER BY id").fetchall()
def salary_history():
    with db() as c:
        return c.execute("SELECT id,source_employee,amount FROM p40s_lab.fake_paid_salary_history").fetchall()
def public_doc(role="public"):
    with db(role) as c:
        return c.execute("SELECT p40s_lab.public_document(%s)",(GROUP,)).fetchone()[0]
def op(kind,source="L",amount=1,key=None,inv=None,role="clerk",
       sync=None,ledger=None,**extra):
    s=header()
    if sync is None:sync=s["sync_version"]
    if ledger is None:ledger=s["ledger_version"]
    payload={
        "key":key or "SYNTH-"+kind+"-"+source,
        "kind":kind,
        "source":SOURCE.get(source,source),
        "invoice":INVOICE.get(source,"SYNTH-INV-INVALID") if inv is None else inv,
        "amount":amount,**extra
    }
    with db(role) as c:
        return c.execute("SELECT * FROM p40s_lab.post_operation(%s::jsonb,%s,%s)",
            (json.dumps(payload,ensure_ascii=False),sync,ledger)).fetchone()
def credit(source="L",key=None,**kw):
    params=({"amount":21000,"net":20000,"tax":1000} if source=="L"
            else {"amount":11100,"net":10571,"tax":529})
    params.update({"approval":"SYNTH-APPROVAL-Q","credit":"SYNTH-CREDIT-Q"})
    params.update(kw)
    return op("CREDIT",source,key=key,**params)
def hold(source="L",rate=10,amount=None,**kwargs):
    return op("RETENTION_SET",source,amount=amount if amount is not None
       else (37900 if source=="L" else 22100),
       rate=str(rate),**kwargs)
def ar(source="L",amount=100000,key=None,**kwargs):
    return op("AR_RECEIPT",source,amount,key=key,**kwargs)
def release(source="L",amount=37900,key=None,**kwargs):
    return op("RETENTION_RECEIPT",source,amount,key=key,**kwargs)
def accrual(source="L",worker="SYNTH-EMP-A",base=14000,rate=2500,
            amount=3500,key=None,**kwargs):
    values={"worker":worker,"untaxedBase":base,"rateBps":rate,"review":"SYNTH-REVIEW-Q"}
    values.update(kwargs)
    return op("COMMISSION_ACCRUAL",source,amount,key=key,**values)
def target(source="L",sync=None,ledger=None,key="SYNTH-SELECT-TARGET"):
    h=header()
    with db() as c:
        return c.execute("SELECT p40s_lab.admin_choose_target(%s,%s,%s,%s)",
            (key,SOURCE.get(source,source),
             h["sync_version"] if sync is None else sync,
             h["ledger_version"] if ledger is None else ledger)).fetchone()[0]
def fully_settle_ar(source="L",after_partial=False):
    effective=(379000 if source=="L" else 221000)
    r=(37900 if source=="L" else 22100)
    partial=(100000 if source=="L" else 80000)
    total=effective-r
    if after_partial:
        return ar(source,total-partial,key="SYNTH-FINAL-AR-"+source)
    return ar(source,total,key="SYNTH-FULL-AR-"+source)

class MultiOriginalSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with db() as c:
            with psycopg.ClientCursor(c) as cursor:
                cursor.execute(Path(".p40-16s-tests/synthetic_group_invoice_ledger.sql").read_text())
    def setUp(self):
        with db() as c:
            c.execute("TRUNCATE p40s_lab.fake_event RESTART IDENTITY")
            c.execute("UPDATE p40s_lab.fake_source_balance SET "
              "credit_untaxed=0,credit_tax=0,retention_hold=0,ar_received=0,"
              "retention_received=0,commission_accrued=0")
            c.execute("UPDATE p40s_lab.fake_group SET display_source='SYNTH-M',"
              "bank_in=0,sync_version=1,ledger_version=0 WHERE id=%s",(GROUP,))

    def test_01_two_originals_not_a_third_receivable(self):
        self.assertEqual(len(sources()),2)
        self.assertEqual(sum(x[4] for x in sources()),632100)
        self.assertEqual(header()["original_gross"],632100)
        self.assertEqual(len(invoices()),2)
    def test_02_exact_original_untaxed_tax_preserved(self):
        self.assertEqual(sum(x[2] for x in sources()),602000)
        self.assertEqual(sum(x[3] for x in sources()),30100)
        for item in sources():self.assertEqual(item[2]+item[3],item[4])
    def test_03_aug_oct_invoices_stay_on_their_own_original(self):
        a,b=invoices()
        self.assertEqual((a[0],a[2],a[3]),("SYNTH-L","2026-08",400000))
        self.assertEqual((b[0],b[2],b[3]),("SYNTH-M","2026-10",232100))
    def test_04_public_projection_only_selected_m_area(self):
        v=public_doc()
        self.assertEqual(v["project"],"SYNTH-M-Area")
        self.assertEqual(v["mergedBillingProjects"],["SYNTH-M-Area"])
        self.assertEqual(v["grossTotal"],632100)
        self.assertEqual(sum(x["amount"] for x in v["lines"]),602000)
        self.assertEqual(len(v["mergedBillingProjects"]),1)
    def test_05_public_pdf_excludes_all_original_invoice_identifiers(self):
        raw=json.dumps(public_doc(),ensure_ascii=False)
        for internal in ("SYNTH-L","SYNTH-INV-AUG","SYNTH-INV-OCT",
          "SYNTH-INVOICE-202608","SYNTH-INVOICE-202610",
          "invoice_month","sourceSnapshots","receipt","creditEvidence",
          "SYNTH-EMP"):
            self.assertNotIn(internal,raw)
    def test_06_target_selector_can_switch_to_l_without_mutating_sources(self):
        initial=(sources(),invoices(),salary_history())
        self.assertEqual(target("L"),"TARGET_CHANGED_WITH_NO_ORIGINAL_MUTATION")
        self.assertEqual(public_doc()["mergedBillingProjects"],["SYNTH-L-Area"])
        self.assertEqual((sources(),invoices(),salary_history()),initial)
    def test_07_target_selector_refuses_not_member_or_stale_sync(self):
        with self.assertRaises(psycopg.Error):target("OTHER")
        self.assertEqual(target("L",sync=99),"CAS_CONFLICT")
        self.assertEqual(public_doc()["project"],"SYNTH-M-Area")
    def test_08_credit_l_links_aug_and_keeps_original_invoice(self):
        before=invoices()
        self.assertEqual(credit("L")[0],"SYNTHETIC_APPLIED")
        self.assertEqual(invoices(),before)
        self.assertEqual(balances()["SYNTH-L"]["credit_untaxed"],20000)
        self.assertEqual(balances()["SYNTH-L"]["credit_tax"],1000)
    def test_09_credit_m_links_oct_and_has_documented_tax_split(self):
        credit("M")
        b=balances()["SYNTH-M"]
        self.assertEqual(b["credit_untaxed"]+b["credit_tax"],11100)
        self.assertEqual((b["credit_untaxed"],b["credit_tax"]),(10571,529))
    def test_10_both_source_credits_total_to_exact_group_adjustment(self):
        original=invoices()
        credit("L");credit("M")
        d=balances()
        allowed=sum(x["credit_untaxed"]+x["credit_tax"] for x in d.values())
        self.assertEqual(allowed,32100)
        self.assertEqual(632100-allowed,600000)
        self.assertEqual(invoices(),original)
        self.assertEqual(header()["original_gross"],632100)
    def test_11_invoice_of_other_source_cannot_back_credit(self):
        with self.assertRaises(psycopg.Error):
            credit("L",inv="SYNTH-INV-OCT")
        self.assertEqual(events(),[])
    def test_12_missing_approval_or_credit_evidence_blocks(self):
        for kw in ({"approval":""},{"credit":""}):
            with self.subTest(kw=kw):
                with self.assertRaises(psycopg.Error):credit("L",**kw)
        self.assertEqual(events(),[])
    def test_13_invalid_tax_split_and_source_amount_block(self):
        for bad in ({"tax":999},{"net":20001},{"amount":32100}):
            with self.subTest(bad=bad):
                with self.assertRaises(psycopg.Error):credit("L",**bad)
        self.assertEqual(events(),[])
    def test_14_nonpositive_or_too_large_allowance_rejected(self):
        for v in (0,-1,100000000):
            with self.assertRaises(psycopg.Error):credit("L",amount=v)
    def test_15_multiple_distinct_credits_one_original_need_review(self):
        credit("L")
        with self.assertRaises(psycopg.Error):
            credit("L",key="SYNTH-SECOND-CREDIT")
        self.assertEqual(len(events()),1)
    def test_16_receipt_before_credit_locks_allowance_for_human_review(self):
        ar("L",100000)
        with self.assertRaises(psycopg.Error):credit("L")
        self.assertEqual(header()["bank_in"],100000)
        self.assertEqual(len(events()),1)
    def test_17_receipt_m_does_not_block_credit_l_other_original(self):
        ar("M",80000)
        self.assertEqual(credit("L")[0],"SYNTHETIC_APPLIED")
        self.assertEqual(balances()["SYNTH-L"]["credit_untaxed"],20000)
        self.assertEqual(balances()["SYNTH-M"]["ar_received"],80000)
    def test_18_credit_then_retention_10pct_per_source(self):
        credit("L");credit("M")
        hold("L");hold("M")
        d=balances()
        self.assertEqual(d["SYNTH-L"]["retention_hold"],37900)
        self.assertEqual(d["SYNTH-M"]["retention_hold"],22100)
        self.assertEqual(sum(x["retention_hold"] for x in d.values()),60000)
    def test_19_retention_rate_or_amount_mismatch_blocks(self):
        credit("L")
        with self.assertRaises(psycopg.Error):hold("L",rate=7)
        with self.assertRaises(psycopg.Error):hold("L",amount=39000)
        self.assertEqual(balances()["SYNTH-L"]["retention_hold"],0)
    def test_20_retention_after_ar_receipt_refused(self):
        credit("L");ar("L",1000)
        with self.assertRaises(psycopg.Error):hold("L")
    def test_21_two_source_partial_receipts_have_one_combined_bank_sum(self):
        credit("L");credit("M");hold("L");hold("M")
        ar("L",100000);ar("M",80000)
        d=balances()
        self.assertEqual(d["SYNTH-L"]["ar_received"],100000)
        self.assertEqual(d["SYNTH-M"]["ar_received"],80000)
        self.assertEqual(header()["bank_in"],180000)
    def test_22_ar_source_must_reference_matching_invoice(self):
        with self.assertRaises(psycopg.Error):
            ar("M",1000,inv="SYNTH-INV-AUG")
        self.assertEqual(header()["bank_in"],0)
    def test_23_each_original_ar_capped_separately_not_group_pool(self):
        credit("L");credit("M");hold("L");hold("M")
        with self.assertRaises(psycopg.Error):
            ar("M",220000)
        self.assertEqual(header()["bank_in"],0)
    def test_24_partial_ar_receipt_cannot_unlock_retention_release(self):
        credit("L");hold("L");ar("L",100000)
        with self.assertRaises(psycopg.Error):release("L")
        self.assertEqual(header()["bank_in"],100000)
    def test_25_source_l_full_ar_then_retention_receipt(self):
        credit("L");hold("L");fully_settle_ar("L")
        self.assertEqual(release("L")[0],"SYNTHETIC_APPLIED")
        s=header();b=balances()["SYNTH-L"]
        self.assertEqual(s["bank_in"],379000)
        self.assertEqual(b["retention_received"],37900)
    def test_26_second_retention_exceeding_balance_rejected(self):
        credit("L");hold("L");fully_settle_ar("L")
        release("L",20000)
        with self.assertRaises(psycopg.Error):
            release("L",20000,key="SYNTH-RET-2")
        self.assertEqual(balances()["SYNTH-L"]["retention_received"],20000)
    def test_27_two_source_complete_cash_matches_effective_600k(self):
        credit("L");credit("M");hold("L");hold("M")
        fully_settle_ar("L");fully_settle_ar("M")
        release("L");release("M",22100)
        self.assertEqual(header()["bank_in"],600000)
        self.assertEqual(sum(x["ar_received"]+x["retention_received"]
                             for x in balances().values()),600000)
    def test_28_commission_locked_when_only_partially_received(self):
        credit("L");hold("L");ar("L",100000)
        with self.assertRaises(psycopg.Error):accrual("L")
        self.assertEqual(balances()["SYNTH-L"]["commission_accrued"],0)
    def test_29_commission_l_unlock_does_not_require_other_source_settled(self):
        credit("L");credit("M");hold("L");hold("M")
        fully_settle_ar("L");ar("M",80000)
        self.assertEqual(accrual("L")[0],"SYNTHETIC_APPLIED")
        with self.assertRaises(psycopg.Error):accrual("M")
        self.assertEqual(balances()["SYNTH-M"]["commission_accrued"],0)
    def test_30_two_workers_each_25pct_of_untaxed_14000(self):
        credit("L");hold("L");fully_settle_ar("L")
        accrual("L",worker="SYNTH-EMP-A",key="SYNTH-COMM-A")
        accrual("L",worker="SYNTH-EMP-B",key="SYNTH-COMM-B")
        self.assertEqual(balances()["SYNTH-L"]["commission_accrued"],7000)
        self.assertEqual(salary_history(),[("SYNTH-HISTORIC-PAID-SALARY","SYNTH-EMP-A",4000)])
    def test_31_duplicate_worker_credit_on_same_source_blocked(self):
        credit("L");hold("L");fully_settle_ar("L")
        accrual("L",key="SYNTH-COMM-A")
        with self.assertRaises(psycopg.Error):
            accrual("L",key="SYNTH-COMM-AGAIN")
    def test_32_commission_wrong_untaxed_basis_or_rate_blocked(self):
        credit("L");hold("L");fully_settle_ar("L")
        for kw in ({"base":14001},{"rate":3000},{"amount":7000},
                   {"review":""},{"worker":"REAL-EMP"}):
            with self.subTest(kw=kw):
                with self.assertRaises(psycopg.Error):accrual("L",**kw)
        self.assertEqual(balances()["SYNTH-L"]["commission_accrued"],0)
    def test_33_original_paid_salary_immutable_and_not_recomputed(self):
        original=salary_history()
        credit("L");hold("L");fully_settle_ar("L");accrual("L")
        self.assertEqual(salary_history(),original)
        for sql in ("UPDATE p40s_lab.fake_paid_salary_history SET amount=1",
                    "DELETE FROM p40s_lab.fake_paid_salary_history"):
            with self.assertRaises(psycopg.Error):
                with db() as c:c.execute(sql)
        self.assertEqual(salary_history(),original)
    def test_34_duplicate_event_key_with_same_payload_is_idempotent(self):
        a=credit("L")
        b=credit("L",sync=1,ledger=0)
        self.assertEqual((a[0],b[0]),("SYNTHETIC_APPLIED","DUPLICATE"))
        self.assertEqual(len(events()),1)
        self.assertEqual(header()["ledger_version"],1)
    def test_35_event_key_reused_for_other_invoice_source_is_blocked(self):
        credit("L")
        with self.assertRaises(psycopg.Error):
            credit("M",key="SYNTH-CREDIT-L")
        self.assertEqual(len(events()),1)
    def test_36_stale_sync_and_ledger_both_refused(self):
        credit("L")
        s=header()
        self.assertEqual(ar("L",1,sync=1,ledger=s["ledger_version"])[0],"CAS_CONFLICT")
        self.assertEqual(ar("L",1,sync=s["sync_version"],ledger=0)[0],"CAS_CONFLICT")
        self.assertEqual(len(events()),1)
    def test_37_concurrent_credits_on_same_group_serialize(self):
        snap=header()
        barrier=Barrier(2)
        def go(src):
            barrier.wait(timeout=8)
            return credit(src,sync=snap["sync_version"],ledger=snap["ledger_version"])[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            jobs=[pool.submit(go,s) for s in ("L","M")]
            results=[x.result(timeout=15) for x in jobs]
        self.assertCountEqual(results,["SYNTHETIC_APPLIED","CAS_CONFLICT"])
        self.assertEqual(len(events()),1)
    def test_38_public_invoice_metadata_not_accessible_to_external_role(self):
        with db("public") as c:
            for table in ("fake_sources","fake_invoices","fake_event",
                "fake_source_balance","fake_paid_salary_history"):
                self.assertFalse(c.execute(
                    "SELECT has_table_privilege(current_user,%s,'SELECT')",
                    ("p40s_lab."+table,)).fetchone()[0])
            self.assertTrue(c.execute("SELECT has_function_privilege(current_user,"
             "'p40s_lab.public_document(text)','EXECUTE')").fetchone()[0])
        with self.assertRaises(psycopg.Error):
            with db("public") as c:c.execute("SELECT * FROM p40s_lab.fake_invoices")
    def test_39_internal_clerk_cannot_directly_edit_original_or_invoice(self):
        for q in ("UPDATE p40s_lab.fake_sources SET original_gross=1",
                  "DELETE FROM p40s_lab.fake_invoices",
                  "INSERT INTO p40s_lab.fake_event(operation_key,source_id,invoice_id,kind,amount,payload)"
                  " VALUES('SYNTH-FORGE','SYNTH-L','SYNTH-INV-AUG','AR_RECEIPT',1,'{}')"):
            with self.assertRaises(psycopg.Error):
                with db("clerk") as c:c.execute(q)
    def test_40_public_projection_unchanged_by_internal_credit_and_cash(self):
        before=public_doc()
        credit("L");credit("M");hold("L");hold("M")
        ar("L",100000);ar("M",80000)
        self.assertEqual(public_doc(),before)
    def test_41_total_per_source_does_not_double_count_group(self):
        credit("L");credit("M");hold("L");hold("M")
        d=balances()
        effective=[x[4]-d[x[0]]["credit_untaxed"]-d[x[0]]["credit_tax"]
                   for x in sources()]
        self.assertEqual(effective,[379000,221000])
        self.assertEqual(sum(effective),600000)
        self.assertEqual(header()["bank_in"],0)
    def test_42_invoice_months_immutable_and_credit_events_separate(self):
        original=invoices()
        credit("L");credit("M")
        self.assertEqual(invoices(),original)
        for sql in ("UPDATE p40s_lab.fake_invoices SET invoice_month='2026-10' "
                    "WHERE source_id='SYNTH-L'",
                    "DELETE FROM p40s_lab.fake_invoices WHERE source_id='SYNTH-M'"):
            with self.assertRaises(psycopg.Error):
                with db() as c:c.execute(sql)
        self.assertEqual(invoices(),original)
    def test_43_public_view_no_business_data_derived_from_p40r_invoice_projection(self):
        p=public_doc()
        self.assertEqual(p["schema"],"p40s-customer-pdf-projection-v1")
        self.assertEqual(p["invoiceStatus"],"invoice_pending")
        self.assertNotIn("invoices",p)
        self.assertNotIn("credit",p)
        self.assertNotIn("sources",p)
    def test_44_only_synthetic_source_schema_and_no_production_hooks(self):
        text=Path(".p40-16s-tests/synthetic_group_invoice_ledger.sql").read_text()
        app=Path("index.html").read_text()
        for bad in ("public.erp_states","https://","service_role",
                    "KuSheERP25_Core34_DB","耀時代","jacky54508"):
            self.assertNotIn(bad,text)
        self.assertNotIn("p40-16s",app)

if __name__=="__main__":
    unittest.main(verbosity=2)
