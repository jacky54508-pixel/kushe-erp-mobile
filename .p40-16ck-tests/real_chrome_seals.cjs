'use strict';
/* P40-16CK: real Chromium, original same-origin company logo & seals,
   a delayed asset load and a broken asset load. FAKE billing values only. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('/tmp/p40bv/node_modules/playwright-core');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'p40ck-artifacts');
const ASSETS=new Set(['/billing-print.html','/enterprise/index.html','/assets/css/p40-16cd-mint-quotation-billing.css','/assets/js/display-sort.js','/assets/js/external-billing-invoice.js']);
const FAKE={company:{name:'酷舍企業有限公司',englishName:'Cool Sir Limited Company',taxId:'82980636',address:'台中市豐原區瑞興路62號',line:'eing0519'},customer:'虛構測試客戶',project:'虛構案場',date:'2026-11-21',taxMode:'未稅',invoiceStatus:'invoice_pending',publicNote:'',lines:[{house:'1F',item:'櫃台美容',unit:'座',qty:1,price:30000,amount:30000,pricingType:'lump_sum'}],salesAmount:30000,taxAmount:1500,totalAmount:31500,receivableAmount:31500};
function serve(req,res){try{const u=new URL(req.url,'http://127.0.0.1');if(!ASSETS.has(u.pathname)){res.writeHead(403);return res.end('DENIED_FAKE_ONLY');}const f=path.resolve(ROOT,'.'+u.pathname);if(!f.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end('DENIED');}const t=path.extname(f);res.writeHead(200,{'Cache-Control':'no-store','Content-Type':t==='.html'?'text/html; charset=utf-8':t==='.css'?'text/css; charset=utf-8':'application/javascript; charset=utf-8'});fs.createReadStream(f).pipe(res)}catch(e){res.writeHead(404);res.end('NOT_FOUND')}}
const hash=d=>encodeURIComponent(Buffer.from(JSON.stringify(d),'utf8').toString('base64'));
const assetState=()=>Object.fromEntries(['formalCompanyLogo','formalCompanySeal'].map(id=>{const e=document.getElementById(id);return [id,{present:!!e,complete:!!e?.complete,width:e?.naturalWidth||0,height:e?.naturalHeight||0,sourceLength:e?.src?.length||0}]}));
async function run(browser,base,name,{quote=false,merged=false,delay=false,breakAssets=false}={}){
 const context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-TW',serviceWorkers:'block'});
 const blocked=[];
 await context.route('**/*',route=>{
   const url=route.request().url();if(url.startsWith(base+'/')||url.startsWith('data:'))return route.continue();
   blocked.push(url);return route.abort();
 });
 if(delay||breakAssets)await context.route('**/enterprise/index.html',async route=>{
   if(delay)await new Promise(resolve=>setTimeout(resolve,650));
   if(breakAssets)return route.abort('failed');
   return route.continue();
 });
 const page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(String(error)));
 const data={...FAKE,documentType:quote?'quotation':'billing',title:quote?'報價單':'請款單',pricingMode:'lump_sum',...(merged?{isMergedExternalBilling:true,mergedBillingProjects:['虛構M區'],project:'虛構M區',referenceTemplateStyle:'dali-standard-2026-11'}:{})};
 await page.goto(base+'/billing-print.html?print=0#'+hash(data),{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#safePrintButton');
 if(delay)assert.ok(await page.locator('#safePrintButton').isDisabled(),name+' should block early print while original seals download');
 if(breakAssets){
   await page.waitForFunction("window.__billingPrintError==='COMPANY_IMAGES_NOT_READY'",{timeout:18000});
   assert.ok(await page.locator('#safePrintButton').isDisabled(),name+' must block print when original asset fetch fails');
   assert.ok(await page.locator('#sealLoadError').isVisible(),name+' must show visible reason');
   await page.evaluate(()=>{window.__testPrintCalls=0;window.print=()=>{window.__testPrintCalls++;};printDocument()});
   assert.equal(await page.evaluate(()=>window.__testPrintCalls),0,name+' cannot print missing seal');
   await context.close();
   console.log('PASS FAKE_SEAL_FAIL_CLOSED '+name);
   return {name,blockedExport:true};
 }
 await page.waitForFunction("window.__billingPrintReady===true",{timeout:30000});
 assert.ok(await page.locator('#safePrintButton').isEnabled(),name+' print button still disabled');
 const images=await page.evaluate(assetState);
 for(const [id,img] of Object.entries(images))assert.ok(img.present&&img.complete&&img.width>0&&img.height>0&&img.sourceLength>1000,name+': '+id+' NOT FULLY DECODED');
 assert.equal(errors.length,0,name+' JS errors '+errors);
 const dest=path.join(OUT,name+'.pdf');
 await page.pdf({path:dest,format:'A4',printBackground:false,preferCSSPageSize:true,displayHeaderFooter:false});
 const info=execFileSync('pdfinfo',[dest],{encoding:'utf8'});
 const body=execFileSync('pdftotext',['-layout',dest,'-'],{encoding:'utf8'});
 assert.match(info,/Pages:\s+1\b/);assert.match(info,/A4/);
 for(const word of ['公司大小章','客戶簽章','櫃台美容','30,000',quote?'報價單':'請款單'])assert.ok(body.includes(word),name+' missing printed text '+word);
 const rawImages=execFileSync('pdfimages',['-list',dest],{encoding:'utf8'}).trim().split('\n');
 assert.ok(rawImages.length>=4,name+' PDF MUST EMBED company logo + seal images');
 await context.close();
 assert.deepEqual(blocked,[],name+' external traffic');
 console.log('PASS FAKE_REAL_PDF_SEALS '+name+' '+JSON.stringify({images,pdfImages:rawImages.length-2,bytes:fs.statSync(dest).size}));
 return {name,logoWidth:images.formalCompanyLogo.width,sealWidth:images.formalCompanySeal.width,pdfImages:rawImages.length-2,pageCount:1};
}
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});for(const f of ASSETS)assert.ok(fs.existsSync(path.join(ROOT,f)),'required original asset missing '+f);
 const server=http.createServer(serve);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;let browser;
 try{
   browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
   const tests=[
     await run(browser,base,'billing_with_original_seal'),
     await run(browser,base,'quotation_with_original_seal',{quote:true}),
     await run(browser,base,'merged_with_original_seal',{merged:true}),
     await run(browser,base,'delayed_original_images',{delay:true}),
     await run(browser,base,'blocked_enterprise_images',{breakAssets:true})
   ];
   assert.equal(tests.length,5);
   fs.writeFileSync(path.join(OUT,'RESULT.json'),JSON.stringify({phase:'P40-16CK',release:'BLOCKED',fakeOnly:true,originalSealDataNotModified:true,formalMainChanged:false,tests},null,2));
   console.log('P40-16CK_FULL_SEAL_GUARD_PASS 5/5');
 }catch(e){console.error('P40-16CK_SEAL_TEST_FAIL '+(e?.stack||e));process.exitCode=1}
 finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
