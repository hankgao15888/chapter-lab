/* MIT License · Live presence supplied by whos.amung.us, not page-view totals. */
(function(root){
 'use strict';
 const SITE_ID='gu6a6mzkpe',COLOR='285344ffffff',SLOT='chapterlab';
 function validCount(value){
  const input=String(value);
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(input))return null;
  const text=input.replace(/,/g,'');
  return /^\d+$/.test(text)&&Number.isSafeInteger(Number(text))?Number(text):null;
 }
 function start(win,doc){
  const badge=doc.getElementById('onlinePresence'),slot=doc.getElementById('_wau'+SLOT);
  if(!badge||!slot)return;
  const fallback=doc.getElementById('onlineFallback');
  let pending=false,deadline,retryAt=0,ready=false,stopped=false;
  win._wau=win._wau||[];
  win.WAU_ren=win.WAU_ren||[];
  const index=win._wau.length;
  win._wau.push(['dynamic',SITE_ID,SLOT,COLOR,'small']);
  // Request fresh server counts directly. Skip the SDK's cached-count branch
  // and its unrelated partner script loader.
  win.WAU_ren[index]=true;
  win._wau_opt={...(win._wau_opt||{}),fd:true,target:'_blank'};
  function unavailable(){
   pending=false;win.clearTimeout(deadline);
   badge.dataset.state='unavailable';fallback.hidden=false;
   fallback.textContent='—';badge.title='在线人数暂不可用，稍后自动重试';
   badge.setAttribute('aria-label','实时在线人数暂不可用');
   for(const widget of badge.querySelectorAll('.waubutton'))widget.remove();
  }
  function request(){
   if(stopped||doc.hidden||pending)return;
   if(!ready){if(Date.now()>=retryAt)load();return;}
   pending=true;win.clearTimeout(deadline);deadline=win.setTimeout(unavailable,15000);
   try{win.WAU_dynamic_request(SITE_ID,COLOR,'small',index);}
   catch{unavailable();}
  }
  function load(){
   if(stopped||pending)return;
   pending=true;retryAt=Date.now()+30000;
   const script=doc.createElement('script');script.src='https://waust.at/d.js';script.async=true;
   script.onerror=()=>{script.remove();unavailable();};
   script.onload=()=>{
    if(stopped)return;
    if(typeof win.WAU_dynamic_request!=='function'||typeof win.WAU_r_d!=='function'){unavailable();return;}
    const render=win.WAU_r_d;
    win.WAU_r_d=function(value,key,slotIndex,...rest){
     if(key!==SITE_ID||slotIndex!==index)return render.call(this,value,key,slotIndex,...rest);
     const count=validCount(value);
     if(count===null){unavailable();return;}
     render.call(this,count,key,slotIndex,...rest);
     const widgets=[...badge.querySelectorAll('.waubutton')];
     if(!widgets.length){unavailable();return;}
     widgets.slice(1).forEach(widget=>widget.remove());
     const current=widgets[0];current.target='_blank';current.rel='noopener noreferrer';
     current.setAttribute('aria-label',`实时在线 ${count} 人，查看统计`);
     current.title='实时在线人数 · whos.amung.us';
     pending=false;win.clearTimeout(deadline);fallback.hidden=true;
     badge.dataset.state='ready';badge.dataset.updatedAt=String(Date.now());badge.title='实时在线人数，每30秒刷新；离开后的移除时间由统计服务决定';
     badge.setAttribute('aria-label',`实时在线 ${count} 人`);
    };
    ready=true;pending=false;win.clearTimeout(deadline);request();
   };
   win.clearTimeout(deadline);deadline=win.setTimeout(()=>{script.remove();unavailable();},15000);
   doc.head.appendChild(script);
  }
  const timer=win.setInterval(request,30000);
  doc.addEventListener('visibilitychange',request);
  win.addEventListener('online',request);
  win.addEventListener('pagehide',event=>{
   if(event.persisted)return;
   stopped=true;win.clearInterval(timer);win.clearTimeout(deadline);
   doc.removeEventListener('visibilitychange',request);win.removeEventListener('online',request);
  });
  request();
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={validCount,start};
 else start(root,root.document);
})(typeof window!=='undefined'?window:globalThis);
