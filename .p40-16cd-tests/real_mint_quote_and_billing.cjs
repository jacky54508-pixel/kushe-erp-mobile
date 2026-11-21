'use strict';
/* P40-16CD — Real Chromium and actual unchanged ERP billing-print.html.
   Synthetic public example ONLY. Readonly page render, no network/cloud/login. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('/tmp/p40bv/node_modules/playwright-core');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'p40cd-artifacts');
const ASSETS=new Set(['/billing-print.html','/assets/css/p40-16cd-mint-quotation-billing.css','/assets/js/display-sort.js','/assets/js/external-billing-invoice.js','/enterprise/index.html']);
for(const u of ASSETS)assert.ok(fs.existsSync(path.join(ROOT,u)),'MISSING_ORIGINAL_ASSET '+u);
const COMPANY={name:'酷舍企業有限公司',englishName:'Cool Sir Limited Company',taxId:'82980636',address:'台中市豐原區瑞興路 62 號',line:'eing0519'};
const BASE={company:COMPANY,customer:'測試建設',project:'測試心閱',date:'2026-11-16',taxMode:'未稅',publicNote:'',retentionAmount:0,invoiceStatus:'invoice_pending'};
const line=(house,item,unit,qty,price)=>({house,item,unit,qty,price,amount:Math.round(qty*price),pricingType:'lump_sum'});
const C=[
 {id:'billing_desktop',width:1280,mobile:false,type:'billing',d:{...BASE,documentType:'billing',title:'請款單',lines:[line('1F','櫃台美容','座',1,30000)],salesAmount:30000,taxAmount:1500,totalAmount:31500,receivableAmount:31500},required:['戶別施工統計','施工項目彙總','30,000','31,500'],expectedFinal:'31,500'},
 {id:'billing_mobile390',width:390,mobile:true,from:'billing_desktop'},
 {id:'billing_retention',width:1280,mobile:false,type:'billing',d:{...BASE,documentType:'billing',title:'請款單',lines:[line('2F','矽利康修繕','式',1,30000)],salesAmount:30000,taxAmount:1500,totalAmount:31500,retentionAmount:1500,receivableAmount:30000},required:['保留款','本期實領／應收'],expectedFinal:'30,000'},
 {id:'quote_desktop',width:1280,mobile:false,type:'quotation',d:{...BASE,documentType:'quotation',title:'報價單',pricingMode:'lump_sum',lines:[line('1F','櫃台美容','座',1,30000)],salesAmount:30000,taxAmount:1500,totalAmount:31500,receivableAmount:31500},required:['報價單','施工明細','30,000','31,500'],expectedFinal:'31,500'},
 {id:'quote_mobile390',width:390,mobile:true,from:'quote_desktop'},
 {id:'quote_actual',width:1280,mobile:false,type:'quotation',d:{...BASE,documentType:'quotation',title:'報價單',pricingMode:'actual',lines:[{...line('1F','玻璃美容','才',5,600),pricingType:'actual'}],salesAmount:3000,taxAmount:150,totalAmount:3150,receivableAmount:3150},required:['報價單','施工明細','實做實算','玻璃美容'],actual:true},
 {id:'merged_desktop',width:1280,mobile:false,type:'billing',d:{...BASE,documentType:'billing',title:'請款單',project:'測試M區',lines:[{...line('1F','櫃台美容','座',1,15000),sourcePricingType:'external-document'},{...line('2F','櫃台美容','座',1,15000),sourcePricingType:'external-document'}],salesAmount:30000,taxAmount:1500,totalAmount:31500,receivableAmount:31500,isMergedExternalBilling:true,mergedBillingProjects:['測試M區'],referenceTemplateStyle:'dali-standard-2026-11'},required:['測試M區','戶別施工統計','施工項目彙總','31,500'],expectedFinal:'31,500'},
 {id:'merged_mobile390',width:390,mobile:true,from:'merged_desktop'}
];
const byId=new Map();for(const c of C)if(c.d)byId.set(c.id,c);
function serve(req,res){try{const u=new URL(req.url,'http://127.0.0.1');if(!ASSETS.has(u.pathname)){res.writeHead(403);return res.end('DENIED_FAKE_ONLY');}const fp=path.resolve(ROOT,'.'+u.pathname);if(!fp.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end('PATH_DENIED');}const ext=path.extname(fp);res.writeHead(200,{'Cache-Control':'no-store','Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'application/javascript; charset=utf-8'});return fs.createReadStream(fp).pipe(res)}catch(e){res.writeHead(404);res.end('ERROR')}}
const encode=d=>encodeURIComponent(Buffer.from(JSON.stringify(d),'utf8').toString('base64'));
function checkPdf(f,c){const info=execFileSync('pdfinfo',[f],{encoding:'utf8'}),text=execFileSync('pdftotext',['-layout',f,'-'],{encoding:'utf8'});const pages=Number(info.match(/^Pages:\s*(\d+)/m)?.[1]);assert.equal(pages,1,c.id+' A4 single page');assert.match(info,/A4/,c.id+' must be A4');for(const word of ['酷舍企業有限公司','公司大小章','客戶簽章',...c.required])assert.ok(text.includes(word),c.id+' text missing '+word);if(c.type==='billing')assert.ok(text.includes('請款單'),c.id+' label');if(c.type==='quotation')assert.ok(text.includes('報價單'),c.id+' label');assert.ok(!text.includes('秘密發票')&&!text.includes('FAKE_OTHER_AREA'),c.id+' privacy');fs.writeFileSync(path.join(OUT,c.id+'_text.txt'),text);return pages;}
async function check(browser,base,raw){const c=raw.from?{...raw,...byId.get(raw.from),id:raw.id,width:raw.width,mobile:raw.mobile}:raw;
  const ctx=await browser.newContext({viewport:{width:c.width,height:c.mobile?844:900},deviceScaleFactor:c.mobile?2:1,isMobile:c.mobile,hasTouch:c.mobile,locale:'zh-TW',serviceWorkers:'block'});
  const blocked=[];await ctx.route('**/*',route=>{const u=route.request().url();if(u.startsWith(base+'/')||u.startsWith('data:'))return route.continue();blocked.push(u);return route.abort()});
  const page=await ctx.newPage();page.on('pageerror',e=>{throw e});
  await page.goto(base+'/billing-print.html?print=0#'+encode(c.d),{waitUntil:'load'});
  await page.waitForFunction('window.__billingPrintReady===true',{timeout:20000});
  await page.waitForFunction("!!document.getElementById('formalCompanyLogo')?.naturalWidth&&!!document.getElementById('formalCompanySeal')?.naturalWidth",{timeout:20000});
  const audit=await page.evaluate(()=>{
    const paper=document.getElementById('paper'),rgb=e=>getComputedStyle(e).backgroundColor,css=e=>getComputedStyle(e).backgroundImage,
     firstItem=paper.querySelector('.detail tbody tr:not(.line-total) td.item'),
     numeric=paper.querySelector('.detail tbody tr:not(.line-total) td:nth-child(2)'),
     matrixFirst=paper.querySelector('.matrix tbody tr:not(.grand) td:first-child'),
     matrixOther=paper.querySelector('.matrix tbody tr:not(.grand) td:nth-child(2)'),
     matrixHead=paper.querySelector('.matrix thead th'),
     header=paper.querySelector('.detail thead th:first-child'),
     total=paper.querySelector('.summary-row.receivable')||paper.querySelector('.summary-row.total'),
     quoteContent=paper.querySelector('#quotationContent');
    return {item:rgb(firstItem),numeric:rgb(numeric),matrix:matrixFirst?rgb(matrixFirst):null,matrixOther:matrixOther?rgb(matrixOther):null,matrixHead:matrixHead?rgb(matrixHead):null,detailHead:rgb(header),titleBG:css(paper.querySelector('.section-title')),totalBG:total?css(total):null,footerBG:getComputedStyle(paper,'::after').backgroundImage,hasMatrix:!!matrixFirst,hasActual:!!paper.querySelector('.actual-pricing-label'),hasQuotationContent:!!quoteContent,hasRetention:!!paper.querySelector('.summary-row.receivable'),plainInfo:rgb(paper.querySelector('.info>div')),invoiceReferencesPresent:!!paper.querySelector('.invoice-ref-table'),signed:!!paper.querySelector('#formalCompanySeal')?.naturalWidth,logo:!!paper.querySelector('#formalCompanyLogo')?.naturalWidth,paperHeight:paper.getBoundingClientRect().height,printScale:paper.dataset.quotationScale||''};
  });
  const mint='rgb(226, 250, 245)',white='rgb(255, 255, 255)';
  assert.equal(audit.item,mint,c.id+' FIRST_ITEM_NOT_MINT');assert.equal(audit.numeric,white,c.id+' NUMERIC_CELL_MUST_REMAIN_WHITE');assert.equal(audit.detailHead,'rgb(23, 110, 156)',c.id+' DARK_TEAL_ITEM_COLUMN_HEADER');
  assert.match(audit.titleBG,/linear-gradient/i,c.id+' SECTION_HEADER_AQUA');assert.match(audit.footerBG,/linear-gradient/i,c.id+' FOOTER_WAVES');
  assert.equal(audit.plainInfo,white,c.id+' HEADER_VALUE_NOT_WHITE');assert.equal(audit.signed,true,c.id+' NO_SEAL');assert.equal(audit.logo,true,c.id+' NO_LOGO');
  if(c.type==='billing'){assert.equal(audit.matrix,mint,c.id+' HOUSE_NOT_SAME_MINT');assert.equal(audit.matrixOther,white,c.id+' HOUSE_COUNT_NOT_WHITE');assert.equal(audit.matrixHead,'rgb(25, 62, 106)',c.id+' MATRIX_HEADER_NAVY');assert.equal(audit.hasQuotationContent,false);}
  else{assert.equal(audit.hasMatrix,false,c.id+' QUOTE_MUST_NOT_GAIN_BILLING_MATRIX');assert.equal(audit.hasQuotationContent,true,c.id+' quote wrapper');assert.equal(audit.hasActual,Boolean(c.actual),c.id+' QUOTE_PRICING_MODE_CHANGED');}
  if(c.actual)assert.equal(audit.totalBG,null,c.id+' ACTUAL_QUOTE_MUST_NOT_ADD_PRICE_TOTAL');
  else assert.match(audit.totalBG||'',/linear-gradient/i,c.id+' FINAL_TOTAL_TEAL_GRADIENT');
  assert.equal(audit.hasRetention,c.id==='billing_retention',c.id+' RETENTION_DISPLAY_CHANGED');
  if(c.d.isMergedExternalBilling)assert.equal(audit.invoiceReferencesPresent,false,c.id+' ORIGINAL_INVOICES_PUBLIC');
  const pdf=path.join(OUT,c.id+'.pdf');await page.pdf({path:pdf,format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
  const pages=checkPdf(pdf,c);
  await page.screenshot({path:path.join(OUT,c.id+'.png'),fullPage:true});
  assert.deepEqual(blocked,[],c.id+' EXTERNAL_NETWORK');
  await ctx.close();
  console.log('PASS MINT_A4 '+c.id+' '+JSON.stringify({pages,ink:mint,pdf_bytes:fs.statSync(pdf).size}));
  return {id:c.id,type:c.type,physicalDevice:false,mode:c.actual?'actual':'standard',pages,pdf_bytes:fs.statSync(pdf).size,hasLogo:audit.logo,hasSeal:audit.signed};
}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const server=http.createServer(serve);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 let browser;
 try{browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
   const cases=[];for(const c of C)cases.push(await check(browser,base,c));
   const report={phase:'P40-16CD',fixture:'synthetic-only',production_release:'BLOCKED',no_erp_data_writes:true,no_supabase_or_external_network:true,quote_and_billing_use_same_mint_color:true,owner_original_image_not_uploaded_to_github:true,physical_device_verification:false,cases};
   fs.writeFileSync(path.join(OUT,'RESULT.json'),JSON.stringify(report,null,2));
   console.log('P40-16CD_MINT_QUOTE_BILLING_ALL_PASS '+cases.length);
 }catch(e){console.error('P40-16CD_MINT_FAIL '+(e?.stack||e));process.exitCode=1}
 finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
