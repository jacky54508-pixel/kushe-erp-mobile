'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const T=require('../../assets/js/p37-19t-readonly-integration-candidate.js');
const C=require('../../assets/js/p37-billing-formal-readonly-projection.js');
const root=path.resolve(__dirname,'../..');
const readerSandbox={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'assets/js/p37-billing-effective-ledger.js'),'utf8'),readerSandbox);
const E=readerSandbox.window.KusheP3718EffectiveLedger;
const clone=x=>JSON.parse(JSON.stringify(x));
const Q=prefix=>'P37-19-SYN-'+prefix;
const P=Q('PROJECT-1');
function fixture() {
 const orig={untaxed:1248000,tax:62400,gross:1310400,receivable:1185600,retention:124800};
 const disc={untaxed:26000,tax:1300,gross:27300,receivable:24700,retention:2600};
 const adjusted={untaxed:1222000,tax:61100,gross:1283100,receivable:1160900,retention:122200};
 function pair(n,amount,tax,retention,date){
  const id=Q('BILL-'+n),arId=Q('AR-'+n),number=Q('BILLNO-'+n);
  const gross=amount+tax,receivable=gross-retention;
  const bill={id,number,date,project:P,receivableId:arId,amount,
   preTaxAmount:amount,tax,taxAmount:tax,grossTotal:gross,taxIncludedAmount:gross,
   total:receivable,retention,retentionAmount:retention,
   customer:Q('CUSTOMER'),customerName:'SYNTHETIC DATA'};
  const ar={id:arId,billingId:id,sourceNo:number,amount:receivable,
   received:0,retention,retentionAmount:retention,retentionReceived:0,
   legacyReceived:0,legacyRetentionReceived:0,receivableCheques:[],
   project:P,date,customer:Q('CUSTOMER')};
  return {bill,ar};
 }
 const adjustedPair=pair('A',1248000,62400,124800,'2026-11-06');
 const unadjusted=pair('B',100000,5000,10500,'2026-11-06');
 const prior=pair('C',50000,2500,0,'2026-10-26');
 const bid=adjustedPair.bill.id,rid=adjustedPair.ar.id;
 const invoiceId=Q('INVOICE-A'),invoiceNo=Q('INVOICENO-A');
 adjustedPair.bill.invoiceStatus='invoiced';
 adjustedPair.bill.invoiceNo=invoiceNo;
 adjustedPair.ar.invoiceNo=invoiceNo;
 const invoice={id:invoiceId,billingId:bid,sourceType:'billing',sourceId:bid,
  invoiceNumber:invoiceNo,status:'issued',amount:orig.untaxed,netAmount:orig.untaxed,
  tax:orig.tax,taxAmount:orig.tax,total:orig.gross,grossAmount:orig.gross};
 const credit={
  id:Q('ALLOWANCE-A'),schema:'kushe-p37-18-posted-ledger-contract-v1',
  status:'POSTED_VERIFIED',
  source:{billingId:bid,billingNo:adjustedPair.bill.number,
   invoiceId,invoiceNo,receivableId:rid,documentSnapshot:Q('DOC-SNAP-A'),draftVersion:1},
  idempotencyKey:'billing-allowance::'+bid+'::'+invoiceNo,
  billingId:bid,receivableId:rid,invoiceNo,
  original:orig,allowance:disc,effective:adjusted,
  posting:{accountantApproved:true,commitRevision:Q('REVISION'),
   approvedBy:Q('TEST-ACCOUNTANT'),approvedAt:'2026-11-06T00:00:00+08:00',
   verificationReference:Q('UNVERIFIED-REF')},
  voucher:{number:Q('FAKE-CREDIT-VOUCHER'),date:'2026-11-06',
   proofLocation:'SYNTHETIC_NOT_VERIFIED_BY_TAX_AUTHORITY',
   verificationReference:Q('UNVERIFIED-REF')}
 };
 const state={meta:{businessSnapshotRevision:{id:Q('REVISION')}},
  projects:[{id:P,name:'P37 Demo Project',customer:Q('CUSTOMER')}],
  customers:[{id:Q('CUSTOMER'),name:'P37 Demo Company'}],
  billings:[adjustedPair.bill,unadjusted.bill,prior.bill],
  receivables:[adjustedPair.ar,unadjusted.ar,prior.ar],
  invoices:[invoice],receipts:[],retentionReceipts:[],
  bankTransactions:[],billingAllowances:[credit],
  commissions:[{id:Q('COMMISSION-A'),billingId:bid,employee:Q('EMPLOYEE')}],
  banks:[],payroll:[],salaryPayments:[]
 };
 return state;
}
function baseline(state,month='2026-11'){
 const project={id:P,name:'P37 Demo Project',customer:'P37 Demo Company',
  billed:1398000,outstanding:1332600,totalCost:0,profit:1398000,
  margin:1,material:0,labor:0,other:0,customerDeduction:0,received:0};
 const revenue=month==='2026-11'?1348000:month==='2026-10'?50000:0;
 return {month,data:clone(state),revenue,outstandingAR:1332600,
  structurePaid:0,structureTotal:month==='2026-11'?1280100:52500,
  structureOpen:month==='2026-11'?1280100:52500,
  attentions:[{type:'待收款',count:3,amount:1332600},
   {type:'保留款待收',count:2,amount:135300}],
  reportProjects:[project],projects:[project],
  deltas:{revenue:{text:'—',className:'neutral'},ar:{text:'—',className:'neutral'}},
  bank:100000,cash:0,collected:0,payrollTotal:0};
}
function auth(){
 const owner=Q('OWNER');
 return {user:()=>({id:owner}),
  companyContext:()=>({companyId:Q('COMPANY'),userId:owner,legacySourceUserId:owner}),
  canWrite:key=>key==='billings'};
}
function args(state=fixture(),month='2026-11'){
 return {mode:T.MODE,officialVoucherIndependentlyVerified:false,
  allowFinancialWrites:false,expectedRevisionId:state.meta.businessSnapshotRevision.id,
  auth:auth(),state,originalDashboard:baseline(state,month),month,
  effectiveLedger:E,formalReadOnlyLedger:C};
}
test('P37-19T uses real P37-18 and P37-19C money readers; never writes to source',()=>{
 assert.equal(typeof E.inspect,'function');
 assert.equal(typeof C.project,'function');
 const state=fixture(),input=args(state),before=JSON.stringify(state);
 const got=T.project(input);
 assert.equal(got.schema,T.SCHEMA);
 assert.equal(got.mode,T.MODE);
 assert.equal(got.status,'UNVERIFIED_VOUCHER_READ_ONLY_CANDIDATE');
 assert.deepEqual(got.original,{revenue:1348000,outstandingAR:1332600,retentionOpen:135300});
 assert.deepEqual(got.adjusted,{revenue:1322000,outstandingAR:1307900,retentionOpen:132700});
 assert.deepEqual(got.reductions,{untaxed:26000,receivable:24700,retention:2600});
 assert.equal(got.dashboard.revenue,1322000);
 assert.equal(got.dashboard.outstandingAR,1307900);
 assert.equal(got.dashboard.reportProjects[0].billed,1372000);
 assert.equal(got.dashboard.reportProjects[0].profit,1372000);
 assert.equal(got.dashboard.structureTotal,1255400);
 assert.equal(got.rows.length,3);
 assert.equal(got.rows.filter(r=>r.sourceIsVoucherReviewOnly).length,1);
 assert.equal(got.readOnly,true);
 assert.equal(got.mayMountProduction,false);
 assert.equal(got.releaseGate,'NO_GO');
 assert.equal(got.canPost,false);
 assert.equal(got.bankEntriesAdded,0);
 assert.equal(got.cloudWrites,0);
 assert.equal(got.formalReceiptWriterConnected,false);
 assert.equal(got.formalBankWriterConnected,false);
 assert.equal(got.formalCommissionPaid,false);
 assert.equal(got.officialVoucherVerified,false);
 assert.equal(got.authorization.serverSignatureVerified,false);
 assert.equal(got.commissionReview[0].formalPayrollReleased,false);
 assert.equal(JSON.stringify(state),before);
 assert.deepEqual(input.originalDashboard.data,state);
});
test('dashboard, chart, monthly reports and KPI rows use exactly the same approved amount',()=>{
 const got=T.project(args());
 const revenue=got.details('revenue','2026-11');
 const ar=got.details('ar');
 const retention=got.details('retention');
 assert.equal(revenue.rows.length,2);
 assert.equal(ar.rows.length,3);
 assert.equal(retention.rows.length,3);
 assert.equal(revenue.total,1322000);
 assert.equal(ar.total,1307900);
 assert.equal(retention.total,132700);
 assert.equal(got.details('revenue','2026-10').total,50000);
 assert.equal(got.chart(12).at(-1).value,1322000);
 assert.equal(got.chart(12).at(-2).value,50000);
 assert.equal(got.chart(4).at(-1).value,1372000);
 assert.equal(got.chart(3).at(-1).value,1372000);
 assert.equal(got.dashboard.attentions.find(r=>r.type==='保留款待收').amount,132700);
 assert.throws(()=>got.details('unknown'),/INVALID_DETAIL_KIND/);
 assert.throws(()=>got.chart(0),/INVALID_CHART_RANGE/);
});
test('October has no discount in month revenue, while lifetime AR remains adjusted',()=>{
 const report=T.project(args(fixture(),'2026-10'));
 assert.equal(report.original.revenue,50000);
 assert.equal(report.adjusted.revenue,50000);
 assert.equal(report.adjusted.outstandingAR,1307900);
 assert.equal(report.reductions.untaxed,0);
 assert.equal(report.reductions.receivable,24700);
 assert.equal(report.details('revenue','2026-10').total,50000);
});
test('real-shaped identifiers are allowed by the read-only candidate; authority still required',()=>{
 const source=JSON.stringify(fixture()).replaceAll('P37-19-SYN-','GENERIC-SHAPED-DEMO-');
 const state=JSON.parse(source),out=T.project(args(state));
 assert.equal(out.readOnly,true);
 assert.equal(out.canPost,false);
 assert.equal(out.rows.length,3);
 assert.ok(out.rows[0].billId.startsWith('GENERIC-SHAPED-DEMO-'));
});
test('genuine owner+company context, permission, review mode and tax flag all fail closed',()=>{
 const testArgs=args();
 for(const patch of [
   {auth:null},{auth:{...auth(),canWrite:()=>false}},
   {auth:{...auth(),user:()=>({id:'ANOTHER-OWNER'})}},
   {auth:{...auth(),companyContext:()=>({companyId:'COMPANY-A',userId:'OWNER-B',legacySourceUserId:'OWNER-B'})}},
   {mode:'PRODUCTION_WRITE'}, {officialVoucherIndependentlyVerified:true},
   {allowFinancialWrites:true}, {expectedRevisionId:'STALE-SNAPSHOT'}
 ])assert.throws(()=>T.project({...testArgs,...patch}),/P37-19T/);
});
test('missing and duplicate invoice/allowance source or inconsistent ledger amounts fail closed',()=>{
 const mods=[
  s=>s.invoices.pop(),
  s=>s.billingAllowances[0].status='PENDING',
  s=>s.billingAllowances[0].voucher.verificationReference='DIFFERENT',
  s=>s.billingAllowances.push({...clone(s.billingAllowances[0]),id:Q('OTHER-ALLOWANCE')}),
  s=>s.billings[0].tax+=1,
  s=>s.receivables[0].amount+=1,
  s=>s.receivables.push({...clone(s.receivables[0]),id:Q('DUPLICATE-AR')}),
  s=>s.billings[0].number=s.billings[1].number,
  s=>s.billings[0].project='',
  s=>s.billings[0].amount=NaN
 ];
 for(const modify of mods){
  const s=fixture();modify(s);
  assert.throws(()=>T.project(args(s)),/P37-19|金額|來源|帳務|請款|發票|折讓|非唯一|未稅|稅額/);
 }
});
test('the dashboard snapshot and numeric baseline cannot silently drift',()=>{
 const s=fixture();
 const o=args(s);
 o.originalDashboard.revenue=1330000;
 assert.throws(()=>T.project(o),/ORIGINAL_DASHBOARD_MONEY_CONFLICT/);
 const a=args(s);
 a.originalDashboard.data.receivables[0].received=400;
 assert.throws(()=>T.project(a),/DIVERGED/);
 const b=args(s);
 b.originalDashboard.outstandingAR=1332500;
 assert.throws(()=>T.project(b),/ORIGINAL_DASHBOARD_MONEY_CONFLICT/);
});
test('the unmounted module is a future review candidate, not an ERP writer or deployed script',()=>{
 const moduleText=fs.readFileSync(path.join(root,'assets/js/p37-19t-readonly-integration-candidate.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const store=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8');
 const dash=fs.readFileSync(path.join(root,'assets/js/dashboard.js'),'utf8');
 const reports=fs.readFileSync(path.join(root,'assets/js/reports.js'),'utf8');
 const sync=fs.readFileSync(path.join(root,'assets/js/cloud-sync.js'),'utf8');
 assert.doesNotMatch(html,/p37-19t|p3719t/i);
 assert.doesNotMatch(store,/p37-19t|p3719t/i);
 assert.doesNotMatch(dash,/p37-19t|p3719t/i);
 assert.doesNotMatch(reports,/p37-19t|p3719t/i);
 assert.match(store,/function requireAllowancesFullyIntegrated\(ar\)/);
 assert.match(sync,/erp_state_cas_write_v2/);
 assert.doesNotMatch(moduleText,/\b(?:indexedDB|localStorage|fetch|XMLHttpRequest|WebSocket)\s*(?:\.|\[|\()/);
 assert.doesNotMatch(moduleText,/service_role|sb_secret_|supabase\.co/i);
 assert.doesNotMatch(moduleText,/require\(['"](?:node:fs|node:http|node:https|child_process)/);
 assert.match(moduleText,/mayMountProduction:false/);
 assert.match(moduleText,/releaseGate:'NO_GO'/);
});
