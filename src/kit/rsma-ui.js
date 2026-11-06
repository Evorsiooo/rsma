/* RSMA UI: tiny helpers. No dependencies.
   - Toggles: any .r-toggle flips aria-pressed on click (add data-static to opt out).
   - Latching buttons: .r-btn[data-latch] flips aria-pressed on click.
   - RSMA.lcd(el, "00:37:52", {h:36, skew:-4, ghost:0}) draws seven-segment digits into an .r-lcd
   - RSMA.addLine(logEl, text, cls) appends a line and flashes it (is-new), keeping at most `max` lines */
(function(){
  var S={a:'10,4 42,4 37,11 15,11',b:'44,6 44,46 39,40 39,13',c:'44,54 44,94 39,87 39,60',d:'10,96 42,96 37,89 15,89',e:'8,54 8,94 13,87 13,60',f:'8,6 8,46 13,40 13,13',g:'10,50 15,45 37,45 42,50 37,55 15,55'};
  var M={'0':'abcdef','1':'bc','2':'abdeg','3':'abcdg','4':'bcfg','5':'acdfg','6':'acdefg','7':'abc','8':'abcdefg','9':'abcdfg','-':'g'};
  var css=function(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()};
  function poly(p,f){return '<polygon points="'+p+'" fill="'+f+'"></polygon>'}
  function digit(ch,h,on,off,w){
    if(ch===':')return '<svg aria-hidden="true" width="'+Math.round(h*.16)+'" height="'+h+'" viewBox="0 0 16 100" style="display:block;margin-right:'+Math.round(h*.04)+'px">'+poly('4,30 12,30 12,38 4,38',on)+poly('4,62 12,62 12,70 4,70',on)+'</svg>';
    var lit=M[ch]||'',s='';'abcdefg'.split('').forEach(function(k){s+=poly(S[k],lit.indexOf(k)>=0?on:off)});
    return '<svg aria-hidden="true" width="'+Math.round(h*.52)+'" height="'+h+'" viewBox="0 0 52 100" style="display:block;margin-right:'+Math.round(h*.12)+'px">'+s+'</svg>';
  }
  window.RSMA={
    lcd:function(el,str,o){o=o||{};var h=o.h||20,on=css('--r-lcd-on'),off=css('--r-lcd-off'),g=css('--r-lcd-ghost'),html='';
      for(var i=0;i<(o.ghost||0);i++)html+=digit('8',h,g,g);
      str.split('').forEach(function(c){html+=digit(c,h,on,off)});
      el.innerHTML='<div style="display:flex;align-items:flex-end;height:'+h+'px;'+(o.skew?'transform:skewX('+o.skew+'deg)':'')+'">'+html+'</div><span style="position:absolute;width:1px;height:1px;overflow:hidden">'+str+'</span>';
      el.setAttribute('role','img');el.setAttribute('aria-label',o.label||str);},
    addLine:function(log,text,cls,max){var d=document.createElement('div');d.className='r-log__line is-new'+(cls?' '+cls:'');d.textContent=text;log.appendChild(d);
      while(max&&log.children.length>max)log.removeChild(log.firstChild);setTimeout(function(){d.classList.remove('is-new')},500);return d;}
  };
  document.addEventListener('click',function(e){
    var t=e.target.closest&&e.target.closest('.r-toggle,.r-btn[data-latch]');
    if(!t||t.hasAttribute('data-static'))return;
    t.setAttribute('aria-pressed',t.getAttribute('aria-pressed')==='true'?'false':'true');
  });
})();
