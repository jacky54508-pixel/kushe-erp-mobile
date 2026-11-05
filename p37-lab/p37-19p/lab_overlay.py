"""P37-19P lab-only, SHA-pinned overlay of an ORIGINAL ERP Store code copy.

NEVER write this overlay into assets/js/erp-store.js, main, beta, or a formal URL.
Accept exactly the original SHA and exact reviewed source spans.
All output remains in a tempfile served only from 127.0.0.1 in CI.
"""
from __future__ import annotations
import hashlib
from pathlib import Path

ORIGINAL_SHA = "1d74daabcf51a6f47b03bac9bbc5407ca881272d"
ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / "assets" / "js" / "erp-store.js"
LAB_ONLY = "P37_19P_UNVERIFIED_SYNTHETIC_FINANCE_OVERLAY_ONLY"


def fail(reason):
    raise ValueError("P37-19P OVERLAY_REJECTED_" + reason)


def replace_exact(source, old, new, expected=1, name="unknown"):
    occurrences = source.count(old)
    if occurrences != expected:
        fail(f"{name}_SOURCE_ANCHOR_{occurrences}_EXPECTED_{expected}")
    return source.replace(old, new)


INJECTED_READER = r"""
  // P37-19P: LAB COPY ONLY, NOT formal ERP. Never post in production.
  // Invoke the existing P37-18 cross-document source and tax-ledger reader.
  // Source-identity fence: no real-looking account can even load this LAB copy.
  const p3719pStartup=window.P37P;
  if(window.location?.hostname!=='127.0.0.1'||
     window.location?.protocol!=='http:'||
     window.location?.pathname!=='/'||
     p3719pStartup?.isolatedFixture!==true||
     p3719pStartup?.scope!=='P37_19P_UNVERIFIED_SYNTHETIC_FINANCE_OVERLAY_ONLY'||
     !Array.isArray(p3719pStartup.snapshot?.billings)||
     !Array.isArray(p3719pStartup.snapshot?.receivables)||
     p3719pStartup.snapshot.billings.some(x=>!/^P37-19-SYN-[A-Z0-9-]+$/.test(String(x?.id||'')))||
     p3719pStartup.snapshot.receivables.some(x=>!/^P37-19-SYN-[A-Z0-9-]+$/.test(String(x?.id||'')))) {
    throw new Error('P37-19P_LAB_BOOTSTRAP_NON_SYNTHETIC_SOURCE');
  }
  function p3719pLabEffective(ar) {
    if(window.location?.hostname!=='127.0.0.1'||
       window.location?.protocol!=='http:'||
       window.location?.pathname!=='/'||
       window.P37P?.scope!=='P37_19P_UNVERIFIED_SYNTHETIC_FINANCE_OVERLAY_ONLY'||
       window.P37P?.isolatedFixture!==true) {
      throw new Error('P37-19P LAB_ORIGIN_AND_FIXTURE_REQUIRED');
    }
    const rid=String(ar?.id||'');
    if(!/^P37-19-SYN-[A-Z0-9-]+$/.test(rid)||
       (state.billings||[]).some(row=>!/^P37-19-SYN-[A-Z0-9-]+$/.test(String(row?.id||'')))||
       (state.receivables||[]).some(row=>!/^P37-19-SYN-[A-Z0-9-]+$/.test(String(row?.id||'')))) {
      throw new Error('P37-19P_NON_SYNTHETIC_FINANCE_SOURCE');
    }
    const inspector=window.KusheP3718EffectiveLedger;
    if(!inspector||typeof inspector.inspect!=='function')
      throw new Error('P37-19P_P37_18_SOURCE_READER_REQUIRED');
    const found=inspector.inspect(state,rid);
    if(found?.readOnly!==true||found?.appliedToERP!==false||
       found?.cloudWrites!==0||found?.formalReceiptWriterConnected!==false)
      throw new Error('P37-19P_P37_18_RESULT_NOT_READ_ONLY');
    if(found.status==='ORIGINAL_UNADJUSTED')return null;
    if(found.status!=='POSTED_RECORD_CONTRACT_REVIEW_ONLY'||
       found.officialVoucherIndependentlyVerifiedBySystem!==false||
       found.source?.receivableId!==rid||
       !/^P37-19-SYN-[A-Z0-9-]+$/.test(found.source?.billingId||''))
      throw new Error('P37-19P_ADJUSTMENT_CONTRACT_NOT_VERIFIED');
    const amount=found.proposed?.receivable,retention=found.proposed?.retention;
    if(!Number.isSafeInteger(amount)||amount<0||
       !Number.isSafeInteger(retention)||retention<0||
       !Number.isSafeInteger(found.proposed?.received)||
       !Number.isSafeInteger(found.proposed?.retentionReceived)||
       found.proposed?.received>amount||
       found.proposed?.retentionReceived>retention) {
      throw new Error('P37-19P_EFFECTIVE_BALANCE_NOT_VERIFIED');
    }
    return {receivable:amount,retention,reviewOnly:true};
  }
  function p3719pLabApprovedAR(ar) {
    const e=p3719pLabEffective(ar);
    return e?e.receivable:ar.amount;
  }
  function p3719pLabApprovedRetention(ar,billing) {
    const e=p3719pLabEffective(ar);
    return e?e.retention:Math.max(0,num(ar.retentionAmount??ar.retention??billing?.retentionAmount??billing?.retention));
  }

"""

