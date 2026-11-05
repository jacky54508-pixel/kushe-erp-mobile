(() => {
'use strict';
if(location.hostname!=='127.0.0.1'||location.protocol!=='http:'||location.pathname!=='/')
  throw Error('P37-19N REQUIRE_LOOPBACK_BROWSER');
const C='P37-19-SYN-CUSTOMER',P='P37-19-SYN-PROJECT',BANK='P37-19-SYN-BANK-1';
const A='P37-19-SYN-AR-ALLOW',B='P37-19-SYN-AR-CLEAN';
const BILL_A='P37-19-SYN-BILL-ALLOW',BILL_B='P37-19-SYN-BILL-CLEAN';
const source={
 meta:{updatedAt:'2026-11-06T00:00:00+08:00'},
 settings:{company:'P37 SYNTHETIC ONLY',defaultTax:5},
 customers:[{id:C,name:'P37 SYNTHETIC CUSTOMER'}],
 projects:[{id:P,name:'P37 SYNTHETIC PROJECT',customer:C}],
 banks:[{id:BANK,name:'P37 SYNTHETIC BANK',openingBalance:100000,
   income:0,expense:0,balance:100000}],
 billings:[
  {id:BILL_A,number:'P37-19-SYN-BILLNO-ALLOW',date:'2026-11-06',
   customer:C,customerName:'P37 SYNTHETIC CUSTOMER',
   project:P,projectName:'P37 SYNTHETIC PROJECT',receivableId:A,
   sourceType:'synthetic',invoiceNo:'P37-19-SYN-INVOICE-NO',
   invoiceStatus:'invoiced',amount:1248000,preTaxAmount:1248000,tax:62400,
   taxAmount:62400,grossTotal:1310400,taxIncludedAmount:1310400,
   retention:124800,retentionAmount:124800,total:1185600,lines:[]},
  {id:BILL_B,number:'P37-19-SYN-BILLNO-CLEAN',date:'2026-11-06',
   customer:C,customerName:'P37 SYNTHETIC CUSTOMER',
   project:P,projectName:'P37 SYNTHETIC PROJECT',receivableId:B,
   sourceType:'synthetic',invoiceStatus:'no_invoice',hasInvoice:false,
   amount:50000,preTaxAmount:50000,tax:2500,taxAmount:2500,
   grossTotal:52500,taxIncludedAmount:52500,retention:0,retentionAmount:0,
   total:52500,lines:[]}
 ],
 receivables:[
  {id:A,billingId:BILL_A,sourceNo:'P37-19-SYN-BILLNO-ALLOW',customer:C,
   customerName:'P37 SYNTHETIC CUSTOMER',project:P,projectName:'P37 SYNTHETIC PROJECT',
   invoiceNo:'P37-19-SYN-INVOICE-NO',amount:1185600,received:0,legacyReceived:0,
   retention:124800,retentionAmount:124800,retentionReceived:0,legacyRetentionReceived:0,
   receivableCheques:[],status:'未收'},
  {id:B,billingId:BILL_B,sourceNo:'P37-19-SYN-BILLNO-CLEAN',customer:C,
   customerName:'P37 SYNTHETIC CUSTOMER',project:P,projectName:'P37 SYNTHETIC PROJECT',
   amount:52500,received:0,legacyReceived:0,retention:0,retentionAmount:0,
   retentionReceived:0,legacyRetentionReceived:0,receivableCheques:[],status:'未收'}
 ],
 invoices:[{id:'P37-19-SYN-INVOICE-ID',billingId:BILL_A,
   invoiceNumber:'P37-19-SYN-INVOICE-NO',status:'issued',
   netAmount:1248000,taxAmount:62400,grossAmount:1310400}],
 billingAllowances:[{id:'P37-19-SYN-ALLOWANCE',billingId:BILL_A,receivableId:A,
   invoiceNo:'P37-19-SYN-INVOICE-NO',source:{billingId:BILL_A,receivableId:A},
   status:'P37_SYNTHETIC_REVIEW_ONLY',grossReduction:27300}],
 bankTransactions:[],receipts:[],retentionReceipts:[],
 payroll:[],salaryPayments:[],commissions:[],audit:[]
};
window.P37N={
 scope:'P37_19N_ACTUAL_STORE_ISOLATED_FIXTURE',
 ids:{C,P,BANK,A,B,BILL_A,BILL_B},
 initial:structuredClone(source),
 originalSourceText:'P37 synthetic - never company financial data'
};
window.KuSheLegacyData=Object.freeze({
 getState:()=>structuredClone(source),
 refresh:()=>structuredClone(source)
});
})();
