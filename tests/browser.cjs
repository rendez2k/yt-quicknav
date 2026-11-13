// Runs the unpacked MV3 extension in an isolated profile. YouTube and provider
// responses are fixtures; no account, credentials or paid requests are used.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.join(__dirname,'..');

test('installed extension: playback, preferences, editing, navigation, failures and popup', {timeout:180000}, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'yqn-check-'));
  const context = await chromium.launchPersistentContext(profile, {headless:true, channel:'chromium',
    args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`, '--autoplay-policy=no-user-gesture-required']});
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).hostname;
    await worker.evaluate(() => {
      self.calls = []; self.sbSubmissions = []; self.providerMode = 'ok'; self.aiMode='ok';
      self.fetch = async (url, options) => {
        if (String(url).startsWith('https://sponsor.ajay.app/') && options?.method === 'POST') {
          self.sbSubmissions.push(JSON.parse(options.body));
          return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
        }
        self.calls.push(String(url));
        if (String(url).startsWith('https://api.anthropic.com/')) {
          if (self.aiMode === 'fail') return new Response('{}',{status:503});
          return new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify({
            highlights:[{start:0,end:110},{start:200,end:350},{start:450,end:600}],
            skip:[{start:120,end:150,reason:'sponsor <b>literal text</b>'}],
            chapters:[{start:0,title:'Start'},{start:200,title:'Demo'}],
            summary:'Fixture summary',takeaways:['Fixture takeaway'],mentions:[]
          })}]}),{status:200});
        }
        if (String(url).startsWith('https://api.typesafe.ai/')) {
          const questions=JSON.parse(options.body).questions;
          const answers=Object.fromEntries(Object.keys(questions).map((key,i)=>{
            const choice=['junk','sponsor','speed'][i] || 'keep';return [key,{choice,probabilities:{[choice]:0.92}}];
          }));
          return new Response(JSON.stringify({answers}),{status:200});
        }
        if (!String(url).startsWith('https://sponsor.ajay.app/')) throw new Error('Paid provider blocked by test');
        if (self.providerMode === 'fail') return new Response('{}',{status:503});
        if (self.providerMode === 'none') return new Response('[]',{status:404});
        return new Response(JSON.stringify(['videoAAAAAA','videoBBBBBB','videoCCCCCC','videoDDDDDD'].map(videoID => ({videoID, segments:[
          {segment:[10,30],category:'intro',actionType:'skip'},
          {segment:[20,50],category:'sponsor',actionType:'skip'},
          {segment:[60,90],category:'filler',actionType:'skip'},
        ]}))),{status:200,headers:{'content-type':'application/json'}});
      };
    });
    await worker.evaluate(() => chrome.storage.sync.set({autoCut:true, cutMessaging:true, cutBoring:false,
      autoIgnoreMusic:false,minCutMinutes:0, cinemaMode:false,showToggle:false,aiHighlights:false,jevCuts:false}));
    let thoroughMode='ok',thoroughDelay=0,questionMode='ok',questionRequests=0;
    const thoroughRequests=[];
    const fixtureText=id=>[2,3,4,28,29,30].includes(id) ? 'This video is sponsored by Acme. Use our discount code today.' :
      id===1 ? 'Welcome to the channel. Here is our usual introduction.' :
      id===12 ? 'This product review is independent. We bought this tool ourselves.' :
      id===15 ? 'We repeat the exact explanation from earlier without any new detail.' :
      'Here is a useful demonstration and explanation of the process '+id;
    await context.route('https://api.anthropic.com/**', async route => {
      const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
      if (route.request().method()==='OPTIONS') return route.fulfill({status:204,headers});
      if (await worker.evaluate(()=>self.aiMode==='fail')) return route.fulfill({status:503,headers,json:{}});
      const request=route.request().postDataJSON();
      if (request.system?.includes('YQN_VIDEO_QUESTION')) {
        questionRequests++;
        if(questionMode==='slow')await new Promise(r=>setTimeout(r,800));
        const input=JSON.parse(request.messages[0].content),line=input.lines.find(l=>l.id===2);
        const result=questionMode==='missing'?{status:'not_covered',answer:'',citations:[]}:
          {status:'supported',answer:'The video mentions an Acme sponsor discount.',citations:[{lineId:questionMode==='invalid'?99999:line.id,quote:line.text}]};
        return route.fulfill({headers,json:{usage:{input_tokens:100,output_tokens:30},stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(result)}]}});
      }
      if (request.system?.includes('YQN_THOROUGH_PASS')) {
        const input=JSON.parse(request.messages[0].content),review=request.system.includes('PASS: review');
        thoroughRequests.push({input,review,system:request.system});
        if (thoroughDelay) await new Promise(r=>setTimeout(r,thoroughDelay));
        if (thoroughMode==='partial' && review && input.coreFirst>=30) return route.fulfill({status:503,headers,json:{}});
        if (thoroughMode==='truncated' && review) return route.fulfill({headers,json:{stop_reason:'max_tokens',content:[{type:'text',text:'{}'}]}});
        if (thoroughMode==='recoverSize' && review && input.coreLast-input.coreFirst+1>15) return route.fulfill({headers,json:{stop_reason:'max_tokens',content:[{type:'text',text:'{}'}]}});
        const sections=input.lines.filter(l=>l.id>=input.coreFirst&&l.id<=input.coreLast).map(l=>{
          let kind='demonstration',action='keep',certainty='high';
          if ([2,3,4,28,29,30].includes(l.id)) {kind='sponsor';action='skip';}
          if (l.id===1) {kind='intro';action='skip';}
          if (l.id===15) {kind='repetition';action='speed';}
          if (l.id===12&&!review) {kind='sponsor';action='skip';}
          if ([6,7,8].includes(l.id)&&!review) {kind='tangent';action='speed';}
          if(thoroughMode==='pacing' && l.id===15){kind=review?'explanation':'repetition';certainty=review?'medium':'high';}
          if(thoroughMode==='pacing' && input.pacing==='quick' && [17,18,19].includes(l.id)){action='speed';kind=review?'demonstration':'explanation';certainty='medium';}
          return {firstLine:l.id,lastLine:l.id,kind,action,certainty,reason:kind==='sponsor'?'Verified sponsor':kind==='intro'?'intro':action==='speed'?'Faster paced detail':'Useful demonstration',evidence:thoroughMode==='quoteMismatch'&&review&&action!=='keep'?'Words that do not occur in the transcript':l.text};
        });
        return route.fulfill({headers,json:{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({sections,summary:'Checked section notes',takeaways:['Verified takeaway'],
          chapters:[{firstLine:input.coreFirst,title:input.coreFirst===0?'Useful demonstrations':'Later examples'}],mentions:[{name:'Acme tool',url:''}]})}]}});
      }
      return route.fulfill({headers,json:{content:[{type:'text',text:JSON.stringify({
        highlights:[{start:0,end:110},{start:200,end:350},{start:450,end:600}],
        skip:[{start:120,end:150,reason:'sponsor <b>literal text</b>'}],
        chapters:[{start:0,title:'Start'},{start:200,title:'Demo'}],
        summary:'Fixture summary',takeaways:['Fixture takeaway'],mentions:[]
      })}]}});
    });
    let nextRequests=0, transcriptRequests=0, fallbackTranscript=false,nativeTopicFixture=false,longVideoFixture=false,ghReleaseVersion='1.45.1';
    await context.route('https://api.github.com/**', async route => {
      const headers={'access-control-allow-origin':'*','content-type':'application/json'};
      return route.fulfill({status:200,headers,json:{
        tag_name:`v${ghReleaseVersion}`,draft:false,prerelease:false,
        html_url:`https://github.com/rendez2k/yt-quicknav/releases/tag/v${ghReleaseVersion}`,
        body:'## Highlights\n- Duration-scaled long-video Highlight Reels and 1-click updater',
        assets:[{name:`youtube-quick-nav-v${ghReleaseVersion}.zip`,browser_download_url:`https://github.com/rendez2k/yt-quicknav/releases/download/v${ghReleaseVersion}/youtube-quick-nav-v${ghReleaseVersion}.zip`}],
      }});
    });
    await context.route('https://www.youtube.com/**', async route => {
      if (route.request().url().includes('/youtubei/v1/next')) {
        nextRequests++;
        await new Promise(r=>setTimeout(r,1800));
        return route.fulfill({json:{getTranscriptEndpoint:{params:'fixture'}}});
      }
      if (route.request().url().includes('/youtubei/v1/get_transcript')) {
        transcriptRequests++;
        if(fallbackTranscript)return route.fulfill({json:{}});
        if(longVideoFixture)return route.fulfill({json:{initialSegments:Array.from({length:118},(_,i)=>({transcriptSegmentRenderer:{startMs:String((i+1)*30000),endMs:String((i+1)*30000+12000),snippet:{runs:[{text:i%2===0?`In section ${i+1} we benchmark cluster scaling under production traffic.`:`Overall, this architecture improves throughput by ${20+i}% compared to baseline.`}]}}}))}});
        return route.fulfill({json:{initialSegments:Array.from({length:60},(_,i)=>({
          transcriptSegmentRenderer:{startMs:String(i*10000),endMs:String((i+1)*10000),snippet:{runs:[{text:fixtureText(i)}]}}
        }))}});
      }
      if (route.request().resourceType() !== 'document') return route.fulfill({status:404,body:''});
      await route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>
        body{margin:25px;background:#181818;color:white;font:16px Arial;--yt-spec-text-primary:#f1f1f1;--yt-spec-text-secondary:#aaa;
          --yt-spec-menu-background:#282828;--yt-spec-badge-chip-background:#383838;--yt-spec-10-percent-layer:#555}
        #movie_player{width:min(800px,100%);height:470px;position:relative}
        video{width:100%;height:440px} .ytp-progress-bar{height:12px;background:#444;position:relative;width:100%}
        ytd-watch-metadata{display:block;width:min(800px,100%)}
        </style></head><body><div id="movie_player" class="html5-video-player"><video class="html5-main-video" controls></video>
        <div class="ytp-progress-bar"></div></div><ytd-watch-metadata><h1 id="title">Workflow test video</h1></ytd-watch-metadata>
        <script>
          const durSec=${longVideoFixture}?3600:600,sRate=${longVideoFixture}?4000:8000; const bytes=new Uint8Array(durSec*sRate*2+44); const view=new DataView(bytes.buffer);
          function str(o,s){for(let i=0;i<s.length;i++)bytes[o+i]=s.charCodeAt(i)}
          str(0,'RIFF');view.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');
          view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
          view.setUint32(24,sRate,true);view.setUint32(28,sRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
          str(36,'data');view.setUint32(40,bytes.length-44,true);
          window.mediaURL=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));document.querySelector('video').src=mediaURL;
          window.ytcfg={get:key=>({INNERTUBE_API_KEY:'fixture',INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'fixture'}}})[key]};
          window.ytInitialPlayerResponse={videoDetails:{videoId:new URL(location).searchParams.get('v'),lengthSeconds:String(durSec)},
            microformat:{playerMicroformatRenderer:{category:'Education'}}};
          window.fixtureDescriptions=${JSON.stringify({videoBBBBBB:'0:00 Second video intro\n2:00 Second video demo\n5:00 Second video ending'})};
          if(${nativeTopicFixture})window.ytInitialData={playerOverlays:{playerOverlayRenderer:{chapters:[
            [0,'Bottom Notifications'],[61000,'Snapgate'],[113000,'Scroll Light'],[180000,'Flow']
          ].map(([timeRangeStartMillis,title])=>({chapterRenderer:{timeRangeStartMillis,title:{simpleText:title}}}))}}};
          document.querySelector('#movie_player').getPlayerResponse=()=>({
            ...window.ytInitialPlayerResponse,videoDetails:{...window.ytInitialPlayerResponse.videoDetails,
              shortDescription:${nativeTopicFixture}?window.fixtureDescriptions[new URL(location).searchParams.get('v')] || '':'',
              videoId:new URL(location).searchParams.get('v'), author:'Fixture creator',
              channelId:new URL(location).searchParams.get('v')==='videoBBBBBB'?'UCfixtureB':'UCfixtureA'}
          });
        </script></body></html>`});
    });
    const page = await context.newPage();
    const errors=[]; page.on('pageerror', e => errors.push(e.message));
    await page.goto('https://www.youtube.com/watch?v=videoAAAAAA');
    await page.waitForFunction(() => document.querySelector('video').duration === 600, null, {timeout:10000}).catch(async e => {
      console.log('Media diagnostic',await page.evaluate(()=>({duration:document.querySelector('video').duration,
        error:document.querySelector('video').error?.message,ready:document.querySelector('video').readyState,
        source:document.querySelector('video').currentSrc,body:document.body.innerText})),errors); throw e;
    });
    await page.locator('#yqn-markers .yqn-marker').first().waitFor();
    await page.locator('#yqn-cut-btn').click();
    await page.getByRole('button',{name:'↻ Re-analyse'}).waitFor();
    assert.equal(await page.locator('.yqn-cp-row').count(),3);
    assert.match(await page.locator('#yqn-cut-panel').innerText(), /sponsor/);
    await t.test('fresh plan renders markers and cut list',()=>assert.equal(errors.length,0,errors.join('\n')));

    await t.test('sponsor skip and fast segment restore user speed',async()=>{
      await page.evaluate(()=>{const v=document.querySelector('video');v.playbackRate=1.5;v.currentTime=25;});
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      await page.evaluate(()=>document.querySelector('video').currentTime=65);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===3);
      await page.evaluate(()=>document.querySelector('video').currentTime=100);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===1.5);
    });
    const callsBefore = await worker.evaluate(()=>self.calls.length);
    await t.test('speed-only preserves sponsor boundaries without refetching',async()=>{
      await worker.evaluate(()=>chrome.storage.sync.set({speedOnly:true,speedRate:4}));
      await page.waitForFunction(()=>document.querySelector('.yqn-cp-row .yqn-cp-badge')?.textContent==='Speed');
      await page.evaluate(()=>document.querySelector('video').currentTime=12);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===4);
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      assert.equal(await worker.evaluate(()=>self.calls.length),callsBefore);
    });
    await t.test('natural media playback crosses into a sponsor and skips it',async()=>{
      await page.evaluate(async()=>{const v=document.querySelector('video');v.currentTime=19;await v.play();});
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      await page.evaluate(()=>document.querySelector('video').pause());
    });
    await t.test('progress-bar and media replacement recover automatically',async()=>{
      await page.evaluate(()=>{
        const old=document.querySelector('.ytp-progress-bar');const bar=old.cloneNode(false);old.replaceWith(bar);
        const v=document.createElement('video');v.className='html5-main-video';v.src=window.mediaURL;
        document.querySelector('video').replaceWith(v);
      });
      await page.locator('#yqn-markers').waitFor();
      await page.waitForFunction(()=>document.querySelector('video').duration===600);
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
    });

    await t.test('markers remain visible outside clipped timeline internals',async()=>{
      await page.evaluate(()=>{const bar=document.querySelector('.ytp-progress-bar');bar.style.clipPath='inset(0 100% 0 0)';});
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#yqn-markers').evaluate(el=>el.parentElement.id),'movie_player');
      assert.equal(await page.locator('#yqn-markers').isVisible(),true);
      assert.ok((await page.locator('#yqn-markers').boundingBox()).height>=3);
      await page.screenshot({path:path.join(root,'tests','marker-clipping.png')});
      await page.evaluate(()=>document.querySelector('.ytp-progress-bar').style.clipPath='');
    });
    await t.test('markers follow the visible replacement slider and recover after controls hide',async()=>{
      await page.evaluate(()=>{const old=document.querySelector('.ytp-progress-bar');old.style.display='none';const next=document.createElement('div');next.className='ytp-progress-bar yqn-test-slider';next.style.width='70%';next.style.marginLeft='40px';old.after(next);});
      await page.waitForFunction(()=>{const marker=document.querySelector('#yqn-markers').getBoundingClientRect(),bar=document.querySelector('.yqn-test-slider').getBoundingClientRect();return Math.abs(marker.x-bar.x)<1&&Math.abs(marker.width-bar.width)<1;});
      await page.locator('.yqn-test-slider').evaluate(el=>el.style.opacity='0');
      await page.waitForFunction(()=>document.querySelector('#yqn-markers').hidden);
      await page.locator('.yqn-test-slider').evaluate(el=>{el.style.opacity='1';el.style.width='90%';});
      await page.waitForFunction(()=>{const m=document.querySelector('#yqn-markers'),b=document.querySelector('.yqn-test-slider');return !m.hidden&&Math.abs(m.getBoundingClientRect().width-b.getBoundingClientRect().width)<1;});
      await page.evaluate(()=>{document.querySelector('.ytp-progress-bar:not(.yqn-test-slider)').remove();document.querySelector('.yqn-test-slider').removeAttribute('style');});
    });
    await t.test('same-video metadata updates preserve an open cut panel',async()=>{
      await page.evaluate(()=>document.dispatchEvent(new Event('yt-page-data-updated')));
      await page.locator('#yqn-cut-panel').waitFor();
      assert.equal(await worker.evaluate(()=>self.calls.length),callsBefore);
    });
    await t.test('late title replacement and alternate metadata hosts recover the toolbar without re-analysis',async()=>{
      await page.evaluate(()=>{
        const host=document.querySelector('ytd-watch-metadata');
        const replacement=document.createElement('ytd-video-primary-info-renderer');
        replacement.style.display='block';replacement.innerHTML='<h1>Replacement title</h1>';
        host.replaceWith(replacement);
      });
      await page.locator('ytd-video-primary-info-renderer #yqn-cut-btn').waitFor();
      assert.equal(await page.locator('#yqn-quick-bar').count(),1);
      assert.equal(await worker.evaluate(()=>self.calls.length),callsBefore);
      await page.evaluate(()=>{
        const host=document.querySelector('ytd-video-primary-info-renderer');
        const replacement=document.createElement('ytd-watch-metadata');replacement.innerHTML='<h1 id="title">Workflow test video</h1>';
        host.replaceWith(replacement);
      });
      await page.locator('ytd-watch-metadata #yqn-cut-btn').waitFor();
      assert.equal(await worker.evaluate(()=>self.calls.length),callsBefore);
    });
    await t.test('SPA navigation loads a new plan and cleans up on leaving watch',async()=>{
      await page.evaluate(()=>{
        window.dispatchEvent(new Event('yt-navigate-start'));
        history.pushState({},'', '/watch?v=videoBBBBBB');
        window.dispatchEvent(new Event('yt-navigate-finish'));
      });
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-btn')?.textContent.includes('3'));
      await page.locator('#yqn-markers').waitFor();
      await page.evaluate(()=>{document.querySelector('video').currentTime=65;});
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===4);
      await page.evaluate(()=>{
        window.dispatchEvent(new Event('yt-navigate-start'));history.pushState({},'', '/');
        window.dispatchEvent(new Event('yt-navigate-finish'));
      });
      assert.equal(await page.locator('#yqn-markers').count(),0);
      assert.equal(await page.evaluate(()=>document.querySelector('video').playbackRate),1);
      assert.equal(await page.locator('#yqn-quick-bar').count(),0);
    });
    await t.test('failure remains distinguishable from no submissions and retry works',async()=>{
      await worker.evaluate(()=>{self.providerMode='fail';return chrome.storage.local.clear();});
      await page.goto('https://www.youtube.com/watch?v=videoAAAAAA');
      await page.locator('#yqn-cut-btn').click();
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-panel')?.textContent.includes('503'),null,{timeout:8000}).catch(async e=>{
        console.log('Failure state',await page.locator('body').innerText(), await worker.evaluate(()=>({mode:self.providerMode,calls:self.calls})), errors);throw e;
      });
      assert.equal(await page.locator('.yqn-cp-row').count(),0);
      await worker.evaluate(()=>{self.providerMode='ok';});
      await page.getByRole('button',{name:'↻ Re-analyse'}).click();
      await page.locator('.yqn-cp-row').first().waitFor();
      await page.locator('#yqn-markers').waitFor();
      assert.equal(await page.locator('#yqn-cut-panel').evaluate(el=>{
        const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.right<=innerWidth;
      }),true,'Cut panel fits inside the viewport');
      await page.screenshot({path:path.join(root,'tests','workflow.png')});
    });
    await t.test('popup changes take effect immediately, including switch off',async()=>{
      const popup=await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await popup.locator('#autoCut').uncheck();
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-panel')?.textContent.includes('Auto-Cut is off'));
      assert.equal(await page.locator('#yqn-markers').count(),0);
      await popup.locator('#autoCut').check();
      await page.locator('#yqn-markers').waitFor();
      await popup.close();
    });
    await t.test('delayed page data leaves sponsor cuts active and repeated bridge pokes run once',async()=>{
      const beforeNext=nextRequests, beforeTranscript=transcriptRequests;
      await worker.evaluate(()=>chrome.storage.sync.set({cutBoring:true,aiHighlights:true,anthropicKey:'fixture-key'}));
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-panel')?.textContent.includes('Checking the remaining sources'));
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-panel')?.textContent.includes('Fixture summary'));
      assert.equal(nextRequests-beforeNext,1);
      assert.equal(transcriptRequests-beforeTranscript,1);
      assert.equal(await page.locator('.yqn-cp-reason b').count(),0,'External reasons must render as text');
      assert.ok(await page.locator('#yqn-markers .yqn-chap-tick').count());
    });
    await t.test('an AI failure retains usable sponsor cuts and reports partial coverage',async()=>{
      await worker.evaluate(()=>{self.aiMode='fail';});
      await page.getByRole('button',{name:'↻ Re-analyse'}).click();
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-panel')?.textContent.includes('AI analysis incomplete'));
      assert.match(await page.locator('#yqn-cut-panel').innerText(),/503/);
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
    });
    await t.test('ignore and unignore restore controls without re-ignoring the video',async()=>{
      await page.getByRole('button',{name:'Ignore',exact:true}).click();
      await page.getByRole('button',{name:'Ignored',exact:true}).waitFor();
      assert.equal(await page.locator('#yqn-markers').count(),0);
      await page.getByRole('button',{name:'Ignored',exact:true}).click();
      await page.locator('#yqn-markers').waitFor();
    });
    await t.test('Jev sponsor stays skipped beside junk in speed-only mode',async()=>{
      await worker.evaluate(()=>chrome.storage.sync.set({aiHighlights:false,jevCuts:true,typesafeKey:'fixture-key'}));
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-panel')?.textContent.includes('Jev: sponsor'));
      const sponsor=page.locator('.yqn-cp-row').filter({hasText:'Jev: sponsor'});
      assert.match(await sponsor.innerText(),/Skip/);
      const junk=page.locator('.yqn-cp-row').filter({hasText:'Jev: junk'});
      assert.match(await junk.first().innerText(),/Speed/);
    });
    await t.test('key test shows upstream failure instead of claiming the key works',async()=>{
      const failedKey=route=>route.fulfill({status:503,json:{}});
      await context.route('https://api.anthropic.com/**', failedKey);
      const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await popup.locator('#testAnthropicKey').click();
      await popup.waitForFunction(()=>document.querySelector('#anthropicKeyStatus').textContent.includes('503'));
      assert.equal(await popup.locator('#anthropicKeyStatus').getAttribute('class'),'keystatus err');
      await popup.close();
      await context.unroute('https://api.anthropic.com/**',failedKey);
    });
    await t.test('duration-based ignore and override work through the page bridge',async()=>{
      await worker.evaluate(async()=>{
        await chrome.storage.sync.set({aiHighlights:false,jevCuts:false,cutBoring:false,minCutMinutes:20,autoIgnoreMusic:true});
        await chrome.storage.local.remove(['cutAllowV1','cutIgnoreV1']);
      });
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-btn')?.textContent.includes('short'));
      assert.equal(await page.locator('#yqn-markers').count(),0);
      await page.getByRole('button',{name:'Ignored',exact:true}).click();
      await page.locator('#yqn-markers').waitFor();
      await page.reload();
      await page.locator('#yqn-markers').waitFor();
      assert.ok(!(await page.locator('#yqn-cut-btn').innerText()).includes('short'));
    });
    const ready = async () => {
      await page.waitForFunction(()=>/Auto-Cut · \d/.test(document.querySelector('#yqn-cut-btn')?.textContent || ''));
      if (!await page.locator('#yqn-cut-panel').count()) await page.locator('#yqn-cut-btn').click();
      await page.waitForFunction(()=>document.querySelector('.yqn-cp-retry')?.disabled===false);
    };
    const row = reason => page.locator('.yqn-cp-row').filter({hasText:reason});
    const navigate = async id => {
      await page.evaluate(id=>{
        document.querySelector('video').pause();
        window.dispatchEvent(new Event('yt-navigate-start'));
        document.querySelector('video').currentTime=0;
        history.pushState({},'', '/watch?v='+id);
        window.dispatchEvent(new Event('yt-navigate-finish'));
      },id);
    };
    await t.test('per-section edits apply immediately, persist on reload and restore automatically',async()=>{
      await worker.evaluate(async()=>{
        await chrome.storage.local.clear();
        await chrome.storage.sync.set({autoCut:true,cutPreset:'custom',cutMessaging:true,cutBoring:false,
          autoCutPlus:false,speedOnly:false,speedRate:3,aiHighlights:false,jevCuts:false,minCutMinutes:0,autoIgnoreMusic:false});
      });
      await page.goto('https://www.youtube.com/watch?v=videoAAAAAA');
      await ready();
      const before=await worker.evaluate(()=>self.calls.length);
      await row('sponsor').locator('select').selectOption('keep');
      await page.waitForFunction(()=>[...document.querySelectorAll('.yqn-cp-row')].some(r=>r.textContent.includes('sponsor')&&r.querySelector('.yqn-cp-badge').textContent==='Keep'));
      assert.match(await page.locator('#yqn-cut-btn').textContent(),/Auto-Cut · 2/);
      assert.equal(await page.locator('#yqn-markers .yqn-marker').count(),2);
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),25);
      assert.equal(await worker.evaluate(()=>self.calls.length),before,'Editing does not reanalyse');
      await page.reload(); await ready();
      assert.equal(await row('sponsor').locator('select').inputValue(),'keep');
      await row('sponsor').locator('select').focus();
      await row('sponsor').locator('select').selectOption('speed');
      await page.waitForFunction(()=>document.activeElement?.className==='yqn-section-action');
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===3);
      await row('sponsor').locator('select').selectOption('skip');
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      await row('sponsor').locator('select').selectOption('default');
      await page.waitForFunction(()=>!document.querySelector('.yqn-reset-edits'));
      assert.equal(await row('sponsor').locator('.yqn-cp-badge').textContent(),'Skip');
      await row('filler').locator('select').selectOption('keep');
      await page.getByRole('button',{name:'Reset my cut changes'}).click();
      await page.waitForFunction(()=>!document.querySelector('.yqn-reset-edits'));
      assert.equal(await row('filler').locator('select').inputValue(),'default');
      for (const reason of ['intro','sponsor','filler']) await row(reason).locator('select').selectOption('keep');
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-btn').textContent.includes('· 0'));
      assert.equal(await page.locator('#yqn-markers').count(),0);
      assert.equal(await page.locator('.yqn-section-action').count(),3,'Kept sections remain editable');
      await page.getByRole('button',{name:'Reset my cut changes'}).click();
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-btn').textContent.includes('· 3'));
    });
    await t.test('all presets drive playback without enabling paid providers',async()=>{
      await page.locator('#yqn-preset-select').selectOption('sponsors'); await ready();
      assert.equal(await row('intro').locator('.yqn-cp-badge').textContent(),'Keep');
      assert.equal(await row('filler').locator('.yqn-cp-badge').textContent(),'Keep');
      assert.equal(await row('sponsor').locator('.yqn-cp-badge').textContent(),'Skip');
      await page.locator('#yqn-preset-select').selectOption('gentle'); await ready();
      assert.equal(await row('intro').locator('.yqn-cp-badge').textContent(),'Speed');
      await page.evaluate(()=>document.querySelector('video').currentTime=12);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===2);
      await page.locator('#yqn-preset-select').selectOption('quick'); await ready();
      assert.equal(await row('intro').locator('.yqn-cp-badge').textContent(),'Skip');
      await page.evaluate(()=>document.querySelector('video').currentTime=65);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===3);
      await page.locator('#yqn-preset-select').selectOption('tldr'); await ready();
      assert.equal(await row('filler').locator('.yqn-cp-badge').textContent(),'Skip');
      await page.evaluate(()=>document.querySelector('video').currentTime=65);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=90);
      assert.deepEqual(await worker.evaluate(()=>chrome.storage.sync.get(['aiHighlights','jevCuts'])),{aiHighlights:false,jevCuts:false});
    });
    await t.test('undo replays a sponsor once and actual savings exclude pauses and refunded skips',async()=>{
      await page.locator('#yqn-preset-select').selectOption('gentle'); await ready();
      await page.reload(); await ready();
      assert.match(await page.locator('.yqn-live-detail').textContent(),/^0:00 saved this viewing.*Next:.*intro/);
      await page.evaluate(async()=>{const v=document.querySelector('video');v.currentTime=18;await v.play();});
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      await page.evaluate(()=>document.querySelector('video').pause());
      assert.match(await page.locator('.yqn-live-detail').textContent(),/^0:3\d saved/);
      await page.getByRole('button',{name:'↶ Watch last skip'}).click();
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),20);
      assert.equal(await page.evaluate(()=>document.querySelector('video').playbackRate),1);
      assert.match(await page.locator('.yqn-live-state').textContent(),/Watching skipped/);
      assert.match(await page.locator('.yqn-live-detail').textContent(),/^0:0\d saved/);
      await page.evaluate(()=>document.querySelector('video').play());
      await page.waitForFunction(()=>document.querySelector('video').currentTime>20.5);
      assert.ok(await page.evaluate(()=>document.querySelector('video').currentTime<23),'Replay does not skip itself');
      await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=55;});
      await page.waitForFunction(()=>document.querySelector('.yqn-live-state').textContent==='Paused');
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      const pausedTotal=await page.locator('.yqn-live-detail').textContent();
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.yqn-live-detail').textContent(),pausedTotal);
      assert.match(pausedTotal,/^0:0\d saved/,'Seeking while paused does not earn saved time');
      await page.evaluate(async()=>{const v=document.querySelector('video');v.currentTime=60;await v.play();});
      await page.waitForFunction(()=>document.querySelector('.yqn-live-state').textContent.includes('Speeding through'));
      await page.waitForTimeout(2300);
      await page.evaluate(()=>document.querySelector('video').pause());
      assert.ok(Number((await page.locator('.yqn-live-detail').textContent()).match(/^0:(\d+)/)[1])>=2,'Actual sped playback earns savings');
    });
    await t.test('channel rules use channel IDs and survive navigation while popup changes defaults',async()=>{
      await ready();
      await page.locator('#yqn-preset-select').selectOption('sponsors'); await ready();
      await page.getByRole('button',{name:'Remember for this channel'}).click();
      await page.getByRole('button',{name:'Use defaults',exact:true}).waitFor();
      const popup=await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await popup.locator('#cutPreset').selectOption('gentle');
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#yqn-preset-select').inputValue(),'sponsors');
      await navigate('videoCCCCCC'); await ready();
      assert.equal(await page.locator('#yqn-preset-select').inputValue(),'sponsors','Same channel retains rule');
      assert.match(await page.locator('.yqn-live-detail').textContent(),/^0:00 saved/,'Navigation resets viewing total');
      await navigate('videoBBBBBB'); await ready();
      assert.equal(await page.locator('#yqn-preset-select').inputValue(),'gentle','Same display name with another ID uses defaults');
      await page.getByRole('button',{name:'Off for this channel',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.yqn-live-state')?.textContent.includes('off for this channel'));
      assert.equal(await page.locator('#yqn-markers').count(),0);
      await page.reload();
      await page.waitForFunction(()=>document.querySelector('.yqn-live-state')?.textContent.includes('off for this channel'));
      await page.locator('#yqn-cut-btn').click();
      await page.getByRole('button',{name:'Use defaults',exact:true}).click(); await ready();
      assert.equal(await page.locator('#yqn-preset-select').inputValue(),'gentle');
      await navigate('videoAAAAAA'); await ready();
      await popup.locator('#autoCut').uncheck();
      await page.waitForFunction(()=>document.querySelector('.yqn-live-state')?.textContent==='Auto-Cut off');
      assert.equal(await page.locator('#yqn-markers').count(),0,'Global off overrides remembered channel on');
      await popup.locator('#autoCut').check(); await ready();
      assert.equal(await page.locator('#yqn-preset-select').inputValue(),'sponsors');
      await page.getByRole('button',{name:'Use defaults',exact:true}).click(); await ready();
      assert.equal(await page.locator('#yqn-preset-select').inputValue(),'gentle');
      await popup.close();
    });
    await t.test('new controls fit desktop and narrow windows',async()=>{
      await page.screenshot({path:path.join(root,'tests','features-desktop.png')});
      await page.setViewportSize({width:390,height:844});
      await page.locator('#yqn-cut-btn').click();
      await page.locator('#yqn-cut-btn').click();
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#yqn-cut-panel').evaluate(el=>{
        const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;
      }),true);
      assert.equal(await page.locator('#yqn-cut-panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'No horizontal panel overflow');
      await row('sponsor').locator('select').selectOption('keep');
      await page.screenshot({path:path.join(root,'tests','features-mobile.png')});
    });
    await t.test('Thorough mode preserves provider switches and explains missing Claude setup',async()=>{
      await page.setViewportSize({width:1280,height:900});
      await worker.evaluate(async()=>{
        await chrome.storage.local.clear();self.aiMode='ok';
        await chrome.storage.sync.set({thoroughAnalysis:false,learnCorrections:true,autoCut:true,
          cutPreset:'custom',cutMessaging:true,cutBoring:true,autoCutPlus:false,speedOnly:false,speedRate:3,
          aiHighlights:false,jevCuts:false,minCutMinutes:0,autoIgnoreMusic:false});
      });
      await page.goto('https://www.youtube.com/watch?v=videoAAAAAA');await ready();
      const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await popup.locator('#thoroughAnalysis').check();
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-panel')?.textContent.includes('Enable AI highlights'));
      assert.equal(await popup.locator('#aiHighlights').isChecked(),false);
      assert.equal(await page.locator('#yqn-thorough-analysis').isChecked(),true);
      assert.equal(thoroughRequests.length,0);
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      await popup.close();
    });
    await t.test('Thorough review publishes sponsors early, checks every section and preserves useful content',async()=>{
      thoroughDelay=400;
      await worker.evaluate(()=>chrome.storage.sync.set({aiHighlights:true,anthropicKey:'fixture-key'}));
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-panel')?.textContent.includes('Reading section'));
      assert.equal(await page.locator('.yqn-cp-retry').isDisabled(),true);
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      await ready();thoroughDelay=0;
      assert.match(await page.locator('.yqn-cp-coverage').textContent(),/60\/60 caption lines checked.*2\/2/);
      assert.equal(thoroughRequests.length,4);
      assert.equal(thoroughRequests.filter(r=>r.review).length,2);
      assert.ok(thoroughRequests.find(r=>r.review&&r.input.coreFirst===0).input.lines.some(l=>l.id>=30),'Review includes overlapping context');
      await page.evaluate(()=>document.querySelector('video').currentTime=65);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(()=>document.querySelector('video').playbackRate),1,'Reviewed demo overrides low-engagement speed');
      await page.evaluate(()=>document.querySelector('video').currentTime=125);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),125,'Independent product review is kept');
      await page.evaluate(()=>document.querySelector('video').currentTime=155);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===3);
      await page.evaluate(async()=>{const v=document.querySelector('video');v.currentTime=279.6;await v.play();});
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=310);
      await page.evaluate(()=>document.querySelector('video').pause());
      await page.getByRole('button',{name:'↶ Watch last skip'}).click();
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),280);
      await ready();
      const before=thoroughRequests.length;
      await page.reload();await ready();
      assert.equal(thoroughRequests.length,before,'Complete Thorough plan comes from cache');
      await page.getByRole('button',{name:/Show kept sections/}).click();
      assert.ok(await page.locator('.yqn-cp-row').filter({hasText:'Useful demonstration'}).count());
      assert.ok(await page.locator('#yqn-markers .yqn-chap-tick').count());
      assert.match(await page.locator('#yqn-cut-panel').textContent(),/Acme tool/);
      assert.match(await page.locator('#yqn-topics-btn').textContent(),/Topics · 2/);
      assert.ok(await page.locator('#yqn-markers .yqn-marker-speed').count(),'Verified repetitions have amber speed markers');
      await page.locator('#yqn-cut-panel').evaluate(el=>el.scrollTop=0);
      await page.screenshot({path:path.join(root,'tests','thorough-desktop.png')});
      await page.getByRole('button',{name:'Hide kept sections'}).click();
    });
    await t.test('partial Thorough failures keep unreviewed content, preserve sponsor cuts and retry',async()=>{
      thoroughMode='partial';await page.getByRole('button',{name:'↻ Re-analyse'}).click();await ready();
      assert.match(await page.locator('#yqn-cut-panel').textContent(),/Thorough analysis incomplete.*503/);
      assert.match(await page.locator('.yqn-cp-coverage').textContent(),/30\/60 caption lines/);
      await page.evaluate(()=>document.querySelector('video').currentTime=305);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),305,'Unreviewed tail is kept');
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      const before=thoroughRequests.length;
      await page.reload();await ready();
      assert.ok(thoroughRequests.length>before,'Partial analysis is not cached as complete');
      thoroughMode='ok';await page.getByRole('button',{name:'↻ Re-analyse'}).click();await ready();
      assert.match(await page.locator('.yqn-cp-coverage').textContent(),/60\/60/);
      assert.ok(!(await page.locator('#yqn-cut-panel').textContent()).includes('Thorough analysis incomplete'));
    });
    await t.test('turning off during Thorough analysis cancels follow-up requests and clears markers',async()=>{
      thoroughDelay=900;const before=thoroughRequests.length;
      await page.getByRole('button',{name:'↻ Re-analyse'}).click();
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-panel')?.textContent.includes('Reading section'));
      await page.waitForTimeout(100);
      assert.match(await page.locator('#yqn-cut-btn').textContent(),/checking/);
      assert.match(await page.locator('#yqn-cut-btn').getAttribute('title'),/Analysis in progress/);
      assert.ok(!(await page.locator('#yqn-toast').textContent()).includes('AI found no clear'));
      await worker.evaluate(()=>chrome.storage.sync.set({autoCut:false}));
      await page.waitForFunction(()=>document.querySelector('.yqn-live-state')?.textContent==='Auto-Cut off');
      await page.waitForTimeout(1100);
      assert.equal(thoroughRequests.length,before+2,'Only the two already-started drafts; no verification or later request after cancellation');
      assert.equal(await page.locator('#yqn-markers').count(),0);
      thoroughDelay=0;
      await worker.evaluate(()=>chrome.storage.sync.set({autoCut:true}));await ready();
    });
    await t.test('truncated AI output cannot become a complete Thorough plan',async()=>{
      thoroughMode='truncated';await page.getByRole('button',{name:'↻ Re-analyse'}).click();await ready();
      assert.match(await page.locator('#yqn-cut-panel').textContent(),/Thorough analysis incomplete.*max_tokens/);
      assert.match(await page.locator('.yqn-cp-coverage').textContent(),/0\/60 caption lines/);
      assert.match(await page.locator('#yqn-toast').textContent(),/Analysis incomplete/);
      assert.ok(!(await page.locator('#yqn-toast').textContent()).includes('AI found no clear'));
      await page.evaluate(()=>document.querySelector('video').currentTime=285);
      await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),285);
      thoroughMode='ok';
    });
    await t.test('corrections across three videos create an opt-in channel suggestion with reset',async()=>{
      await worker.evaluate(async()=>{
        await chrome.storage.local.clear();await chrome.storage.sync.set({thoroughAnalysis:false,aiHighlights:false,jevCuts:false,cutBoring:false,learnCorrections:true});
      });
      await page.goto('https://www.youtube.com/watch?v=videoAAAAAA');await ready();
      for (const id of ['videoAAAAAA','videoCCCCCC','videoDDDDDD']) {
        if (!page.url().includes(id)) {await navigate(id);await ready();}
        await row('intro').locator('select').selectOption('keep');
        await page.waitForTimeout(150);
      }
      await page.getByRole('button',{name:'Apply keep for intro (3 videos)'}).waitFor();
      assert.equal((await worker.evaluate(()=>chrome.storage.local.get('yqnLearningV1:UCfixtureA')))['yqnLearningV1:UCfixtureA'].approved,undefined);
      await page.getByRole('button',{name:'Apply keep for intro (3 videos)'}).click();
      await page.waitForFunction(()=>document.querySelector('.yqn-channel-learning')?.textContent.includes('Applied: keep intro'));
      await worker.evaluate(()=>chrome.storage.local.remove('yqnCutEditsV1:videoAAAAAA'));
      await navigate('videoAAAAAA');await ready();
      assert.match(await row('intro').textContent(),/Your channel rule: keep intro/);
      assert.equal(await row('intro').locator('.yqn-cp-badge').textContent(),'Keep');
      await row('intro').locator('select').selectOption('skip');
      assert.equal(await row('intro').locator('.yqn-cp-badge').textContent(),'Skip','Per-video edits override the learned rule');
      await row('intro').locator('select').selectOption('default');
      await page.getByRole('button',{name:'Reset learning for this channel'}).click();
      await page.waitForFunction(()=>!document.querySelector('.yqn-learning-reset'));
      assert.equal(await row('intro').locator('.yqn-cp-badge').textContent(),'Skip');
      await navigate('videoBBBBBB');await ready();
      assert.ok(!(await page.locator('#yqn-cut-panel').textContent()).includes('Applied: keep intro'));
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(root,'tests','thorough-mobile.png')});
      assert.equal(await page.locator('#yqn-cut-panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    });

    await t.test('review mode shows proposals but blocks skip and speed until explicit approval',async()=>{
      await page.setViewportSize({width:1280,height:900});
      await worker.evaluate(async()=>{await chrome.storage.local.clear();await chrome.storage.sync.set({autoCut:true,cutPreset:'custom',reviewBeforeApply:true,aiHighlights:false,jevCuts:false,thoroughAnalysis:false,cutMessaging:true,cutBoring:false,speedOnly:false,aiDailyBudget:0,aiVideoBudget:0});});
      await page.goto('https://www.youtube.com/watch?v=videoAAAAAA');await ready();
      await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=25;v.playbackRate=1.5;});
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),25);
      assert.equal(await page.locator('#yqn-markers .yqn-marker-proposed').count(),3);
      assert.match(await page.locator('.yqn-cp-sum').textContent(),/3 proposed cuts/);
      assert.match(await page.locator('#yqn-toast').textContent(),/3 proposed cuts/);
      await page.getByRole('button',{name:'Approve these cuts'}).click();
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      await page.evaluate(()=>document.querySelector('video').currentTime=65);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===3);
      await row('intro').locator('select').selectOption('keep');
      await page.getByRole('button',{name:'Approve these cuts'}).waitFor();
      assert.equal(await page.evaluate(()=>document.querySelector('video').playbackRate),1.5);
      await page.getByRole('button',{name:'Approve these cuts'}).click();
      await page.reload();await ready();await page.getByRole('button',{name:'Approve these cuts'}).waitFor();
      await page.screenshot({path:path.join(root,'tests','review-before-apply.png')});
    });
    const tools=()=>page.locator('#yqn-tools');
    await t.test('missed sponsor marking previews without skips, saves locally and survives reload',async()=>{
      await worker.evaluate(()=>chrome.storage.sync.set({reviewBeforeApply:false}));
      await page.locator('#yqn-tools-btn').click();
      await tools().getByLabel('Start (seconds or mm:ss)',{exact:true}).fill('20');
      await tools().getByLabel('End (seconds or mm:ss)',{exact:true}).fill('20.6');
      await tools().getByRole('button',{name:'Preview range',exact:true}).click();
      await page.waitForFunction(()=>{const v=document.querySelector('video');return v.paused&&Math.abs(v.currentTime-20.6)<0.1;});
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),20.6,'Preview end remains paused inside a known sponsor');
      await tools().getByRole('button',{name:'Stop preview',exact:true}).click();
      await tools().getByLabel('Start (seconds or mm:ss)',{exact:true}).fill('2:00');
      await tools().getByLabel('End (seconds or mm:ss)',{exact:true}).fill('2:20');
      await tools().getByRole('button',{name:'Save sponsor skip',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.yqn-tools-status').textContent.includes('saved on this device'));
      await page.evaluate(()=>document.querySelector('video').currentTime=125);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=140);
      await page.reload();await ready();
      await page.evaluate(()=>document.querySelector('video').currentTime=125);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=140);
      await page.locator('#yqn-tools-btn').click();
      await tools().getByLabel('Start (seconds or mm:ss)',{exact:true}).fill('120');
      await tools().getByLabel('End (seconds or mm:ss)',{exact:true}).fill('140');
      await tools().getByRole('button',{name:'Remove saved override',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.yqn-tools-status').textContent.includes('override removed'));
      await page.evaluate(()=>document.querySelector('video').currentTime=125);await page.waitForTimeout(300);
      assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),125);
    });
    await t.test('timestamped notes can be created, edited, exported and deleted after reload',async()=>{
      await tools().getByRole('button',{name:'Notes',exact:true}).click();
      await tools().getByLabel('Note (optional)',{exact:true}).fill('Useful <b>literal</b> demo');
      await tools().getByRole('button',{name:'Bookmark current time',exact:true}).click();
      await tools().locator('.yqn-note').waitFor();assert.equal(await tools().locator('b').count(),0);
      const exportEvent=page.waitForEvent('download');await tools().getByRole('button',{name:'Export notes (.md)',exact:true}).click();
      const download=await exportEvent,downloadPath=await download.path();
      const exported=await fs.readFile(downloadPath,'utf8');assert.match(exported,/&t=125s/);assert.match(exported,/Useful/);
      await page.reload();await ready();await page.locator('#yqn-tools-btn').click();await tools().getByRole('button',{name:'Notes',exact:true}).click();
      await tools().locator('.yqn-note textarea').waitFor();assert.equal(await tools().locator('.yqn-note textarea').inputValue(),'Useful <b>literal</b> demo');
      await tools().locator('.yqn-note textarea').fill('Changed note');await tools().getByRole('button',{name:'Save note',exact:true}).click();
      await page.waitForTimeout(100);
      const data=await worker.evaluate(()=>chrome.storage.local.get('yqnNotesV1:videoAAAAAA'));assert.equal(data['yqnNotesV1:videoAAAAAA'][0].text,'Changed note');
      await tools().getByRole('button',{name:'Delete note',exact:true}).click();await tools().getByText('No bookmarks yet.',{exact:true}).waitFor();
    });
    await t.test('video questions use real caption IDs and refuse missing or fabricated evidence',async()=>{
      await worker.evaluate(()=>chrome.storage.sync.set({anthropicKey:'fixture-secret-key'}));
      await tools().getByRole('button',{name:'Ask video',exact:true}).click();
      await tools().getByLabel('Question',{exact:true}).fill('What sponsor discount is mentioned?');
      await tools().getByRole('button',{name:'Ask this video',exact:true}).click();
      await tools().locator('.yqn-tools-answer button').waitFor();
      assert.match(await tools().locator('.yqn-tools-answer').textContent(),/Acme sponsor discount/);
      await tools().locator('.yqn-tools-answer button').first().click();await page.waitForTimeout(100);
      const time=await page.evaluate(()=>document.querySelector('video').currentTime);assert.ok(time>=20&&time<23,'Citation bypasses the overlapping sponsor');
      await page.evaluate(()=>document.querySelector('video').pause());
      questionMode='missing';await tools().getByRole('button',{name:'Ask this video',exact:true}).click();
      await tools().getByText('This is not covered in the available transcript.',{exact:true}).waitFor();
      questionMode='invalid';await tools().getByRole('button',{name:'Ask this video',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('#yqn-tools button:disabled'));
      assert.equal(await tools().locator('.yqn-tools-answer button').count(),0);
      questionMode='ok';
    });
    await t.test('diagnostic copy excludes credentials and explains the current playback state',async()=>{
      await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://www.youtube.com'});
      await tools().getByRole('button',{name:'Diagnostics',exact:true}).click();
      await tools().getByRole('button',{name:'Why wasn’t this skipped?',exact:true}).click();
      const report=await tools().locator('pre').textContent();assert.match(report,/replayed at normal speed/);assert.ok(!report.includes('fixture-secret-key'));
      await tools().getByRole('button',{name:'Copy diagnostic report',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.yqn-tools-status').textContent==='Diagnostic report copied.');
      assert.deepEqual(JSON.parse(await page.evaluate(()=>navigator.clipboard.readText())),JSON.parse(report));
      await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'tests','video-tools-mobile.png')});
      assert.equal(await tools().evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      await page.setViewportSize({width:1280,height:900});
    });
    await t.test('budget blocks paid questions before dispatch and popup changes let them resume',async()=>{
      const before=questionRequests;
      const popup=await context.newPage();await popup.goto('chrome-extension://'+extensionId+'/popup.html');
      await popup.locator('details').evaluate(el=>el.open=true);
      await popup.locator('#aiDailyBudget').fill('0.000001');await popup.locator('#aiDailyBudget').dispatchEvent('change');
      await page.bringToFront();await tools().getByRole('button',{name:'Ask video',exact:true}).click();
      await tools().getByRole('button',{name:'Ask this video',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.yqn-tools-status').textContent.includes('budget reached'));
      assert.equal(questionRequests,before);
      await popup.locator('#aiDailyBudget').fill('0');await popup.locator('#aiDailyBudget').dispatchEvent('change');
      await page.bringToFront();await tools().getByRole('button',{name:'Ask this video',exact:true}).click();
      await tools().locator('.yqn-tools-answer button').waitFor();assert.equal(questionRequests,before+1);
      await tools().getByRole('button',{name:'AI usage',exact:true}).click();await tools().getByRole('button',{name:'Refresh usage',exact:true}).click();
      await tools().getByText(/Reported tokens today: 520/).waitFor();
      await page.screenshot({path:path.join(root,'tests','video-tools-desktop.png')});await popup.close();
      await navigate('videoBBBBBB');await ready();assert.equal(await page.locator('#yqn-tools').count(),0,'Navigation closes the old video drawer');
    });

    await t.test('Thorough analysis stops new provider passes at the shared budget and reports incomplete coverage',async()=>{
      await worker.evaluate(async()=>{await chrome.storage.local.clear();await chrome.storage.sync.set({aiDailyBudget:0.008,aiVideoBudget:0,aiModel:'claude-haiku-5-5',aiHighlights:true,thoroughAnalysis:true,reviewBeforeApply:true});});
      const before=thoroughRequests.length;
      await page.goto('https://www.youtube.com/watch?v=videoAAAAAA');await ready();
      assert.equal(thoroughRequests.length,before+1,'Only one paid pass fits the conservative reservation');
      assert.match(await page.locator('#yqn-cut-panel').textContent(),/budget reached/);
      assert.match(await page.locator('.yqn-cp-coverage').textContent(),/0\/60/);
      await page.evaluate(()=>document.querySelector('video').currentTime=25);await page.waitForTimeout(300);
      assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),25,'Early community proposals also wait for approval');
      await page.getByRole('button',{name:'Approve these cuts'}).click();await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      await worker.evaluate(()=>chrome.storage.sync.set({aiDailyBudget:0,aiHighlights:false,thoroughAnalysis:false,reviewBeforeApply:false}));await ready();
    });
    await t.test('navigation cancels an in-flight video question and discards its old answer',async()=>{
      await page.locator('#yqn-tools-btn').click();await tools().getByRole('button',{name:'Ask video',exact:true}).click();
      await tools().getByLabel('Question',{exact:true}).fill('What sponsor is mentioned?');
      questionMode='slow';const before=questionRequests;
      await tools().getByRole('button',{name:'Ask this video',exact:true}).click();
      for(let i=0;i<100&&questionRequests===before;i++)await page.waitForTimeout(50);
      assert.equal(questionRequests,before+1);
      await navigate('videoBBBBBB');await ready();await page.waitForTimeout(900);
      assert.equal(await page.locator('#yqn-tools').count(),0);
      await page.locator('#yqn-tools-btn').click();await tools().getByRole('button',{name:'Ask video',exact:true}).click();
      assert.equal(await tools().locator('.yqn-tools-answer').textContent(),'');
      questionMode='ok';
    });

    await t.test('chapter headings are never analysed as spoken captions',async()=>{
      fallbackTranscript=true;thoroughMode='ok';
      await worker.evaluate(async()=>{await chrome.storage.local.clear();self.providerMode='none';await chrome.storage.sync.set({aiHighlights:false,thoroughAnalysis:true,jevCuts:false,cutBoring:false,cutMessaging:true,reviewBeforeApply:false,aiDailyBudget:0});});
      await page.goto('https://www.youtube.com/watch?v=videoDDDDDD');await ready();
      await page.evaluate(()=>{
        const panel=document.createElement('ytd-engagement-panel-section-list-renderer');panel.id='fixture-transcript-panel';
        panel.innerHTML=['Intro','App Interface','Video settings','Audio settings','Features','Live TV','Conclusion'].map((title,i)=>'<ytd-macro-markers-list-item-renderer><div><h3>'+title+'</h3><h3 hidden>'+title+'</h3><div>'+i+':00</div></div></ytd-macro-markers-list-item-renderer>').join('');
        const unknown=document.createElement('div');unknown.innerHTML='<span>0:30</span><span>Not caption text</span>';panel.append(unknown);document.body.append(panel);
      });
      const before=thoroughRequests.length;
      await worker.evaluate(()=>chrome.storage.sync.set({aiHighlights:true,anthropicKey:'fixture-key'}));
      await page.waitForFunction(()=>document.querySelector('#yqn-cut-btn')?.textContent.includes('checking') || document.querySelector('.yqn-cp-retry')?.disabled);
      await ready();
      assert.equal(thoroughRequests.length,before,'No paid call should receive chapter headings');
      assert.match(await page.locator('#yqn-cut-panel').textContent(),/No usable transcript|Transcript unavailable/);
      assert.match(await page.locator('#yqn-toast').textContent(),/Analysis incomplete/);
    });
    await t.test('modern transcript fallback reads speech, excludes time labels and closes its panel',async()=>{
      const before=thoroughRequests.length;
      await page.evaluate(()=>{
        const show=document.createElement('button');show.textContent='Show transcript';show.id='fixture-show-transcript';
        show.onclick=()=>{
          let panel=document.getElementById('fixture-transcript-panel');
          if(!panel){panel=document.createElement('ytd-engagement-panel-section-list-renderer');panel.id='fixture-transcript-panel';document.body.append(panel);}
          panel.innerHTML='<button aria-label="Close transcript">Close</button>';
          panel.querySelector('button').onclick=()=>panel.remove();
          for(let i=0;i<60;i++){
            const row=document.createElement('transcript-segment-view-model');row.className='ytwTranscriptSegmentViewModelHost';
            const stamp=Math.floor(i/6)+':'+String((i%6)*10).padStart(2,'0');
            const text=[2,3,4,28,29,30].includes(i)?'This video is sponsored by Acme. Use our discount code today.':i===1?'Welcome to the channel. Here is our usual introduction.':i===15?'We repeat the exact explanation from earlier without any new detail.':'Here is a useful demonstration and explanation of the process '+i;
            row.innerHTML='<div aria-hidden="true">'+stamp+'</div><div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">'+(i*10)+' seconds</div><span role="text"></span>';row.querySelector('[role="text"]').textContent=text;panel.append(row);
          }
        };
        document.body.append(show);
      });
      await page.getByRole('button',{name:'↻ Re-analyse'}).click();await ready();
      assert.equal(thoroughRequests.length,before+4);
      const lines=thoroughRequests.slice(before).flatMap(r=>r.input.lines);
      assert.ok(lines.some(l=>l.text.includes('sponsored by Acme')));
      assert.ok(lines.every(l=>!/^\d+ seconds/.test(l.text) && !l.text.includes('Intro Intro') && l.text!=='Not caption text'));
      assert.equal(await page.locator('#fixture-transcript-panel').count(),0);
      assert.match(await page.locator('.yqn-cp-coverage').first().textContent(),/60\/60 caption lines/);
      assert.ok(await page.locator('#yqn-markers .yqn-marker-skip').count());
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=28 && document.querySelector('video').currentTime<30);
      fallbackTranscript=false;
    });
    await t.test('verification failures are visible in the cut panel and safe diagnostic report',async()=>{
      thoroughMode='quoteMismatch';await page.getByRole('button',{name:'↻ Re-analyse'}).click();await ready();
      assert.match(await page.locator('#yqn-toast').textContent(),/did not pass verification/);
      assert.match(await page.locator('.yqn-cp-audit').textContent(),/quote mismatches/);
      await page.locator('#yqn-tools-btn').click();await tools().getByRole('button',{name:'Diagnostics',exact:true}).click();
      await tools().getByRole('button',{name:'Why wasn’t this skipped?',exact:true}).click();
      const report=JSON.parse(await tools().locator('pre').textContent());assert.ok(report.analysis.quoteMismatch>0);assert.equal(report.analysis.acceptedCut,0);
      assert.ok(!JSON.stringify(report).includes('fixture-key'));thoroughMode='ok';
    });
    await t.test('native app topics work with Auto-Cut and AI off, including previous, next and direct jumps',async()=>{
      fallbackTranscript=false;nativeTopicFixture=true;thoroughMode='ok';
      await worker.evaluate(async()=>{await chrome.storage.local.clear();await chrome.storage.sync.set({autoCut:false,aiHighlights:false,jevCuts:false});});
      const before=thoroughRequests.length;
      await page.goto('https://www.youtube.com/watch?v=videoDDDDDD');
      await page.waitForFunction(()=>document.querySelector('#yqn-topics-btn')?.textContent==='Topics · 4');
      await page.locator('#yqn-topics-btn').click();
      assert.equal(await tools().locator('.yqn-topic-list button').count(),4);
      assert.match(await tools().getByRole('region',{name:'Topics'}).textContent(),/Auto-Cut is off/);
      await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=107;});
      await tools().getByRole('button',{name:'Next topic',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=113&&document.querySelector('video').currentTime<115);
      await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=125;});
      await tools().getByRole('button',{name:'Previous topic',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=113&&document.querySelector('video').currentTime<115);
      await tools().getByRole('button',{name:'Previous topic',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=61&&document.querySelector('video').currentTime<63);
      await tools().getByRole('button',{name:'3:00 · Flow',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=180&&document.querySelector('video').currentTime<182);
      await tools().getByRole('button',{name:'Next topic',exact:true}).click();
      assert.match(await page.locator('#yqn-toast').textContent(),/No later chapter/);
      assert.equal(thoroughRequests.length,before);
      assert.equal(await page.locator('#yqn-markers .yqn-marker').count(),0);
      assert.equal(await page.locator('#yqn-markers .yqn-chap-tick').count(),3);
    });
    await t.test('SPA navigation replaces native topics with the new video description and clears stale topics',async()=>{
      await navigate('videoBBBBBB');
      await page.waitForFunction(()=>document.querySelector('#yqn-topics-btn')?.textContent==='Topics · 3');
      await page.locator('#yqn-topics-btn').click();
      assert.match(await tools().locator('.yqn-topic-list').textContent(),/Second video demo/);
      assert.doesNotMatch(await tools().locator('.yqn-topic-list').textContent(),/Snapgate/);
      await tools().getByRole('button',{name:'2:00 · Second video demo',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=120&&document.querySelector('video').currentTime<122);
      await navigate('videoCCCCCC');
      await page.waitForFunction(()=>document.querySelector('#yqn-topics-btn')?.textContent==='Topics');
      await page.locator('#yqn-topics-btn').click();
      assert.equal(await tools().locator('.yqn-topic-list button').count(),0);
      assert.match(await tools().locator('.yqn-topic-list').textContent(),/No topics available/);
    });
    await t.test('native topics are usable during Thorough analysis and remain preferred when it completes',async()=>{
      thoroughDelay=400;
      await worker.evaluate(()=>chrome.storage.sync.set({autoCut:true,aiHighlights:true,thoroughAnalysis:true}));
      await page.goto('https://www.youtube.com/watch?v=videoDDDDDD');
      await page.waitForFunction(()=>document.querySelector('#yqn-topics-btn')?.textContent==='Topics · 4' && /checking|…/.test(document.querySelector('#yqn-cut-btn')?.textContent));
      await page.locator('#yqn-topics-btn').click();
      assert.equal(await tools().locator('.yqn-topic-list button').count(),4);
      assert.match(await tools().getByRole('region',{name:'Topics'}).textContent(),/still checking/);
      await tools().getByRole('button',{name:'Close',exact:true}).click();
      await ready();thoroughDelay=0;
      assert.match(await page.locator('#yqn-topics-btn').textContent(),/Topics · 4/);
      await page.locator('#yqn-topics-btn').click();
      assert.match(await tools().locator('.yqn-topic-list').textContent(),/Snapgate/);
      assert.doesNotMatch(await tools().locator('.yqn-topic-list').textContent(),/Useful demonstrations/);
      await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.playbackRate=1.5;v.currentTime=155;});
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===3);
      await tools().getByRole('button',{name:'Next topic',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=180&&document.querySelector('video').playbackRate===1.5);
      await page.evaluate(()=>document.querySelector('video').pause());
    });
    await t.test('Thorough retains agreed speed-ups with different category labels and medium certainty',async()=>{
      nativeTopicFixture=false;thoroughMode='pacing';
      await worker.evaluate(async()=>{await chrome.storage.local.clear();self.providerMode='ok';await chrome.storage.sync.set({autoCut:true,thoroughAnalysis:true,aiHighlights:true,anthropicKey:'fixture-key',
        autoCutPlus:false,cutPreset:'custom',cutBoring:false,cutMessaging:true,speedOnly:false,speedRate:3,reviewBeforeApply:false,aiDailyBudget:0,aiVideoBudget:0});});
      await page.goto('https://www.youtube.com/watch?v=videoDDDDDD');await ready();
      assert.ok(thoroughRequests.slice(-4).every(r=>r.input.pacing==='balanced'));
      assert.match(await page.locator('.yqn-cp-audit').textContent(),/speed 1\/1 accepted/);
      await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.playbackRate=1.5;v.currentTime=155;});
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===3);
      const marker=page.locator('#yqn-markers .yqn-marker-speed').first();assert.ok(await marker.isVisible());
      assert.equal(await marker.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 179, 0)');
      await page.evaluate(()=>document.querySelector('video').currentTime=165);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===1.5);
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
    });
    await t.test('Quick watch changes both Thorough passes, plays broader speeds and preserves overrides and cached pacing',async()=>{
      const before=thoroughRequests.length;
      await page.locator('#yqn-preset-select').selectOption('quick');await ready();
      assert.equal(thoroughRequests.length,before+4);
      assert.ok(thoroughRequests.slice(before).every(r=>r.input.pacing==='quick' && r.system.includes('QUICK WATCH')));
      assert.match(await page.locator('.yqn-cp-audit').textContent(),/speed 4\/4 accepted/);
      await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.playbackRate=1.5;v.currentTime=175;});
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===3);
      const row=page.locator('.yqn-cp-row[data-start="170"]');
      await row.locator('select').selectOption('keep');
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===1.5);
      const after=thoroughRequests.length;await page.reload();await ready();
      assert.equal(thoroughRequests.length,after,'The complete quick-pacing plan comes from its matching cache');
      await page.evaluate(()=>document.querySelector('video').currentTime=175);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(()=>document.querySelector('video').playbackRate),1,'Saved Keep overrides the cached speed');
      await page.locator('.yqn-cp-row[data-start="170"] select').selectOption('default');
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===3);
      await page.evaluate(()=>document.querySelector('video').currentTime=205);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===1);
      await page.locator('#yqn-tools-btn').click();await tools().getByRole('button',{name:'Diagnostics',exact:true}).click();
      await tools().getByRole('button',{name:'Why wasn’t this skipped?',exact:true}).click();
      const report=JSON.parse(await tools().locator('pre').textContent());assert.equal(report.analysis.acceptedSpeed,4);assert.ok(report.analysis.acceptedSkip>0);
      assert.ok(!JSON.stringify(report).includes('fixture-key'));
      await tools().getByRole('button',{name:'Close',exact:true}).click();
      await ready();await page.locator('#yqn-preset-select').selectOption('gentle');await ready();
      assert.ok(thoroughRequests.slice(-4).every(r=>r.input.pacing==='balanced'),'Leaving Quick watch restores balanced review');
      await page.evaluate(()=>document.querySelector('video').currentTime=155);await page.waitForFunction(()=>document.querySelector('video').playbackRate===2);
      await page.evaluate(()=>document.querySelector('video').currentTime=175);await page.waitForFunction(()=>document.querySelector('video').playbackRate===1);
      thoroughMode='ok';
    });
    await t.test('truncated early reviews recover in smaller sections and publish early speed markers',async()=>{
      thoroughMode='recoverSize';const before=thoroughRequests.length;
      await page.getByRole('button',{name:'↻ Re-analyse'}).click();await ready();
      assert.match(await page.locator('.yqn-cp-coverage').textContent(),/60\/60 caption lines checked.*4\/4 sections processed/);
      assert.doesNotMatch(await page.locator('#yqn-cut-btn').textContent(),/incomplete|checking/);
      assert.equal(thoroughRequests.length,before+12);
      assert.ok(thoroughRequests.slice(before).some(r=>r.input.coreFirst===0&&r.input.coreLast===14));
      await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.playbackRate=1.25;v.currentTime=155;});
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===2);
      assert.ok(await page.locator('#yqn-markers .yqn-marker-speed').count());
      await page.evaluate(()=>document.querySelector('video').currentTime=165);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===1.25);
      const after=thoroughRequests.length;await page.reload();await ready();assert.equal(thoroughRequests.length,after,'Recovered complete plan is cached');
      await page.locator('#yqn-tools-btn').click();await tools().getByRole('button',{name:'Diagnostics',exact:true}).click();
      await tools().getByRole('button',{name:'Why wasn’t this skipped?',exact:true}).click();
      const report=JSON.parse(await tools().locator('pre').textContent());assert.deepEqual(report.coverage,{checked:60,total:60,recoveries:2});assert.deepEqual(report.failedSections,[]);
      await tools().getByRole('button',{name:'Close',exact:true}).click();thoroughMode='ok';
    });
    await t.test('per-channel normal speed, SponsorBlock submission, hotkeys and cross-video All notes work end to end',async()=>{
      await worker.evaluate(async()=>{
        await chrome.storage.local.clear();
        self.sbSubmissions=[];
        await chrome.storage.sync.set({autoCut:true,cutPreset:'custom',cutMessaging:true,cutBoring:false,
          aiHighlights:false,thoroughAnalysis:false,jevCuts:false,speedOnly:false,speedRate:3,shortcutsEnabled:true,anthropicKey:'fixture-secret-key'});
      });
      await page.goto('https://www.youtube.com/watch?v=videoAAAAAA');await ready();
      await page.locator('#yqn-channel-speed').selectOption('1.5');
      assert.equal(await page.evaluate(()=>document.querySelector('video').playbackRate),1.5);
      await page.evaluate(()=>document.querySelector('video').currentTime=65);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===3);
      await page.evaluate(()=>document.querySelector('video').currentTime=100);
      await page.waitForFunction(()=>document.querySelector('video').playbackRate===1.5);

      // Navigate to another channel (UCfixtureB) -> resets to 1x, quick bookmark with Shift+B at 1:45 (105s, outside cuts).
      await navigate('videoBBBBBB');await ready();
      assert.equal(await page.locator('#yqn-channel-speed').inputValue(),'0');
      assert.equal(await page.evaluate(()=>document.querySelector('video').playbackRate),1);
      await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=105;});
      await page.locator('#yqn-cut-btn').click(); // close cut panel so body receives focus cleanly
      await page.keyboard.press('Shift+KeyB');
      await page.waitForFunction(()=>document.querySelector('#yqn-toast')?.textContent.includes('Bookmarked 1:45'));

      // Navigate back to UCfixtureA -> 1.5x channel normal speed automatically re-applies.
      await navigate('videoAAAAAA');await ready();
      assert.equal(await page.evaluate(()=>document.querySelector('video').playbackRate),1.5);

      // Test Shift+Z undo-last-skip hotkey after sponsor skip.
      await page.locator('#yqn-cut-btn').click();
      await page.evaluate(()=>document.querySelector('video').currentTime=25);
      await page.waitForFunction(()=>document.querySelector('video').currentTime>=50);
      await page.keyboard.press('Shift+KeyZ');
      await page.waitForFunction(()=>{const t=document.querySelector('video').currentTime;return t>=10&&t<26;});

      // Bookmark on videoAAAAAA via Shift+B, submit missed sponsor to SponsorBlock, and search All notes.
      await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=95;});
      await page.keyboard.press('Shift+KeyB');
      await page.waitForFunction(()=>document.querySelector('#yqn-toast')?.textContent.includes('Bookmarked 1:35'));

      await page.locator('#yqn-tools-btn').click();
      await tools().getByLabel('Start (seconds or mm:ss)',{exact:true}).fill('3:00');
      await tools().getByLabel('End (seconds or mm:ss)',{exact:true}).fill('3:25');
      await tools().getByLabel('Category',{exact:true}).selectOption('selfpromo');
      await tools().getByRole('button',{name:'Submit to SponsorBlock',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.yqn-tools-status')?.textContent.includes('Submitted to SponsorBlock'));
      const subs=await worker.evaluate(()=>self.sbSubmissions);
      assert.equal(subs.length,1);
      assert.equal(subs[0].videoID,'videoAAAAAA');
      assert.equal(subs[0].startTime,180);
      assert.equal(subs[0].endTime,205);
      assert.equal(subs[0].category,'selfpromo');

      await tools().getByRole('button',{name:'All notes',exact:true}).click();
      await tools().getByText(/2 matching of 2 notes across 2 videos/).waitFor();
      await tools().getByLabel('Search all saved notes',{exact:true}).fill('videoAAAAAA');
      await tools().getByText(/1 matching of 2 notes across 2 videos/).waitFor();
      const dlPromise=page.waitForEvent('download');
      await tools().getByRole('button',{name:'Export matching notes (.md)',exact:true}).click();
      const dl=await dlPromise;
      const mdText=await fs.readFile(await dl.path(),'utf8');
      assert.match(mdText,/watch\?v=videoAAAAAA&t=95s/);
      await page.setViewportSize({width:390,height:844});
      assert.equal(await tools().evaluate(el=>el.scrollWidth<=el.clientWidth),true,'All notes and SponsorBlock tools fit 390px viewport');
      await page.setViewportSize({width:1280,height:900});
      await tools().getByRole('button',{name:'Close',exact:true}).click();
    });
    await t.test('popup backup export excludes API keys and import restores settings, channel speeds and notes',async()=>{
      const popup=await context.newPage();
      await popup.goto('chrome-extension://'+extensionId+'/popup.html');
      const dlPromise=popup.waitForEvent('download');
      await popup.locator('#exportBackup').click();
      const dl=await dlPromise;
      const backupPath=await dl.path();
      const rawBackup=await fs.readFile(backupPath,'utf8');
      assert.ok(!rawBackup.includes('fixture-secret-key'),'Exported backup must never contain API keys');
      const parsedBackup=JSON.parse(rawBackup);
      assert.equal(parsedBackup.format,'yqn-backup-v1');
      assert.equal(parsedBackup.local['yqnChannelSpeedV1:UCfixtureA'].rate,1.5);

      // Wipe local storage and flip sync settings, then import the JSON backup.
      await worker.evaluate(async()=>{
        await chrome.storage.local.clear();
        await chrome.storage.sync.set({autoCut:false,cutSilence:false,shortcutsEnabled:false});
      });
      await popup.locator('#importBackupFile').setInputFiles(backupPath);
      await popup.waitForFunction(()=>document.querySelector('#backupStatus')?.textContent.includes('Restored'));
      assert.match(await popup.locator('#backupStatus').textContent(),/2 notes/);
      const restored=await worker.evaluate(()=>chrome.storage.local.get(['yqnChannelSpeedV1:UCfixtureA','yqnNotesV1:videoAAAAAA','yqnNotesV1:videoBBBBBB']));
      assert.equal(restored['yqnChannelSpeedV1:UCfixtureA'].rate,1.5);
      assert.equal(restored['yqnNotesV1:videoAAAAAA'].length,1);
      assert.equal(restored['yqnNotesV1:videoBBBBBB'].length,1);
      await popup.close();
    });
    await t.test('TL;DR card, Shift+T hotkey, Markdown copy, 390px layout and playable highlight reel work even with Auto-Cut off',async()=>{
      await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://www.youtube.com'});
      await worker.evaluate(async()=>{
        await chrome.storage.local.clear();
        await chrome.storage.sync.set({autoCut:false,cutPreset:'custom',showTldr:true,shortcutsEnabled:true,aiHighlights:false,jevCuts:false,thoroughAnalysis:false});
      });
      await page.setViewportSize({width:1280,height:900});
      await page.goto('https://www.youtube.com/watch?v=videoAAAAAA');
      await page.locator('#yqn-tldr-btn').waitFor();
      await page.waitForFunction(()=>document.querySelector('video')?.duration===600);

      // Open TL;DR card via Shift+T hotkey; captions load on demand and sponsor lines are excluded.
      await page.keyboard.press('Shift+KeyT');
      await page.locator('#yqn-tldr-panel').waitFor();
      await page.locator('#yqn-tldr-panel .yqn-tldr-clip').first().waitFor();
      const cardText=await page.locator('#yqn-tldr-panel').textContent();
      assert.ok(!cardText.includes('NaN'),'TL;DR card must never render NaN durations');
      assert.match(await page.locator('#yqn-tldr-play-reel').textContent(),/Play Highlight Reel \(\d+:\d{2}\)/);
      assert.match(await page.locator('#yqn-tldr-panel .yqn-tldr-compression').textContent(),/10:00 → \d+:\d{2}/);
      assert.match(cardText,/Bottom line/);
      assert.ok(!/sponsored by Acme/i.test(cardText),'Sponsor lines excluded from TL;DR card');

      // Copy TL;DR as Markdown and verify timestamped URL formatting.
      await page.locator('#yqn-tldr-copy-btn').click();
      await page.waitForFunction(()=>document.querySelector('#yqn-toast')?.textContent.includes('TL;DR copied'));
      const copiedMd=await page.evaluate(()=>navigator.clipboard.readText());
      assert.match(copiedMd,/# TL;DR: Workflow test video/);
      assert.match(copiedMd,/https:\/\/www\.youtube\.com\/watch\?v=videoAAAAAA&t=/);

      // Verify responsive fit on 390x844 mobile viewport without horizontal overflow.
      await page.setViewportSize({width:390,height:844});
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#yqn-tldr-panel').evaluate(el=>{
        const r=el.getBoundingClientRect();
        return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth;
      }),true,'TL;DR panel fits 390px viewport with zero horizontal overflow');
      await page.setViewportSize({width:1280,height:900});

      // Play Highlight Reel works even when Auto-Cut is off, advancing across clips and pausing at end.
      const clipBounds=await page.locator('#yqn-tldr-panel .yqn-tldr-clip .yqn-tldr-ts').evaluateAll(els=>
        els.map(el=>{
          const [a,b]=el.textContent.split('–').map(s=>s.split(':').reduce((acc,p)=>acc*60+Number(p),0));
          return {start:a,end:b};
        })
      );
      assert.ok(clipBounds.length>=2,'At least 2 highlight clips curated');
      await page.locator('#yqn-tldr-play-reel').click();
      await page.waitForFunction(()=>document.querySelector('#yqn-playback-status .yqn-live-state')?.textContent.includes('TL;DR reel 1/'));
      assert.equal(await page.locator('#yqn-playback-status').isVisible(),true);

      // Advance near end of clip 1 -> boundary scheduler jumps automatically into clip 2.
      await page.evaluate(end=>{
        const v=document.querySelector('video');
        v.currentTime=Math.max(0,end-0.25);
        return v.play();
      },clipBounds[0].end);
      await page.waitForFunction(()=>document.querySelector('#yqn-playback-status .yqn-live-state')?.textContent.includes('TL;DR reel 2/'));

      // Jump to last clip via UI button and let it finish -> pauses cleanly and announces completion.
      await page.locator('#yqn-tldr-panel .yqn-tldr-clip').last().click();
      const lastClip=clipBounds[clipBounds.length-1];
      await page.evaluate(end=>{
        const v=document.querySelector('video');
        v.currentTime=Math.max(0,end-0.25);
        return v.play();
      },lastClip.end);
      await page.waitForFunction(()=>{
        const v=document.querySelector('video');
        return v.paused && document.querySelector('#yqn-toast')?.textContent.includes('TL;DR highlight reel complete');
      });

      // One-click Use TL;DR Preset activates Auto-Cut + tldr preset without touching paid AI toggles.
      await page.locator('#yqn-tldr-preset-btn').click();
      await page.waitForFunction(()=>document.querySelector('#yqn-tldr-btn')?.textContent.includes('TL;DR · preset'));
      assert.deepEqual(
        await worker.evaluate(()=>chrome.storage.sync.get(['autoCut','cutPreset','aiHighlights','jevCuts'])),
        {autoCut:true,cutPreset:'tldr',aiHighlights:false,jevCuts:false}
      );
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#yqn-tldr-panel').count(),0);
    });
    await t.test('v1.42: transcript search (Shift+F), SponsorBlock POI highlights, thumbnail runtime badges, speed pill, playlist outro advance and time-saved dashboard',async()=>{
      await worker.evaluate(async()=>{
        await chrome.storage.local.clear();
        self.sbSubmissions=[];
        const prevFetch=self.fetch;
        self.fetch=async(url,options)=>{
          if(String(url).startsWith('https://sponsor.ajay.app/api/skipSegments/')&&(!options?.method||options.method==='GET')){
            return new Response(JSON.stringify([
              {videoID:'videoEEEEEE',segments:[
                {segment:[20,50],category:'sponsor',actionType:'skip'},
                {segment:[185,185],category:'poi_highlight',actionType:'poi'},
                {segment:[575,599],category:'outro',actionType:'skip'},
              ]},
              {videoID:'videoAAAAAA',segments:[
                {segment:[20,50],category:'sponsor',actionType:'skip'},
              ]},
            ]),{status:200,headers:{'content-type':'application/json'}});
          }
          return prevFetch(url,options);
        };
        await chrome.storage.sync.set({
          autoCut:true,cutPreset:'custom',cutMessaging:true,cutBoring:false,
          showSpeed:true,showThumbBadges:true,autoAdvancePlaylist:true,
          shortcutsEnabled:true,aiHighlights:false,jevCuts:false,thoroughAnalysis:false,
        });
      });

      // 1) Feed thumbnail hover badge previews effective runtime + POI highlight.
      await page.setViewportSize({width:1280,height:900});
      await page.goto('https://www.youtube.com/watch?v=videoAAAAAA');
      await page.locator('#yqn-cut-btn').waitFor();
      await page.evaluate(()=>{
        const card=document.createElement('div');
        card.setAttribute('data-yqn-thumb','1');
        card.style.cssText='width:240px;height:135px;position:relative;margin-top:16px;background:#222';
        card.innerHTML='<a id="yqn-test-thumb-link" href="/watch?v=videoEEEEEE" style="display:block;width:100%;height:100%">Card</a><span data-yqn-duration>10:00</span>';
        document.body.appendChild(card);
      });
      await page.locator('#yqn-test-thumb-link').hover();
      await page.locator('[data-yqn-thumb] .yqn-thumb-badge').waitFor();
      assert.equal(await page.locator('[data-yqn-thumb] .yqn-thumb-badge').textContent(),'→ 9:06');
      assert.match(await page.locator('[data-yqn-thumb] .yqn-thumb-badge').getAttribute('title'),/★ highlight at 3:05/);

      // 2) SponsorBlock poi_highlight marker, Shift+H community highlight jump, and POI submission.
      await page.goto('https://www.youtube.com/watch?v=videoEEEEEE&list=WL');
      await page.waitForFunction(()=>document.querySelector('video')?.duration===600);
      await page.locator('#yqn-markers .yqn-poi-tick').waitFor();
      assert.equal(await page.locator('#yqn-markers .yqn-poi-tick').count(),1); await page.waitForFunction(()=>document.querySelector('#yqn-cut-btn')?.textContent?.includes('Auto-Cut · 2'));

      await page.keyboard.press('Shift+KeyH');
      await page.waitForFunction(()=>Math.abs((document.querySelector('video')?.currentTime||0)-185)<0.5);
      assert.match(await page.locator('#yqn-toast').textContent(),/Community highlight/);
      await page.evaluate(()=>document.querySelector('video').pause());

      // Submit a new POI highlight from Video tools -> Mark sponsor.
      await page.locator('#yqn-tools-btn').click();
      const tools=()=>page.locator('#yqn-tools');
      await tools().getByLabel('Category',{exact:true}).selectOption('poi_highlight');
      assert.equal(await tools().getByLabel('End (seconds or mm:ss)',{exact:true}).getAttribute('placeholder'),'Not needed for highlight');
      await tools().getByLabel('Start (seconds or mm:ss)',{exact:true}).fill('4:10');
      await tools().getByRole('button',{name:'Submit to SponsorBlock',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.yqn-tools-status')?.textContent.includes('Highlight submitted'));
      const poiSubs=await worker.evaluate(()=>self.sbSubmissions);
      assert.equal(poiSubs.length,1);
      assert.equal(poiSubs[0].category,'poi_highlight');
      assert.equal(poiSubs[0].actionType,'poi');
      assert.equal(poiSubs[0].startTime,250);
      assert.equal(poiSubs[0].endTime,250);
      await page.waitForFunction(()=>document.querySelectorAll('#yqn-markers .yqn-poi-tick').length===2);
      await tools().getByRole('button',{name:'Close',exact:true}).click();

      // 3) Shift+F opens Video tools directly on Search, highlights matches, fits 390px, and Enter jumps.
      await page.keyboard.press('Shift+KeyF');
      await tools().waitFor();
      assert.equal(await tools().getByRole('button',{name:'Search',exact:true}).getAttribute('aria-pressed'),'true');
      await page.waitForFunction(()=>document.querySelector('#yqn-tools .yqn-search-summary')?.textContent.includes('caption lines ready')||document.querySelectorAll('#yqn-tools .yqn-search-list button').length>0);
      await tools().getByLabel('Search captions',{exact:true}).fill('independent');
      await tools().locator('mark.yqn-search-hit').first().waitFor();
      assert.equal(await tools().locator('mark.yqn-search-hit').first().textContent(),'independent');
      await page.setViewportSize({width:390,height:844});
      assert.equal(await tools().evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Transcript search fits 390px viewport');
      await page.setViewportSize({width:1280,height:900});
      await tools().getByLabel('Search captions',{exact:true}).press('Enter');
      await page.waitForFunction(()=>Math.abs((document.querySelector('video')?.currentTime||0)-120)<1);
      await page.evaluate(()=>document.querySelector('video').pause());
      await tools().getByRole('button',{name:'Close',exact:true}).click();

      // 4) Inline speed pill: click cycles 1x -> 1.25x, wheel steps +0.1x -> 1.35x, Shift+click pins channel speed.
      const speedBtn=page.locator('#yqn-speed-btn');
      await speedBtn.click();
      await page.waitForFunction(()=>Math.abs((document.querySelector('video')?.playbackRate||0)-1.25)<0.01);
      assert.equal(await speedBtn.locator('.yqn-speed-label').textContent(),'1.25×');
      await speedBtn.dispatchEvent('wheel',{deltaY:-100});
      await page.waitForFunction(()=>Math.abs((document.querySelector('video')?.playbackRate||0)-1.35)<0.01);
      assert.equal(await speedBtn.locator('.yqn-speed-label').textContent(),'1.35×');
      await speedBtn.click({modifiers:['Shift']});
      await page.waitForFunction(()=>document.querySelector('#yqn-speed-btn .yqn-speed-label')?.textContent==='1.35× ★');
      const savedSpeed=await worker.evaluate(()=>chrome.storage.local.get('yqnChannelSpeedV1:UCfixtureA'));
      assert.equal(savedSpeed['yqnChannelSpeedV1:UCfixtureA']?.rate,1.35);

      // 5) Playlist outro skip clicks YouTube's .ytp-next-button immediately and flushes lifetime savings.
      await page.evaluate(async()=>{
        const nextBtn=document.createElement('button');
        nextBtn.className='ytp-next-button';
        nextBtn.textContent='Next';
        window.__nextClicked=0;
        nextBtn.addEventListener('click',()=>{window.__nextClicked++;});
        document.querySelector('#movie_player').appendChild(nextBtn);
        const v=document.querySelector('video');
        v.currentTime=574.7;
        await v.play();
      });
      await page.waitForFunction(()=>window.__nextClicked===1);
      assert.match(await page.locator('#yqn-toast').textContent(),/Skipped outro → next in playlist/);
      await page.evaluate(()=>document.querySelector('video').pause());

      // 6) Popup Time-Saved dashboard shows Today / 7 days / All-time + breakdown, and keeps single <details>.
      const popup=await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      assert.equal(await popup.locator('details').count(),1,'Popup must maintain single <details> element');
      await popup.waitForFunction(()=>document.querySelector('#savedTotal')?.textContent!=='0s');
      assert.notEqual(await popup.locator('#savedToday').textContent(),'0s');
      assert.notEqual(await popup.locator('#savedWeek').textContent(),'0s');
      assert.match(await popup.locator('#savedBreakdown').textContent(),/Skips 18s · .*videos?/);
      await popup.locator('#resetTimeSaved').click();
      await popup.waitForFunction(()=>document.querySelector('#savedTotal')?.textContent==='0s');
      await popup.close();
    });
    await t.test('v1.43: real-time remaining clock, live-synced transcript & quote copy, clean end-screens, A-B loop, native frame capture and Shorts player',async()=>{
      await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://www.youtube.com'});
      await worker.evaluate(async()=>{
        await chrome.storage.local.clear();
        await chrome.storage.sync.set({
          autoCut:true,cutPreset:'custom',cutMessaging:true,cutBoring:false,
          showSpeed:true,showLoop:true,showScreenshot:true,showRealRemaining:true,
          cleanEndscreen:true,redirectShorts:false,shortcutsEnabled:true,
          aiHighlights:false,jevCuts:false,thoroughAnalysis:false,
        });
      });

      await page.setViewportSize({width:1280,height:900});
      await page.goto('https://www.youtube.com/watch?v=videoEEEEEE');
      await page.waitForFunction(()=>document.querySelector('video')?.duration===600);
      await page.locator('#yqn-markers .yqn-marker').first().waitFor();

      // 1) Live Real Time Left + Finish-At clock mounts inside .ytp-time-display and accounts for cuts + speed.
      await page.evaluate(()=>{
        const td=document.createElement('div');
        td.className='ytp-time-display';
        td.innerHTML='<span class="ytp-time-current">0:00</span><span> / </span><span class="ytp-time-duration">10:00</span>';
        document.querySelector('#movie_player').appendChild(td);
        const v=document.querySelector('video');
        v.currentTime=0;
      });
      await page.locator('#yqn-speed-btn').click(); // 1x -> 1.25x
      await page.waitForFunction(()=>document.querySelector('.ytp-time-display #yqn-time-left')?.textContent==='· 7:17 left');
      assert.match(await page.locator('#yqn-time-left').getAttribute('title'),/finishes ~\d{2}:\d{2}\) · .* of cuts ahead/);

      // 2) Clean end-screen declutter hides .ytp-ce-element overlays until Alt peek is held.
      await page.evaluate(()=>{
        const ce=document.createElement('div');
        ce.id='yqn-test-ce';
        ce.className='ytp-ce-element';
        ce.textContent='Blocking card';
        document.querySelector('#movie_player').appendChild(ce);
      });
      assert.equal(await page.locator('#yqn-test-ce').evaluate(el=>getComputedStyle(el).opacity),'0');
      assert.equal(await page.locator('#yqn-test-ce').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
      await page.keyboard.down('Alt');
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('#yqn-test-ce')).opacity==='1');
      await page.keyboard.up('Alt');
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('#yqn-test-ce')).opacity==='0');

      // 3) Interactive live-synced transcript in Search (Shift+F) + one-click timestamped quote copy + 390px layout.
      await page.evaluate(()=>{document.querySelector('video').currentTime=122;});
      await page.keyboard.press('Shift+KeyF');
      const tools=()=>page.locator('#yqn-tools');
      await tools().waitFor();
      await tools().locator('.yqn-search-row.yqn-search-active').waitFor();
      assert.equal(await tools().locator('.yqn-search-follow').getAttribute('aria-pressed'),'true');
      assert.match(await tools().locator('.yqn-search-row.yqn-search-active .yqn-search-text').textContent(),/independent/);
      await page.setViewportSize({width:390,height:844});
      assert.equal(await tools().evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Live transcript fits 390px viewport');
      await page.setViewportSize({width:1280,height:900});
      await tools().locator('.yqn-search-row.yqn-search-active .yqn-search-copy').click();
      await page.waitForFunction(()=>document.querySelector('.yqn-tools-status')?.textContent==='Quote copied to clipboard.');
      assert.equal(
        await page.evaluate(()=>navigator.clipboard.readText()),
        '"This product review is independent. We bought this tool ourselves." (2:00 — https://www.youtube.com/watch?v=videoEEEEEE&t=120s)'
      );
      await tools().getByRole('button',{name:'Close',exact:true}).click();

      // 4) A-B Section Loop (Shift+L): sets A pin, sets A-B bracket, wraps playback, and clears cleanly.
      await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=100;});
      await page.keyboard.press('Shift+KeyL');
      await page.locator('#yqn-markers .yqn-loop-pin').waitFor();
      assert.equal(await page.locator('#yqn-loop-btn .yqn-loop-label').textContent(),'A · 1:40');
      await page.evaluate(()=>{document.querySelector('video').currentTime=101.2;});
      await page.keyboard.press('Shift+KeyL');
      await page.locator('#yqn-markers .yqn-loop-range').waitFor();
      assert.equal(await page.locator('#yqn-loop-btn .yqn-loop-label').textContent(),'1:40–1:41');
      assert.match(await page.locator('.yqn-live-state').textContent(),/Looping 1:40 → 1:41/);
      await page.evaluate(async()=>{const v=document.querySelector('video');v.currentTime=101.0;await v.play();});
      await page.waitForFunction(()=>{const t=document.querySelector('video')?.currentTime||0;return t>=100&&t<100.7;});
      await page.evaluate(()=>document.querySelector('video').pause());
      await page.keyboard.press('Shift+KeyL');
      assert.equal(await page.locator('#yqn-markers .yqn-loop-range').count(),0);
      assert.equal(await page.locator('#yqn-loop-btn .yqn-loop-label').textContent(),'Loop');

      // 5) Full-resolution clean frame capture (Shift+S) captures video pixels onto PNG without HUD.
      await page.evaluate(async()=>{
        const c=document.createElement('canvas');c.width=320;c.height=180;
        const ctx=c.getContext('2d');ctx.fillStyle='#1e90ff';ctx.fillRect(0,0,320,180);
        const stream=c.captureStream(30);
        window.__yqnFramePaint=setInterval(()=>{ctx.fillStyle='#1e90ff';ctx.fillRect(0,0,320,180);},40);
        const v=document.querySelector('video');
        v.srcObject=stream;
        await v.play();
      });
      await page.waitForFunction(()=>document.querySelector('video')?.videoWidth===320);
      await page.keyboard.press('Shift+KeyS');
      await page.waitForFunction(()=>Boolean(document.querySelector('#yqn-snap-btn')?.dataset.lastCapture));
      await page.evaluate(()=>clearInterval(window.__yqnFramePaint));
      assert.match(await page.locator('#yqn-snap-btn').getAttribute('data-last-capture'),/^(clipboard|download):320x180:Workflow test video - \d{2}m\d{2}s\.png$/);

      // 6) Shorts -> Normal Watch Player: floating Full player pill & auto-redirect popup toggle.
      await page.goto('https://www.youtube.com/shorts/videoEEEEEE');
      await page.locator('#yqn-shorts-watch-btn').waitFor();
      await page.locator('#yqn-shorts-watch-btn').click();
      await page.waitForURL('https://www.youtube.com/watch?v=videoEEEEEE');

      const popup=await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      assert.equal(await popup.locator('details').count(),1,'Popup must maintain single <details> element');
      await popup.locator('#redirectShorts').check();
      await popup.close();
      await page.goto('https://www.youtube.com/shorts/videoAAAAAA?t=15',{waitUntil:'commit'});
      await page.waitForURL('https://www.youtube.com/watch?v=videoAAAAAA&t=15s');
    });
    await t.test('v1.44: long-video Highlight Reel depth toggle (Skim / Balanced / Deep) and GitHub Release popup update banner',async()=>{
      longVideoFixture=true;
      await worker.evaluate(async()=>{
        await chrome.storage.local.clear();
        await chrome.storage.sync.set({
          autoCut:false,showTldr:true,tldrDepth:'balanced',redirectShorts:false,shortcutsEnabled:true,
          aiHighlights:false,jevCuts:false,thoroughAnalysis:false,
        });
      });
      await page.setViewportSize({width:1280,height:900});
      await page.goto('https://www.youtube.com/watch?v=videoLLLLLL');
      await page.waitForFunction(()=>document.querySelector('video')?.duration===3600);

      await page.keyboard.press('Shift+KeyT');
      const tldr=page.locator('#yqn-tldr-panel');
      await tldr.waitFor();
      await page.waitForFunction(()=>document.querySelectorAll('#yqn-tldr-panel .yqn-tldr-clip').length>=7);

      const parseReelSec=async()=>{
        const txt=await page.locator('#yqn-tldr-play-reel').textContent();
        const m=txt.match(/\((\d+):(\d{2})\)/);
        assert.ok(m,`Expected mm:ss in play reel button, got: ${txt}`);
        return Number(m[1])*60+Number(m[2]);
      };

      assert.equal(await tldr.locator('[data-tldr-depth="balanced"]').getAttribute('aria-pressed'),'true');
      const balancedSec=await parseReelSec();
      assert.ok(balancedSec>=240,`Balanced 60m reel should be >= 4m, got ${balancedSec}s`);

      await tldr.locator('[data-tldr-depth="skim"]').click();
      await page.waitForFunction(()=>document.querySelector('#yqn-tldr-panel [data-tldr-depth="skim"]')?.getAttribute('aria-pressed')==='true');
      const skimSec=await parseReelSec();
      assert.ok(skimSec<balancedSec,`Skim (${skimSec}s) should be shorter than Balanced (${balancedSec}s)`);

      await tldr.locator('[data-tldr-depth="deep"]').click();
      await page.waitForFunction(()=>document.querySelector('#yqn-tldr-panel [data-tldr-depth="deep"]')?.getAttribute('aria-pressed')==='true');
      const deepSec=await parseReelSec();
      assert.ok(deepSec>balancedSec,`Deep (${deepSec}s) should be longer than Balanced (${balancedSec}s)`);
      assert.deepEqual(await worker.evaluate(()=>chrome.storage.sync.get('tldrDepth')),{tldrDepth:'deep'});

      await page.setViewportSize({width:390,height:844});
      assert.equal(await tldr.evaluate(el=>el.scrollWidth<=el.clientWidth),true,'TL;DR depth bar fits 390px viewport');
      await page.setViewportSize({width:1280,height:900});
      await page.keyboard.press('Escape');
      longVideoFixture=false;

      // GitHub Releases popup update notifier (zero new permissions, strict repo allowlist, single <details>).
      ghReleaseVersion='1.99.0';
      const popup=await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      assert.equal(await popup.locator('details').count(),1,'Popup must maintain single <details> element');
      // Auto-paint prepared Watch Later / playlist badges without hover (⚡ → mm:ss and ⚡ Ready).
      await page.evaluate(()=>{
        const wrap=document.createElement('div');
        wrap.innerHTML='<div data-yqn-thumb="prep1" style="width:200px;height:110px;position:relative"><a href="/watch?v=prepCut0001">Cut</a><span data-yqn-duration>10:00</span></div>' +
          '<div data-yqn-thumb="prep2" style="width:200px;height:110px;position:relative"><a href="/watch?v=prepClean01">Clean</a><span data-yqn-duration>4:44</span></div>';
        document.body.appendChild(wrap);
      });
      await worker.evaluate(async()=>{
        const now=Date.now();
        await chrome.storage.local.set({cutCacheV15:{
          prepCut0001:{ts:now,complete:true,segments:[{start:10,end:60,action:'skip'}]},
          prepClean01:{ts:now,complete:true,segments:[]},
        }});
      });
      await page.locator('[data-yqn-thumb="prep1"] .yqn-thumb-badge').waitFor();
      await page.locator('[data-yqn-thumb="prep2"] .yqn-thumb-badge').waitFor();
      assert.equal(await page.locator('[data-yqn-thumb="prep1"] .yqn-thumb-badge').textContent(),'⚡ → 9:10');
      assert.equal(await page.locator('[data-yqn-thumb="prep2"] .yqn-thumb-badge').textContent(),'⚡ Ready');

      // Distinct navigation links vs per-video action toggles (#yqn-wl-btn Save Later/Saved, #yqn-like-btn Like, History ↗, Watch Later ↗, Liked list ↗).
      await worker.evaluate(()=>chrome.storage.sync.set({showToggle:true,showLike:true,showWatchLater:true,showHistory:true,showLiked:true}));
      await page.locator('#yqn-wl-btn').waitFor();
      assert.match(await page.locator('#yqn-wl-btn').textContent(),/Save|Saved/);
      assert.equal(await page.locator('#yqn-quick-bar .yqn-link-strip a[href="/playlist?list=WL"]').getAttribute('aria-label'),'Watch Later ↗');
      assert.equal(await page.locator('#yqn-quick-bar .yqn-link-strip a[href="/feed/history"]').textContent(),'📜');
      assert.equal(await page.locator('#yqn-quick-bar .yqn-link-strip a[href="/playlist?list=LL"]').textContent(),'❤️');
      await worker.evaluate(()=>chrome.storage.sync.set({showSubscriptions:true,showLibrary:true,showCopyLink:true,showPeak:true,showJump:true,showVolume:true,showTools:true,showLoop:true,showScreenshot:true,showSpeed:true,showTldr:true,showCut:true}));
      await page.evaluate(()=>{document.querySelector('ytd-watch-metadata').style.width='1120px';});
      await page.locator('#yqn-quick-bar .yqn-topic-group #yqn-topics-btn').waitFor();
      const singleRow=await page.evaluate(()=>{const a=document.querySelector('#yqn-quick-bar .yqn-link-strip').getBoundingClientRect();const b=document.querySelector('#yqn-tools-btn').getBoundingClientRect();return Math.abs(a.top-b.top)<4;});
      assert.equal(singleRow,true,'All 19 toolbar controls fit on a single row at 1120px watch width');

      assert.equal(await popup.locator('#extVersion').textContent(),'v1.45.1');
      await popup.locator('#checkUpdatesBtn').click();
      await page.waitForTimeout(50);
      await popup.waitForFunction(()=>!document.querySelector('#updateBanner')?.hidden);
      assert.equal(await popup.locator('#updateTitle').textContent(),'⬆ Update v1.99.0 available');
      assert.equal(
        await popup.locator('#updateDownloadLink').getAttribute('href'),
        'https://github.com/rendez2k/yt-quicknav/releases/download/v1.99.0/youtube-quick-nav-v1.99.0.zip'
      );
      await popup.close();
    });
    assert.deepEqual(errors,[]);
  } finally {
    await context.close();
    const resolved=path.resolve(profile);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('yqn-check-')) throw new Error('Unexpected profile path');
    await fs.rm(resolved,{recursive:true,force:true});
  }
});
