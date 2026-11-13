// Read the supplied public video with simulated AI only, in a disposable profile.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
(async()=>{
  const root=path.resolve(__dirname,'..'),profile=await fs.mkdtemp(path.join(os.tmpdir(),'yqn-video-check-'));
  const id=process.env.YQN_VIDEO_ID || 'mSjlmpGH6Is';
  if(!/^[\w-]{11}$/.test(id))throw new Error('Invalid video ID');
  const captured=new Map(),errors=[];let context,calls=0;
  try {
    context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',viewport:{width:1280,height:1000},
      args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
    await context.route('https://api.anthropic.com/**',async route=>{
      const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
      calls++;const request=route.request().postDataJSON(),input=JSON.parse(request.messages[0].content);
      for(const line of input.lines)captured.set(line.id,line);
      const sections=input.lines.filter(l=>l.id>=input.coreFirst&&l.id<=input.coreLast).map(l=>({firstLine:l.id,lastLine:l.id,action:'keep',kind:'explanation',certainty:'high',reason:'Transport check only',evidence:l.text}));
      await route.fulfill({headers,json:{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({sections,summary:'Simulated response; no model assessment performed.',takeaways:[],chapters:[],mentions:[]})}]}});
    });
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(async()=>{
      self.sponsorData=[];const original=self.fetch;
      self.fetch=async(...args)=>{const res=await original(...args);if(String(args[0]).startsWith('https://sponsor.ajay.app/')){try{self.sponsorData.push({status:res.status,data:await res.clone().json()});}catch{}}return res;};
      await chrome.storage.sync.set({autoCut:true,cutMessaging:true,cutBoring:false,thoroughAnalysis:true,aiHighlights:true,
        anthropicKey:'fixture-key-not-real',jevCuts:false,minCutMinutes:0,autoIgnoreMusic:false,cinemaMode:false,showToggle:false});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    let networkSample=null;
    page.on('response',async response=>{
      if(!response.url().includes('/youtubei/v1/get_transcript'))return;
      try{const data=await response.json(),found=[];
        function walk(value){if(!value||typeof value!=='object'||found.length>=3)return;for(const [key,item]of Object.entries(value)){if(/transcript.*segment|segment.*viewmodel/i.test(key))found.push({key,value:item});else walk(item);if(found.length>=3)return;}}
        walk(data);networkSample=found;
      }catch{}
    });
    await page.goto('https://www.youtube.com/watch?v='+id,{waitUntil:'domcontentloaded',timeout:30000});
    for(let n=0;n<20;n++){
      const reject=page.locator('ytd-consent-bump-v2-lightbox').getByText('Reject all',{exact:true}).first();
      if(await reject.isVisible().catch(()=>false)){await reject.click();break;}
      if(await page.locator('#yqn-cut-btn').isVisible().catch(()=>false))break;
      await page.waitForTimeout(500);
    }
    await page.locator('#yqn-cut-btn').click({timeout:20000});
    for(let n=0;n<600;n++){
      if(calls>=2 && !/checking|…/.test(await page.locator('#yqn-cut-btn').textContent()))break;
      await page.waitForTimeout(100);
    }
    if(!await page.locator('#yqn-cut-panel').count())await page.locator('#yqn-cut-btn').click();
    await page.waitForFunction(()=>document.querySelector('.yqn-cp-coverage')&&document.querySelector('.yqn-cp-retry')?.disabled===false,null,{timeout:10000});
    const result=await page.evaluate(()=>{const data=document.querySelector('#movie_player')?.getPlayerResponse?.();return {title:document.title,duration:document.querySelector('video')?.duration,
      description:data?.videoDetails?.shortDescription,captionTracks:data?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.map(t=>({language:t.languageCode,name:t.name,kind:t.kind})),
      panel:document.querySelector('#yqn-cut-panel')?.textContent,toast:document.querySelector('#yqn-toast')?.textContent};});
    result.transcript=[...captured.values()].sort((a,b)=>a.id-b.id);result.sponsorData=await worker.evaluate(()=>self.sponsorData);
    result.transcriptNetworkSample=networkSample;
    result.chapterData=await page.evaluate(()=>{const found=[];function walk(value,path=''){if(!value||typeof value!=='object'||found.length>30)return;for(const [k,v] of Object.entries(value)){if(k==='chapterRenderer'||k==='chapters')found.push({path:path+'.'+k,value:v});else walk(v,path+'.'+k);}}walk(window.ytInitialData,'initial');return found;});
    result.transcriptDom=await page.evaluate(()=>[...document.querySelectorAll('ytd-engagement-panel-section-list-renderer *')].filter(el=>[...el.children].some(child=>/^\d{1,2}:\d{2}(:\d{2})?$/.test(child.textContent.trim()))).slice(0,4).map(el=>el.outerHTML.slice(0,3500)));
    result.simulatedCalls=calls;result.paidCalls=0;result.errors=errors;
    await page.locator('#yqn-topics-btn').click();
    result.topics=await page.locator('#yqn-tools .yqn-topic-list button').allTextContents();
    if(id==='TYNzg59ke30'){
      assert.equal(result.topics.length,16);
      assert.ok(result.topics.some(t=>t==='1:01 · Snapgate'));
      await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=107;});
      await page.locator('#yqn-tools').getByRole('button',{name:'Next topic',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=113 && document.querySelector('video').currentTime<116);
      result.nextTopicFrom107=await page.evaluate(()=>{const v=document.querySelector('video');v.pause();return v.currentTime;});
      await page.screenshot({path:path.join(root,'tests','topics-'+id+'.png')});
    }
    await page.locator('#yqn-tools').getByRole('button',{name:'Close',exact:true}).click();
    // Four synthetic local cuts exercise layout only; never touch a user profile.
    await worker.evaluate(async id=>chrome.storage.local.set({['yqnCutEditsV1:'+id]:[
      {start:30,end:40,action:'skip'},{start:300,end:340,action:'speed'},
      {start:788,end:842,action:'skip'},{start:1036,end:1117,action:'skip'}]}),id);
    await page.locator('#yqn-markers .yqn-marker').first().waitFor({state:'attached'});
    await page.locator('#yqn-cut-btn').click();
    await page.evaluate(()=>document.querySelector('video').pause());
    await page.locator('#movie_player .ytp-progress-bar').hover({force:true});await page.waitForTimeout(350);
    await page.locator('#yqn-markers .yqn-marker').first().waitFor({timeout:10000});
    result.markerLayout=await page.evaluate(()=>[...document.querySelectorAll('#yqn-markers, #yqn-markers .yqn-marker')].map(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {id:el.id,class:el.className,x:r.x,y:r.y,w:r.width,h:r.height,display:s.display,opacity:s.opacity,zIndex:s.zIndex,visibility:s.visibility,parent:el.parentElement.className};}));
    await page.screenshot({path:path.join(root,'tests','video-diagnostic.png')});
    const file=path.join(root,'tests',`video-diagnostic-${id}.json`);await fs.writeFile(file,JSON.stringify(result,null,2));
    console.log(JSON.stringify({file,title:result.title,duration:result.duration,captionTracks:result.captionTracks,lines:captured.size,simulatedCalls:calls,errors,
      matchingLines:result.transcript.filter(l=>/sponsor|brought to you|discount|free trial|our code|link.*description/i.test(l.text)).slice(0,20),
      topics:result.topics,nextTopicFrom107:result.nextTopicFrom107,
      markerLayout:result.markerLayout.slice(0,3),sponsorData:result.sponsorData.map(x=>({status:x.status,rows:Array.isArray(x.data)?x.data.filter(r=>r.videoID===id):x.data}))},null,2));
  }catch(error){
    const page=context?.pages().at(-1);
    if(page){
      const state=await page.evaluate(()=>({title:document.title,text:document.body.innerText.slice(0,3500),
        panel:document.querySelector('#yqn-cut-panel')?.textContent,markers:document.querySelector('#yqn-markers')?.outerHTML,
        progress:[...document.querySelectorAll('#movie_player [class*="progress"], #movie_player [role="slider"]')].map(el=>({tag:el.tagName,class:el.className,role:el.getAttribute('role'),label:el.getAttribute('aria-label'),rect:{x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height},html:el.outerHTML.slice(0,600)}))}));
      await fs.writeFile(path.join(root,'tests',`video-diagnostic-${id}.json`),JSON.stringify({error:error.message,state,transcript:[...captured.values()],calls,errors},null,2));
      await page.screenshot({path:path.join(root,'tests','video-diagnostic.png')});
      console.log(JSON.stringify(state,null,2));
    }
    throw error;
  }finally{
    await context?.close();
    if(path.dirname(profile)!==path.resolve(os.tmpdir())||!path.basename(profile).startsWith('yqn-video-check-'))throw new Error('Unexpected profile path');
    await fs.rm(profile,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
