const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const ctx=vm.createContext({});vm.runInContext(source('video-tools-model.js'),ctx);const m=ctx.YqnToolsModel;

test('prices account for long-context threshold, cache writes and reads',()=>{
  assert.equal(m.price('claude-haiku-4-5-20251001',{input_tokens:1000,output_tokens:1000}),0.006);
  assert.equal(m.price('claude-haiku-5-5',{input_tokens:100001,output_tokens:1000}),0.0525005);
  assert.equal(m.price('claude-sonnet-5',{input_tokens:1000,output_tokens:100,cache_read_input_tokens:2000,
    cache_creation_input_tokens:1000,cache_creation:{ephemeral_1h_input_tokens:500}}),0.00665);
  assert.equal(m.price('unknown',{input_tokens:1,output_tokens:1}),null);
  assert.equal(m.estimate('jev-latest',100,0),null);
  assert.equal(m.estimate('jev-latest',100,0,0.042),4196*0.042/1e6);
});
test('manual ranges reject invalid or out-of-video timestamps',()=>{
  assert.equal(m.range('1:20.5','2:00',600).start,80.5);
  for(const args of [['-1','20',600],['5','5',600],['1:80','2:00',600],['1','601',600],['','10',600]])assert.throws(()=>m.range(...args));
});
test('answers require all citations to match supplied caption evidence',()=>{
  const lines=[{id:5,start:50,end:60,text:'We use a blue filter to reduce glare.'}];
  const result={status:'supported',answer:'Use a blue filter.',citations:[{lineId:5,quote:'a blue filter to reduce glare'}]};
  assert.equal(m.validateAnswer(result,lines,false).citations[0].start,50);
  assert.equal(m.validateAnswer({...result,citations:[{lineId:99,quote:lines[0].text}]},lines,false).citations.length,0);
  assert.equal(m.validateAnswer({...result,citations:[{lineId:5,quote:'Something the video never says'}]},lines,false).citations.length,0);
  assert.match(m.validateAnswer({status:'not_covered'},lines,true).answer,/selected transcript excerpts/);
});
test('long transcript retrieval stays bounded and includes matching passages',()=>{
  const lines=Array.from({length:200},(_,id)=>({id,text:id===120?'Discussing polarised filters and glare.':'Ordinary text '.repeat(20)}));
  const out=m.evidence(lines,'polarised filters',1200);
  assert.equal(out.partial,true);assert.ok(out.lines.some(l=>l.id===120));
  assert.ok(out.lines.reduce((s,l)=>s+l.text.length+60,0)<=1200);
});
test('export escapes Markdown and keeps genuine timestamp links',()=>{
  const out=m.notesMarkdown('videoAAAAAA','<Title>',[{time:91,text:'[click](javascript:alert(1))\n# heading'}]);
  assert.match(out,/&t=91s/);assert.match(out,/\\\[click\\\]/);assert.match(out,/\\<Title\\>/);
});
test('diagnostics explain override and review state without serialising secrets',()=>{
  const out=m.diagnosis({videoId:'videoAAAAAA',enabled:true,time:25,awaitingReview:true,
    row:{start:20,end:50,action:'keep',edited:true,evidence:'PRIVATE'},anthropicKey:'SECRET',transcript:'PRIVATE',errors:[]});
  assert.match(out.reasons.join(' '),/approval.*Keep override/);
  assert.ok(!JSON.stringify(out).includes('SECRET'));assert.ok(!JSON.stringify(out).includes('PRIVATE'));
});
test('diagnostic analysis exports include only numeric audit fields',()=>{
  const out=m.diagnosis({analysisAudit:{quoteMismatch:2,acceptedCut:0,prompt:'PRIVATE',key:'SECRET'}});
  assert.equal(out.analysis.quoteMismatch,2);assert.ok(!JSON.stringify(out).includes('SECRET'));assert.ok(!JSON.stringify(out).includes('PRIVATE'));
});

