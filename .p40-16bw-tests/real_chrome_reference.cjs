'use strict';
/* P40-16BW: real Chrome two-tab FAKE billing test. NEVER connect to production. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('/tmp/p40bv/node_modules/playwright-core');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'p40bw-artifacts'),PARENT=path.join(ROOT,'p40bw-fake-parent.html');
for(const f of ['assets/js/billing-groups.js','assets/js/external-billing-print.js','external-billing-print.html','billing-print.html'])
 assert(fs.existsSync(path.join(ROOT,f)),'MISSING_CANDIDATE_FILE '+f);
const ss={untaxed:100,tax:5,grossTotal:105,retention:5,receivable:100};
const src=(id,name)=>({billingId:id,projectName:name,customerId:'FAKE_CUST',taxMode:'未稅',invoiceStatus:'invoiced',invoiceNo:'FAKE_PRIVATE_INV_7738',originalLines:[{house:'1F',item:'櫃台美容',unit:'座',qty:1,price:100}],anchors:{...ss}});
const st=id=>({billingId:id,received:0,outstanding:100,retentionReceived:0,retentionOutstanding:5,pendingCheque:0,availableToCollect:100,bankSecret:'FAKE_PRIVATE_BANK'});
const doc={schema:'kushe-external-billing-group-v2',id:'FAKE_DOC',status:'active',revision:3,documentDate:'2026-11-20',updatedAt:'2026-11-20T11:00:00+08:00',targetBillingId:'B-M',displayProjectName:'測試M區',customerName:'測試建商',sourceIds:['B-M','B-L'],sourceSnapshots:[src('B-M','測試M區'),src('B-L','FAKE_OTHER_AREA_L')],settlementSnapshots:[st('B-M'),st('B-L')],note:'僅供虛構測試',totals:{untaxed:200,tax:10,grossTotal:210,retention:10,receivable:200,received:0,outstanding:200,retentionReceived:0,retentionOutstanding:10,pendingCheque:0,availableToCollect:200},detailMode:'unified',unified:{taxMode:'未稅',reason:'測試施工合併',lines:[{house:'1F',item:'櫃台美容',unit:'座',qty:1,price:100,amount:100},{house:'2F',item:'櫃台美容',unit:'座',qty:1,price:100,amount:100}],total:200,target:200}};
const secrets=['FAKE_PRIVATE_INV_7738','FAKE_OTHER_AREA_L','FAKE_PRIVATE_BANK','sourceSnapshots','settlementSnapshots'];
function fakeParent(){
 const s='<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>FAKE ERP isolated browser fixture</title><body><button id="preview" type="button">合併請款預覽</button><script>const d='+JSON.stringify(doc).replace(/<\//g,'<\\/')+'; const st={billings:[{id:"B-M"}]};window.KuSheERPStore={getState(){return st},externalBillingDocumentIndex(){return {documents:[{document:d,issues:[],termsChanged:false,settlementChanged:false}]}}};window.KusheBillingPrint={buildExternalView(){return {company:{name:"酷舍企業有限公司",englishName:"Cool Sir Limited Company",taxId:"82980636",address:"測試地址"},publicNote:"",lines:[]}}};</script><script src="/assets/js/billing-groups.js"></script><script>document.getElementById("preview").onclick=()=>window.KusheBillingGroups.printSaved("FAKE_DOC",0,true);</script></body></html>';
 fs.writeFileSync(PARENT,s);
}
const required=['酷舍企業有限公司','請款單','戶別施工統計','施工項目彙總','客戶簽章','公司大小章','測試M區','櫃台美容'];
function checkPDF(file,label){
 const info=execFileSync('pdfinfo',[file],{encoding:'utf8'});
 const pages=Number(info.match(/^Pages:\s*(\d+)/m)?.[1]);
 assert.equal(pages,1,label+' expected A4 ONE PAGE');
 assert.match(info,/A4/,label+' not A4');
 const txt=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
 fs.writeFileSync(path.join(OUT,label+'_extracted.txt'),txt);
 for(const word of required)assert.ok(txt.includes(word),label+' PDF missing '+word);
 for(const word of secrets)assert.ok(!txt.includes(word),label+' leaked '+word);
 assert.ok(txt.includes('210')&&txt.includes('200'),label+' lost saved amount');
 return pages;
}
function serve(req,res){
 try{
  const u=new URL(req.url,'http://localhost'),f=path.resolve(ROOT,'.'+decodeURIComponent(u.pathname));
  if(!f.startsWith(ROOT+path.sep)||!fs.statSync(f).isFile()){res.writeHead(403);return res.end('invalid');}
  const ext=path.extname(f);
  res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'application/javascript; charset=utf-8':ext==='.css'?'text/css':ext==='.png'?'image/png':'text/plain; charset=utf-8','Cache-Control':'no-store'});
  fs.createReadStream(f).pipe(res);
 }catch(_){res.writeHead(404);res.end('not found');}
}
async function checkCase(browser,base,label,viewport,mobile){
 const context=await browser.newContext({viewport,deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile,locale:'zh-TW',serviceWorkers:'block'});
 const requests=[];context.on('request',r=>requests.push(r.url()));
 const page=await context.newPage();await page.goto(base+'/p40bw-fake-parent.html',{waitUntil:'load'});
 await page.waitForFunction('window.KusheBillingGroups&&window.KusheBillingGroups.printSaved');
 assert.equal(await page.evaluate('typeof crypto.randomUUID'),'function');
 assert.equal(await page.evaluate('typeof BroadcastChannel'),'function');
 const event=context.waitForEvent('page',{timeout:20000});await page.locator('#preview').click();const popup=await event;
 await popup.waitForURL(/billing-print\.html\?/, {timeout:25000});
 await popup.waitForFunction('window.__billingPrintReady===true',{timeout:25000});
 assert.ok(!popup.url().includes('ksprint'),label+' ticket should be cleared in final route');
 for(const word of secrets)assert.ok(!popup.url().includes(word),label+' raw snapshot in URL');
 const html=await popup.locator('#paper').innerHTML();

 const audit=await popup.evaluate(()=>{
   const paper=document.querySelector('#paper');
   const label=paper.querySelector('.info .label'), title=paper.querySelector('.section-title'), th=paper.querySelector('.matrix th'), total=paper.querySelector('.summary-row.total');
   if(!paper||!label||!title||!th||!total)throw Error('MISSING_REFERENCE_STYLE_NODES');
   const current={flag:paper.classList.contains('reference-template'),labelBackground:getComputedStyle(label).backgroundColor,
     labelColor:getComputedStyle(label).color,titleBackground:getComputedStyle(title).backgroundColor,titleImage:getComputedStyle(title).backgroundImage,
     tableHeader:getComputedStyle(th).backgroundColor,totalBackground:getComputedStyle(total).backgroundColor};
   paper.classList.remove('reference-template');
   current.normalTitleBackgroundImage=getComputedStyle(title).backgroundImage;
   current.normalLabelBackground=getComputedStyle(label).backgroundColor;
   paper.classList.add('reference-template');
   return current;
 });
 assert.equal(audit.flag,true,label+' missing template opt-in flag');
 assert.equal(audit.labelBackground,'rgba(0, 0, 0, 0)',label+' label should be gray text on transparent background');
 assert.equal(audit.titleBackground,'rgb(255, 255, 255)',label+' title must be white');
 assert.equal(audit.titleImage,'none',label+' gradient must be removed on external reference');
 assert.equal(audit.tableHeader,'rgb(255, 255, 255)',label+' reference table headers must be white');
 assert.equal(audit.totalBackground,'rgb(255, 255, 255)',label+' summary total background must be white');
 assert.match(audit.normalTitleBackgroundImage,/linear-gradient/i,label+' ordinary billing gradient must remain unchanged');
 assert.equal(audit.normalLabelBackground,'rgb(9, 45, 87)',label+' ordinary billing label must keep prior dark blue');

 for(const word of ['formalCompanyLogo','formalCompanySeal','戶別施工統計','施工項目彙總','客戶簽章','公司大小章','測試M區'])
   assert.ok(html.includes(word),label+' native template missing '+word);
 for(const word of secrets)assert.ok(!html.includes(word),label+' leaked private record '+word);
 const pdf=path.join(OUT,'FAKE_'+label+'_A4.pdf');
 await popup.pdf({path:pdf,format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
 const pages=checkPDF(pdf,label);
 await popup.screenshot({path:path.join(OUT,'FAKE_'+label+'_preview.png'),fullPage:true});
 for(const u of requests)assert.ok(u.startsWith(base)||u.startsWith('data:'),label+' unexpected external network '+u);
 await context.close();
 return {label,pages,pdf_bytes:fs.statSync(pdf).size,viewport,has_real_browser_popup:true,real_physical_device:false};
}
async function checkBadUrls(browser,base){
 const ctx=await browser.newContext();const p=await ctx.newPage();
 await p.goto(base+'/external-billing-print.html#FAKE_NOT_SAFE',{waitUntil:'load'});
 await p.waitForFunction("document.querySelector('#paper').textContent.includes('不安全')",{timeout:6000});
 await p.goto(base+'/external-billing-print.html?v=x',{waitUntil:'load'});
 await p.waitForFunction("document.querySelector('#paper').textContent.includes('安全列印憑證')",{timeout:6000});
 await ctx.close();return {reject_old_snapshot_url:true,reject_missing_ticket:true};
}
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});fakeParent();const server=http.createServer(serve);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  const exe=process.env.CHROME_BIN||'/usr/bin/google-chrome';
  assert.ok(fs.existsSync(exe),'CHROME_BIN_NOT_FOUND '+exe);
  browser=await chromium.launch({executablePath:exe,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const desktop=await checkCase(browser,base,'desktop',{width:1280,height:900},false);
  const mobile=await checkCase(browser,base,'mobile390',{width:390,height:844},true);
  const rejected=await checkBadUrls(browser,base);
  const result={phase:'P40-16BW',mode:'FAKE_REAL_CHROMIUM_TWO_TABS',cases:[desktop,mobile],negative_cases:rejected,production_release:'BLOCKED',real_business_data_used:false,main_beta_supabase_untouched:true};
  fs.writeFileSync(path.join(OUT,'RESULT.json'),JSON.stringify(result,null,2));
  console.log('PASS P40-16BW_REAL_CHROMIUM_FAKE_A4 '+JSON.stringify(result));
 }catch(e){console.error('FAIL P40-16BW REAL BROWSER '+e.stack);process.exitCode=1}
 finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));try{fs.unlinkSync(PARENT)}catch(_){}}
})().catch(e=>{console.error(e);process.exitCode=1});
