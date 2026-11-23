'use strict';
// P40-16BS: pin PR74 candidate; browser/PDF smoke check using FAKE data only.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),url=require('node:url');
const source=path.resolve('candidate'),out=path.resolve('p40bs-artifacts');
const chrome=['google-chrome','google-chrome-stable','chromium','chromium-browser'].find(n=>{try{cp.execFileSync('which',[n],{stdio:'ignore'});return true}catch{return false}});
if(!chrome)throw Error('NO_CHROME: cannot claim rendered PDF PASS');
for(const cmd of ['pdfinfo','pdftotext'])try{cp.execFileSync('which',[cmd],{stdio:'ignore'})}catch{throw Error('NO_'+cmd)};
const html=path.join(source,'external-billing-print.html');
const js=path.join(source,'assets/js/external-billing-print.js');
assert(fs.existsSync(html)&&fs.existsSync(js),'MISSING_CANDIDATE_PAGE');
const code=fs.readFileSync(js,'utf8');
assert(code.includes('施工項目彙總')&&!code.includes('原請款／發票對照（原帳款不變）'),'CANDIDATE_SHA_MISMATCH');
const a={untaxed:100,tax:5,grossTotal:105,retention:5,receivable:100};
const src=(id,name)=>({billingId:id,projectName:name,customerId:'FAKE_CUST',taxMode:'未稅',invoiceStatus:'invoiced',invoiceNo:'PRIVATE_INVOICE_7738',invoiceDate:'2026-08-01',originalLines:[{house:'1A',item:'FAKE施工',unit:'式',qty:1,price:100}],anchors:{...a}});
const settle=id=>({billingId:id,received:0,outstanding:100,retentionReceived:0,retentionOutstanding:5,pendingCheque:0,availableToCollect:100,bankSecret:'PRIVATE_BANK_551'});
const line={house:'1A',item:'FAKE施工',unit:'式',qty:1,price:100,amount:100};
const d={schema:'kushe-external-billing-group-v2',id:'FAKE_EXT_3',revision:3,status:'active',documentDate:'2026-11-20',updatedAt:'2026-11-20T08:00:00+08:00',targetBillingId:'BILL-M',displayProjectName:'FAKE_TARGET_M',customerName:'FAKE建商',sourceIds:['BILL-M','BILL-L'],sourceSnapshots:[src('BILL-M','FAKE_TARGET_M'),src('BILL-L','SECRET_ZONE_L')],settlementSnapshots:[settle('BILL-M'),settle('BILL-L')],note:'虛構測試，非真實請款',totals:{untaxed:200,tax:10,grossTotal:210,retention:10,receivable:200,received:0,outstanding:200,retentionReceived:0,retentionOutstanding:10,pendingCheque:0,availableToCollect:200},detailMode:'unified',unified:{taxMode:'未稅',reason:'FAKE test merge',lines:[{...line},{...line,house:'2A'}],total:200,target:200}};
const payload={schema:'kushe-external-billing-print-v1',historical:true,document:d};
const location=url.pathToFileURL(html).href+'#'+encodeURIComponent(Buffer.from(JSON.stringify(payload)).toString('base64'));
fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'p40bs-chrome-'));
function run(extra){
 const args=['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-extensions','--disable-background-networking','--no-first-run','--allow-file-access-from-files','--no-pdf-header-footer','--virtual-time-budget=3000','--user-data-dir='+profile,...extra,location];
 try{return cp.execFileSync(chrome,args,{encoding:'utf8',timeout:45000,maxBuffer:16*1024*1024})}
 catch(e){throw Error('CHROME_FAILED '+String(e.stderr||e).slice(-900))}
}
try {
 const dom=run(['--dump-dom']);
 fs.writeFileSync(path.join(out,'FAKE_rendered_DOM.html'),dom);
 const paper=(dom.match(/<main class="paper" id="paper">([\s\S]*?)<\/main>/)||[])[1]||'';
 for(const phrase of ['FAKE_TARGET_M','FAKE施工','施工項目彙總','非本次付款通知'])assert(paper.includes(phrase),'MISSING_HTML '+phrase);
 for(const secret of ['SECRET_ZONE_L','PRIVATE_INVOICE_7738','PRIVATE_BANK_551','原請款／發票對照'])assert(!paper.includes(secret),'HTML_LEAK '+secret);
 const pdf=path.join(out,'FAKE_historical_A4.pdf');
 run(['--print-to-pdf='+pdf]);
 assert(fs.statSync(pdf).size>4500,'PDF_MISSING');
 const info=cp.execFileSync('pdfinfo',[pdf],{encoding:'utf8'});
 const txt=cp.execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'});
 fs.writeFileSync(path.join(out,'FAKE_pdf_text.txt'),txt);
 const paperSize=info.match(/Page size:\s*([0-9.]+)\s+x\s+([0-9.]+)\s+pts\s+\(A4\)/);
 assert(paperSize,'PDF_NOT_LABELED_A4');
 assert(Math.abs(Number(paperSize[1])-595.28)<1&&Math.abs(Number(paperSize[2])-841.89)<1,'PDF_A4_DIMENSIONS_WRONG');
 const pages=Number(info.match(/^Pages:\s*(\d+)/m)?.[1]);
 assert.equal(pages,1,'FAKE_SHORT_BILL_EXCEEDS_ONE_PAGE');
 for(const phrase of ['FAKE_TARGET_M','FAKE施工','施工項目彙總','非本次付款通知'])assert(txt.includes(phrase),'PDF_TEXT_MISSING '+phrase);
 assert(txt.includes('酷舍企業有限公司')&&txt.includes('統編'),'CJK_FONT_FALLBACK_FAILED_PDF_TEXT');
 for(const secret of ['SECRET_ZONE_L','PRIVATE_INVOICE_7738','PRIVATE_BANK_551','原請款／發票對照'])assert(!txt.includes(secret),'PDF_LEAK '+secret);
 run(['--window-size=390,844','--screenshot='+path.join(out,'FAKE_mobile_390.png')]);
 run(['--window-size=1280,1000','--screenshot='+path.join(out,'FAKE_desktop_1280.png')]);
 for(const file of ['FAKE_mobile_390.png','FAKE_desktop_1280.png'])assert(fs.statSync(path.join(out,file)).size>4000,'SCREENSHOT_MISSING '+file);
 fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({phase:'P40-16BS',pinnedCandidateSha:'84aca677b786c15e0e33a41aff8881a2b6944846',fakeDataOnly:true,pages,a4:true,customerPrivacyTextPass:true,realERPValidated:false,productionRelease:'BLOCKED'},null,2));
 console.log('FAKE_A4_CHROME_PDF_PASS pages='+pages+' DOM_PDF_SECRETS_ABSENT');
} finally {fs.rmSync(profile,{recursive:true,force:true})}