test('failed-range diagnostics expose coverage and safe codes without raw provider data',()=>{
  const out=m.diagnosis({analysisCoverage:{checked:63,total:288,recoveries:2,key:'SECRET'},
    analysisFailures:[{start:0,end:300,phase:'review',code:'response_limit',raw:'SECRET'},
      {start:300,end:600,phase:'PRIVATE',code:'SECRET'}]});
  assert.deepEqual(JSON.parse(JSON.stringify(out.coverage)),{checked:63,total:288,recoveries:2});
  assert.equal(out.failedSections[0].code,'response_limit');assert.equal(out.failedSections[1].code,'unknown');
  assert.ok(!JSON.stringify(out).includes('SECRET'));assert.ok(!JSON.stringify(out).includes('PRIVATE'));
});

function worker(storage,settings){
  let listener;
  const c=vm.createContext({crypto:require('node:crypto').webcrypto,chrome:{runtime:{id:'test',onMessage:{addListener:fn=>{listener=fn;}}},storage:{
    local:{get:async key=>({[key]:structuredClone(storage[key])}),set:async patch=>{await new Promise(r=>setImmediate(r));Object.assign(storage,structuredClone(patch));}},
    sync:{get:async defaults=>({...defaults,...settings})}
  }}});
  vm.runInContext(source('video-tools-model.js'),c);vm.runInContext(source('usage-ledger.js'),c);
  return msg=>new Promise(resolve=>listener(msg,{id:'test'},resolve));
}
test('concurrent reservations enforce shared budgets; restart cannot lose pending spend',async()=>{
  const storage={},settings={aiDailyBudget:0.01};const call=worker(storage,settings);
  const msg={type:'yqn-usage-reserve',model:'claude-haiku-4-5-20251001',bytes:1000,output:1,videoId:'videoAAAAAA'};
  const results=await Promise.all([call(msg),call(msg)]);
  assert.equal(results.filter(r=>r.ok).length,1);
  const restarted=worker(storage,settings);assert.equal((await restarted(msg)).ok,false);
  await restarted({type:'yqn-usage-settle',id:results.find(r=>r.ok).id,usage:{input_tokens:100,output_tokens:1}});
  assert.equal((await restarted(msg)).ok,true);
});
test('unknown usage retains estimate; settling twice cannot erase it',async()=>{
  const storage={},call=worker(storage,{});
  const {id}=await call({type:'yqn-usage-reserve',model:'claude-sonnet-5',bytes:1000,output:100,videoId:'v'});
  await call({type:'yqn-usage-settle',id});
  const first=await call({type:'yqn-usage-read',videoId:'v'});
  await call({type:'yqn-usage-settle',id,usage:{input_tokens:0,output_tokens:0}});
  assert.equal((await call({type:'yqn-usage-read',videoId:'v'})).video.usd,first.video.usd);
  assert.ok(first.video.usd>0);assert.equal(first.video.uncertain,1);
});
test('per-video limit spans days and unpriced models cannot bypass an enabled budget',async()=>{
  const storage={},settings={aiVideoBudget:0.01},call=worker(storage,settings);
  assert.equal((await call({type:'yqn-usage-reserve',model:'jev-latest',bytes:100,videoId:'a'})).ok,false);
  assert.equal((await call({type:'yqn-usage-reserve',model:'claude-haiku-4-5-20251001',bytes:1000,output:1,videoId:'a'})).ok,true);
  const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
  Object.values(storage.yqnUsageV1.entries)[0].day=m.day(yesterday);
  assert.equal((await call({type:'yqn-usage-reserve',model:'claude-haiku-4-5-20251001',bytes:1000,output:1,videoId:'a'})).ok,false);
  assert.equal((await call({type:'yqn-usage-reserve',model:'claude-haiku-4-5-20251001',bytes:1000,output:1,videoId:'b'})).ok,true);
});

