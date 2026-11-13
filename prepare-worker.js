/* Reuse one muted tab in a separate minimised window. Persist before navigating; never replay
 * a lost paid request after a restart or silently analyse an arbitrary tab. */
(() => {
  'use strict';
  const KEY='yqnPreparationV1',ALARM='yqn-watch-later',TICK='yqn-prepare-timeout';
  let serial=Promise.resolve();
  function locked(fn){const previous=serial;const task=(async()=>{try{await previous;}catch{}return fn();})();serial=task;return task;}
  const read=async()=> (await chrome.storage.local.get(KEY))[KEY] || {running:false,recent:{},message:'Not started'};
  const save=s=>chrome.storage.local.set({[KEY]:s});
  const config=()=>chrome.storage.sync.get({...YqnCache.defaults,autoCut:false,watchLaterPrepare:false,prepareBatchSize:0,autoIgnoreMusic:true,minCutMinutes:2,aiDailyBudget:0,aiVideoBudget:0});
  const batchLimit=c=>{const n=Math.floor(Number(c?.prepareBatchSize));if(Number.isFinite(n)&&n>=1&&n<=50)return n;return (c?.aiHighlights&&c?.anthropicKey)||(c?.jevCuts&&c?.typesafeKey)?5:15;};
  const identity=c=>JSON.stringify([YqnCache.key(c),c.autoIgnoreMusic,c.minCutMinutes,c.aiDailyBudget,c.aiVideoBudget]);
  const validId=id=>typeof id==='string'&&/^[\w-]{11}$/.test(id);
  function owns(job,tab){try{
    if(!job||tab.id!==job.tabId)return false;
    const url=new URL(tab.pendingUrl||tab.url);
    if(url.origin!=='https://www.youtube.com')return false;
    // The tab ID is assigned by us before navigation. YouTube can remove the
    // tracking query parameter on redirects/SPA updates; verify its actual
    // destination instead. Never accept another video or an unrelated page.
    return job.kind==='playlist'?url.pathname==='/playlist'&&url.searchParams.get('list')==='WL':
      url.pathname==='/watch'&&url.searchParams.get('v')===job.videoId;
  }catch{return false;}}
  async function quietWindow(job){
    if(!job?.windowId||job.viewing)return false;
    try{
      const win=await chrome.windows.get(job.windowId),tabs=await chrome.tabs.query({windowId:job.windowId});
      return win.state==='minimized'&&!win.focused&&tabs.length===1&&tabs[0].id===job.tabId;
    }catch{return false;}
  }
  async function reusable(job){
    if(!await quietWindow(job))return false;
    try{return owns(job,await chrome.tabs.get(job.tabId));}catch{return false;}
  }
  async function releaseOwned(job){try{
    if(!owns(job,await chrome.tabs.get(job.tabId)))return;
    job.viewing=true;await chrome.tabs.update(job.tabId,{muted:false});
    await chrome.tabs.sendMessage(job.tabId,{type:'yqn-prepare-view'});
  }catch{}}
  async function closeOwned(job){if(!job||job.viewing)return;try{
    // Never close a restored window, a moved tab, or a window given other tabs.
    if(job.windowId&&!await quietWindow(job)){await releaseOwned(job);return;}
    const tab=await chrome.tabs.get(job.tabId);if(owns(job,tab))await chrome.tabs.remove(job.tabId);
  }catch{}}
  async function retire(s){s.parked=s.job;s.job=null;await save(s);}
  async function stop(s,message){const job=s.job;
    if(job?.kind==='video'){s.recent||={};s.recent[job.videoId]={at:Date.now(),key:identity(await config()),status:'interrupted'};}
    const parked=s.parked;s.running=false;s.job=null;s.parked=null;s.queue=[];s.message=message;
    await save(s);await chrome.alarms.clear(TICK);await closeOwned(job);await closeOwned(parked);return s;}
  async function open(s,kind,videoId){
    try{
    const token=crypto.randomUUID();
    const parked=s.parked;let tab;
    if(await reusable(parked))tab=await chrome.tabs.get(parked.tabId);
    else{
      await closeOwned(parked);
      // Create the window unfocused and already minimised. There is no fallback
      // that would open preparation videos in the viewer's browsing window.
      const prev=await chrome.windows.getLastFocused?.().catch(()=>null);
      const win=await chrome.windows.create({url:'about:blank',type:'normal',state:'minimized',focused:false});
      if(!win?.id)throw new Error('Preparation window unavailable');
      const tabs=win.tabs||await chrome.tabs.query({windowId:win.id});tab=tabs[0];
      if(!tab?.id)throw new Error('Preparation tab unavailable');
      if(win.state!=='minimized'||win.focused){
        if(typeof globalThis.setTimeout==='function')await new Promise(r=>globalThis.setTimeout(r,60));
        await chrome.windows.update(win.id,{state:'minimized',focused:false});
        if(prev?.id&&prev.id!==win.id&&prev.focused){
          const pNow=await chrome.windows.get(prev.id).catch(()=>null);
          if(pNow&&!pNow.focused)await chrome.windows.update(prev.id,{focused:true}).catch(()=>{});
        }
        let cur=await chrome.windows.get(win.id);
        for(let i=0;i<15&&(cur?.state!=='minimized'||cur?.focused)&&typeof globalThis.setTimeout==='function';i++){
          await chrome.windows.update(win.id,{state:'minimized',focused:false});
          await new Promise(r=>globalThis.setTimeout(r,25));
          cur=await chrome.windows.get(win.id);
        }
      }
    }
    s.parked=null;s.job={kind,videoId,tabId:tab.id,windowId:tab.windowId,token,started:Date.now()};
    await save(s);
    await chrome.alarms.create(TICK,{periodInMinutes:1});
    await chrome.tabs.update(tab.id,{muted:true});
    const url=kind==='playlist'?'https://www.youtube.com/playlist?list=WL':'https://www.youtube.com/watch?v='+videoId;
    await chrome.tabs.update(tab.id,{url:url+'&yqn_prepare='+token});
    return true;
    }catch{await stop(s,'Preparation could not open its minimised window. Try again from Auto-Cut.');return false;}
  }
  async function advance(s){
    const c=await config(),limit=batchLimit(c);
    if(!c.autoCut || (s.automatic&&!c.watchLaterPrepare))return stop(s,'Preparation stopped');
    if(s.job)return;
    if(s.attempted>=limit||(s.opened||0)>=Math.max(limit*3,25)||!s.queue.length)return stop(s,`Finished: ${s.ready} ready · ${s.failed} incomplete · ${s.skipped} already prepared or left unchanged`);
    const tabs=(await chrome.tabs.query({url:'https://www.youtube.com/watch*'})).filter(t=>t.id!==s.parked?.tabId||s.parked.viewing);
    const openIds=new Set(tabs.map(t=>{try{return new URL(t.url).searchParams.get('v');}catch{return null;}}));
    const cache=(await chrome.storage.local.get(YqnCache.storageKey))[YqnCache.storageKey]||{};
    while(s.queue.length){
      const id=s.queue.shift(),hit=cache[id],recent=s.recent?.[id];
      if(openIds.has(id)||(hit&&Date.now()-hit.ts<YqnCache.ttl&&hit.settingsKey===YqnCache.key(c))||
          (recent?.key===identity(c)&&Date.now()-recent.at<86400000&&(recent.status!=='ready'||hit&&Date.now()-hit.ts<YqnCache.ttl))){s.skipped++;continue;}
      s.attempted++;s.opened=(s.opened||0)+1;s.message=`Preparing video ${s.attempted} of at most ${limit} · ${s.ready} ready`;
      await open(s,'video',id);return;
    }
    return stop(s,`Finished: ${s.ready} ready · ${s.failed} incomplete · ${s.skipped} already prepared or left unchanged`);
  }
  async function start(manual=false){
    const s=await read(),c=await config();
    if(s.running)return {ok:true,message:s.message};
    if(!manual&&!c.watchLaterPrepare)return {ok:true};
    if(!c.autoCut)return {ok:false,error:'Turn on Auto-Cut before preparing Watch Later'};
    if(!(c.cutMessaging||c.cutBoring||c.aiHighlights||c.jevCuts))return {ok:false,error:'Enable an analysis source first'};
    const next={running:true,automatic:!manual,cycleAt:Date.now(),job:null,queue:[],attempted:0,opened:0,ready:0,failed:0,skipped:0,
      recent:s.recent||{},message:'Checking Watch Later…'};
    for(const [id,r] of Object.entries(next.recent))if(Date.now()-r.at>YqnCache.ttl)delete next.recent[id];
    const opened=await open(next,'playlist',null);return opened?{ok:true,message:next.message}:{ok:false,error:next.message};
  }
  async function handle(msg,sender){
    if(msg.type==='yqn-cache-put'||msg.type==='yqn-cache-remove'){
      if(!validId(msg.videoId))return {ok:false};
      const cache=(await chrome.storage.local.get(YqnCache.storageKey))[YqnCache.storageKey]||{};
      if(msg.type==='yqn-cache-remove')delete cache[msg.videoId];
      else if(Array.isArray(msg.entry?.segments)&&(msg.entry.segments.length||msg.entry.complete))cache[msg.videoId]=msg.entry;
      const ids=Object.keys(cache).sort((a,b)=>(cache[b].ts||0)-(cache[a].ts||0));
      for(const id of ids.slice(300))delete cache[id];
      await chrome.storage.local.set({[YqnCache.storageKey]:cache});return {ok:true};
    }
    const s=await read();
    if(msg.type==='yqn-prepare-status')return {ok:true,running:s.running,message:s.message,ready:s.ready||0,failed:s.failed||0};
    if(msg.type==='yqn-prepare-start')return start(true);
    if(msg.type==='yqn-prepare-stop'){await stop(s,'Stopped by you');return {ok:true};}
    if(msg.type==='yqn-prepare-foreground'){
      if(s.job?.kind==='video'&&s.job.videoId===msg.videoId&&s.job.tabId!==sender.tab?.id){
        const old=s.job;s.job=null;s.message='Yielded to the video you opened';await save(s);await closeOwned(old);await advance(s);
      }
      return {ok:true};
    }
    // A reused tab can be navigating to the next video while an old document
    // sends its final message. Authenticate the sending document, never pendingUrl.
    if(!s.running||!owns(s.job,{id:sender.tab?.id,url:sender.url||sender.tab?.url}))return {ok:true,role:null};
    if(msg.type==='yqn-prepare-role')return {ok:true,role:s.job.kind,videoId:s.job.videoId,viewing:!!s.job.viewing};
    if(msg.type==='yqn-prepare-progress'&&s.job.kind==='video'){
      const limit=batchLimit(await config());
      const count=v=>Number.isFinite(Number(v))?Math.min(100000,Math.max(0,Math.floor(Number(v)))):0;
      const total=count(msg.total),checked=Math.min(total,count(msg.checked));
      const title=typeof msg.title==='string'?msg.title.slice(0,100):'';
      s.message=`Preparing video ${s.attempted} of at most ${limit} · ${s.ready} ready`+(title?' · '+title:'')+
        (total?` · ${checked}/${total} caption lines checked`:'')+(s.job.viewing?' · Open for viewing':'');
      await save(s);return {ok:true};
    }
    if(msg.type==='yqn-prepare-list'&&s.job.kind==='playlist'){
      s.queue=[...new Set((Array.isArray(msg.ids)?msg.ids:[]).filter(validId))].slice(0,500);
      await retire(s);
      if(!s.queue.length)return {ok:true,...await stop(s,'No available Watch Later videos found. Check that YouTube is signed in.')};
      await advance(s);return {ok:true};
    }
    if(msg.type==='yqn-prepare-done'&&s.job.kind==='video'){
      const status=['ready','ignored','budget'].includes(msg.status)?msg.status:'incomplete';
      const c=await config();
      s.recent[s.job.videoId]={at:Date.now(),key:identity(c),status};
      if(status==='ready')s.ready++;else if(status==='ignored'){s.skipped++;s.attempted=Math.max(0,s.attempted-1);}else s.failed++;
      await retire(s);
      if(status==='budget')await stop(s,'Paused: AI spending limit reached');else await advance(s);
      return {ok:true};
    }
    return {ok:false};
  }
  async function ensureAlarm(){const c=await config();if(c.watchLaterPrepare){if(!await chrome.alarms.get(ALARM))await chrome.alarms.create(ALARM,{delayInMinutes:30,periodInMinutes:30});}else await chrome.alarms.clear(ALARM);
    if((await read()).running&&!await chrome.alarms.get(TICK))await chrome.alarms.create(TICK,{periodInMinutes:1});}
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(!msg?.type?.startsWith('yqn-prepare-')&&!['yqn-cache-put','yqn-cache-remove'].includes(msg?.type))return;
    if(sender.id!==chrome.runtime.id){reply({ok:false});return;}
    (async()=>{try{reply(await locked(()=>handle(msg,sender)));}catch{reply({ok:false,error:'Preparation could not continue. Try again from the extension controls.'});}})();return true;
  });
  chrome.alarms.onAlarm.addListener(alarm=>{
    if(![ALARM,TICK].includes(alarm.name))return;
    void locked(async()=>{
      if(alarm.name===ALARM){await start();return;}
      const s=await read();if(!s.running){await chrome.alarms.clear(TICK);return;}
      if(!s.job){await advance(s);return;}
      let tab;try{tab=await chrome.tabs.get(s.job.tabId);}catch{}
      if(!tab||!owns(s.job,tab)){await stop(s,'Preparation interrupted; no requests replayed');return;}
      if(Date.now()-s.job.started>(s.job.kind==='playlist'?120000:1200000))await stop(s,'Preparation timed out; unfinished videos left unchanged');
    }).catch(()=>{});
  });
  chrome.tabs.onRemoved.addListener(tabId=>{void locked(async()=>{const s=await read();if(s.job?.tabId===tabId)await stop(s,'Preparation tab closed; stopped');}).catch(()=>{});});
  async function viewIfOpened({tabId,windowId}){
    const s=await read(),job=s.job||s.parked;
    if(!job||job.viewing||(tabId!==undefined&&job.tabId!==tabId)||(windowId!==undefined&&job.windowId!==windowId))return;
    // The selected tab in a minimised window is "active" too. Only restoring
    // the window (or moving its tab elsewhere) hands the page to the viewer.
    if(job.windowId){try{
      const tab=await chrome.tabs.get(job.tabId),win=await chrome.windows.get(tab.windowId);
      if(tab.windowId===job.windowId&&win.state==='minimized'&&!win.focused)return;
    }catch{return;}}
    job.viewing=true;s.message+=s.message.includes('Open for viewing')?'':' · Open for viewing';await save(s);
    try{await chrome.tabs.update(job.tabId,{muted:false});await chrome.tabs.sendMessage(job.tabId,{type:'yqn-prepare-view'});}catch{}
  }
  chrome.tabs.onActivated.addListener(({tabId})=>{void locked(()=>viewIfOpened({tabId})).catch(()=>{});});
  chrome.tabs.onAttached.addListener(tabId=>{void locked(()=>viewIfOpened({tabId})).catch(()=>{});});
  chrome.windows.onFocusChanged.addListener(windowId=>{if(windowId>=0)void locked(()=>viewIfOpened({windowId})).catch(()=>{});});
  chrome.windows.onBoundsChanged.addListener(win=>{void locked(()=>viewIfOpened({windowId:win.id})).catch(()=>{});});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='sync')return;void locked(async()=>{
    if(changes.watchLaterPrepare){await ensureAlarm();if(changes.watchLaterPrepare.newValue)await start();else await stop(await read(),'Automatic preparation off');}
    if(changes.autoCut?.newValue===false)await stop(await read(),'Auto-Cut is off');
  }).catch(()=>{});});
  chrome.runtime.onStartup?.addListener(()=>{void locked(ensureAlarm).catch(()=>{});});
  chrome.runtime.onInstalled?.addListener(()=>{void locked(ensureAlarm).catch(()=>{});});
  void locked(ensureAlarm).catch(()=>{});
})();
