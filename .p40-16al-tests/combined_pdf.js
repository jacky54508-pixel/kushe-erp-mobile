/* P40-16AL — actual in-browser PDF bytes of synthetic GENERAL combined bills.
 * NO formal ERP integration, downloads, storage, network upload or real seals.
 * 1 A4 page or reject. The bottom item summary is EXPERIMENTAL (the current
 * official HTML bundles projects and grand totals; it has no item-summary).
 */
(function(root){
'use strict';
const A4=[595.28,841.89],LEFT=32,RIGHT=563,WIDTH=531,MIN=8.1;
const fail=k=>{const e=new Error(k);e.code=k;throw e;};
const n=v=>Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
function text(page,font,value,x,y,size=MIN,limit=RIGHT){
  const s=String(value??'');
  if(y<29||y>825||font.widthOfTextAtSize(s,size)>limit-x)fail('TEXT_OVERFLOW');
  page.drawText(s,{font,size,x,y});
}
function wrap(s,font,max){
  const lines=[];let cur='';
  for(const ch of Array.from(String(s))){
    if(ch==='\n'){lines.push(cur);cur='';continue;}
    if(cur && font.widthOfTextAtSize(cur+ch,MIN)>max){lines.push(cur);cur=ch;}
    else cur+=ch;
  }lines.push(cur);return lines;
}
function box(page,x,top,w,h){
  if(top-h<29)fail('A4_BOX_OVERFLOW');
  page.drawRectangle({x,y:top-h,width:w,height:h,borderWidth:.33,
    borderColor:PDFLib.rgb(.74,.80,.86)});
}
function cells(page,font,parts,widths,x,top,height){
  box(page,x,top,widths.reduce((a,b)=>a+b,0),height);
  let cur=x;
  for(let i=0;i<parts.length;i++){
    if(i)page.drawLine({start:{x:cur,y:top},end:{x:cur,y:top-height},
      color:PDFLib.rgb(.76,.81,.86),thickness:.3});
    const content=Array.isArray(parts[i])?parts[i]:[String(parts[i]??'')];
    for(let j=0;j<content.length;j++){
      if(font.widthOfTextAtSize(content[j],MIN)>widths[i]-7)
        fail('CELL_TOO_WIDE');
      text(page,font,content[j],cur+3,top-9-j*9,MIN,cur+widths[i]-4);
    }
    cur+=widths[i];
  }
}
const val=v=>v==null?'—':n(v);
async function generate(combined,trust){
  if(!root.P40AL||!root.PDFLib||!root.fontkit)
    fail('LAB_DEPENDENCIES_MISSING');
  const view=root.P40AL.normalize(combined,trust);
  const fontRes=await fetch('../.p40-16ah-tests/runtime-font.ttf',{cache:'no-store'});
  if(!fontRes.ok)fail('CJK_TEST_FONT_MISSING');
  const doc=await PDFLib.PDFDocument.create();
  doc.registerFontkit(root.fontkit);
  const font=await doc.embedFont(await fontRes.arrayBuffer(),{subset:true});
  const page=doc.addPage(A4);
  text(page,font,'虛構測試公司｜一般合併請款（僅測試）',LEFT,810,11.2);
  box(page,511,821,51,40);
  text(page,font,'模擬LOGO',515,795);
  text(page,font,'客戶：'+view.customer,LEFT,779,8.4);
  text(page,font,'請款日期：'+view.dateStart+' ~ '+view.dateEnd,LEFT,763,8.1);
  text(page,font,'來源原單：'+view.billings.length+' 張，案場：'+view.projects.length+' 個',LEFT,749,8.1);
  let y=728;
  const widths=[51,206,36,59,75,104];
  for(const bill of view.billings){
    if(y<300)fail('BILLING_SECTIONS_EXCEED_A4');
    text(page,font,'【'+bill.projectName+'】 '+bill.number+'　'+bill.date+'　'+bill.taxMode,
         LEFT,y,8.6);
    y-=13;
    cells(page,font,['戶別','施工項目','單位','數量','單價','小計'],
      widths,LEFT,y,12);
    y-=12;
    for(const l of bill.lines){
      const itemLines=wrap(l.item,font,widths[1]-7);
      const rowHeight=Math.max(10.5,itemLines.length*9+1.5);
      if(rowHeight>30)fail('DETAIL_DESCRIPTION_TOO_LONG');
      cells(page,font,[l.house,itemLines,l.unit,val(l.qty),val(l.price),
            val(l.amount)],widths,LEFT,y,rowHeight);
      y-=rowHeight;
      if(y<274)fail('DETAIL_CAPACITY_EXCEEDED');
    }
    const amount=bill.amounts;
    text(page,font,'本單施工 '+n(amount.salesAmount)+'　稅額 '+n(amount.taxAmount)+
      '　總額 '+n(amount.totalAmount)+'　保留 '+n(amount.retentionAmount)+
      '　應收 '+n(amount.receivableAmount),LEFT+2,y-10,8.1);
    y-=27;
    if(bill.publicNote){
      const notes=wrap('備註：'+bill.publicNote,font,WIDTH-8);
      if(notes.length>2)fail('LONG_PUBLIC_NOTE_CANNOT_FIT');
      for(const part of notes){text(page,font,part,LEFT+2,y,MIN);y-=10;}
      y-=3;
      if(y<260)fail('NOTE_OVERLAPS_BOTTOM_SUMMARY');
    }
  }
  // Bottom summary is included as a new safety-review requirement, not yet
  // identical to the official HTML bundle template.
  if(y<253)fail('NO_SPACE_FOR_SUMMARY_AND_SEAL');
  text(page,font,'施工項目彙總（依案場、項目、計價來源分類）',LEFT,y,8.6);
  y-=11;
  const half=(WIDTH-9)/2;
  const sw=[half*.17,half*.40,half*.12,half*.13,half*.18];
  const center=Math.ceil(view.summary.length/2);
  function side(rows,x,top){
    let v=top;
    cells(page,font,['案場','項目','數量','單價','小計'],sw,x,v,12);
    v-=12;
    for(const r of rows){
      const item=wrap(r.item,font,sw[1]-7);
      const project=wrap(r.projectName,font,sw[0]-7);
      const height=Math.max(10.5,Math.max(item.length,project.length)*9+1.5);
      if(height>27)fail('GROUPED_ITEM_TOO_LONG');
      cells(page,font,[project,item,val(r.qty),val(r.price),val(r.amount)],
        sw,x,v,height);
      v-=height;
    }
    return v;
  }
  const y1=side(view.summary.slice(0,center),LEFT,y);
  const y2=side(view.summary.slice(center),LEFT+half+9,y);
  y=Math.min(y1,y2)-7;
  if(y<179)fail('SUMMARY_OVERFLOW_INTO_SIGN_SPACE');
  const t=view.totals;
  text(page,font,'合併請款總計（沿用原單核定金額）',LEFT,y,8.5);
  y-=13;
  text(page,font,'未稅 '+n(t.salesAmount)+'　稅額 '+n(t.taxAmount)+
      '　總額 '+n(t.totalAmount)+'　保留款 '+n(t.retentionAmount)+
      '　應收 '+n(t.receivableAmount),LEFT,y,8.1);
  // Bottom zone deliberately fixed and non-overlapping.
  text(page,font,'客戶簽章：___________________',LEFT,80,8.1);
  box(page,409,101,154,68);
  text(page,font,'模擬大小章',415,67,8.1);
  text(page,font,'54 × 24 mm 預留',415,54,8.1);
  const bytes=await doc.save({useObjectStreams:false});
  const expected={sourceBills:view.billings.map(b=>({
       number:b.number,projectName:b.projectName,date:b.date,
       original:b.lines,approvedAmounts:b.amounts
     })),
     summary:view.summary,grandTotals:view.totals,customer:view.customer,
     selectedProjects:view.projects,releaseApproved:false};
  let raw='';
  for(let i=0;i<bytes.length;i+=12000)
     raw+=String.fromCharCode(...bytes.subarray(i,i+12000));
  return {base64:btoa(raw),expected};
}
root.P40ALPDF={generate};
})(window);
