(() => {
'use strict';
// P37-19R entirely fictional accounting source for localhost-only UI inspection.
if(location.hostname!=='127.0.0.1'||location.pathname!=='/'||
  window.P37N?.scope!=='P37_19N_ACTUAL_STORE_ISOLATED_FIXTURE'||
  window.P37O?.scope!=='P37_19O_REAL_STORE_ISOLATED_FIXTURE'||
  window.P37P?.scope!=='P37_19P_UNVERIFIED_SYNTHETIC_FINANCE_OVERLAY_ONLY')
 throw Error('P37-19R_NON_ISOLATED_FIXTURE_REJECTED');
const base=structuredClone(window.P37P.snapshot);
const forbidden='P37-19-SYN-AR-ALLOW';
const oldBill='P37-19-SYN-BILL-ALLOW';
base.receivables=base.receivables.filter(x=>x.id!==forbidden);
base.billings=base.billings.filter(x=>x.id!==oldBill);
base.invoices=base.invoices.filter(x=>x.billingId!==oldBill);
base.billingAllowances=base.billingAllowances.filter(x=>x.billingId!==oldBill);
const octBill=base.billings.find(x=>x.id==='P37-19-SYN-BILL-CLEAN');
if(!octBill)throw Error('P37-19R_OCTOBER_BILL_MISSING');
octBill.date='2026-10-26';
for(const ar of base.receivables){
 const bill=base.billings.find(b=>b.id===ar.billingId);
 if(!bill)throw Error('P37-19R_BILLING_AR_NOT_ONE_TO_ONE');
 ar.date=bill.date;
}
base.settings.company='P37-19R SYNTHETIC ONLY';
if(base.billings.length!==3||base.receivables.length!==3||
   base.billingAllowances.length!==1||base.invoices.length!==1)
 throw Error('P37-19R_UNEXPECTED_SOURCE_CASE_COUNT');
window.P37R=Object.freeze({
 scope:'P37_19R_LOCALHOST_SYNTHETIC_READ_ONLY',
 isolatedFixture:true,ownerTestOnly:true,
 officialTaxVoucherVerified:false,bankWritesAllowed:false,
 fixtureSnapshot:structuredClone(base),
 acceptedRevision:null
});
window.KuSheLegacyData=Object.freeze({
 getState:()=>structuredClone(base),
 refresh:()=>structuredClone(base)
});
window.KusheKpi=Object.freeze({
 register(){return true},attrs(){return ''},model(){return null}
});
})();