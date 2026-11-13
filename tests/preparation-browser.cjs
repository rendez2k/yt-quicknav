/* Full queue workflow in an isolated profile; all provider replies are fixtures. */
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {chromium}=require('playwright');
test('Watch Later background preparation, cached playback, own-store skip, budget and cancellation',{timeout:180000},async t=>{
  const root=path.join(__dirname,'..'),profile=await fs.mkdtemp(path.join(os.tmpdir(),'yqn-preparation-'));
  // Window state is not implemented by headless Chromium. Use an isolated,
  // initially minimised browser to exercise actual OS window behaviour.
  const context=await chromium.launchPersistentContext(profile,{headless:false,channel:'chromium',args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`,'--start-minimized','--autoplay-policy=no-user-gesture-required']});
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const extensionId=new URL(worker.url()).hostname;
    const ids=Array.from({length:6},(_,i)=>'queued'+String(i).padStart(5,'0'));
    let requests=0,delay=300,viewed,viewedPlaylist;const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    await worker.evaluate(()=>{
      self.fetch=async()=>new Response('[]',{status:404});
      // Model YouTube's canonical destination before document_start. Mocked
      // HTTP redirects would escape Playwright's route handler and hit YouTube.
      const update=chrome.tabs.update;
      chrome.tabs.update=async(id,patch)=>{if(patch.url?.startsWith('https://www.youtube.com/')){const u=new URL(patch.url);u.searchParams.delete('yqn_prepare');patch={...patch,url:u.href};}return update(id,patch);};
    });
    await context.route('https://api.anthropic.com/**',async route=>{
      const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
      requests++;const q=route.request().postDataJSON(),input=JSON.parse(q.messages[0].content);
      assert.match(q.system,/own shop, store, import business/);await new Promise(r=>setTimeout(r,delay));
      await route.fulfill({headers,json:{stop_reason:'end_turn',usage:{input_tokens:200,output_tokens:200},content:[{type:'text',text:JSON.stringify({sections:input.lines.map(l=>({firstLine:l.id,lastLine:l.id,
        action:l.id===1?'skip':l.id===3?'speed':'keep',kind:l.id===1?'sponsor':l.id===3?'repetition':'explanation',certainty:'high',evidence:l.text,reason:l.id===1?'Own store promotion':l.id===3?'Repeated detail':'Review facts'})),summary:'A review',takeaways:[],chapters:[],mentions:[]})}]}}).catch(()=>{});
    });
    await context.route('https://www.youtube.com/**',async route=>{
      const u=new URL(route.request().url());
      if(u.pathname.includes('/youtubei/v1/next'))return route.fulfill({json:{getTranscriptEndpoint:{params:'fixture'}}});
      if(u.pathname.includes('/youtubei/v1/get_transcript'))return route.fulfill({json:{initialSegments:Array.from({length:6},(_,i)=>({transcriptSegmentRenderer:{startMs:String(i*10000),endMs:String((i+1)*10000),snippet:{runs:[{text:i===1?'I own an import store that sells phones worldwide.':i===3?'Repeating the previous detail without adding a new fact.':'The screen is brighter and the battery lasts longer in our tests.'}]}}}))}});
      if(route.request().resourceType()!=='document')return route.fulfill({status:404,body:''});
      if(u.pathname==='/playlist')return route.fulfill({contentType:'text/html',body:`<html><body>${ids.map(id=>`<ytd-playlist-video-renderer><a href="/watch?v=${id}">Review ${id}</a></ytd-playlist-video-renderer>`).join('')}</body></html>`});
      await route.fulfill({contentType:'text/html',body:`<html><head><style>#movie_player{width:800px;height:450px;position:relative}video{width:100%;height:420px}.ytp-progress-bar{height:12px;width:100%;background:#444}</style></head><body><div id="movie_player"><video class="html5-main-video" autoplay></video><div class="ytp-progress-bar"></div></div><ytd-watch-metadata><h1>Review</h1></ytd-watch-metadata><script>
        const bytes=new Uint8Array(60*16000+44),view=new DataView(bytes.buffer);function str(o,s){for(let i=0;i<s.length;i++)bytes[o+i]=s.charCodeAt(i)}str(0,'RIFF');view.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,bytes.length-44,true);document.querySelector('video').src=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
        window.ytcfg={get:k=>({INNERTUBE_API_KEY:'fixture',INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'fixture'}}})[k]};window.ytInitialPlayerResponse={videoDetails:{videoId:new URL(location).searchParams.get('v'),lengthSeconds:'60',title:'Review',channelId:'UCqueue',author:'Creator'},microformat:{playerMicroformatRenderer:{category:'Education'}}};document.querySelector('#movie_player').getPlayerResponse=()=>window.ytInitialPlayerResponse;
      </script></body></html>`});
    });
    await worker.evaluate(()=>chrome.storage.sync.set({autoCut:true,thoroughAnalysis:true,aiHighlights:true,anthropicKey:'fixture-key',cutMessaging:false,cutBoring:false,autoIgnoreMusic:false,minCutMinutes:0,cinemaMode:false,volumeBoost:100,volumeLevel:false,speedOnly:true,speedRate:3}));
    const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const state=()=>worker.evaluate(async()=>(await chrome.storage.local.get('yqnPreparationV1')).yqnPreparationV1);
    async function until(fn){const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Preparation wait expired: '+JSON.stringify({state:await state(),pages:await Promise.all(context.pages().map(async p=>({url:p.url(),text:(await p.locator('body').innerText().catch(()=>'' )).slice(0,180)}))),errors}));}
    await t.test('five videos reuse one minimised window and tab while the normal window keeps focus',async()=>{
      const normalWindow=await worker.evaluate(()=>chrome.windows.getLastFocused());const opened=[];
      const record=p=>opened.push(p);context.on('page',record);
      await popup.locator('#watchLaterPrepare').check();
      await until(async()=>(await state())?.job?.kind==='video');
      const s=await state(),tab=await worker.evaluate(id=>chrome.tabs.get(id),s.job.tabId);
      const win=await worker.evaluate(id=>chrome.windows.get(id),s.job.windowId);
      assert.equal(tab.active,true);assert.equal(tab.mutedInfo.muted,true);assert.notEqual(win.id,normalWindow.id);
      assert.equal(win.state,'minimized');assert.equal(win.focused,false);assert.equal(s.job.viewing,undefined);
      assert.equal((await worker.evaluate(id=>chrome.windows.get(id),normalWindow.id)).focused,normalWindow.focused);
      await until(async()=>!(await state())?.running);
      assert.equal((await state()).ready,5);assert.equal((await state()).attempted,5);assert.equal(requests,10);assert.equal(popup.isClosed(),false);
      context.off('page',record);assert.equal(opened.length,1,'Reuse the same page for the playlist and all five videos');assert.equal(opened[0].isClosed(),true);
      assert.equal((await worker.evaluate(id=>chrome.windows.get(id),normalWindow.id)).focused,normalWindow.focused);
      assert.equal(await worker.evaluate(async id=>{try{await chrome.windows.get(id);return true;}catch{return false;}},win.id),false);
      assert.equal((await worker.evaluate(()=>chrome.alarms.get('yqn-watch-later'))).periodInMinutes,30);
    });
    await t.test('a later batch reuses saved plans and preserves a restored playlist and preparation video',async()=>{
      delay=900;await popup.locator('#prepareNow').click();
      await until(async()=>{viewedPlaylist=context.pages().find(p=>p.url().includes('/playlist?list=WL'));return !!viewedPlaylist;});
      let s=await state();await worker.evaluate(id=>chrome.windows.update(id,{state:'normal',focused:false}),s.job.windowId);
      await until(async()=>(await state())?.job?.kind==='video');
      await until(async()=>{const job=(await state())?.job;viewed=job?.kind==='video'&&context.pages().find(p=>p.url().includes('v='+job.videoId));return !!viewed;});
      s=await state();assert.equal(s.job.videoId,ids[5]);assert.equal(viewedPlaylist.isClosed(),false);
      await viewed.waitForFunction(()=>document.querySelector('video')?.paused&&document.querySelector('video')?.muted);
      await worker.evaluate(id=>chrome.windows.update(id,{state:'normal',focused:false}),s.job.windowId);
      await until(async()=>(await state())?.job?.viewing);
      await until(async()=>/caption lines checked.*Open for viewing/.test((await state())?.message));
      await viewed.waitForFunction(()=>document.querySelector('video')?.muted===false);
      await viewed.evaluate(()=>document.querySelector('video').play());await viewed.waitForFunction(()=>!document.querySelector('video').paused);
      await viewed.evaluate(()=>document.querySelector('video').pause());
      await until(async()=>!(await state())?.running);
      assert.equal((await state()).ready,1);assert.equal((await state()).skipped,5);assert.equal(requests,12);
      assert.equal(viewed.isClosed(),false);assert.equal(viewedPlaylist.isClosed(),false);delay=300;
    });
    await t.test('the video opened during preparation keeps working with its completed skip and speed plan',async()=>{
      await viewed.waitForFunction(()=>document.querySelector('#yqn-cut-btn')?.textContent.includes('2'));
      await viewed.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=12;});
      await viewed.waitForFunction(()=>document.querySelector('video').currentTime>=20);
      assert.ok(await viewed.locator('.yqn-marker-skip').count());
      await viewed.evaluate(()=>document.querySelector('video').currentTime=35);
      await viewed.waitForFunction(()=>document.querySelector('video').playbackRate===3);
      await viewed.evaluate(()=>document.querySelector('video').currentTime=45);
      await viewed.waitForFunction(()=>document.querySelector('video').playbackRate===1);
      assert.equal(requests,12);
    });
    const watch=await context.newPage();
    await t.test('opening a prepared video loads the cache and skips own-store advertising in speed-only mode',async()=>{
      const before=requests;await watch.goto('https://www.youtube.com/watch?v='+ids[0]);
      await watch.locator('#yqn-cut-btn').waitFor();await watch.waitForFunction(()=>document.querySelector('#yqn-cut-btn')?.textContent.includes('2'));
      assert.equal(requests,before);await watch.evaluate(()=>{const v=document.querySelector('video');v.pause();v.playbackRate=1.5;v.currentTime=12;});
      await watch.waitForFunction(()=>document.querySelector('video').currentTime>=20);assert.ok(await watch.locator('.yqn-marker-skip').count());
      await watch.evaluate(()=>document.querySelector('video').currentTime=35);await watch.waitForFunction(()=>document.querySelector('video').playbackRate===3);
      await watch.evaluate(()=>document.querySelector('video').currentTime=45);await watch.waitForFunction(()=>document.querySelector('video').playbackRate===1.5);
    });
    await t.test('a spending limit stops preparation before any paid request',async()=>{
      await worker.evaluate(()=>chrome.storage.local.remove('cutCacheV15'));await worker.evaluate(()=>chrome.storage.sync.set({aiDailyBudget:0.000001}));
      const before=requests;await popup.locator('#prepareNow').click();await until(async()=>(await state())?.running);await until(async()=>!(await state())?.running);
      assert.match((await state()).message,/spending limit/);assert.equal(requests,before);assert.equal((await state()).attempted,1);
    });
    await t.test('turning preparation off closes only its own tab and cancels follow-up passes',async()=>{
      await worker.evaluate(()=>chrome.storage.sync.set({aiDailyBudget:0}));delay=1000;
      const before=requests;await popup.locator('#prepareNow').click();await until(()=>requests>before);await popup.locator('#watchLaterPrepare').uncheck();
      await until(async()=>!(await state())?.running);const atStop=requests;await new Promise(r=>setTimeout(r,1300));assert.equal(requests,atStop);
      assert.equal(watch.isClosed(),false);assert.equal(popup.isClosed(),false);assert.equal(await worker.evaluate(()=>chrome.alarms.get('yqn-watch-later')),undefined);
    });
    assert.deepEqual(errors,[]);
  }finally{await context.close();const resolved=path.resolve(profile);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('yqn-preparation-'))throw Error('Unexpected profile');await fs.rm(resolved,{recursive:true,force:true});}
});