RETENTION_BRANCH = r"""    // P37-19P: approved amount is only a computed overlay. Never replace the
    // original invoice/billing/AR retention amount in the actual snapshot.
    const p3719pApproved=p3719pLabEffective(ar);
    if(p3719pApproved){
      const capacity=p3719pApproved.retention;
      const recorded=state.retentionReceipts.filter(row=>
        row.receivableId===ar.id||
        row.billingId&&row.billingId===ar.billingId
      ).reduce((sum,row)=>sum+strictReceiptMoney(row.amount,'P37 合成保留款'),0);
      const received=safeReceiptMoneySum([
        strictReceiptMoney(ar.legacyRetentionReceived??0,'P37 歷史保留款'),recorded
      ],'P37 合成保留款收回');
      if(received>capacity)throw new Error('P37-19P_RETENTION_OVER_APPROVED_EFFECTIVE');
      const remaining=capacity-received,next=retentionState(capacity,received,ar.retentionStatus);
      Object.assign(ar,{retentionReceived:received,remainingRetention:remaining,
        retentionStatus:next,updatedAt:now});
      if(billing){
        Object.assign(billing,{retentionReceived:received,remainingRetention:remaining,
          retentionStatus:next,updatedAt:now});
        const principalComplete=num(ar.received)>=p3719pApproved.receivable;
        billing.status=principalComplete&&remaining===0?'全部收清':
          principalComplete?'已收款':num(ar.received)>0?'部分收款':'未收款';
      }
      return;
    }
"""


