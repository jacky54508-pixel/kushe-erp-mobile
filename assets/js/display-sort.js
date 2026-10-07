(function(){
  'use strict';

  const collator=new Intl.Collator('zh-Hant',{numeric:true,sensitivity:'base'});

  function clean(value){return String(value??'').trim()}
  function compareText(a,b){
    const left=clean(a),right=clean(b);
    if(!left&&!right)return 0;
    if(!left)return 1;
    if(!right)return -1;
    return collator.compare(left,right);
  }
  function compareHouse(a,b){
    const left=clean(a),right=clean(b),missing=(value)=>!value||value==='—'||value==='未指定戶別';
    if(missing(left)&&missing(right))return 0;
    if(missing(left))return 1;
    if(missing(right))return -1;
    return compareText(left,right);
  }

  function sortByHouse(rows,getHouse=(row)=>row?.house){
    return (Array.isArray(rows)?rows:[])
      .map((row,originalIndex)=>({row,originalIndex}))
      .sort((a,b)=>compareHouse(getHouse(a.row),getHouse(b.row))||a.originalIndex-b.originalIndex)
      .map(({row})=>row);
  }

  function sortWorkRows(rows,accessors={}){
    const source=Array.isArray(rows)?rows:[];
    const read=(row,key,aliases)=>{
      const getter=accessors?.[key];
      if(typeof getter==='function')return getter(row);
      for(const alias of aliases){
        const value=row?.[alias];
        if(value!==undefined&&value!==null&&String(value).trim()!=='')return value;
      }
      return '';
    };
    const decorated=source.map((row,originalIndex)=>({
      row,
      originalIndex,
      date:clean(read(row,'date',['date','workDate'])),
      employee:clean(read(row,'employee',['employees','employeeName','employee'])),
      house:clean(read(row,'house',['house'])),
      item:clean(read(row,'item',['item','itemName']))
    }));

    // Within each date + employee, keep the first-seen item sequence and repeat it for every house.
    const itemRanks=new Map();
    decorated.forEach((entry)=>{
      const scope=entry.date+'\u0000'+entry.employee;
      if(!itemRanks.has(scope))itemRanks.set(scope,new Map());
      const ranks=itemRanks.get(scope),item=entry.item||'\uffff';
      if(!ranks.has(item))ranks.set(item,ranks.size);
      entry.itemRank=ranks.get(item);
    });

    decorated.sort((a,b)=>
      compareText(a.date,b.date)||
      compareText(a.employee,b.employee)||
      a.itemRank-b.itemRank||
      compareHouse(a.house,b.house)||
      a.originalIndex-b.originalIndex
    );
    return decorated.map(({row})=>row);
  }

  window.KusheDisplaySort=Object.freeze({compareText,compareHouse,sortByHouse,sortWorkRows});
}());