test('a configured Jev price accounts for earlier unpriced calls',async()=>{
  const storage={},settings={},call=worker(storage,settings);
  await call({type:'yqn-usage-reserve',model:'jev-latest',bytes:1000,output:0,videoId:'v'});
  assert.equal((await call({type:'yqn-usage-read',videoId:'v'})).video.unpriced,1);
  settings.jevInputPrice=0.042;settings.aiDailyBudget=1;
  const repriced=await call({type:'yqn-usage-read',videoId:'v'});
  assert.equal(repriced.video.unpriced,0);assert.ok(repriced.video.usd>0);
  assert.equal((await call({type:'yqn-usage-reserve',model:'claude-haiku-5-5',bytes:1000,output:10,videoId:'v'})).ok,true);
});
test('AI client stops before dispatch on cancellation and never sends keys to accounting',async()=>{
  const sent=[],abort=new AbortController();let paid=0;
  const c=vm.createContext({TextEncoder,fetch:async()=>{paid++;},chrome:{runtime:{sendMessage:async msg=>{sent.push(msg);if(msg.type==='yqn-usage-reserve')abort.abort();return {ok:true,id:'reservation'};}}}});
  vm.runInContext(source('ai-client.js'),c);
  await assert.rejects(c.YqnAI.request('https://api.anthropic.com/v1/messages',{signal:abort.signal,headers:{'x-api-key':'SECRET'},body:JSON.stringify({model:'claude-haiku-5-5',max_tokens:10,messages:[]})},'video'));
  assert.equal(paid,0);assert.equal(sent.at(-1).cancelledBeforeSend,true);assert.ok(!JSON.stringify(sent).includes('SECRET'));
});
test('AI client reserves unknown usage on a lost response and does not retry',async()=>{
  const sent=[];let paid=0;
  const c=vm.createContext({TextEncoder,fetch:async()=>{paid++;throw new Error('network lost');},chrome:{runtime:{sendMessage:async msg=>{sent.push(msg);return {ok:true,id:'reservation'};}}}});
  vm.runInContext(source('ai-client.js'),c);
  await assert.rejects(c.YqnAI.request('https://api.anthropic.com/v1/messages',{body:JSON.stringify({model:'claude-haiku-5-5',max_tokens:10})},'video'));
  assert.equal(paid,1);assert.equal(sent.at(-1).cancelledBeforeSend,false);assert.equal(sent.at(-1).usage,undefined);
});
test('explicit unbilled HTTP errors release reservations instead of draining budgets',async()=>{
  const storage={},settings={aiDailyBudget:0.06},call=worker(storage,settings);
  for(const status of [401,429,503]){
    const sent=[];
    const c=vm.createContext({TextEncoder,fetch:async()=>({ok:false,status,clone(){return {json:async()=>({error:{type:'rate_limit_error'}})};}}),
      chrome:{runtime:{sendMessage:async msg=>{sent.push(msg);return call(msg);}}}});
    vm.runInContext(source('ai-client.js'),c);
    const res=await c.YqnAI.request('https://api.anthropic.com/v1/messages',{body:JSON.stringify({model:'claude-sonnet-5-5',max_tokens:4000})},'videoAAAAAA');
    assert.equal(res.status,status);assert.equal(sent.at(-1).unbilledError,true);
  }
  const usage=await call({type:'yqn-usage-read',videoId:'videoAAAAAA'});
  assert.equal(usage.today.usd,0);assert.equal(usage.video.usd,0);
});
test('evidence supports 2-char technical tokens, stopword filtering and CJK bigrams; claude-sonnet-5-5 is priced',()=>{
  assert.equal(m.price('claude-sonnet-5-5',{input_tokens:1000,output_tokens:100}),0.003);
  const enLines=Array.from({length:120},(_,id)=>({id,text:id===95?'The M4 AI neural engine doubles throughput.':'What is the standard baseline test '.repeat(12)}));
  const enOut=m.evidence(enLines,'What is the M4 AI throughput?',900);
  assert.ok(enOut.lines.some(l=>l.id===95));
  const cjkLines=Array.from({length:120},(_,id)=>({id,text:id===88?'動画編集の書き出し速度は従来の二倍です。':'一般的な説明文が続きます。'.repeat(12)}));
  const cjkOut=m.evidence(cjkLines,'書き出し速度は？',900);
  assert.ok(cjkOut.lines.some(l=>l.id===88));
  const diag=m.diagnosis({adPlaying:true,ignored:true,ignoreReason:'live'});
  assert.match(diag.reasons.join(' '),/advert.*live stream/);
});
test('sponsorBlockPayload validates inputs and produces SponsorBlock skipSegments JSON',()=>{
  const userId='a'.repeat(32);
  const payload=m.sponsorBlockPayload({videoId:'videoAAAAAA',start:'1:05',end:'1:30.25',duration:600,category:'sponsor',userId,version:'1.39.0'});
  assert.deepEqual(JSON.parse(JSON.stringify(payload)),{
    videoID:'videoAAAAAA',startTime:65,endTime:90.25,category:'sponsor',
    userID:userId,userAgent:'YouTubeQuickNav/1.39.0',actionType:'skip',videoDuration:600
  });
  assert.throws(()=>m.sponsorBlockPayload({videoId:'short',start:10,end:20,duration:600,category:'sponsor',userId}),/11-character/);
  assert.throws(()=>m.sponsorBlockPayload({videoId:'videoAAAAAA',start:10,end:10.2,duration:600,category:'sponsor',userId}),/0\.5 seconds/);
  assert.throws(()=>m.sponsorBlockPayload({videoId:'videoAAAAAA',start:10,end:20,duration:600,category:'invalid_cat',userId}),/category/);
  assert.throws(()=>m.sponsorBlockPayload({videoId:'videoAAAAAA',start:10,end:20,duration:600,category:'sponsor',userId:'too-short'}),/submitter ID/);
});
test('searchAllNotes and allNotesMarkdown filter across videos and escape Markdown safely',()=>{
  const store={
    yqnNotesMetaV1:{
      videoAAAAAA:{title:'Rust Async Deep Dive',channelName:'Systems Lab',updatedAt:200},
      videoBBBBBB:{title:'Camera <Lens> Guide',channelName:'Optics Weekly',updatedAt:300},
    },
    'yqnNotesV1:videoAAAAAA':[{id:'n1',time:125,text:'Pinning futures on the stack'}],
    'yqnNotesV1:videoBBBBBB':[{id:'n2',time:42,text:'Use a [polarizer](javascript:alert(1))'},{id:'n3',time:90,text:'Aperture sweet spot'}],
  };
  const all=m.searchAllNotes(store,'');
  assert.equal(all.totalNotes,3);assert.equal(all.totalVideos,2);
  assert.equal(all.results[0].videoId,'videoBBBBBB','Most recently updated video sorts first');
  const filtered=m.searchAllNotes(store,'systems stack');
  assert.equal(filtered.results.length,1);assert.equal(filtered.results[0].id,'n1');
  const md=m.allNotesMarkdown(all.results,'lens');
  assert.match(md,/Camera \\<Lens\\> Guide — Optics Weekly/);
  assert.match(md,/\\\[polarizer\\\]/);
  assert.match(md,/watch\?v=videoBBBBBB&t=42s/);
});
test('buildBackup and parseBackup round-trip user state while stripping API keys and unsafe properties',()=>{
  const defaults={autoCut:false,cutPreset:'custom',cutSilence:false,shortcutsEnabled:true,speedRate:3,anthropicKey:'',typesafeKey:''};
  const syncStore={autoCut:true,cutPreset:'gentle',cutSilence:true,shortcutsEnabled:false,speedRate:2.5,anthropicKey:'sk-ant-SECRET',typesafeKey:'ts-SECRET'};
  const localStore={
    cutIgnoreV1:{videoCCCCCC:1700000000000},
    yqnNotesMetaV1:{videoAAAAAA:{title:'Test video',channelName:'Creator',updatedAt:100}},
    'yqnChannelV1:UCfixtureA':{name:'Creator',preferences:{autoCut:true,cutPreset:'quick'}},
    'yqnChannelSpeedV1:UCfixtureA':{name:'Creator',rate:1.5},
    'yqnLearningV1:UCfixtureA':{samples:[{videoId:'videoAAAAAA',kind:'intro',action:'keep'}],approved:{intro:'keep'}},
    'yqnCutEditsV1:videoAAAAAA':[{start:10,end:30,action:'keep'}],
    'yqnNotesV1:videoAAAAAA':[{id:'note-1',time:55,text:'Key point'}],
    cutCacheV15:{videoAAAAAA:{segments:[]}},
    yqnUsageV1:{entries:{}},
  };
  const backup=m.buildBackup(syncStore,localStore,defaults);
  const serialized=JSON.stringify(backup);
  assert.ok(!serialized.includes('sk-ant-SECRET'));
  assert.ok(!serialized.includes('ts-SECRET'));
  assert.equal('cutCacheV15' in backup.local,false);
  assert.equal('yqnUsageV1' in backup.local,false);

  // Inject malicious keys into the JSON before parsing to verify defence-in-depth.
  const tampered=JSON.parse(serialized);
  tampered.settings.anthropicKey='INJECTED_SECRET';
  tampered.settings.typesafeKey='INJECTED_TS';
  tampered.local['yqnChannelV1:UCfixtureA'].preferences.anthropicKey='INJECTED_CH_SECRET';
  tampered.local['yqnChannelSpeedV1:UCbad']={name:'Bad',rate:99};

  const parsed=m.parseBackup(JSON.stringify(tampered),defaults);
  assert.equal('anthropicKey' in parsed.syncPatch,false);
  assert.equal('typesafeKey' in parsed.syncPatch,false);
  assert.equal('anthropicKey' in parsed.localPatch['yqnChannelV1:UCfixtureA'].preferences,false);
  assert.equal('yqnChannelSpeedV1:UCbad' in parsed.localPatch,false);
  assert.equal(parsed.syncPatch.autoCut,true);
  assert.equal(parsed.syncPatch.cutSilence,true);
  assert.equal(parsed.syncPatch.shortcutsEnabled,false);
  assert.equal(parsed.localPatch['yqnChannelSpeedV1:UCfixtureA'].rate,1.5);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.summary)),{settingsCount:5,channelsCount:1,videosEditedCount:1,notesCount:1});
  assert.throws(()=>m.parseBackup('{"format":"wrong"}',defaults),/yqn-backup-v1/);
});
test('diagnosis includes channel base speed and silence speedup without hiding skip verdict',()=>{
  const out=m.diagnosis({videoId:'videoAAAAAA',enabled:true,time:25,channelBaseSpeed:1.5,cutSilence:true,silenceActive:true,
    row:{start:20,end:50,action:'skip',edited:false},errors:[]});
  assert.equal(out.reasons[0],'This section is set to skip.');
  assert.match(out.reasons.join(' '),/1\.5×.*silence speedup/);
  assert.equal(out.channelBaseSpeed,1.5);
  assert.equal(out.silenceSpeedup,true);
  assert.equal(out.sources.silence,true);
});

