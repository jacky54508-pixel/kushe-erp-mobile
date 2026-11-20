'use strict';
/* P40-16BT: FAKE test only, prints isolated draft through the unchanged original billing-print.html.
 * Never touches production, never logs actual customer data.
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const source=process.cwd(),output=path.join(source,'p40bt-artifacts');
const chrome=['google-chrome','google-chrome-stable','chromium','chromium-browser'].find(bin=>{
  try{execFileSync('which',[bin],{stdio:'ignore'});return true}catch{return false}
});
assert(chrome,'CI_CHROME_NOT_INSTALLED');
for(const executable of ['pdfinfo','pdftotext'])execFileSync('which',[executable],{stdio:'ignore'});
for(const name of ['billing-print.html','external-billing-print.html','assets/js/external-billing-print.js','enterprise/index.html'])
  assert(fs.existsSync(path.join(source,name)),'MISSING_REPOSITORY_FILE '+name);
const official=fs.readFileSync('billing-print.html','utf8');
for(const x of ['戶別施工統計','施工項目彙總','formalCompanyLogo','formalCompanySeal','客戶簽章'])
  assert(official.includes(x),'ORIGINAL_TEMPLATE_REQUIRED '+x);
const original={untaxed:100,tax:5,grossTotal:105,retention:0,receivable:105};
const src=(id,project)=>({
 billingId:id,projectName:project,customerId:'FAKE_CUST',taxMode:'未稅',
 invoiceStatus:'invoiced',invoiceNo:'FAKE_PRIVATE_INVOICE_2026',
 invoiceDate:'2026-08-01',originalLines:[{house:'1F',item:'FAKE櫃台美容',unit:'座',qty:1,price:100}],
 anchors:{...original}
});
const settlement=id=>({billingId:id,received:0,outstanding:105,retentionReceived:0,
 retentionOutstanding:0,pendingCheque:0,availableToCollect:105,bankSecret:'FAKE_PRIVATE_BANK'});
const doc={
 schema:'kushe-external-billing-group-v2',id:'FAKE_EXT_DOC',status:'active',revision:3,
 documentDate:'2026-11-20',updatedAt:'2026-11-20T09:38:00+08:00',
 targetBillingId:'BILL-M',displayProjectName:'測試M區',customerName:'測試建商',
 sourceIds:['BILL-M','BILL-L'],
 sourceSnapshots:[src('BILL-M','測試M區'),src('BILL-L','不得外顯L區')],
 settlementSnapshots:[settlement('BILL-M'),settlement('BILL-L')],
 note:'僅供版型測試，非真實請款',
 totals:{untaxed:200,tax:10,grossTotal:210,retention:0,receivable:210,received:0,
 outstanding:210,retentionReceived:0,retentionOutstanding:0,pendingCheque:0,
 availableToCollect:210},
 detailMode:'unified',
 unified:{taxMode:'未稅',reason:'FAKE',lines:[
  {house:'1F',item:'FAKE櫃台美容',unit:'座',qty:1,price:100,amount:100},
  {house:'2F',item:'FAKE櫃台美容',unit:'座',qty:1,price:100,amount:100}
 ],total:200,target:200}
};
const payload={schema:'kushe-external-billing-print-v1',historical:true,document:doc};
const encoded=encodeURIComponent(Buffer.from(JSON.stringify(payload),'utf8').toString('base64'));
const url=pathToFileURL(path.join(source,'external-billing-print.html')).href+'#'+encoded;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'p40bt-native-'));
fs.mkdirSync(output,{recursive:true});
function run(extra){
  const cmd=['--headless=new','--no-sandbox','--disable-gpu','--disable-extensions',
   '--disable-background-networking','--disable-dev-shm-usage','--no-first-run',
   '--allow-file-access-from-files','--no-pdf-header-footer',
   '--virtual-time-budget=6500','--user-data-dir='+profile,...extra,url];
  try{return execFileSync(chrome,cmd,{encoding:'utf8',timeout:120000,maxBuffer:20*1024*1024,stdio:['ignore','pipe','pipe']});}
  catch(e){throw Error('CHROME_FAILED '+String(e.stderr||e).slice(-1200))}
}
try{
 const html=run(['--dump-dom']);
 fs.writeFileSync(path.join(output,'FAKE_native_rendered_DOM.html'),html);
 const paper=(html.match(/<main\b[^>]*\bid="paper"[^>]*>([\s\S]*?)<\/main>/)||[])[1]||'';
 assert(paper.includes('測試M區')&&paper.includes('戶別施工統計')&&paper.includes('施工項目彙總'),'NOT_ORIGINAL_BILLING_TEMPLATE');
 for(const word of ['不得外顯L區','FAKE_PRIVATE_INVOICE_2026','FAKE_PRIVATE_BANK','原請款／發票對照']){
   assert(!paper.includes(word),'PUBLIC_DOM_LEAKED '+word);
 }
 assert(paper.includes('formalCompanyLogo')&&paper.includes('formalCompanySeal'),'ORIGINAL_LOGO_OR_STAMP_MISSING');
 const pdf=path.join(output,'FAKE_corrected_original_template_A4.pdf');
 run(['--print-to-pdf='+pdf]);
 assert(fs.statSync(pdf).size>8000,'NO_PDF');
 const info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'});
 const text=execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'});
 fs.writeFileSync(path.join(output,'FAKE_pdf_text.txt'),text);
 const pages=Number(info.match(/^Pages:\s*(\d+)/m)?.[1]);
 assert.equal(pages,1,'FAKE_PREVIEW_SHOULD_BE_A4_SINGLE_PAGE');
 const dimensions=info.match(/Page size:\s*([0-9.]+)\s+x\s+([0-9.]+)\s+pts\s+\(A4\)/);
 assert(dimensions,'PDF_IS_NOT_A4');
 assert(Math.abs(Number(dimensions[1])-595.28)<1 && Math.abs(Number(dimensions[2])-841.89)<1,'PDF_A4_POINT_DIMENSIONS_WRONG');
 for(const required of ['酷舍企業有限公司','請款單','戶別施工統計','施工項目彙總','公司大小章','客戶簽章','測試M區']){
   assert(text.includes(required),'ORIGINAL_TEMPLATE_PDF_REQUIRED '+required);
 }
 for(const secret of ['不得外顯L區','FAKE_PRIVATE_INVOICE_2026','FAKE_PRIVATE_BANK','原請款／發票對照']){
   assert(!text.includes(secret),'PUBLIC_PDF_LEAKED '+secret);
 }
 run(['--window-size=1280,1000','--screenshot='+path.join(output,'FAKE_native_desktop_1280.png')]);
 run(['--window-size=390,844','--screenshot='+path.join(output,'FAKE_native_mobile_390.png')]);
 for(const a of ['FAKE_native_desktop_1280.png','FAKE_native_mobile_390.png'])assert(fs.statSync(path.join(output,a)).size>3000);
 fs.writeFileSync(path.join(output,'VERIFY.json'),JSON.stringify({phase:'P40-16BT',fake:true,original_renderer_unchanged:true,
 A4_pages:pages,privacy_pass:true,formal_source_untouched:true,real_device_acceptance:false,
 production_release:'BLOCKED'},null,2));
 console.log('P40-16BT_NATIVE_TEMPLATE_FAKE_A4_PASS pages='+pages);
}finally{fs.rmSync(profile,{recursive:true,force:true})}