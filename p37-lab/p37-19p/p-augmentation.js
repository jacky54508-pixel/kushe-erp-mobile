(() => {
'use strict';
// P37-19P temporary localhost financial fixture. No real invoice or tax voucher.
if(location.protocol!=='http:'||location.hostname!=='127.0.0.1'||
   location.pathname!=='/'||window.P37O?.scope!=='P37_19O_REAL_STORE_ISOLATED_FIXTURE')
 throw Error('P37-19P NON_SANDBOX_SOURCE_REJECTED');
const previous=window.P37O.initial;
const source=structuredClone(previous);
const ID={
 AR:'P37-19-SYN-AR-APPROVED',BILL:'P37-19-SYN-BILL-APPROVED',
 BILLNO:'P37-19-SYN-BILLNO-APPROVED',
 INV:'P37-19-SYN-INVOICE-APPROVED',INVNO:'P37-19-SYN-INVOICENO-APPROVED',
 ALLOW:'P37-19-SYN-ALLOW-APPROVED',COMM:'P37-19-SYN-COMM-APPROVED'
};
const original={untaxed:1248000,tax:62400,gross:1310400,receivable:1185600,retention:124800};
const allowance={untaxed:26000,tax:1300,gross:27300,receivable:24700,retention:2600};
const approved={untaxed:1222000,tax:61100,gross:1283100,receivable:1160900,retention:122200};
const customer=window.P37N.ids.C,project=window.P37N.ids.P;
const bill={id:ID.BILL,number:ID.BILLNO,date:'2026-11-06',sourceType:'synthetic',
 customer,customerName:'P37 SYNTHETIC CUSTOMER',project,projectName:'P37 SYNTHETIC PROJECT',
 receivableId:ID.AR,invoiceNo:ID.INVNO,invoiceStatus:'invoiced',
 amount:original.untaxed,preTaxAmount:original.untaxed,tax:original.tax,taxAmount:original.tax,
 grossTotal:original.gross,taxIncludedAmount:original.gross,
 total:original.receivable,retention:original.retention,retentionAmount:original.retention,
 retentionReceived:0,lines:[]};
const ar={id:ID.AR,billingId:ID.BILL,sourceNo:ID.BILLNO,invoiceNo:ID.INVNO,
 customer,customerName:'P37 SYNTHETIC CUSTOMER',project,projectName:'P37 SYNTHETIC PROJECT',
 amount:original.receivable,received:0,legacyReceived:0,
 retention:original.retention,retentionAmount:original.retention,
 retentionReceived:0,legacyRetentionReceived:0,receivableCheques:[],status:'未收'};
const invoice={id:ID.INV,billingId:ID.BILL,sourceType:'billing',sourceId:ID.BILL,
 invoiceNumber:ID.INVNO,status:'issued',
 netAmount:original.untaxed,amount:original.untaxed,taxAmount:original.tax,tax:original.tax,
 grossAmount:original.gross,total:original.gross};
const record={id:ID.ALLOW,schema:'kushe-p37-18-posted-ledger-contract-v1',
 status:'POSTED_VERIFIED',
 source:{billingId:ID.BILL,billingNo:ID.BILLNO,invoiceId:ID.INV,
  invoiceNo:ID.INVNO,receivableId:ID.AR,
  documentSnapshot:'P37-19-SYN-ORIGINAL-SNAPSHOT',draftVersion:1},
 idempotencyKey:'billing-allowance::'+ID.BILL+'::'+ID.INVNO,
 billingId:ID.BILL,receivableId:ID.AR,invoiceNo:ID.INVNO,
 original,allowance,effective:approved,
 posting:{accountantApproved:true,commitRevision:'P37-19-SYN-REV',
  approvedBy:'P37-19-SYN-ACCOUNTANT',approvedAt:'2026-11-06T00:00:00+08:00',
  verificationReference:'P37-19-SYN-FAKE-REF'},
 voucher:{number:'P37-19-SYN-CREDIT-VOUCHER',date:'2026-11-06',
  proofLocation:'SYNTHETIC_NOT_OFFICIAL_OR_LEGALLY_VERIFIED',
  verificationReference:'P37-19-SYN-FAKE-REF'}};
source.billings.push(bill);
source.receivables.push(ar);
source.invoices.push(invoice);
source.billingAllowances.push(record);
source.commissions.push({
 id:ID.COMM,date:'2026-11-06',employee:window.P37O.ids.EMP,
 employeeName:'P37 SYNTHETIC EMPLOYEE',project,
 projectName:'P37 SYNTHETIC PROJECT',
 sourceNo:ID.BILLNO,sourceType:'billing',
 sourceId:ID.BILL,billingId:ID.BILL,untaxedAmount:10000,rate:25,
 commission:2500,status:'已列入薪資',note:'P37-19P synthetic approval contract only'
});
const scenario=new URLSearchParams(location.search).get('bad')||'';
if(scenario==='bad-voucher')record.voucher.verificationReference='P37-19-SYN-OTHER-REF';
if(scenario==='bad-money')record.effective.gross=1283101;
if(scenario==='duplicate-allowance')source.billingAllowances.push({...structuredClone(record),id:'P37-19-SYN-ALLOW-DUPLICATE'});
if(scenario==='foreign-source')ar.id='REAL-CLIENT-AR';
if(!['','bad-voucher','bad-money','duplicate-allowance','foreign-source'].includes(scenario))
 throw Error('P37-19P UNKNOWN_BAD_FIXTURE_CASE');
window.P37P=Object.freeze({
 scope:'P37_19P_UNVERIFIED_SYNTHETIC_FINANCE_OVERLAY_ONLY',
 isolatedFixture:true,scenario,ids:ID,
 original:structuredClone(original),allowance:structuredClone(allowance),
 approved:structuredClone(approved),snapshot:structuredClone(source),
 legalTaxVoucherVerified:false,formalReleaseAllowed:false
});
window.KuSheLegacyData=Object.freeze({
 getState:()=>structuredClone(source),
 refresh:()=>structuredClone(source)
});
})();