test('searchTranscript matches single-cue terms and multi-word phrases split across 3s ASR cues with exact highlight spans',()=>{
  const cues=[
    {start:12,duration:3,text:'Welcome back to our camera comparison.'},
    {start:45,duration:3,text:'Notice how the dynamic'},
    {start:48,duration:3,text:'range holds up in harsh noon shadows.'},
    {start:92,duration:4,text:'Battery endurance easily beats last year.'},
  ];
  const single=m.searchTranscript(cues,'camera comparison');
  assert.equal(single.totalMatches,1);
  assert.equal(single.matches[0].start,12);
  const highlighted=[...single.matches[0].highlights].map(([a,b])=>single.matches[0].text.slice(a,b));
  assert.deepEqual(highlighted,['camera comparison']);

  // Phrase split across two adjacent 3s ASR cues ('dynamic' + 'range holds'):
  const split=m.searchTranscript(cues,'dynamic range holds');
  assert.equal(split.totalMatches,1);
  assert.equal(split.matches[0].start,45);
  assert.equal(split.matches[0].end,51);
  assert.equal([...split.matches[0].highlights].map(([a,b])=>split.matches[0].text.slice(a,b))[0],'dynamic range holds');
});

test('sponsorBlockPayload supports poi_highlight point-of-interest submissions and backups preserve yqnLifetimeSavingsV1',()=>{
  const poi=m.sponsorBlockPayload({
    videoId:'videoAAAAAA',
    start:142.456,
    end:142.456,
    duration:600,
    category:'poi_highlight',
    userId:'0123456789abcdef0123456789abcdef',
    version:'1.42.0',
  });
  assert.equal(poi.actionType,'poi');
  assert.equal(poi.category,'poi_highlight');
  assert.equal(poi.startTime,142.456);
  assert.equal(poi.endTime,142.456);
  assert.throws(()=>m.sponsorBlockPayload({
    videoId:'videoAAAAAA',start:650,end:650,duration:600,category:'poi_highlight',userId:'0123456789abcdef0123456789abcdef'
  }),/within this video/);

  const defaults={autoCut:true,showSpeed:true,showThumbBadges:true,autoAdvancePlaylist:true,anthropicKey:'',typesafeKey:''};
  const localStore={
    yqnLifetimeSavingsV1:{
      version:1,
      byDay:{'2026-11-11':{skip:90,speed:30,silence:10,reel:20}},
      total:{skip:90,speed:30,silence:10,reel:20},
      videosCount:3,
      recentVideos:['videoAAAAAA','videoBBBBBB','videoCCCCCC'],
    },
  };
  const backup=m.buildBackup(defaults,localStore,defaults);
  assert.ok(backup.local.yqnLifetimeSavingsV1);
  const parsed=m.parseBackup(JSON.stringify(backup),defaults);
  assert.equal(parsed.localPatch.yqnLifetimeSavingsV1.total.skip,90);
  assert.equal(parsed.localPatch.yqnLifetimeSavingsV1.videosCount,3);
});

