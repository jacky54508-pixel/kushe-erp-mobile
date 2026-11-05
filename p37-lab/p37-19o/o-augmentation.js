(() => {
'use strict';
// Extend the P37-19N fictitious fixture before loading the ORIGINAL ERP Store.
// This is NOT an ERP writer, and NEVER loads production data.
if(location.protocol!=='http:'||location.hostname!=='127.0.0.1'||location.pathname!=='/')
 throw Error('P37-19O MUST_REMAIN_LOCALHOST');
const original=window.P37N;
if(original?.scope!=='P37_19N_ACTUAL_STORE_ISOLATED_FIXTURE')
 throw Error('P37-19O MISSING_APPROVED_SYNTHETIC_FIXTURE');
const src=structuredClone(original.initial);
const ids={AR:'P37-19-SYN-AR-RET-CHEQUE',
 BILL:'P37-19-SYN-BILL-RET-CHEQUE',
 NUMBER:'P37-19-SYN-BILLNO-RET-CHEQUE',
 EMP:'P37-19-SYN-EMP-COMM',
 COMM:'P37-19-SYN-COMM-ENTRY'};
src.billings.push({
 id:ids.BILL,number:ids.NUMBER,date:'2026-11-06',receivableId:ids.AR,
 customer:original.ids.C,customerName:'P37 SYNTHETIC CUSTOMER',
 project:original.ids.P,projectName:'P37 SYNTHETIC PROJECT',
 sourceType:'synthetic',invoiceStatus:'no_invoice',hasInvoice:false,
 amount:100000,preTaxAmount:100000,tax:5000,taxAmount:5000,
 grossTotal:105000,taxIncludedAmount:105000,total:94500,
 retention:10500,retentionAmount:10500,lines:[]
});
src.receivables.push({
 id:ids.AR,billingId:ids.BILL,sourceNo:ids.NUMBER,
 customer:original.ids.C,customerName:'P37 SYNTHETIC CUSTOMER',
 project:original.ids.P,projectName:'P37 SYNTHETIC PROJECT',
 amount:94500,received:0,legacyReceived:0,status:'未收',
 retention:10500,retentionAmount:10500,retentionReceived:0,
 legacyRetentionReceived:0,receivableCheques:[]
});
src.employees=[{id:ids.EMP,name:'P37 SYNTHETIC EMPLOYEE'}];
src.commissions=[{id:ids.COMM,date:'2026-11-06',
 employee:ids.EMP,employeeName:'P37 SYNTHETIC EMPLOYEE',
 project:original.ids.P,projectName:'P37 SYNTHETIC PROJECT',
 sourceNo:ids.NUMBER,sourceType:'billing',sourceId:ids.BILL,
 billingId:ids.BILL,untaxedAmount:10000,rate:25,commission:2500,
 status:'已列入薪資',note:'P37-19O synthetic-only commission'}];
src.payroll=[];
window.P37O=Object.freeze({scope:'P37_19O_REAL_STORE_ISOLATED_FIXTURE',
 ids, initial:structuredClone(src)});
window.KuSheLegacyData=Object.freeze({
 getState:()=>structuredClone(src),
 refresh:()=>structuredClone(src)
});
})();