/* Runs only in a tab assigned by our worker. A URL flag never authorises work. */
(() => {
  'use strict';
  const api={role:null,viewing:false,finished:false,onRelease:null,onView:null};globalThis.YqnPreparation=api;
  let observer;
  const pause=()=>{for(const v of document.querySelectorAll('video')){v.muted=true;if(!v.paused)v.pause();}};
  const stopPause=()=>{observer?.disconnect();document.removeEventListener('play',pause,true);};
  api.finish=async status=>{if(!api.role||api.finished)return;api.finished=true;try{await chrome.runtime.sendMessage({type:'yqn-prepare-done',status});}catch{}if(api.viewing)api.role=null;};
  api.progress=info=>{if(api.role==='video'&&!api.finished)void chrome.runtime.sendMessage({type:'yqn-prepare-progress',...info}).catch(()=>{});};
  const view=()=>{api.viewing=true;stopPause();for(const v of document.querySelectorAll('video'))v.muted=false;api.onView?.();};
  chrome.runtime.onMessage.addListener(msg=>{if(msg?.type==='yqn-prepare-release'){api.finished=true;api.role=null;stopPause();api.onRelease?.();}});
  chrome.runtime.onMessage.addListener(msg=>{if(msg?.type==='yqn-prepare-view')view();});
  async function collect(){
    if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    const ids=new Set();let stable=0;
    for(let i=0;i<20&&api.role==='playlist';i++){
      const before=ids.size;
      for(const a of document.querySelectorAll('ytd-playlist-video-renderer a[href*="/watch?"], yt-lockup-view-model a[href*="/watch?"]')){
        try{const u=new URL(a.href);const id=u.searchParams.get('v');if(u.origin===location.origin&&/^[\w-]{11}$/.test(id||''))ids.add(id);}catch{}
      }
      stable=ids.size===before?stable+1:0;
      if(api.viewing&&ids.size||ids.size>=500||stable>=3&&ids.size)break;
      if(!api.viewing)window.scrollTo(0,document.documentElement.scrollHeight);
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    if(api.role==='playlist')try{await chrome.runtime.sendMessage({type:'yqn-prepare-list',ids:[...ids]});}catch{}
    if(api.viewing)api.role=null;
  }
  api.ready=(async()=>{
    // Keep media silent while checking ownership, including initial autoplay.
    function guard(){pause();document.addEventListener('play',pause,true);observer=new MutationObserver(pause);observer.observe(document,{childList:true,subtree:true});}
    if(new URL(location.href).searchParams.has('yqn_prepare'))guard();
    try{
      const result=await chrome.runtime.sendMessage({type:'yqn-prepare-role'});
      api.role=result?.role||null;
      if(!api.role){stopPause();return;}
      if(result.viewing||api.viewing){view();if(api.role==='playlist')void collect();return;}
      if(!observer)guard();
      if(api.role==='playlist')void collect();
    }catch{stopPause();}
  })();
})();
