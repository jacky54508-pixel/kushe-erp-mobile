'use strict';

// Exercises the real public producer against saved quotation/source-history pairs.
// It intentionally does not call private implementation helpers. All data is synthetic.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const BASELINE='4c02e3c707473c4483946afd5222c7cf05d8fb63';
const BASELINE_SHA256='ba1678758af70566ec7870eb119123532f16ab22b4c61be803c7ed1bb7b52b53';
const EXPECTED_VERSION='p41-k27-quote-export-20261127-3';
const options={root:process.cwd()};
for(let i=2;i<process.argv.length;i+=2){
  const name=process.argv[i];
  if(!['--root','--baseline-root','--output'].includes(name)||!process.argv[i+1])throw new Error('Usage: node test_backup_projection.cjs --root REPO [--baseline-root CURRENT_K26_COPY] [--output RESULT.json]');
  options[name.slice(2)]=path.resolve(process.argv[i+1]);
}
options.root=path.resolve(options.root);
const source=fs.readFileSync(path.join(options.root,'assets/js/billing-print.js'),'utf8');
const baseline=options['baseline-root']?fs.readFileSync(path.join(options['baseline-root'],'assets/js/billing-print.js'),'utf8'):execFileSync('git',['-C',options.root,'show',`${BASELINE}:assets/js/billing-print.js`],{encoding:'utf8'});
assert.equal(crypto.createHash('sha256').update(baseline).digest('hex'),BASELINE_SHA256,'Reference producer is not the pinned released K26 file');
const report={schema:'p41-k27-backup-price-projection-v1',baselineCommit:BASELINE,syntheticOnly:true,sourceWrites:false,checks:[],status:'RUNNING'};
function check(name,run){try{run();report.checks.push({name,pass:true});}catch(error){report.checks.push({name,pass:false,error:error.message});}}
const normalize=value=>JSON.parse(JSON.stringify(value));
const clone=value=>structuredClone(value);
const PUBLIC_NOTE='不含拋光磚.全室地壁磚.全室門檻.車庫地磚\nSYN public scope <b> & details';
const PRIVATE='SYN-K27-PRIVATE-SENTINEL';
function fixture(scope='project'){
  const history={id:'SYN-PRICE-OLD',scope,item:'室內鋁窗美容',unit:'戶',price:15000,isBackupPrice:true,effectiveDate:'2026-09-03',createdAt:'2026-09-03T00:00:00Z',customerId:scope==='company'?'':'SYN-CUSTOMER',projectId:scope==='project'?'SYN-PROJECT':'',internalNote:PRIVATE};
  const quote={id:'SYN-QUOTE',number:'SYN-Q-001',customer:'SYN-CUSTOMER',customerName:'SYN 客戶',project:'SYN-PROJECT',projectName:'SYN 案場',date:'2026-11-27',pricingMode:'actual',taxMode:'未稅',amount:15000,tax:750,total:15750,status:'已確認',publicNote:'SYN 公開整單備註',internalNote:PRIVATE,
    lines:[{id:'SYN-LINE',house:'A1',item:history.item,unit:history.unit,qty:1,price:history.price,subtotal:15000,pricingType:'actual',priceSource:scope,priceId:history.id,note:PUBLIC_NOTE,internalNote:PRIVATE,privateNote:PRIVATE,cost:PRIVATE}]};
  const state={settings:{internalSecret:PRIVATE},quotationPrices:[history,{...history,id:'SYN-PRICE-NEW',price:17000,isBackupPrice:false,effectiveDate:'2026-11-27',createdAt:'2026-11-27T00:00:00Z'}],internalSecret:PRIVATE};
  return {quote,state,history,line:quote.lines[0]};
}
function loadProducer(code,state){
  const navigation=[];
  const window={KuSheERPStore:{getState:()=>state,quotationPriceFor:()=>{throw new Error('Export must not query the latest price');}},KusheDisplaySort:{sortWorkRows:rows=>rows},KushePhase1:{toast:message=>{throw new Error(message);}}};
  const location={href:'https://example.invalid/erp/index.html',assign:url=>navigation.push(url)};
  vm.runInNewContext(code,{window,location,URL,btoa:value=>Buffer.from(value,'binary').toString('base64'),unescape,encodeURIComponent},{filename:'assets/js/billing-print.js'});
  return {window,navigation};
}
function project(f,code=source){return normalize(loadProducer(code,f.state).window.KusheQuotationPrint.buildExternalView(f.quote));}
function financialAndTextProjection(view){const copy=normalize(view);for(const row of copy.lines)delete row.isBackupPrice;return copy;}
function expectFlag(name,transform,expected,scope='project'){
  check(name,()=>{
    const f=fixture(scope);transform?.(f);const before=clone({quote:f.quote,state:f.state});
    const after=project(f),old=project(f,baseline);
    assert.equal(after.lines[0].isBackupPrice,expected);
    assert.equal(after.lines[0].note,String(f.line.note??'').trim(),'Public work-scope note changed');
    assert.deepEqual(financialAndTextProjection(after),financialAndTextProjection(old),'The change must not alter prices, quantities, amounts, ordering or other public data');
    assert(!JSON.stringify(after).includes(PRIVATE),'Private fields escaped into external payload');
    assert.deepEqual({quote:f.quote,state:f.state},before,'Read-only export mutated a quotation or source history');
  });
}

