'use strict';
/* P40-16CE | Stress test unchanged mint PDF renderer with fictional documents.
 * Offline localhost, never connects ERP, GitHub secrets, official Supabase or real records.
 * Supported examples require A4 one-page; stress cases report pagination honestly. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('/tmp/p40bv/node_modules/playwright-core');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'p40ce-artifacts');
const ALLOWED=new Set(['/billing-print.html','/assets/css/p40-16cd-mint-quotation-billing.css','/assets/js/display-sort.js','/assets/js/external-billing-invoice.js','/enterprise/index.html']);
for(const p of ALLOWED)assert.ok(fs.existsSync(path.join(ROOT,p)),'MISSING_PRINT_ASSET '+p);
const company={name:'酷舍企業有限公司',englishName:'Cool Sir Limited Company',taxId:'82980636',address:'台中市豐原區瑞興路62號',line:'eing0519'};
const base={company,customer:'虛構測試建設',project:'虛構心閱',date:'2026-11-21',taxMode:'未稅',invoiceStatus:'invoice_pending',publicNote:''};
const n=v=>Math.round(v);
function makeLines(count,{mode='billing',itemCount=3,houses=12,price=1100,merged=false,actual=false}={}){
 return Array.from({length:count},(_,i)=>{
   const house='FAKE-'+String(1+(i%houses)).padStart(2,'0')+'F';
   const unique='測試'+String(i+1).padStart(2,'0');
   const item=mode==='quote'?unique+'玻璃美容':'測試'+String(i%itemCount+1)+'類施工';
   const p=price+(i%4)*100,quantity=1+(i%3),amount=n(p*quantity);
   return {house,item,unit:'式',qty:quantity,price:p,amount,pricingType:actual?'actual':'lump_sum',...(merged?{sourcePricingType:'external-document'}:{})};
 });
}
function doc(type,lines,{retention=0,merged=false,actual=false,note=''}={}){
 const salesAmount=lines.reduce((a,l)=>a+l.amount,0),taxAmount=n(salesAmount*.05),totalAmount=salesAmount+taxAmount;
 return {...base,documentType:type,title:type==='quotation'?'報價單':'請款單',
 pricingMode:type==='quotation'?(actual?'actual':'lump_sum'):'',project:merged?'虛構M區':base.project,
 lines,salesAmount,taxAmount,totalAmount,retentionAmount:retention,receivableAmount:totalAmount-retention,publicNote:note,
 ...(merged?{isMergedExternalBilling:true,mergedBillingProjects:['虛構M區'],referenceTemplateStyle:'dali-standard-2026-11'}:{})};
}
const data=[
 {id:'billing_12_houses',type:'billing',supported:true,rows:12,doc:doc('billing',makeLines(12,{itemCount:1,houses:12}),{retention:500})},
 {id:'merged_18_details',type:'billing',supported:true,rows:18,dense:true,doc:doc('billing',makeLines(18,{itemCount:3,houses:6,merged:true}),{merged:true})},
 {id:'quotation_18_items',type:'quotation',supported:true,rows:18,doc:doc('quotation',makeLines(18,{mode:'quote',houses:18}))},
 {id:'quotation_actual_18_items',type:'quotation',supported:true,rows:18,actual:true,doc:doc('quotation',makeLines(18,{mode:'quote',actual:true,houses:18}),{actual:true})},
 {id:'merged_32_stress',type:'billing',supported:false,rows:32,dense:true,doc:doc('billing',makeLines(32,{itemCount:4,houses:16,merged:true}),{merged:true})},
 {id:'quotation_36_stress',type:'quotation',supported:false,rows:36,doc:doc('quotation',makeLines(36,{mode:'quote',houses:18}))}
];
const encode=d=>encodeURIComponent(Buffer.from(JSON.stringify(d),'utf8').toString('base64'));
function serve(req,res){try{const u=new URL(req.url,'http://127.0.0.1');if(!ALLOWED.has(u.pathname)){res.writeHead(403);return res.end('DENIED');}
 const f=path.resolve(ROOT,'.'+u.pathname);if(!f.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end('DENIED');}
 const ext=path.extname(f);res.writeHead(200,{'Cache-Control':'no-store','Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'application/javascript; charset=utf-8'});fs.createReadStream(f).pipe(res);}catch(e){res.writeHead(404);res.end('NOT_FOUND')}}
function pdfReport(file,c){
 const info=execFileSync('pdfinfo',[file],{encoding:'utf8'}),text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
 const pages=Number(info.match(/^Pages:\s*(\d+)/m)?.[1]);assert.ok(pages>=1,'INVALID_PDF_PAGE_COUNT');
 assert.match(info,/A4/,'NOT_A4');
 const expectedWords=[...new Set(c.doc.lines.map(row=>row.item))];
 for(const word of ['酷舍企業有限公司',c.doc.title,'公司大小章','客戶簽章',...expectedWords])assert.ok(text.includes(word),c.id+' MISSING_PDF_CONTENT '+word);
 assert.ok(!text.includes('另一區發票')&&!text.includes('FAKE_BANK_SECRET'),c.id+' PRIVATE_LEAK');
 // Check no independent source amount silently changed.
 assert.ok(text.includes(c.doc.salesAmount.toLocaleString('en-US'))||c.actual,c.id+' UNEXPECTED_MISSING_PRICE');
 if(c.supported)assert.equal(pages,1,c.id+' SINGLE_A4_OVERFLOW_NOT_ACCEPTABLE');
 fs.writeFileSync(path.join(OUT,c.id+'_text.txt'),text);
 const pageTexts=[];for(let p=1;p<=pages;p++){pageTexts.push(execFileSync('pdftotext',['-f',String(p),'-l',String(p),'-layout',file,'-'],{encoding:'utf8'}).trim());}
 const blankPages=pageTexts.filter(t=>t.length<12).length;
 assert.equal(blankPages,0,c.id+' BLANK_PDF_PAGE');
 return {pages,blankPages,characters:text.length,uniqueItemCount:expectedWords.length};
}
async function runCase(browser,base,c){
 const context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-TW',serviceWorkers:'block'}),blocked=[];
 await context.route('**/*',route=>{const u=route.request().url();if(u.startsWith(base+'/')||u.startsWith('data:'))return route.continue();blocked.push(u);return route.abort()});
 const page=await context.newPage();
 await page.goto(base+'/billing-print.html?print=0#'+encode(c.doc),{waitUntil:'load'});
 await page.waitForFunction('window.__billingPrintReady===true',{timeout:25000});
 const audit=await page.evaluate(()=>{
   const root=document.querySelector('#paper'),detail=root.querySelector('.detail');
   const swatch=el=>el?getComputedStyle(el).backgroundColor:null;
   const item=detail?.querySelector('tbody tr:not(.line-total) td.item');
   const amount=detail?.querySelector('tbody tr:not(.line-total) td.num');
   const house=root.querySelector('.matrix tbody tr:not(.grand) td:first-child');
   const dense=root.querySelector('.dense-original-details');
   const quote=root.querySelector('#quotationContent');
   const summary=root.querySelector('.grouped-item-summary');
   return {itemColor:swatch(item),amountColor:swatch(amount),houseColor:swatch(house),
    detailRows:detail?.querySelectorAll('tbody tr:not(.line-total)').length,
    denseRows:dense?.querySelectorAll('tbody tr:not(.line-total)').length,
    hasDense:!!dense,hasGroupedSummary:!!summary,hasMatrix:!!house,
    hasQuotationWrapper:!!quote,quotationScale:root.dataset.quotationScale||'',sealsLoaded:Boolean(document.querySelector('#formalCompanySeal')?.naturalWidth),logoLoaded:Boolean(document.querySelector('#formalCompanyLogo')?.naturalWidth)};
 });
 assert.equal(audit.itemColor,'rgb(226, 250, 245)',c.id+' ITEM_MINT_CHANGED');
 assert.equal(audit.amountColor,'rgb(255, 255, 255)',c.id+' AMOUNT_WHITE_CHANGED');
 if(c.dense){assert.equal(audit.hasDense,true,'DENSE_DETAIL_MISSING');assert.equal(audit.hasGroupedSummary,true,'DENSE_GROUPED_SUMMARY_MISSING');assert.equal(audit.denseRows,c.rows,'DENSE_ORIGINAL_ROWS_LOST');}
 else{assert.equal(audit.detailRows,c.rows===12?1:c.rows,'DETAIL_COUNT_MISMATCH');}
 if(c.type==='quotation')assert.ok(audit.hasQuotationWrapper,'QUOTATION_WRAPPER_MISSING');
 if(c.id==='billing_12_houses')assert.equal(audit.houseColor,'rgb(226, 250, 245)','HOUSE_MINT_DIFFERENT_FROM_ITEM');
 const pdf=path.join(OUT,c.id+'.pdf');
 await page.pdf({path:pdf,format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
 const stats=pdfReport(pdf,c);
 await page.screenshot({path:path.join(OUT,c.id+'.png'),fullPage:true});
 assert.deepEqual(blocked,[],c.id+' OUTBOUND_NETWORK');
 await context.close();
 console.log('PASS P40_16CE_DENSE '+c.id+' '+JSON.stringify({pages:stats.pages,supported:c.supported,details:audit.denseRows||audit.detailRows}));
 return {id:c.id,supported:c.supported,type:c.type,rows:c.rows,merged:Boolean(c.doc.isMergedExternalBilling),actual:Boolean(c.actual),...stats,renderedTotalsUnchanged:true,hasDense:audit.hasDense,hasGroupedSummary:audit.hasGroupedSummary,pdfSizeBytes:fs.statSync(pdf).size};
}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const server=http.createServer(serve);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const base='http://127.0.0.1:'+server.address().port;
 try{browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const cases=[];for(const c of data)cases.push(await runCase(browser,base,c));
 const diagnosticMultiplePage=cases.filter(c=>!c.supported&&c.pages>1).map(c=>({id:c.id,pages:c.pages,reason:'stress-limit; not approved as one-page'}));
 const report={phase:'P40-16CE',fakeOnly:true,actualERPPrintHTML:true,actualChromium:true,production_release:'BLOCKED',no_real_customer_data:true,no_code_accounting_changes:true,physically_tested_on_user_devices:false,one_page_supported_cases_pass:cases.filter(c=>c.supported).every(c=>c.pages===1),diagnosticMultiplePage,cases};
 fs.writeFileSync(path.join(OUT,'RESULT.json'),JSON.stringify(report,null,2));
 console.log('P40-16CE_REAL_A4_RESULT '+JSON.stringify({passed:cases.length,diagnosticMultiplePage}));
 }catch(e){console.error('P40-16CE_FAIL '+(e.stack||e));process.exitCode=1}
 finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
