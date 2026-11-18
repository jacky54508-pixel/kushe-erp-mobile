/* P40-16AM. Browser-side TEST PDF: one target zone ONLY.
 * Ordinary general-combined and archived invoice-reference documents must be
 * rejected. No real branding, snapshots, invoice number or origin projects.
 */
(function(root){
'use strict';
const A4=[595.28,841.89],X=32,W=531,RIGHT=563,MIN=8.1;
const stop=reason=>{const e=new Error(reason);e.code=reason;throw e;};
const fmt=x=>Number(x).toLocaleString('en-US',{maximumFractionDigits:4});
function wrap(s,font,width){
  const result=[];let word='';
  for(const ch of Array.from(String(s))){
    if(ch==='\n'){result.push(word);word='';continue;}
    if(word && font.widthOfTextAtSize(word+ch,MIN)>width){
      result.push(word);word=ch;
    }else word+=ch;
  }
  result.push(word);return result;
}
function put(page,font,s,x,y,size=MIN,limit=RIGHT){
  const str=String(s??'');
  if(y<29||y>831||font.widthOfTextAtSize(str,size)>limit-x)
    stop('TEXT_EXCEEDS_A4');
  page.drawText(str,{font,x,y,size});
}
function border(page,x,top,width,height){
  if(top-height<30)stop('BOX_OUTSIDE_A4');
  page.drawRectangle({x,y:top-height,width,height,borderWidth:.33,
    borderColor:PDFLib.rgb(.73,.80,.86)});
}
function tableLine(page,font,values,widths,x,top,height){
  const all=widths.reduce((a,b)=>a+b,0);
  border(page,x,top,all,height);
  let cur=x;
  for(let i=0;i<values.length;i++){
    if(i)page.drawLine({start:{x:cur,y:top},
      end:{x:cur,y:top-height},thickness:.3,
      color:PDFLib.rgb(.76,.82,.87)});
    const seg=Array.isArray(values[i])?values[i]:[String(values[i]??'')];
    for(let j=0;j<seg.length;j++){
      if(font.widthOfTextAtSize(seg[j],MIN)>widths[i]-7)stop('CELL_TOO_WIDE');
      put(page,font,seg[j],cur+3.5,top-9-j*9,MIN,cur+widths[i]-3.5);
    }
    cur+=widths[i];
  }
}
async function generate(payload){
  if(!root.PDFLib||!root.fontkit||!root.P40AM)stop('LAB_DEPENDENCIES_MISSING');
  const view=root.P40AM.normalizeCustomerOnly(payload);
  const res=await fetch('../.p40-16ah-tests/runtime-font.ttf',{cache:'no-store'});
  if(!res.ok)stop('TEMP_TEST_FONT_NOT_AVAILABLE');
  const doc=await PDFLib.PDFDocument.create();
  doc.registerFontkit(root.fontkit);
  const font=await doc.embedFont(await res.arrayBuffer(),{subset:true});
  const page=doc.addPage(A4);
  put(page,font,'虛構公司｜跨區合併對外請款（僅測試）',X,810,11.3);
  border(page,511,821,51,40);
  put(page,font,'模擬LOGO',514,795);
  put(page,font,'建商：'+view.customer,X,770,8.8);
  put(page,font,'工程案場：'+view.project,X,751,9.2);
  put(page,font,'日期：'+view.date+'　稅別：'+view.taxMode,X,734,8.2);
  let y=710;
  put(page,font,'原施工明細（合併後指定區域，不刪戶別）',X,y,8.8);
  y-=10;
  const col=[53,221,31,48,70,108];
  tableLine(page,font,['戶別','施工項目','單位','數量','單價','小計'],col,X,y,13);
  y-=13;
  for(const l of view.lines){
    const desc=wrap(l.item,font,col[1]-7);
    const height=Math.max(10.5,desc.length*9+1.5);
    if(height>28)stop('ORIGINAL_ITEM_TOO_LONG');
    tableLine(page,font,[l.house,desc,l.unit,fmt(l.qty),fmt(l.price),fmt(l.amount)],
      col,X,y,height);
    y-=height;
    if(y<254)stop('ORIGINAL_DETAILS_EXCEED_CAPACITY');
  }
  put(page,font,'原施工明細合計：'+fmt(view.displayDetailTotal),X+3,y-10,8.2);
  y-=28;
  put(page,font,'施工項目彙總（保留來源分類）',X,y,8.8);
  y-=11;
  const half=(W-9)/2;
  const cols=[half*.57,half*.13,half*.14,half*.16];
  const cut=Math.ceil(view.summary.length/2);
  function summary(rows,x,top){
    let position=top;
    tableLine(page,font,['項目','數量','單價','小計'],cols,x,position,13);
    position-=13;
    for(const l of rows){
      const desc=wrap(l.item,font,cols[0]-7);
      const height=Math.max(10.5,desc.length*9+1.5);
      if(height>27)stop('SUMMARY_ITEM_TOO_LONG');
      tableLine(page,font,[desc,fmt(l.qty),fmt(l.price),fmt(l.amount)],
        cols,x,position,height);
      position-=height;
    }
    return position;
  }
  const left=summary(view.summary.slice(0,cut),X,y);
  const right=summary(view.summary.slice(cut),X+half+9,y);
  y=Math.min(left,right)-8;
  if(y<191)stop('SUMMARY_OVERLAPS_FOOTER');
  put(page,font,'施工彙總合計：'+fmt(view.displayDetailTotal),X,y,8.2);
  const note=wrap('備註：'+view.publicNote,font,303);
  if(note.length>3)stop('PUBLIC_NOTE_TOO_LONG');
  border(page,X,171,317,62);
  note.forEach((part,i)=>put(page,font,part,X+5,158-i*11));
  border(page,X+323,171,W-323,62);
  const a=view.amounts;
  put(page,font,'未稅：'+fmt(a.salesAmount),X+328,158);
  put(page,font,'稅額：'+fmt(a.taxAmount),X+328,147);
  put(page,font,'含稅：'+fmt(a.totalAmount),X+328,136);
  put(page,font,'保留款：'+fmt(a.retentionAmount),X+328,125);
  put(page,font,'應收：'+fmt(a.receivableAmount),X+328,114);
  put(page,font,'客戶簽章：__________________',X,84);
  border(page,409,101,154,68);
  put(page,font,'模擬大小章',413,67);
  put(page,font,'54 × 24 mm 預留',413,54);
  const bytes=await doc.save({useObjectStreams:false});
  const expected={
    targetOnly:view.project,
    customer:view.customer,
    original:view.lines,
    summary:view.summary,
    amounts:view.amounts,
    note:view.publicNote,
    taxMode:view.taxMode,
    originalSourceCount:payload.document.sourceSnapshots.length,
    pageCountRequired:1,
    minPt:MIN,
    readyForProduction:false
  };
  let raw='';
  for(let i=0;i<bytes.length;i+=12000)
    raw+=String.fromCharCode(...bytes.subarray(i,i+12000));
  return {base64:btoa(raw),expected};
}
root.P40AMPDF={generate};
})(window);