check('Pinned K26 reproduces missing backup flag for an exact historical price with a custom note',()=>{
  const f=fixture();const old=project(f,baseline);assert.equal(old.lines[0].isBackupPrice,false);assert.equal(old.lines[0].note,PUBLIC_NOTE);
});
expectFlag('Exact project source ID supplies backup flag with custom public note',null,true);
expectFlag('Exact customer source ID supplies backup flag',null,true,'customer');
expectFlag('Exact company source ID supplies backup flag',null,true,'company');
expectFlag('A newer same-item non-backup price never overrides the saved old backup price',f=>f.state.quotationPrices.reverse(),true);
expectFlag('A newer same-item backup price never changes a saved old non-backup price',f=>{f.history.isBackupPrice=false;f.state.quotationPrices[1].isBackupPrice=true;},false);
expectFlag('An empty public note does not erase saved source backup identity',f=>f.line.note='',true);
expectFlag('A zero-valued saved backup price is supported',f=>{f.history.price=0;f.line.price=0;},true);
expectFlag('Nonempty finite numeric strings match their numeric saved price',f=>{f.history.price='15000';f.line.price='15000.00';},true);
expectFlag('Whitespace trimming permits unchanged source labels',f=>{f.line.item=' '+f.line.item+' ';f.line.unit=' 戶 ';},true);
expectFlag('Legacy exact backup note survives even without source history',f=>{f.line.note=' 備用單價 ';f.line.priceSource='manual';f.line.priceId='';f.state.quotationPrices=[];},true);
expectFlag('Legacy exact backup note remains public text even if manualPrice is true',f=>{f.line.note='備用單價';f.line.manualPrice=true;},true);
expectFlag('Manual source cannot inherit backup flag from a stale source ID',f=>f.line.priceSource='manual',false);
expectFlag('Unknown legacy source cannot inherit backup flag',f=>f.line.priceSource='legacy',false);
expectFlag('Explicit manualPrice=true blocks inferred backup flag',f=>f.line.manualPrice=true,false);
expectFlag('Missing source ID does not search prices by item',f=>delete f.line.priceId,false);
expectFlag('Empty source ID does not search prices by item',f=>f.line.priceId='   ',false);
expectFlag('Deleted source history does not use the newer same-item history',f=>f.state.quotationPrices.shift(),false);
expectFlag('Duplicate source history IDs are ambiguous even when their flags agree',f=>f.state.quotationPrices.push({...f.history}),false);
expectFlag('Duplicate source IDs with conflicting backup flags are rejected',f=>f.state.quotationPrices.push({...f.history,isBackupPrice:false}),false);
expectFlag('Source/history scope mismatch does not infer backup flag',f=>f.history.scope='customer',false);
expectFlag('Changed saved item does not infer backup flag',f=>f.line.item='SYN 不同項目',false);
expectFlag('Changed saved unit does not infer backup flag',f=>f.line.unit='式',false);
expectFlag('Changed saved amount per unit does not infer backup flag',f=>f.line.price=14999,false);
expectFlag('History backup=false does not infer backup flag',f=>f.history.isBackupPrice=false,false);
expectFlag('Truthy string backup metadata is not a boolean backup flag',f=>f.history.isBackupPrice='true',false);
expectFlag('Project source belongs to the quotation project',f=>f.history.projectId='SYN-OTHER-PROJECT',false);
expectFlag('Project source belongs to the quotation customer',f=>f.history.customerId='SYN-OTHER-CUSTOMER',false);
expectFlag('Customer source belongs to the quotation customer',f=>f.history.customerId='SYN-OTHER-CUSTOMER',false,'customer');
expectFlag('Customer source must not silently use a project-scoped history',f=>f.history.projectId='SYN-PROJECT',false,'customer');
expectFlag('Company source must not silently use customer-specific history',f=>f.history.customerId='SYN-CUSTOMER',false,'company');
expectFlag('Company source must not silently use project-specific history',f=>f.history.projectId='SYN-PROJECT',false,'company');
expectFlag('No price history collection means no inferred backup flag',f=>delete f.state.quotationPrices,false);
expectFlag('A malformed price history collection means no inferred backup flag',f=>f.state.quotationPrices={},false);
expectFlag('An unsupported explicit line flag cannot invent a source-history match',f=>{f.line.priceSource='manual';f.line.priceId='';f.line.isBackupPrice=true;},false);
for(const [label,value] of [['null',null],['undefined',undefined],['empty',''],['whitespace','   '],['NaN',NaN],['Infinity',Infinity],['negative Infinity',-Infinity],['nonnumeric','not-a-price']]){
  expectFlag(`Invalid line price ${label} cannot match a backup zero price`,f=>{f.line.price=value;f.history.price=0;},false);
  expectFlag(`Invalid history price ${label} cannot match a saved zero price`,f=>{f.line.price=0;f.history.price=value;},false);
}
expectFlag('Mixed quotation preserves backup identity for its actual row',f=>{f.quote.pricingMode='mixed';f.quote.lines.push({id:'SYN-LUMP',item:'SYN 固定承攬',unit:'式',qty:1,price:800,pricingType:'lump_sum',lumpSumAmount:800,note:'SYN 固定範圍'});},true);
expectFlag('Saved history identity remains readable in a lump-sum quotation without changing totals',f=>{f.quote.pricingMode='lump_sum';f.line.pricingType='lump_sum';f.line.lumpSumAmount=15000;f.quote.lumpSumTotal=15000;},true);
check('Appending a newer history does not mutate or reprice an already confirmed quotation export',()=>{
  const f=fixture(),first=project(f);f.state.quotationPrices.unshift({...f.history,id:'SYN-NEWEST',price:90000,isBackupPrice:false,effectiveDate:'2099-01-01'});const second=project(f);assert.deepEqual(second,first);
});
check('Billing producer remains identical to released K26 and does not export quotation public line notes',()=>{
  const f=fixture();f.quote.lines[0].note='備用單價';
  const current=normalize(loadProducer(source,f.state).window.KusheBillingPrint.buildExternalView(f.quote));
  const previous=normalize(loadProducer(baseline,f.state).window.KusheBillingPrint.buildExternalView(f.quote));
  assert.deepEqual(current,previous);assert.equal(Object.hasOwn(current.lines[0],'note'),false);assert.equal(current.lines[0].isBackupPrice,false);assert(!JSON.stringify(current).includes(PRIVATE));
});
check('Export navigation payload carries both work note and resolved backup flag without private metadata',()=>{
  const f=fixture(),loaded=loadProducer(source,f.state);loaded.window.KusheQuotationPrint.export(f.quote);assert.equal(loaded.navigation.length,1);
  const url=new URL(loaded.navigation[0]);assert.equal(url.searchParams.get('print'),'1');assert.equal(url.searchParams.get('v'),EXPECTED_VERSION);
  const payload=JSON.parse(Buffer.from(decodeURIComponent(url.hash.slice(1)),'base64').toString('utf8'));
  assert.equal(payload.lines[0].note,PUBLIC_NOTE);assert.equal(payload.lines[0].isBackupPrice,true);assert(!JSON.stringify(payload).includes(PRIVATE));
});
check('Versioned prepare API provides one immutable complete public snapshot',()=>{
  const f=fixture(),loaded=loadProducer(source,f.state),engine=loaded.window.KusheQuotationPrint;
  assert.equal(engine.version,EXPECTED_VERSION);
  const prepared=engine.prepare(f.quote);
  assert(Object.isFrozen(prepared)&&Object.isFrozen(prepared.view)&&Object.isFrozen(prepared.view.lines)&&Object.isFrozen(prepared.view.lines[0]));
  assert.equal(prepared.view.lines[0].note,PUBLIC_NOTE);assert.equal(prepared.view.publicNote,f.quote.publicNote);
  assert.deepEqual(normalize(prepared.view),project(f));assert.equal(loaded.navigation.length,0);
});
check('A prepared quotation cannot lose a line or document note between verification and export',()=>{
  const f=fixture(),loaded=loadProducer(source,f.state),prepared=loaded.window.KusheQuotationPrint.prepare(f.quote);
  assert.equal(Reflect.set(prepared.view.lines[0],'note',''),false);
  assert.equal(Reflect.set(prepared.view,'publicNote',''),false);
  assert.equal(Reflect.set(prepared.view.lines,'length',0),false);
  prepared.export();assert.equal(loaded.navigation.length,1);
  const payload=JSON.parse(Buffer.from(decodeURIComponent(new URL(loaded.navigation[0]).hash.slice(1)),'base64').toString('utf8'));
  assert.equal(payload.lines[0].note,PUBLIC_NOTE);assert.equal(payload.publicNote,f.quote.publicNote);
});
check('Prepared export does not re-read state or re-project after its public snapshot is approved',()=>{
  const f=fixture(),loaded=loadProducer(source,f.state),prepared=loaded.window.KusheQuotationPrint.prepare(f.quote);
  loaded.window.KuSheERPStore.getState=()=>{throw Error('Unexpected second state read')};
  f.line.note='SYN later source change';
  prepared.export();assert.equal(loaded.navigation.length,1);
  const payload=JSON.parse(Buffer.from(decodeURIComponent(new URL(loaded.navigation[0]).hash.slice(1)),'base64').toString('utf8'));
  assert.equal(payload.lines[0].note,PUBLIC_NOTE);
});
check('CRLF and CR in public line notes remain exact in the prepared and exported payload',()=>{
  const f=fixture(),note='SYN CRLF 第一行\r\nSYN CR 第二行\rSYN END 第三行';
  f.line.note=note;
  const loaded=loadProducer(source,f.state),prepared=loaded.window.KusheQuotationPrint.prepare(f.quote);
  assert.equal(prepared.view.lines[0].note,note);
  prepared.export();assert.equal(loaded.navigation.length,1);
  const payload=JSON.parse(Buffer.from(decodeURIComponent(new URL(loaded.navigation[0]).hash.slice(1)),'base64').toString('utf8'));
  assert.equal(payload.lines[0].note,note);assert.equal(f.line.note,note);
});
check('Producer stops before navigation if its display sorting dependency drops a noted row',()=>{
  const f=fixture(),loaded=loadProducer(source,f.state);
  loaded.window.KusheDisplaySort.sortWorkRows=()=>[];
  assert.throws(()=>loaded.window.KusheQuotationPrint.prepare(f.quote),/備註未完整/);
  assert.throws(()=>loaded.window.KusheQuotationPrint.export(f.quote),/備註未完整/);
  assert.equal(loaded.navigation.length,0);
});
check('Producer rejects a noted source line that its ordinary public-row filter would otherwise discard',()=>{
  const f=fixture(),loaded=loadProducer(source,f.state);
  Object.assign(f.line,{item:'',qty:0,price:0,subtotal:0});
  assert.throws(()=>loaded.window.KusheQuotationPrint.prepare(f.quote),/備註未完整/);
  assert.equal(loaded.navigation.length,0);
});
check('Producer rejects notes swapped between same-name rows with different saved prices',()=>{
  const f=fixture();f.quote.lines.push({...f.line,id:'SYN-LINE-SECOND',price:21000,note:'SYN second scope',priceId:'',priceSource:'manual'});
  const loaded=loadProducer(source,f.state);
  loaded.window.KusheDisplaySort.sortWorkRows=rows=>rows.map((row,i)=>({...row,note:rows[1-i].note}));
  assert.throws(()=>loaded.window.KusheQuotationPrint.prepare(f.quote),/備註未完整/);
  assert.equal(loaded.navigation.length,0);
});
report.passed=report.checks.filter(c=>c.pass).length;
report.failed=report.checks.length-report.passed;
report.status=report.failed?'FAIL':'PASS';
if(options.output){fs.mkdirSync(path.dirname(options.output),{recursive:true});fs.writeFileSync(options.output,JSON.stringify(report,null,2)+'\n');}
for(const result of report.checks)process.stdout.write(`${result.pass?'PASS':'FAIL'} ${result.name}${result.error?': '+result.error:''}\n`);
process.stdout.write(`RESULT ${report.status}: ${report.passed} passed, ${report.failed} failed\n`);
process.exitCode=report.failed?1:0;
