'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const invoice=require('../assets/js/external-billing-invoice.js');

function source(id,project,month,amount,status='invoiced'){
 const tax=status==='no_invoice'?0:Math.round(amount*0.05),
       gross=amount+tax,retention=0;
 return {
   document:{billingId:id,receivableId:id+'-AR',number:id.replace('SYN-B','SYN-NO'),
     projectName:project,invoiceStatus:status,
     invoiceNo:status==='invoiced'?'SYN-'+month.slice(5)+'-INV':'',
     invoiceDate:status==='invoiced'?month+'-20':'',
     invoiceId:status==='invoiced'?id+'-I':'',
     anchors:{untaxed:amount,tax,grossTotal:gross,retention,receivable:gross}}
 };
}
const data=()=>[
 source('SYN-B-A','虛構區域 A','2026-08',100000),
 source('SYN-B-B','虛構區域 B','2026-10',200000)
];
const checkBefore=(v,run)=>{const before=JSON.stringify(v);const result=run();assert.equal(JSON.stringify(v),before,'projection mutated original ERP');return result};
test('8月與10月發票分開顯示，各自票號及原請款原額不變',()=>{
 const src=data(),model=checkBefore(src,()=>invoice.project(src));
 assert.equal(model.schema,'kushe-p39-inv1-source-reference-v1');
 assert.equal(model.rows.length,2);
 assert.deepEqual(model.rows.map(x=>x.invoiceMonth),['2026-08','2026-10']);
 assert.deepEqual(model.rows.map(x=>x.invoiceDate),['2026-08-20','2026-10-20']);
 assert.equal(model.totals.untaxed,300000);
 assert.equal(model.totals.tax,15000);
 assert.equal(model.totals.grossTotal,315000);
 assert.equal(model.issued,2);
 assert.equal(model.createdInvoiceRecords,0);
 assert.equal(model.createdReceivables,0);
 invoice.validateProjection(model);
});
test('待開票與免開發票保留原狀，不創造號碼或假日期',()=>{
 const src=data();src[0].document.invoiceStatus='invoice_pending';
 src[0].document.invoiceNo='';src[0].document.invoiceDate='';
 src[1].document.invoiceStatus='no_invoice';src[1].document.invoiceNo='';
 src[1].document.invoiceDate='';src[1].document.anchors.tax=0;
 src[1].document.anchors.grossTotal=200000;
 src[1].document.anchors.receivable=200000;
 const model=invoice.project(src);
 assert.deepEqual([model.pending,model.exempt,model.issued],[1,1,0]);
 assert.equal(model.totals.grossTotal,305000);
 assert.ok(model.rows.every(r=>r.invoiceDate===''&&r.invoiceNo===''));
 invoice.validateProjection(model);
});
test('舊資料已開票但缺日期：顯示待核對而不是推算合併月份',()=>{
 const src=data();src[0].document.invoiceDate='';
 const model=invoice.project(src);
 assert.equal(model.rows[0].invoiceMonth,'');
 assert.equal(model.rows[0].hasRecordedInvoice,false);
 assert.match(model.rows[0].invoiceLabel,/待核對/);
 assert.ok(model.warnings.length>0);
 invoice.validateProjection(model);
});
test('原單與整份合併總額一致才可列示',()=>{
 const src=data();
 assert.throws(()=>invoice.project(src,{untaxed:300000,tax:15000,
   grossTotal:316000,retention:0,receivable:315000}),/不一致/);
});
test('同張原單、同張應收重複或金額不平衡必須拒絕',()=>{
 const src=data();
 src[1].document.billingId=src[0].document.billingId;
 assert.throws(()=>invoice.project(src),/重複/);
 const more=data();more[1].document.receivableId=more[0].document.receivableId;
 assert.throws(()=>invoice.project(more),/重複/);
 const bad=data();bad[1].document.anchors.grossTotal++;
 assert.throws(()=>invoice.project(bad),/不一致/);
});
test('PDF 對照資料不得暗中改合計',()=>{
 const model=JSON.parse(JSON.stringify(invoice.project(data())));
 model.rows[0].originalGross++;
 assert.throws(()=>invoice.validateProjection(model),/不平衡/);
 model.rows[0].originalGross--;
 model.totals.tax++;
 assert.throws(()=>invoice.validateProjection(model),/不一致/);
});
test('PDF 標題及票號只被當成純文字，防止 XSS',()=>{
 const src=data();src[0].document.projectName='<img src=x onerror=alert(1)>';
 src[0].document.invoiceNo='<script>alert(1)</script>';
 const model=invoice.project(src),html=invoice.printHtml(model);
 assert.ok(html.includes('&lt;img'));
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('<script>'));
 assert.match(html,/發票日期/);
 assert.match(html,/原單未稅/);
 assert.match(html,/原單稅額/);
});
test('只匯出原單對照，沒有可寫入 ERP 的發票或應收API',()=>{
 const api=Object.keys(invoice).sort();
 assert.deepEqual(api,['SCHEMA','STATUS','printHtml','project','validateProjection']);
 const model=invoice.project(data());
 const html=invoice.printHtml(model);
 assert.ok(html.includes('非新增發票或應收'));
});
