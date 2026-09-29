(function(){
  'use strict';
  function compareHouse(a,b){
    const x=/^(\d+)([a-z]*)$/i.exec(String(a??'').trim()),y=/^(\d+)([a-z]*)$/i.exec(String(b??'').trim());
    if(!x||!y)return x?-1:y?1:0; // Nonstandard houses retain stable source order.
    const xn=x[1].replace(/^0+(?=\d)/,''),yn=y[1].replace(/^0+(?=\d)/,'');
    if(xn.length!==yn.length)return xn.length-yn.length;
    if(xn!==yn)return xn<yn?-1:1;
    const xs=x[2].toUpperCase(),ys=y[2].toUpperCase();
    return xs<ys?-1:xs>ys?1:0;
  }
  window.KusheDisplaySort={compareHouse};
}());
