'use strict';
/* P40-16CJ: reproduce user's native print-dialog bug by calling Chromium PDF
   with printBackground=false; test approved A4 tint survives. FAKE DATA ONLY. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require('/tmp/p40bv/node_modules/playwright-core');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'p40cj-artifacts');
const ALLOWED=new Set(['/billing-print.html','/assets/css/p40-16cd-mint-quotation-billing.css','/assets/js/display-sort.js','/assets/js/external-billing-invoice.js','/enterprise/index.html']);
const COMPANY={name:'酷舍企業有限公司',englishName:'Cool Sir Limited Company',taxId:'82980636',address:'台中市豐原區瑞興路62號',line:'eing0519'};
const row=(house,item,qty,price)=>({house,item,unit:'座',qty,price,amount:qty*price,pricingType:'lump_sum'});
const BASE={company:COMPANY,customer:'虛構測試建設',project:'虛構心閱',date:'2026-11-21',taxMode:'未稅',invoiceStatus:'invoice_pending',publicNote:''};
const CASES=[
 {id:'billing_native',data:{...BASE,documentType:'billing',title:'請款單',lines:[row('1F','櫃台美容',1,30000)],salesAmount:30000,taxAmount:1500,totalAmount:31500,receivableAmount:31500},required:['戶別施工統計','施工項目彙總','櫃台美容','31,500']},
 {id:'quotation_native',data:{...BASE,documentType:'quotation',title:'報價單',lines:[row('1F','櫃台美容',1,30000)],pricingMode:'lump_sum',salesAmount:30000,taxAmount:1500,totalAmount:31500,receivableAmount:31500},required:['報價單','施工明細','櫃台美容','31,500']},
 {id:'merged_native',data:{...BASE,documentType:'billing',title:'請款單',project:'虛構M區',lines:[row('1F','櫃台美容',1,15000),row('2F','櫃台美容',1,15000)],salesAmount:30000,taxAmount:1500,totalAmount:31500,receivableAmount:31500,isMergedExternalBilling:true,mergedBillingProjects:['虛構M區'],referenceTemplateStyle:'dali-standard-2026-11'},required:['虛構M區','戶別施工統計','施工項目彙總','31,500']}
];
const makeUrl=x=>encodeURIComponent(Buffer.from(JSON.stringify(x),'utf8').toString('base64'));
function server(req,res){try{const u=new URL(req.url,'http://127.0.0.1');if(!ALLOWED.has(u.pathname)){res.writeHead(403);return res.end('DENIED_FAKE_ONLY');}
 const f=path.resolve(ROOT,'.'+u.pathname);if(!f.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end('DENIED');}
 const ext=path.extname(f);res.writeHead(200,{'Cache-Control':'no-store','Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'application/javascript; charset=utf-8'});return fs.createReadStream(f).pipe(res)}
 catch(e){res.writeHead(404);res.end('INVALID')}}
function pdfCheck(f,c){const info=execFileSync('pdfinfo',[f],{encoding:'utf8'}),text=execFileSync('pdftotext',['-layout',f,'-'],{encoding:'utf8'});assert.match(info,/Page size:\s+595.*842.*A4/);assert.match(info,/Pages:\s+1\b/);
 for(const word of ['酷舍企業有限公司','公司大小章','客戶簽章',...c.required])assert.ok(text.includes(word),c.id+': MISSING '+word);
 assert.ok(!text.includes('其他區發票號')&&!text.includes('BANK_SECRET'),c.id+': LEAK');}
function render(f){const ppm=f.replace(/\.pdf$/,'');
 execFileSync('pdftoppm',['-f','1','-l','1','-r','72','-singlefile','-ppm',f,ppm]);
 const buffer=fs.readFileSync(ppm+'.ppm'),match=buffer.subarray(0,140).toString('latin1').match(/^P6\s+(?:#[^\n]*\n\s*)?(\d+)\s+(\d+)\s+255\s/);
 assert.ok(match,'INVALID_PPM_HEADER');const width=+match[1],height=+match[2],start=match[0].length;
 const pixels=buffer.subarray(start,start+width*height*3);assert.equal(pixels.length,width*height*3);
 return {width,height,pixels};}
function difference(a,b){assert.equal(a.width,b.width);assert.equal(a.height,b.height);let differing=0,score=0;
 for(let j=0;j<a.pixels.length;j+=3){const dr=Math.abs(a.pixels[j]-b.pixels[j]),dg=Math.abs(a.pixels[j+1]-b.pixels[j+1]),db=Math.abs(a.pixels[j+2]-b.pixels[j+2]);if(Math.max(dr,dg,db)>=35)differring++;score+=dr+dg+db;}
 return {diff_pixels:differring,total_rgb_delta:score};}
async function run(browser,origin,c){
 const ctx=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-TW',serviceWorkers:'block'});const blocked=[];
 await ctx.route('**/*',route=>{const u=route.request().url();if(u.startsWith(origin+'/')||u.startsWith('data:'))return route.continue();blocked.push(u);return route.abort()});
 const page=await ctx.newPage();page.on('pageerror',e=>{throw e});
 await page.goto(origin+'/billing-print.html?print=0#'+makeUrl(c.data),{waitUntil:'load'});
 await page.waitForFunction('window.__billingPrintReady===true',{timeout:20000});
 await page.waitForFunction("document.getElementById('formalCompanyLogo')?.naturalWidth>0&&document.getElementById('formalCompanySeal')?.naturalWidth>0",{timeout:20000});
 await page.emulateMedia({media:'print'});
 const audit=await page.evaluate(()=>{
   const el=document.querySelector('#paper .detail tbody tr:not(.line-total) td.item');
   const paper=document.getElementById('paper');
   return {itemColor:getComputedStyle(el).backgroundColor,
     paperAdjust:getComputedStyle(paper).printColorAdjust,
     itemAdjust:getComputedStyle(el).printColorAdjust,
     sectionAdjust:getComputedStyle(paper.querySelector('.section-title')).printColorAdjust}
 });
 assert.equal(audit.itemColor,'rgb(226, 250, 245)',c.id+' item lost mint in print media');
 assert.equal(audit.paperAdjust,'exact',c.id+' print-color-adjust exact not applied to A4');
 assert.equal(audit.itemAdjust,'exact',c.id+' item exact not applied');
 const fixedOff=path.join(OUT,c.id+'_no_background_checkbox.pdf');
 const correctOn=path.join(OUT,c.id+'_background_checkbox_on.pdf');
 const oldOff=path.join(OUT,c.id+'_old_behavior_control.pdf');
 // This is Chrome's native print dialog default: "Background graphics" OFF.
 await page.pdf({path:fixedOff,format:'A4',preferCSSPageSize:true,printBackground:false,displayHeaderFooter:false});
 await page.pdf({path:correctOn,format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
 // Reproduce original bug on the same document by disabling only this opt-in rule
 // in a synthetic test (do NOT modify any app source or business data).
 await page.addStyleTag({content:'@media print {#paper.billing-document,#paper.billing-document *,#paper.quotation-document,#paper.quotation-document *{-webkit-print-color-adjust:economy !important;print-color-adjust:economy !important}}'});
 const control=await page.evaluate(()=>getComputedStyle(document.querySelector('#paper')).printColorAdjust);assert.equal(control,'economy');
 await page.pdf({path:oldOff,format:'A4',preferCSSPageSize:true,printBackground:false,displayHeaderFooter:false});
 for(const p of [fixedOff,correctOn,oldOff])pdfCheck(p,c);
 const fixedPixels=render(fixedOff),correctPixels=render(correctOn),oldPixels=render(oldOff);
 const fixedDifference=difference(fixedPixels,correctPixels),oldDifference=difference(oldPixels,correctPixels);
 console.log('P40-16CJ_COLOR_COMPARE '+c.id+' '+JSON.stringify({fixedDifference,oldDifference,audit}));
 // An unfixed PDF deliberately omits backgrounds; the corrected 'OFF'
 // rendering should nearly match the user's colorful preview/'ON' PDF.
 assert.ok(oldDifference.diff_pixels>2500,c.id+' control did not reproduce old background-loss problem');
 assert.ok(fixedDifference.diff_pixels<oldDifference.diff_pixels*.20,c.id+' printed PDF still discards approved backgrounds');
 assert.deepEqual(blocked,[],c.id+' external request blocked');
 await ctx.close();
 return {case:c.id,printBackgroundFalseA4:true,printBackgroundTrueA4:true,oldBackgroundLossReproduced:true,printColorAdjustExact:true,difference_fixed:fixedDifference,difference_old:oldDifference};
}
(async()=>{fs.mkdirSync(OUT,{recursive:true});for(const s of ALLOWED)assert.ok(fs.existsSync(path.join(ROOT,s)),'MISSING_ARTIFACT '+s);
 const host=http.createServer(server);await new Promise(done=>host.listen(0,'127.0.0.1',done));const url='http://127.0.0.1:'+host.address().port;let browser;
 try{browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const cases=[];for(const c of CASES)cases.push(await run(browser,url,c));
 fs.writeFileSync(path.join(OUT,'RESULT.json'),JSON.stringify({phase:'P40-16CJ',production_release:'BLOCKED',real_business_data_used:false,app_source_modified_for_control:false,safe_only_fake_localhost:true,cases},null,2));
 console.log('P40-16CJ_NATIVE_BACKGROUND_FIX_ALL_PASS '+cases.length);
 }catch(e){console.error('P40-16CJ_NATIVE_BACKGROUND_FAIL '+(e.stack||e));process.exitCode=1}
 finally{if(browser)await browser.close();await new Promise(ok=>host.close(ok));}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
