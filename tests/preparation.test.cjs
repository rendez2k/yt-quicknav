const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const clone=x=>JSON.parse(JSON.stringify(x));
async function harness(saved){
  const local=saved?.local||{},sync=saved?.sync||{autoCut:true,cutMessaging:true},tabs=saved?.tabs||new Map(),windows=saved?.windows||new Map([[1,{id:1,state:'normal',focused:true}]]),alarms=new Map(),removed=[],created=[],sent=[],windowCreates=[];
  let next=Math.max(100,...tabs.keys())+1,nextWindow=Math.max(20,...windows.keys())+1;
  const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},fire(...a){for(const fn of this.listeners)fn(...a);}});
  const messages=event(),alarmEvent=event(),changed=event(),activated=event(),attached=event(),removedEvent=event(),focused=event(),bounds=event();
  const storage=store=>({async get(keys){if(typeof keys==='string')return clone({[keys]:store[keys]});return clone({...keys,...Object.fromEntries(Object.keys(keys).filter(k=>k in store).map(k=>[k,store[k]]))});},async set(patch){Object.assign(store,clone(patch));}});
  const context={URL,crypto:require('node:crypto').webcrypto,console,chrome:{
    runtime:{id:'test',onMessage:messages},storage:{local:storage(local),sync:storage(sync),onChanged:changed},
    alarms:{onAlarm:alarmEvent,async get(id){return alarms.get(id);},async create(id,data){alarms.set(id,data);},async clear(id){alarms.delete(id);}},
    windows:{onFocusChanged:focused,onBoundsChanged:bounds,async create(data){
      windowCreates.push(clone(data));if(saved?.failCreate)throw Error('blocked');
      const win={id:nextWindow++,state:data.state,focused:data.focused};windows.set(win.id,win);
      const tab={id:next++,url:data.url,active:true,windowId:win.id};tabs.set(tab.id,tab);created.push(tab.id);activated.fire({tabId:tab.id,windowId:win.id});return clone({...win,tabs:[tab]});
    },async get(id){if(!windows.has(id))throw Error('gone');return clone(windows.get(id));},async update(id,patch){Object.assign(windows.get(id),patch);return clone(windows.get(id));}},
    tabs:{onRemoved:removedEvent,onActivated:activated,onAttached:attached,async create(data){const tab={id:next++,windowId:1,...data};tabs.set(tab.id,tab);created.push(tab.id);return clone(tab);},
      async update(id,patch){Object.assign(tabs.get(id),patch);return clone(tabs.get(id));},async get(id){if(!tabs.has(id))throw Error('gone');return clone(tabs.get(id));},
      async remove(id){const tab=tabs.get(id);tabs.delete(id);if(tab&&![...tabs.values()].some(t=>t.windowId===tab.windowId))windows.delete(tab.windowId);removed.push(id);removedEvent.fire(id);},
      async query(q={}){return [...tabs.values()].filter(t=>(q.windowId===undefined||q.windowId===t.windowId)&&(!q.url||t.url?.startsWith('https://www.youtube.com/watch')));},
      async sendMessage(id,m){sent.push({id,...m});}}
  }};
  vm.createContext(context);for(const file of ['plan-cache.js','prepare-worker.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  const flush=()=>new Promise(r=>setImmediate(r));await flush();
  const msg=(message,sender={id:'test'})=>new Promise(resolve=>messages.fire(message,sender,resolve));
  const state=()=>local.yqnPreparationV1;
  const jobSender=()=>({id:'test',tab:clone(tabs.get(state().job.tabId)),url:tabs.get(state().job.tabId).url});
  const restore=async()=>{const win=windows.get(state().job.windowId);win.state='normal';win.focused=true;focused.fire(win.id);await flush();};
  return {local,sync,tabs,windows,windowCreates,alarms,created,removed,sent,changed,activated,attached,focused,bounds,restore,alarmEvent,msg,state,jobSender,flush,cache:context.YqnCache};
}
const ids=Array.from({length:8},(_,i)=>'video'+String(i).padStart(6,'0'));
test('opening a video while its role reply is arriving cannot reapply the pause guard',async()=>{
  let reply;const listeners=[],video={muted:true,paused:true,pause(){this.paused=true;}},events=new Set();
  const context={URL,location:{href:'https://www.youtube.com/watch?v='+ids[0]},
    chrome:{runtime:{onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:()=>new Promise(resolve=>{reply=resolve;})}},
    document:{querySelectorAll:()=>[video],addEventListener:name=>events.add(name),removeEventListener:name=>events.delete(name)},
    MutationObserver:class {observe(){events.add('observe');}disconnect(){events.delete('observe');}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','preparation.js'),'utf8'),context);
  for(const listener of listeners)listener({type:'yqn-prepare-view'});
  reply({role:'video',viewing:false});await context.YqnPreparation.ready;
  assert.equal(context.YqnPreparation.viewing,true);assert.equal(video.muted,false);assert.deepEqual([...events],[]);
});
test('Watch Later reuses one minimised window and muted tab for 15 free videos by default (5 with AI), and ignored clips do not consume slots',async()=>{
  const batchIds=Array.from({length:20},(_,i)=>'video'+String(i).padStart(6,'0'));
  const h=await harness();assert.equal(h.created.length,0,'Default is off');
  await h.msg({type:'yqn-prepare-start'});assert.equal(h.state().job.kind,'playlist');
  assert.equal((await h.msg({type:'yqn-prepare-role'},h.jobSender())).role,'playlist');
  await h.msg({type:'yqn-prepare-list',ids:[...batchIds,...batchIds,'https://evil.test']},h.jobSender());
  // First 2 clips are short/music ('ignored') — they must not steal from the 15 real videos.
  for(let i=0;i<2;i++){
    assert.equal(h.state().job.videoId,batchIds[i]);
    await h.msg({type:'yqn-prepare-done',status:'ignored'},h.jobSender());
  }
  for(let i=2;i<17;i++){
    const job=h.state().job,tab=h.tabs.get(job.tabId);assert.equal(job.videoId,batchIds[i]);assert.equal(tab.active,true);assert.equal(tab.muted,true);
    assert.equal(h.windows.get(job.windowId).state,'minimized');assert.equal(h.windows.get(job.windowId).focused,false);assert.equal(job.viewing,undefined);
    await h.msg({type:'yqn-cache-put',videoId:job.videoId,entry:{settingsKey:h.cache.key({...h.cache.defaults,...h.sync}),ts:Date.now(),segments:[{start:0,end:10,action:'keep'}]}});
    await h.msg({type:'yqn-prepare-done',status:'ready'},h.jobSender());
  }
  assert.equal(h.state().running,false);assert.equal(h.state().ready,15);assert.equal(h.state().attempted,15);assert.equal(h.state().skipped,2);assert.equal(h.tabs.size,0);
  assert.equal(h.created.length,1);assert.equal(h.windowCreates.length,1);assert.equal(h.windows.size,1);assert.equal(h.windows.get(1).focused,true);
  assert.equal(Object.keys(h.local.cutCacheV15).length,15);

  // Paid AI defaults to 5 unless prepareBatchSize is explicitly set.
  const hAi=await harness({sync:{autoCut:true,aiHighlights:true,anthropicKey:'k'}});
  await hAi.msg({type:'yqn-prepare-start'});
  await hAi.msg({type:'yqn-prepare-list',ids:batchIds},hAi.jobSender());
  for(let i=0;i<5;i++)await hAi.msg({type:'yqn-prepare-done',status:'ready'},hAi.jobSender());
  assert.equal(hAi.state().running,false);assert.equal(hAi.state().attempted,5);

  // Explicit prepareBatchSize overrides Auto.
  const hCustom=await harness({sync:{autoCut:true,cutMessaging:true,prepareBatchSize:10}});
  await hCustom.msg({type:'yqn-prepare-start'});
  await hCustom.msg({type:'yqn-prepare-list',ids:batchIds},hCustom.jobSender());
  for(let i=0;i<10;i++)await hCustom.msg({type:'yqn-prepare-done',status:'ready'},hCustom.jobSender());
  assert.equal(hCustom.state().running,false);assert.equal(hCustom.state().attempted,10);
});
test('existing prepared and open videos are skipped; another tab cannot submit queue work',async()=>{
  const h=await harness();h.tabs.set(1,{id:1,url:'https://www.youtube.com/watch?v='+ids[0],active:true});
  h.local.cutCacheV15={[ids[1]]:{ts:Date.now(),settingsKey:h.cache.key({...h.cache.defaults,...h.sync}),segments:[{action:'keep'}]}};
  await h.msg({type:'yqn-prepare-start'});
  await h.msg({type:'yqn-prepare-list',ids},{id:'test',tab:h.tabs.get(1)});assert.equal(h.state().job.kind,'playlist');
  await h.msg({type:'yqn-prepare-list',ids},h.jobSender());assert.equal(h.state().job.videoId,ids[2]);
  assert.equal(h.state().skipped,2);await h.msg({type:'yqn-prepare-stop'});assert.equal(h.tabs.has(1),true);
});
test('budget stops the queue; activating its playlist retains the page and continues with collected videos',async()=>{
  const h=await harness();await h.msg({type:'yqn-prepare-start'});await h.msg({type:'yqn-prepare-list',ids},h.jobSender());
  await h.msg({type:'yqn-prepare-done',status:'budget'},h.jobSender());assert.equal(h.state().running,false);assert.match(h.state().message,/spending limit/);assert.equal(h.state().attempted,1);
  await h.msg({type:'yqn-prepare-start'});const tabId=h.state().job.tabId;await h.restore();
  assert.equal(h.state().running,true);assert.equal(h.state().job.viewing,true);
  assert.equal(h.tabs.has(tabId),true);assert.equal(h.sent.at(-1).type,'yqn-prepare-view');
  await h.msg({type:'yqn-prepare-list',ids},h.jobSender());
  assert.equal(h.state().job.kind,'video');assert.equal(h.tabs.has(tabId),true);
});
test('an active playlist collects loaded videos without further scrolling and returns to normal browsing',async()=>{
  for(const initiallyViewing of [true,false]){
    const listeners=[],sent=[],timers=[];let scrolls=0,reads=0;
    const context={URL,location:{href:'https://www.youtube.com/playlist?list=WL',origin:'https://www.youtube.com'},
      chrome:{runtime:{onMessage:{addListener:fn=>listeners.push(fn)},async sendMessage(msg){sent.push(msg);return msg.type==='yqn-prepare-role'?{role:'playlist',viewing:initiallyViewing}:{ok:true};}}},
      document:{readyState:'complete',documentElement:{scrollHeight:3000},querySelectorAll:selector=>selector==='video'?[]:initiallyViewing&&reads++===0?[]:ids.slice(0,3).map(id=>({href:'https://www.youtube.com/watch?v='+id})),addEventListener(){},removeEventListener(){}},
      window:{scrollTo(){scrolls++;}},setTimeout:fn=>timers.push(fn),MutationObserver:class {observe(){}disconnect(){}}};
    vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','preparation.js'),'utf8'),context);
    await context.YqnPreparation.ready;
    if(!initiallyViewing){
      assert.equal(scrolls,1);for(const listener of listeners)listener({type:'yqn-prepare-view'});timers.shift()();
    }else{
      assert.equal(sent.some(m=>m.type==='yqn-prepare-list'),false,'Wait for the playlist to render before reporting it empty');timers.shift()();
    }
    await new Promise(r=>setImmediate(r));
    const list=sent.filter(m=>m.type==='yqn-prepare-list');assert.equal(list.length,1);assert.deepEqual(clone(list[0].ids),ids.slice(0,3));
    assert.equal(scrolls,initiallyViewing?0:1);assert.equal(context.YqnPreparation.role,null);
  }
});
test('opening a preparation video preserves the analysis, next job and viewer-owned tab',async()=>{
  const h=await harness();await h.msg({type:'yqn-prepare-start'});await h.msg({type:'yqn-prepare-list',ids},h.jobSender());
  const first=h.state().job.tabId,sender=h.jobSender();
  await h.restore();
  assert.equal(h.state().running,true);assert.equal(h.state().job.viewing,true);
  assert.equal(h.tabs.get(first).muted,false);assert.equal(h.sent.at(-1).type,'yqn-prepare-view');
  assert.equal((await h.msg({type:'yqn-prepare-role'},sender)).viewing,true);
  const restarted=await harness(h);
  assert.equal((await restarted.msg({type:'yqn-prepare-role'},sender)).viewing,true);
  await restarted.msg({type:'yqn-prepare-done',status:'ready'},sender);
  assert.equal(restarted.state().ready,1);assert.equal(restarted.state().job.videoId,ids[1]);
  assert.equal(restarted.tabs.has(first),true);assert.equal(restarted.tabs.get(first).muted,false);
  await restarted.msg({type:'yqn-prepare-stop'});assert.equal(restarted.tabs.has(first),true);
});
test('caption progress is bounded, accepts only the assigned video, and retains viewing state',async()=>{
  const h=await harness();await h.msg({type:'yqn-prepare-start'});await h.msg({type:'yqn-prepare-list',ids},h.jobSender());
  const previous=h.state().message;
  await h.msg({type:'yqn-prepare-progress',checked:10,total:20,title:'Wrong tab'},{id:'test',tab:{id:999,url:h.jobSender().url}});
  assert.equal(h.state().message,previous);
  await h.restore();
  await h.msg({type:'yqn-prepare-progress',checked:250,total:243,title:'A review',transcript:'must not be stored'},h.jobSender());
  assert.match(h.state().message,/A review · 243\/243 caption lines checked · Open for viewing/);
  assert.equal(JSON.stringify(h.state()).includes('must not be stored'),false);
  await h.msg({type:'yqn-prepare-progress',checked:Infinity,total:Infinity,title:'x'.repeat(300)},h.jobSender());
  assert.equal(h.state().message.includes('Infinity'),false);assert.equal(h.state().message.includes('x'.repeat(101)),false);
  const viewed=h.state().job.tabId;await h.msg({type:'yqn-prepare-stop'});assert.equal(h.tabs.has(viewed),true);
});
test('30-minute schedule and restart watchdog do not replay lost work or close a repurposed tab',async()=>{
  const h=await harness();h.sync.watchLaterPrepare=true;h.changed.fire({watchLaterPrepare:{newValue:true}},'sync');await h.flush();
  assert.equal(h.alarms.get('yqn-watch-later').periodInMinutes,30);assert.equal(h.alarms.get('yqn-watch-later').delayInMinutes,30);assert.equal(h.state().running,true);
  const existing=h.state().job;const restarted=await harness(h);assert.equal(restarted.created.length,0);assert.ok(restarted.alarms.has('yqn-prepare-timeout'));
  restarted.tabs.get(existing.tabId).url='https://www.youtube.com/watch?v='+ids[7];
  restarted.alarmEvent.fire({name:'yqn-prepare-timeout'});await restarted.flush();
  assert.equal(restarted.state().running,false);assert.equal(restarted.tabs.has(existing.tabId),true);assert.equal(restarted.created.length,0);
});

test('interrupted paid work has a cooldown before the next automatic batch',async()=>{
  const h=await harness();await h.msg({type:'yqn-prepare-start'});await h.msg({type:'yqn-prepare-list',ids},h.jobSender());
  const first=h.state().job.videoId;h.state().job.started=Date.now()-1300000;
  h.alarmEvent.fire({name:'yqn-prepare-timeout'});await h.flush();assert.equal(h.state().running,false);
  await h.msg({type:'yqn-prepare-start'});await h.msg({type:'yqn-prepare-list',ids},h.jobSender());assert.notEqual(h.state().job.videoId,first);
});

test('YouTube canonical URLs keep assigned work valid without authorising other tabs or videos',async()=>{
  const h=await harness();await h.msg({type:'yqn-prepare-start'});
  h.tabs.get(h.state().job.tabId).url='https://www.youtube.com/playlist?list=WL';
  assert.equal((await h.msg({type:'yqn-prepare-role'},h.jobSender())).role,'playlist');
  await h.msg({type:'yqn-prepare-list',ids},h.jobSender());const job=h.state().job;
  h.tabs.get(job.tabId).url='https://www.youtube.com/watch?v='+job.videoId;
  assert.equal((await h.msg({type:'yqn-prepare-role'},h.jobSender())).role,'video');
  h.alarmEvent.fire({name:'yqn-prepare-timeout'});await h.flush();assert.equal(h.state().running,true);
  assert.equal((await h.msg({type:'yqn-prepare-role'},{id:'test',tab:{id:999,url:h.tabs.get(job.tabId).url}})).role,null);
  const sender=h.jobSender();sender.url='https://www.youtube.com/watch?v='+ids[7];
  assert.equal((await h.msg({type:'yqn-prepare-role'},sender)).role,null);
});
test('late completion from a previous document cannot finish the next video in the reused tab',async()=>{
  const h=await harness();await h.msg({type:'yqn-prepare-start'});await h.msg({type:'yqn-prepare-list',ids},h.jobSender());
  const previous=h.jobSender();await h.msg({type:'yqn-prepare-done',status:'ready'},previous);
  assert.equal(h.state().job.tabId,previous.tab.id);assert.equal(h.state().job.videoId,ids[1]);
  previous.tab.pendingUrl=h.jobSender().url;
  await h.msg({type:'yqn-prepare-done',status:'ready'},previous);
  await h.msg({type:'yqn-prepare-progress',title:'stale',checked:99,total:99},previous);
  assert.equal(h.state().ready,1);assert.equal(h.state().job.videoId,ids[1]);assert.equal(h.state().message.includes('stale'),false);
});
test('a restart between videos resumes using the parked window without replaying the completed video',async()=>{
  const h=await harness();await h.msg({type:'yqn-prepare-start'});await h.msg({type:'yqn-prepare-list',ids},h.jobSender());
  const parked=clone(h.state().job);h.state().parked=parked;h.state().job=null;h.state().ready=1;
  const restarted=await harness(h);restarted.alarmEvent.fire({name:'yqn-prepare-timeout'});await restarted.flush();
  assert.equal(restarted.state().job.videoId,ids[1]);assert.equal(restarted.state().job.tabId,parked.tabId);
  assert.equal(restarted.windowCreates.length,0);
});
test('moving the preparation tab to a browsing window preserves it and uses a new quiet window for the next video',async()=>{
  const h=await harness();await h.msg({type:'yqn-prepare-start'});await h.msg({type:'yqn-prepare-list',ids},h.jobSender());
  const tabId=h.state().job.tabId;h.tabs.get(tabId).windowId=1;h.attached.fire(tabId);await h.flush();
  assert.equal(h.state().job.viewing,true);await h.msg({type:'yqn-prepare-done',status:'ready'},h.jobSender());
  assert.equal(h.tabs.get(tabId).url.includes(ids[0]),true);assert.notEqual(h.state().job.tabId,tabId);
  assert.notEqual(h.state().job.windowId,1);await h.msg({type:'yqn-prepare-stop'});assert.equal(h.tabs.has(tabId),true);
});
test('restoring or adding another tab protects the preparation window from reuse and cleanup',async()=>{
  for(const restore of [true,false]){
    const h=await harness();await h.msg({type:'yqn-prepare-start'});await h.msg({type:'yqn-prepare-list',ids},h.jobSender());
    const job=clone(h.state().job);
    if(restore){const win=h.windows.get(job.windowId);win.state='normal';win.focused=false;h.bounds.fire(win);await h.flush();assert.equal(h.state().job.viewing,true);}
    else h.tabs.set(999,{id:999,windowId:job.windowId,url:'https://example.test/',active:true});
    await h.msg({type:'yqn-prepare-done',status:'ready'},h.jobSender());
    assert.equal(h.tabs.get(job.tabId).url.includes(ids[0]),true);assert.notEqual(h.state().job.windowId,job.windowId);
    assert.equal(h.tabs.get(job.tabId).muted,false);
    assert.ok(h.sent.some(m=>m.id===job.tabId&&m.type==='yqn-prepare-view'),'A retained tab must be released from the pause guard');
    await h.msg({type:'yqn-prepare-stop'});assert.equal(h.tabs.has(job.tabId),true);if(!restore)assert.equal(h.tabs.has(999),true);
  }
});
test('window creation failure stops cleanly without falling back to a normal browsing tab',async()=>{
  const h=await harness({failCreate:true});const result=await h.msg({type:'yqn-prepare-start'});
  assert.equal(result.ok,false);assert.match(result.error,/minimised window/);assert.equal(h.state().running,false);
  assert.equal(h.created.length,0);assert.equal(h.alarms.has('yqn-prepare-timeout'),false);
});
test('complete zero-cut plans are cached and skipped on subsequent Watch Later preparation batches',async()=>{
  const h=await harness();
  await h.msg({type:'yqn-prepare-start'});
  await h.msg({type:'yqn-prepare-list',ids:[ids[0]]},h.jobSender());
  const put=await h.msg({type:'yqn-cache-put',videoId:ids[0],entry:{
    settingsKey:h.cache.key({...h.cache.defaults,...h.sync}),complete:true,ts:Date.now(),segments:[]
  }});
  assert.equal(put.ok,true);
  await h.msg({type:'yqn-prepare-done',status:'ready'},h.jobSender());
  assert.equal(h.state().running,false);assert.equal(h.state().ready,1);
  await h.msg({type:'yqn-prepare-start'});
  await h.msg({type:'yqn-prepare-list',ids:[ids[0],ids[1]]},h.jobSender());
  assert.equal(h.state().skipped,1);
  assert.equal(h.state().job.videoId,ids[1]);
});
