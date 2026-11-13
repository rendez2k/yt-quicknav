// Optional public-site smoke check. No signed-in profile or AI credentials.
const {chromium}=require('playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
(async()=>{
  const root=path.resolve(__dirname,'..'),profile=await fs.mkdtemp(path.join(os.tmpdir(),'yqn-live-'));
  let context;
  const errors=[];
  try {
    context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',viewport:{width:1280,height:1000},
      args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(()=>chrome.storage.sync.set({autoCut:true,cutMessaging:true,cutBoring:false,
      thoroughAnalysis:true,aiHighlights:false,jevCuts:false,minCutMinutes:0,autoIgnoreMusic:false,
      cinemaMode:false,showToggle:false}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw',{waitUntil:'domcontentloaded',timeout:30000});
    for (let attempt=0;attempt<25;attempt++) {
      let dismissed=false;
      for (const frame of page.frames()) {
        const reject=frame.locator('ytd-consent-bump-v2-lightbox').getByText('Reject all',{exact:true}).first();
        if (await reject.isVisible().catch(()=>false)) {await reject.click();dismissed=true;break;}
      }
      if (dismissed) break;
      await page.waitForTimeout(500);
    }
    await page.locator('#yqn-cut-btn').waitFor({timeout:20000});
    await page.locator('#yqn-cut-btn').click();
    await page.waitForFunction(()=>document.querySelector('#yqn-cut-panel')?.textContent.includes('Enable AI highlights'),null,{timeout:20000});
    let simulatedAICalls=0;
    await context.route('https://api.anthropic.com/**',async route=>{
      const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
      simulatedAICalls++;
      const data=route.request().postDataJSON(),input=JSON.parse(data.messages[0].content);
      if(data.system?.includes('YQN_VIDEO_QUESTION')) {
        const line=input.lines[0];
        return route.fulfill({headers,json:{usage:{input_tokens:100,output_tokens:30},stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({status:'supported',answer:'Caption transport check: '+line.text,citations:[{lineId:line.id,quote:line.text}]})}]}});
      }
      const sections=input.lines.filter(l=>l.id>=input.coreFirst&&l.id<=input.coreLast).map(l=>({firstLine:l.id,lastLine:l.id,
        action:'keep',kind:'explanation',certainty:'high',reason:'Caption transport check',evidence:l.text}));
      return route.fulfill({headers,json:{stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({sections,
        summary:'Simulated AI response for the live caption transport check.',takeaways:[],chapters:[],mentions:[]})}]}});
    });
    await worker.evaluate(()=>chrome.storage.sync.set({aiHighlights:true,anthropicKey:'fixture-key-not-a-real-key'}));
    await page.waitForFunction(()=>document.querySelector('.yqn-cp-coverage') && document.querySelector('.yqn-cp-retry')?.disabled===false,null,{timeout:45000});
    if(simulatedAICalls<2)throw new Error('Live transcript did not reach both simulated AI passes');
    const result=await page.evaluate(()=>({title:document.title,url:location.href,
      duration:document.querySelector('video')?.duration || null,
      panel:document.querySelector('#yqn-cut-panel')?.textContent,
      coverage:document.querySelector('.yqn-cp-coverage')?.textContent,
      markerCount:document.querySelectorAll('#yqn-markers .yqn-marker').length}));
    await page.locator('#yqn-tools-btn').click();
    const tools=page.locator('#yqn-tools');
    await tools.getByRole('button',{name:'Ask video',exact:true}).click();
    await tools.getByLabel('Question',{exact:true}).fill('What is being discussed?');
    await tools.getByRole('button',{name:'Ask this video',exact:true}).click();
    await tools.locator('.yqn-tools-answer button').first().waitFor({timeout:20000});
    result.questionAnswer=await tools.locator('.yqn-tools-answer').textContent();
    await tools.getByRole('button',{name:'Notes',exact:true}).click();
    await tools.getByLabel('Note (optional)',{exact:true}).fill('Live caption workflow check');
    await tools.getByRole('button',{name:'Bookmark current time',exact:true}).click();
    await tools.locator('.yqn-note').waitFor();result.notesSaved=await tools.locator('.yqn-note').count();
    await tools.getByRole('button',{name:'Diagnostics',exact:true}).click();
    await tools.getByRole('button',{name:'Why wasn’t this skipped?',exact:true}).click();
    result.diagnosticReport=JSON.parse(await tools.locator('pre').textContent());
    await page.screenshot({path:path.join(root,'tests','live-smoke.png')});
    console.log(JSON.stringify({...result,simulatedAICalls,paidAICalls:0,pageErrors:errors},null,2));
  } catch(error) {
    console.error('Public YouTube smoke check could not complete: '+error.message);process.exitCode=1;
    if(context) {
      const page=context.pages().at(-1);
      if(page)console.error(JSON.stringify({url:page.url(),title:await page.title().catch(()=>''),
        visibleText:(await page.locator('body').innerText().catch(()=>'')).slice(0,400),errors,frames:page.frames().map(f=>f.url()),
        dom:await page.evaluate(()=>({bridge:!!window.__yqnInjected,bar:document.querySelector('#yqn-quick-bar')?.outerHTML.slice(0,300),
          selectors:Object.fromEntries(['ytd-watch-metadata','ytd-watch-flexy','#movie_player','#title','yt-watch-metadata-view-model','yt-lockup-view-model'].map(s=>[s,document.querySelectorAll(s).length])),
          titles:[...document.querySelectorAll('h1')].map(e=>({text:e.textContent,parent:e.parentElement?.tagName,id:e.parentElement?.id,html:e.parentElement?.outerHTML.slice(0,500)}))})).catch(()=>null)}));
      await page?.screenshot({path:path.join(root,'tests','live-smoke-failure.png')}).catch(()=>{});
    }
  } finally {
    await context?.close();
    if(path.dirname(profile)!==path.resolve(os.tmpdir())||!path.basename(profile).startsWith('yqn-live-'))throw new Error('Unexpected profile path');
    await fs.rm(profile,{recursive:true,force:true});
  }
})();