test('findActiveCaptionIndex tracks spoken cues and formatTranscriptQuote formats timestamped share quotes',()=>{
  const cues=m.normalizeCaptionLines([
    {start:10,duration:4,text:'First spoken point.'},
    {start:16,duration:5,text:'Second spoken point with extra detail.'},
    {start:30,duration:3,text:'Final wrap up.'},
  ]);
  assert.equal(m.findActiveCaptionIndex(cues,4),-1,'Before first cue');
  assert.equal(m.findActiveCaptionIndex(cues,12),0,'Inside first cue');
  assert.equal(m.findActiveCaptionIndex(cues,15),0,'Brief pause before second cue keeps context');
  assert.equal(m.findActiveCaptionIndex(cues,18),1,'Inside second cue');
  assert.equal(m.findActiveCaptionIndex(cues,60),-1,'Long silent outro expires active cue');

  assert.equal(
    m.formatTranscriptQuote({text:'  Second   spoken point  ',start:75.8,videoId:'videoAAAAAA'}),
    '"Second spoken point" (1:15 — https://www.youtube.com/watch?v=videoAAAAAA&t=75s)'
  );
  assert.equal(
    m.formatTranscriptQuote({text:'No id fallback',start:12,videoId:''}),
    '"No id fallback" (0:12)'
  );
});

