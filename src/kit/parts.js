/* RSMA UI: behaviour for the added parts. Load after rsma-ui.js. */
(function(){
  /* ---- added: groups, push-to-talk, toast, modal ---- */
  /* <div data-select="one|many"> with .r-cell / .r-btn children: is-on marks the selection (aria-pressed mirrors it) */
  document.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('[data-select]>.r-cell,[data-select]>.r-btn');if(!b||b.disabled)return;
    var g=b.parentNode,many=g.getAttribute('data-select')==='many';
    if(!many)Array.prototype.forEach.call(g.children,function(c){c.classList.remove('is-on');c.setAttribute('aria-pressed','false')});
    var on=many?!b.classList.contains('is-on'):true;b.classList.toggle('is-on',on);b.setAttribute('aria-pressed',on);
    b.dispatchEvent(new CustomEvent('rsma:select',{bubbles:true,detail:{on:on}}));
  });
  /* push to talk: hold pointer or space/enter on .r-btn--ptt; adds is-tx and emits rsma:ptt {detail:{on}} */
  var tx=null;function ptt(b,v){if(b.disabled||(tx===b)===v)return;tx=v?b:null;b.classList.toggle('is-tx',v);b.dispatchEvent(new CustomEvent('rsma:ptt',{bubbles:true,detail:{on:v}}))}
  document.addEventListener('pointerdown',function(e){var b=e.target.closest&&e.target.closest('.r-btn--ptt');if(b)ptt(b,true)});
  ['pointerup','pointercancel'].forEach(function(n){document.addEventListener(n,function(){if(tx)ptt(tx,false)})});
  document.addEventListener('keydown',function(e){var b=e.target.closest&&e.target.closest('.r-btn--ptt');if(b&&(e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();b.classList.add('is-on');ptt(b,true)}});
  document.addEventListener('keyup',function(e){if(tx&&(e.key===' '||e.key==='Enter')){tx.classList.remove('is-on');ptt(tx,false)}});
  /* RSMA.toast({text, tone:'green|red|teal', ms}) */
  RSMA.toast=function(o){var box=document.querySelector('.r-toasts');if(!box){box=document.createElement('div');box.className='r-toasts';box.setAttribute('role','status');box.setAttribute('aria-live','polite');document.body.appendChild(box)}
    var t=document.createElement('div');t.className='r-banner'+(o.tone?' is-'+o.tone:'');t.textContent=o.text;box.appendChild(t);setTimeout(function(){t.remove()},o.ms||4000);return t};
  /* RSMA.modal(backdropEl) shows it, traps focus, Esc closes, restores focus; returns close() */
  RSMA.modal=function(bd){var prev=document.activeElement;bd.hidden=false;function f(){return bd.querySelectorAll('button:not(:disabled),[href],input:not(:disabled),select,textarea')}
    var a=f()[0];if(a)a.focus();
    function key(e){if(e.key==='Escape')return close();if(e.key!=='Tab')return;var l=f();if(!l.length)return;var x=l[0],z=l[l.length-1];
      if(e.shiftKey&&document.activeElement===x){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();x.focus()}}
    function close(){bd.hidden=true;document.removeEventListener('keydown',key);if(prev&&prev.focus)prev.focus();bd.dispatchEvent(new CustomEvent('rsma:close'))}
    document.addEventListener('keydown',key);return close};
})();