def build():
    raw = STORE.read_bytes()
    digest = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
    if digest != ORIGINAL_SHA:
        fail("BASE_GIT_SHA_CHANGED")
    source = raw.decode("utf-8")
    # Never patch an unexpected financial code path or a second occurrence.
    source = replace_exact(
        source,
        "  // P37-14: fail closed for an allowance or credit note linked to a real receivable.\n",
        INJECTED_READER + "  // P37-14: fail closed for an allowance or credit note linked to a real receivable.\n",
        name="verified_lab_ledger_insertion"
    )
    source = replace_exact(
        source,
        "  function requireAllowancesFullyIntegrated(ar) {\n    const receivableId=String(ar?.id||'').trim();",
        "  function requireAllowancesFullyIntegrated(ar) {\n"
        "    if(p3719pLabEffective(ar))return true; // only verified synthetic LAB record\n"
        "    const receivableId=String(ar?.id||'').trim();",
        name="lab_only_review_allowance_gate"
    )
    source = replace_exact(
        source,
        "amount=strictReceiptMoney(ar.amount,'應收金額')",
        "amount=strictReceiptMoney(p3719pLabApprovedAR(ar),'應收金額')",
        expected=2, name="principal_settlement_and_summary_ceiling"
    )
    source = replace_exact(
        source,
        "const received = num(ar?.received), amount = num(ar?.amount ?? billing.total);",
        "const received = num(ar?.received), amount = num(ar?p3719pLabApprovedAR(ar):billing.total);",
        name="billing_status_effective_receivable"
    )
    source = replace_exact(
        source,
        "result.receivableAmount=states.reduce((sum,item)=>sum+num(item.receipt.receivable?.amount??item.billing.total),0);",
        "result.receivableAmount=states.reduce((sum,item)=>sum+num(item.receipt.receivable?"
        "p3719pLabApprovedAR(item.receipt.receivable):item.billing.total),0);",
        name="commission_release_effective_amount"
    )
    source = replace_exact(
        source,
        "  function syncRetentionSummary(ar, billing, now) {\n    requireAllowancesFullyIntegrated(ar);\n",
        "  function syncRetentionSummary(ar, billing, now) {\n"
        "    requireAllowancesFullyIntegrated(ar);\n" + RETENTION_BRANCH,
        name="retention_overlay_immutability"
    )
    source = replace_exact(
        source,
        "const retentionAmount=Math.max(0,num(ar.retentionAmount ?? ar.retention ?? billing?.retentionAmount ?? billing?.retention));",
        "const retentionAmount=p3719pLabApprovedRetention(ar,billing);",
        name="new_retention_receipt_limit"
    )
    source = replace_exact(
        source,
        "const retentionAmount=Math.max(0,num(ar.retentionAmount??ar.retention??billing?.retentionAmount??billing?.retention));",
        "const retentionAmount=p3719pLabApprovedRetention(ar,billing);",
        expected=1, name="retention_update_original_helper_only"
    )
    # The real Store reconstructs retention-derived fields on LOAD as well as
    # during receipt writers. Preserve original retention but recompute effective
    # outstanding on browser reload for this one synthetic adjusted receivable.
    source = replace_exact(
        source,
        "        receivable.remainingRetention = Math.max(0,num(receivable.retentionAmount)-num(receivable.retentionReceived));",
        "        const p3719pLoadRetention=String(receivable.id||'')===String(window.P37P?.ids?.AR||'')?"
        "p3719pLabApprovedRetention(receivable,billing):num(receivable.retentionAmount);"
        "receivable.remainingRetention=Math.max(0,p3719pLoadRetention-num(receivable.retentionReceived));",
        name="load_billing_effective_remaining_retention"
    )
    source = replace_exact(
        source,
        "        receivable.retentionStatus = retentionState(receivable.retention ?? billing.retention,receivable.retentionReceived,receivable.retentionStatus || billing.retentionStatus);",
        "        receivable.retentionStatus = retentionState(p3719pLoadRetention,receivable.retentionReceived,receivable.retentionStatus || billing.retentionStatus);",
        name="load_billing_effective_retention_status"
    )
    source = replace_exact(
        source,
        "      const received=Math.min(retentionAmount,num(receivable.legacyRetentionReceived)+recorded);",
        "      const effectiveRetention=String(receivable.id||'')===String(window.P37P?.ids?.AR||'')?"
        "p3719pLabApprovedRetention(receivable,billing):retentionAmount;"
        "const received=Math.min(effectiveRetention,num(receivable.legacyRetentionReceived)+recorded);",
        name="load_ar_effective_retention_cap"
    )
    source = replace_exact(
        source,
        "receivable.remainingRetention=Math.max(0,retentionAmount-received);receivable.retentionStatus=retentionState(retentionAmount,received,receivable.retentionStatus);",
        "receivable.remainingRetention=Math.max(0,effectiveRetention-received);receivable.retentionStatus=retentionState(effectiveRetention,received,receivable.retentionStatus);",
        name="load_ar_derived_retention"
    )
    source = replace_exact(
        source,
        "billing.remainingRetention=Math.max(0,billing.retentionAmount-received);billing.retentionStatus=retentionState(billing.retentionAmount,received,billing.retentionStatus)",
        "billing.remainingRetention=Math.max(0,effectiveRetention-received);billing.retentionStatus=retentionState(effectiveRetention,received,billing.retentionStatus)",
        name="load_bill_derived_retention"
    )
    # All other writer branches (including formal posted allowance writer)
    # and all original Store persistence/CAS semantics stay byte-identical.
    if "P37_19P_UNVERIFIED_SYNTHETIC_FINANCE_OVERLAY_ONLY" not in source:
        fail("LAB_ONLY_MARKER_MISSING")
    return source.encode("utf-8")


if __name__ == "__main__":
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument("--verify-only",action="store_true")
    args=parser.parse_args()
    result=build()
    print(f"P37-19P exact-source sandbox overlay validated, bytes={len(result)}, "
          f"base={ORIGINAL_SHA}, no ERP repository file written")