test('pack script audits runtime files against hardcoded keys and builds valid PKZIP archive',()=>{
  const {auditSourceText,createZipBuffer}=require('../scripts/pack.cjs');
  assert.doesNotThrow(()=>auditSourceText('cut-controls.js',"const defaults = { anthropicKey: '', typesafeKey: '' };"));
  assert.doesNotThrow(()=>auditSourceText('popup.js','const VALUE_FIELDS = { anthropicKey: "string", typesafeKey: "string" };'));
  assert.throws(()=>auditSourceText('cut-controls.js',"const defaults = { anthropicKey: 'sk-ant-api03-1234567890abcdef', typesafeKey: '' };"),/Security check failed/);
  assert.throws(()=>auditSourceText('content.js',"const k = { typesafeKey: 'my-real-secret-token' };"),/Security check failed/);
  assert.throws(()=>auditSourceText('cut-controls.js',"const defaults = {};"),/default API keys must be empty/);

  const zip=createZipBuffer([
    {name:'manifest.json',data:Buffer.from('{"manifest_version":3,"version":"1.43.0"}')},
    {name:'icons/icon16.png',data:Buffer.from([137,80,78,71,13,10,26,10])},
  ]);
  assert.equal(zip.readUInt32LE(0),0x04034B50,'Valid PKZIP local header');
  assert.equal(zip.readUInt32LE(zip.length-22),0x06054B50,'Valid PKZIP end-of-central-directory');
  assert.equal(zip.readUInt16LE(zip.length-14),2,'Contains both entries');
});

