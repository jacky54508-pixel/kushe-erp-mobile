'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const inv=require('../assets/js/external-billing-invoice.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function make(id,project,originalDate,invoiceStatus,invoiceNo,invoiceDate,untaxed){
 const tax=untaxed/20,gross=untaxed+tax;
 return {document:{
  billingId:id,receivableId:id+'-AR',number:id.replace('SYN-','LEGACY-SYN-'),
  projectName:project,date:originalDate,invoiceStatus,invoiceNo,invoiceDate,
  anchors:{untaxed,tax,grossTotal:gross,retention:0,receivable:gross}
 }};
}
function samples(){
 return [
  make('SYN-A','虛構甲區','2026-10-04','invoice_pending','','2026-10-04',100000),
  make('SYN-B','虛構乙區','2026-10-04','invoiced','SYN-AB12345678','2026-06-26',200000)
 ];
}
test('待開票即使原欄有日期，PDF 發票日期只顯示尚未開立',()=>{
 const src=samples(),original=clone(src),m=inv.project(src),html=inv.printHtml(m);
 assert.equal(m.rows[0].invoiceDate,'2026-10-04'); // immutable legacy source
 assert.equal(m.rows[0].sourceBillingDate,'2026-10-04');
 assert.match(html,/<td>尚未開立<\/td><td>待開票<\/td>/);
 assert.match(html,/原請款日期：2026-10-04/);
 assert.deepEqual(src,original,'must not alter any stored dates or invoice records');
});
test('已開票只使用實際發票號碼與發票日期，不依合併文件日期',()=>{
 const html=inv.printHtml(inv.project(samples()));
 assert.match(html,/SYN-AB12345678/);
 assert.match(html,/<td>2026-06-26<\/td><td>已開票<\/td>/);
 assert.ok(!html.includes('發票日期：2026-10-04'));
});
test('對外 PDF 不洩露 LEGACY 等內部請款識別碼',()=>{
 const s=samples();s[0].document.number='B20261004-001';
 const html=inv.printHtml(inv.project(s));
 assert.ok(!html.includes('LEGACY-'),html);
 assert.ok(!html.includes('B20261004-001'),html);
 assert.ok(html.includes('虛構甲區')&&html.includes('虛構乙區'));
});
test('保留全部原請款金額、稅額，不新增發票或應收',()=>{
 const m=inv.project(samples());
 assert.deepEqual(m.totals,{untaxed:300000,tax:15000,
  grossTotal:315000,retention:0,receivable:315000});
 assert.equal(m.issued,1);assert.equal(m.pending,1);
 assert.equal(m.createdInvoiceRecords,0);assert.equal(m.createdReceivables,0);
 inv.validateProjection(m);
});
test('有原單免開票、缺日期或未知狀態時不能偽造發票號碼',()=>{
 const s=samples();s[0].document.invoiceStatus='no_invoice';
 s[0].document.invoiceNo='';s[0].document.invoiceDate='';
 s[0].document.anchors.tax=0;s[0].document.anchors.grossTotal=100000;
 s[0].document.anchors.receivable=100000;
 let html=inv.printHtml(inv.project(s));
 assert.match(html,/免開發票/);
 assert.match(html,/不適用/);
 s[0].document.invoiceStatus='some_legacy_value';
 html=inv.printHtml(inv.project(s));
 assert.match(html,/狀態待核對/);
 assert.ok(!html.includes('LEGACY-'));
});
test('歷史已開票缺少日期，應標示待核對而非沿用請款日期',()=>{
 const s=samples();s[1].document.invoiceDate='';
 const html=inv.printHtml(inv.project(s));
 assert.match(html,/日期待核對/);
 assert.match(html,/資料待核對/);
});
test('PDF 字串 escape 特殊字元、防 XSS，保留完整原資料',()=>{
 const s=samples();s[0].document.projectName='<img src=x onerror=alert(1)>';
 const before=clone(s),html=inv.printHtml(inv.project(s));
 assert.match(html,/&lt;img/);
 assert.ok(!html.includes('<img src=x onerror'));
 assert.deepEqual(s,before);
});
test('發票明細短註不再包含系統性長文，仍清楚指出未開票',()=>{
 const html=inv.printHtml(inv.project(samples()));
 assert.ok(html.includes('未開票者不列開立日期'));
 assert.ok(!html.includes('非新增發票或應收；請以原始發票'));
});