test('v1.44: compareSemver, parseReleaseUpdate URL allowlisting, and 1-click updater scripts',()=>{
  assert.equal(m.GITHUB_REPO,'rendez2k/yt-quicknav');
  assert.equal(m.compareSemver('v1.45.0','1.44.0'),1);
  assert.equal(m.compareSemver('1.44.0','v1.44.0'),0);
  assert.equal(m.compareSemver('1.43.9','1.44.0'),-1);
  assert.equal(m.compareSemver('1.45.0-beta.1','1.44.0'),0,'Pre-release strings rejected');

  const validRel=m.parseReleaseUpdate({
    tag_name:'v1.50.0',
    draft:false,
    prerelease:false,
    html_url:'https://github.com/rendez2k/yt-quicknav/releases/tag/v1.50.0',
    body:'## Highlights\n- Faster long-video TL;DR reels and chapter coverage',
    assets:[
      {name:'evil.zip',browser_download_url:'https://evil.example.com/evil.zip'},
      {name:'youtube-quick-nav-v1.50.0.zip',browser_download_url:'https://github.com/rendez2k/yt-quicknav/releases/download/v1.50.0/youtube-quick-nav-v1.50.0.zip'},
    ],
  },'1.44.0');
  assert.equal(validRel.valid,true);
  assert.equal(validRel.hasUpdate,true);
  assert.equal(validRel.latestVersion,'1.50.0');
  assert.equal(validRel.zipUrl,'https://github.com/rendez2k/yt-quicknav/releases/download/v1.50.0/youtube-quick-nav-v1.50.0.zip');
  assert.match(validRel.summary,/Faster long-video TL;DR reels/);

  // Drafts and pre-releases never trigger friend update prompts
  assert.equal(m.parseReleaseUpdate({tag_name:'v2.0.0',draft:true},'1.44.0').hasUpdate,false);
  assert.equal(m.parseReleaseUpdate({tag_name:'v2.0.0',prerelease:true},'1.44.0').hasUpdate,false);
  assert.equal(m.parseReleaseUpdate({tag_name:'v1.44.0'},'1.44.0').hasUpdate,false);

  const {buildWindowsUpdater,buildUnixUpdater}=require('../scripts/pack.cjs');
  assert.match(buildWindowsUpdater(),/https:\/\/api\.github\.com\/repos\/rendez2k\/yt-quicknav\/releases\/latest/);
  assert.match(buildUnixUpdater(),/https:\/\/api\.github\.com\/repos\/rendez2k\/yt-quicknav\/releases\/latest/);
});
