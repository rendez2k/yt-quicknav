const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const source = fs.readFileSync(path.join(process.env.YQN_SOURCE || path.join(__dirname, '..'), 'content.js'), 'utf8');
  const events = {};
  const video = { currentTime: 0, duration: 600, playbackRate: 1.5, isConnected: true,
    addEventListener(name, fn) { events[name] = fn; }, removeEventListener(name) { delete events[name]; } };
  const context = { console, URL, URLSearchParams, TextEncoder, performance, AbortController, AbortSignal, crypto: require('node:crypto').webcrypto,
    location: { pathname: '/watch', search: '?v=videoAAAAAA', origin: 'https://www.youtube.com' },
    chrome: { runtime: { id: 'test' }, storage: { onChanged: { addListener() {} } } },
    document: { getElementById() { return null; }, querySelector() { return null; }, addEventListener() {} },
    setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); return t; }, clearTimeout,
    setInterval() {}, clearInterval, requestAnimationFrame() {}, video,
  };
  context.window = { addEventListener() {}, postMessage() {}, dispatchEvent() {} };
  context.Event=Event;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'plan-cache.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'topics.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'analysis-engine.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'cut-controls.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'video-tools-model.js'), 'utf8'), context);
  context.YqnAI={request:(url,options,id,transport)=>transport(url,options)};
  const end = source.indexOf('  loadSettings().then(');
  vm.runInContext(source.slice(0, end) + `
    const seen = { markers: 0, announced: 0, saved: 0, builds: 0, toasts: [] };
    const realBuildCutPlan = buildCutPlan;
    settings = { ...DEFAULTS, autoCut: true, autoIgnoreMusic: false, minCutMinutes: 0 };
    preferencesFor = 'videoAAAAAA';
    getVideoEl = () => video;
    videoFlagGet = async () => false;
    getCachedPlan = async () => null;
    setCachedPlan = () => seen.saved++;
    removeCutMarkers = () => {};
    renderCutPanelIfOpen = () => {};
    setCutTooltip = () => {};
    toast = (msg) => { seen.toasts.push(msg); };
    attachCutController = () => {};
    scheduleMarkerRender = () => seen.markers++;
    announcePlan = () => seen.announced++;
    buildCutPlan = async () => { seen.builds++; const info = {sbCount:1};
      const segments = [{start:10,end:20,action:'skip',reason:'sponsor'}];
      lastPlanInfo = info; return { segments, info }; };
    window.test = { seen, startAutoCut, realBuildCutPlan, normalizeSegments, maybeSpeedOnly, onCutTick, speedOutsideHighlights, jevCutSegments, emptyReason, cutStatusText, aiHighlights,
      setInfo(info) { lastPlanInfo=info; },
      setPlanning(id) { cutPlanningFor=id; },
      readTranscriptSegments,
      setProxy(fn) { proxyFetch=fn; },
      setPageData(fn) { requestAutocutData = fn; },
      setCategoryFn(fn) { getVideoCategory = fn; },
      setLastMeta(meta) { lastVideoMeta = meta; },
      setSettings(p) { Object.assign(settings,p); },
      setPreferencesFor(id) { preferencesFor = id; },
      setPlan(p) { cutPlan = p; }, plan() { return cutPlan; },
      setBuild(fn) { buildCutPlan = fn; },
      setCache(fn) { getCachedPlan = fn; },
      setAudioDb(fn) { audioDbOverride = fn; },
      setHoldBoost(val) { holdBoostOverride = val; },
      setChannelSpeed(rate) { currentChannel = { id: 'UCtest', name: 'Test Channel' }; currentChannelSpeed = rate; applyChannelBaseSpeed(video, false); },
      fetchSponsorBlock,
      pois(id) { return poiCache.get(id) || []; },
      setManualBaseSpeed,
      getEffectiveNormalRate,
      flushLifetimeSavings,
      handleShortsPage,
      resetControls() { resetVideoControls(); },
      runCommand(cmd) { return runShortcutCommand(cmd); },
      toolsApi: videoToolsAPI,
      info() { return lastPlanInfo; },
      cancel() { if (typeof cancelCutPlanning === 'function') cancelCutPlanning(); else {cutPlan=null; cutPlanningFor=null;} }
    };
  })();`, context);
  return { api: context.window.test, context, video };
}

test('fresh analysis announces and draws the plan (including Debug off)', async () => {
  const { api } = harness();
  // Legacy buildCutPlan returned an array and wrote diagnostic globals.
  if (process.env.YQN_LEGACY) api.setBuild(async () => [{start:10,end:20,action:'skip',reason:'sponsor'}]);
  await api.startAutoCut();
  assert.equal(api.seen.announced, 1);
  assert.equal(api.seen.markers, 1);
});

test('partial analysis never announces a final empty result',async()=>{
  const {api}=harness();let release;
  api.setBuild(async(id,current,progress)=>{
    progress([{start:0,end:600,action:'keep'}],{aiEnabled:true,transcriptLines:60,analysisProgress:'Checking sponsors'});
    await new Promise(r=>release=r);
    return {segments:[],info:{aiEnabled:true,transcriptLines:60,thoroughError:'Review failed'}};
  });
  const work=api.startAutoCut();await new Promise(r=>setImmediate(r));
  assert.equal(api.seen.announced,0);assert.match(api.emptyReason(false),/Analysis in progress/);
  assert.match(api.cutStatusText(),/Checking sponsors/);
  release();await work;assert.equal(api.seen.announced,1);
  assert.match(api.emptyReason(false),/Analysis incomplete.*Review failed/);
});
test('cached or fresh no-cut results preserve failures and distinguish preference overrides',()=>{
  const {api}=harness();
  for(const error of [{thoroughError:'Review failed'},{aiError:'HTTP 503'},{jevError:'HTTP 503'},{analysisError:true}]){
    api.setInfo({aiEnabled:true,transcriptLines:60,...error});
    assert.match(api.emptyReason(false),/Analysis incomplete/);assert.match(api.emptyReason(true),/Analysis incomplete/);
  }
  api.setInfo({aiEnabled:true,transcriptLines:60});
  api.setPlan({rawSegments:[{start:10,end:20,action:'skip'}],proposed:[],segments:[]});
  assert.match(api.emptyReason(false),/saved edits, channel rules or viewing preset/);
});
test('an empty or malformed standard AI plan is a failure, not a no-cuts verdict',async()=>{
  const {api,context}=harness();
  for(const result of [{},{highlights:[],skip:[]},{highlights:[{start:0,end:NaN}],skip:[]}]){
    context.YqnAI.request=async()=>({ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify(result)}]})});
    await assert.rejects(api.aiHighlights([{start:0,text:'Useful video content'}],600,''),/no usable section classifications/);
  }
});

test('speed-only keeps sponsor cuts even when they overlap an intro', () => {
  const { api } = harness();
  api.setSettings({speedOnly:true});
  const raw = api.normalizeSegments([
    {start:0,end:30,action:'skip',reason:'intro'},
    {start:20,end:50,action:'skip',reason:'sponsor'}
  ], 600);
  const applied = api.maybeSpeedOnly(raw);
  assert.ok(applied.some(s => s.action === 'skip' && s.start <= 25 && s.end >= 50));
  assert.ok(applied.some(s => s.action === 'speed' && s.start === 0 && s.end === 20));
});

test('restores the viewer speed after a fast section', () => {
  const { api, video } = harness();
  api.setPlan({videoId:'videoAAAAAA',segments:[{start:10,end:20,action:'speed'}]});
  video.currentTime = 12; api.onCutTick({target:video});
  assert.equal(video.playbackRate, 3);
  video.currentTime = 25; api.onCutTick({target:video});
  assert.equal(video.playbackRate, 1.5);
});

test('old video completion cannot overwrite diagnostics or the new plan', async () => {
  const { api, context } = harness();
  let finishOld;
  api.setBuild(id => id === 'videoAAAAAA' ? new Promise(r => {finishOld=r;}) :
    Promise.resolve({segments:[{start:30,end:40,action:'skip',reason:'sponsor'}],info:{name:'new'}}));
  const old = api.startAutoCut();
  await new Promise(r => setImmediate(r));
  context.location.search = '?v=videoBBBBBB';
  api.setPreferencesFor('videoBBBBBB');
  const newer = api.startAutoCut(); await newer;
  finishOld({segments:[],info:{name:'old'}}); await old;
  assert.equal(api.plan().videoId, 'videoBBBBBB');
  assert.equal(api.info().name, 'new');
});

test('analysis waits for saved preferences before applying default cuts', async () => {
  const { api } = harness();
  api.setPreferencesFor(null);
  await api.startAutoCut(true, true);
  assert.equal(api.seen.builds, 0);
  assert.equal(api.plan(), null);
  api.setPreferencesFor('videoAAAAAA');
  await api.startAutoCut();
  assert.equal(api.seen.builds, 1);
});

test('cancelling same-video work prevents its stale result from returning', async () => {
  const { api } = harness();
  let finish;
  api.setBuild(() => new Promise(r => {finish=r;}));
  const work = api.startAutoCut(); await new Promise(r => setImmediate(r));
  api.cancel();
  finish({segments:[{start:10,end:20,action:'skip',reason:'stale'}],info:{}}); await work;
  assert.equal(api.plan(), null);
});

test('skip wins over overlapping speed and segment times stay within duration', () => {
  const { api } = harness();
  const out = api.normalizeSegments([
    {start:0,end:100,action:'speed',reason:'dull'},
    {start:30,end:50,action:'skip',reason:'sponsor'},
    {start:NaN,end:100,action:'skip'},
  ], 80);
  assert.deepEqual(JSON.parse(JSON.stringify(out)).map(({start,end,action}) => ({start,end,action})), [
    {start:0,end:30,action:'speed'}, {start:30,end:50,action:'skip'}, {start:50,end:80,action:'speed'}
  ]);
});

test('duplicate or out-of-range AI highlights cannot fake sufficient coverage', () => {
  const {api}=harness();
  assert.equal(api.speedOutsideHighlights(Array.from({length:20},()=>({start:10,end:15})),600).length,0);
  assert.equal(api.speedOutsideHighlights([{start:600,end:900}],600).length,0);
});

test('verified keeps defeat weak cuts while community sponsor evidence remains active',()=>{
  const {api}=harness();
  const out=api.normalizeSegments([
    {start:0,end:100,action:'keep',source:'unreviewed'},
    {start:0,end:100,action:'skip',reason:'Jev: sponsor',source:'jev'},
    {start:10,end:40,action:'keep',reason:'Useful demo',verified:true,source:'thorough'},
    {start:50,end:60,action:'skip',reason:'sponsor',source:'sponsorblock',sponsor:true},
  ],100);
  assert.equal(out.find(s=>s.start<=20&&s.end>20).action,'keep');
  assert.equal(out.find(s=>s.start<=80&&s.end>80).action,'keep');
  assert.equal(out.find(s=>s.start<=55&&s.end>55).action,'skip');
});

test('Jev batches include evidence for every requested window beyond the old transcript cap',async()=>{
  const {api}=harness();const calls=[];
  api.setProxy(async(url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    const answers={};
    for(const [key,q] of Object.entries(body.questions)) {
      const start=Number(q.instructions.match(/from (\d+)s/)[1]);
      assert.ok(body.state.includes(`[${start}]`),`Missing evidence for ${start}`);
      answers[key]={choice:'keep',probabilities:{keep:0.95}};
    }
    return {ok:true,status:200,body:{answers}};
  });
  const transcript=Array.from({length:900},(_,i)=>({start:i*5,text:('Useful source text '+i+' ').repeat(30)}));
  assert.ok(transcript.map(t=>t.text).join('').length>300000);
  const cuts=await api.jevCutSegments(transcript,4500);
  assert.ok(calls.length>3);assert.ok(calls.at(-1).state.includes('Useful source text 899'));
  assert.ok(cuts.every(s=>s.action==='keep'));
});

test('onCutTick pauses skips and restores normal playback speed while a YouTube ad is playing', () => {
  const { api, context, video } = harness();
  let adShowing = false;
  context.document.querySelector = (sel) => {
    if (sel === '#movie_player, .html5-video-player') {
      return { classList: { contains: (c) => adShowing && c === 'ad-showing' } };
    }
    return null;
  };
  api.setPlan({
    videoId: 'videoAAAAAA',
    segments: [
      { start: 5, end: 25, action: 'skip', reason: 'sponsor' },
      { start: 30, end: 50, action: 'speed', reason: 'filler' },
    ],
  });
  // Enter a speed segment on the main video first.
  video.currentTime = 35;
  api.onCutTick({ target: video });
  assert.equal(video.playbackRate, 3);

  // Mid-roll ad starts at ad time 10s (which would match skip 5..25 on the main video!).
  adShowing = true;
  video.currentTime = 10;
  api.onCutTick({ target: video });
  assert.equal(video.currentTime, 10, 'Must never seek an ad using main-video skip segments');
  assert.equal(video.playbackRate, 1.5, 'Must restore base rate during an ad');

  // Ad finishes; main video resumes at 10s -> sponsor skip now fires.
  adShowing = false;
  api.onCutTick({ target: video });
  assert.ok(video.currentTime > 25);
});

test('injected helper hides state globals, parses XML dur attributes, and forwards multi-account headers', async () => {
  const posted = [];
  const fetchCalls = [];
  const unrefTimeout = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };
  const win = {
    location: { origin: 'https://www.youtube.com', search: '?v=videoAAAAAA' },
    ytcfg: {
      data_: {
        INNERTUBE_API_KEY: 'key123',
        INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: '2.2026' } },
        SESSION_INDEX: '2',
        DELEGATED_SESSION_ID: 'brand-page-99',
      },
      get(k) { return this.data_[k]; },
    },
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input.href;
      fetchCalls.push({ url, init });
      if (url.includes('/api/timedtext') && url.includes('fmt=json3')) {
        const res = { ok: true, status: 200, text: async () => '', clone() { return res; } };
        return res;
      }
      if (url.includes('/api/timedtext')) {
        const res = {
          ok: true,
          status: 200,
          text: async () => '<transcript><text dur="4.5" start="12.5">Hello &amp; welcome</text></transcript>',
          clone() { return res; },
        };
        return res;
      }
      const res = {
        ok: true,
        status: 200,
        json: async () => ({
          videoDetails: { videoId: 'videoAAAAAA', lengthSeconds: '120', isLive: true },
          captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=videoAAAAAA', languageCode: 'en' }] } },
        }),
        clone() { return res; },
      };
      return res;
    },
    XMLHttpRequest: function () {},
    addEventListener(type, fn) { if (type === 'message') win._onMsg = fn; },
    postMessage(data) { posted.push(data); },
  };
  win.XMLHttpRequest.prototype = { open() {}, send() {}, addEventListener() {} };
  const ctx = vm.createContext({
    window: win, location: win.location, fetch: (...a) => win.fetch(...a),
    document: { cookie: 'SAPISID=fake_sapisid; path=/', getElementById: () => null, querySelector: () => null },
    URL, URLSearchParams, TextEncoder, crypto: require('node:crypto').webcrypto, console, setTimeout: unrefTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'topics.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'injected.js'), 'utf8'), ctx);
  assert.equal('__yqnTx' in win, false);
  assert.equal('__yqnTt' in win, false);
  assert.equal(Object.keys(win).includes('__yqnInjected'), false);

  win._onMsg({ source: win, data: { source: 'yqn', type: 'autocut-data', requestId: 'r1', videoId: 'videoAAAAAA', needHeatmap: false, needTranscript: true } });
  for (let i = 0; i < 40 && !posted.some((m) => m.type === 'autocut-data' && m.requestId === 'r1'); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const reply = posted.find((m) => m.type === 'autocut-data' && m.requestId === 'r1');
  assert.ok(reply);
  assert.deepEqual(JSON.parse(JSON.stringify(reply.payload.transcript)), [{ start: 12.5, duration: 4.5, text: 'Hello & welcome' }]);
  const playerCall = fetchCalls.find((c) => c.url.includes('/youtubei/v1/player'));
  assert.equal(playerCall.init.headers['X-Goog-AuthUser'], '2');
  assert.equal(playerCall.init.headers['X-Goog-PageId'], 'brand-page-99');
});

test('background fetch proxy rejects messages from foreign extension IDs', async () => {
  let listener;
  const ctx = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout,
    importScripts() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    chrome: { runtime: { id: 'own-ext', onMessage: { addListener(fn) { listener = fn; } } } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), ctx);
  let foreignReply;
  listener({ type: 'yqn-proxy-fetch', url: 'https://sponsor.ajay.app/api/skipSegments/0000' }, { id: 'foreign-ext' }, (r) => { foreignReply = r; });
  assert.deepEqual(JSON.parse(JSON.stringify(foreignReply)), { ok: false, error: 'unauthorized sender' });
});

test('real-time Web Audio silence speedup boosts sustained dead air and restores immediately on speech', async () => {
  const { api, video } = harness();
  video.playbackRate = 1.25;
  video.paused = false;
  video.seeking = false;
  video.muted = false;
  video.volume = 1;
  let currentDb = -18;
  api.setAudioDb(() => currentDb);
  api.setSettings({ cutSilence: true, speedRate: 3 });
  api.setPlan({ videoId: 'videoAAAAAA', segments: [] });

  // Initial loud speech establishes hasHeardAudio without changing playbackRate.
  video.currentTime = 5;
  api.onCutTick({ target: video });
  assert.equal(video.playbackRate, 1.25);

  // Enter dead air (-55 dBFS) and wait past the 550ms minimum silence window.
  currentDb = -55;
  api.onCutTick({ target: video });
  assert.equal(video.playbackRate, 1.25);
  await new Promise((r) => setTimeout(r, 580));
  video.currentTime = 5.6;
  api.onCutTick({ target: video });
  assert.equal(video.playbackRate, 3);
  assert.equal(video.__yqnSilentSped, true);

  // Speech resumes (-18 dBFS) -> playbackRate restores to 1.25 immediately.
  currentDb = -18;
  video.currentTime = 7.4;
  api.onCutTick({ target: video });
  assert.equal(video.playbackRate, 1.25);
  assert.equal(Boolean(video.__yqnSilentSped), false);
});

test('per-channel normal speed restores after Auto-Cut speedups and resets cleanly on navigation', () => {
  const { api, video } = harness();
  video.playbackRate = 1;
  api.setChannelSpeed(1.75);
  assert.equal(video.playbackRate, 1.75);

  api.setPlan({ videoId: 'videoAAAAAA', segments: [{ start: 10, end: 20, action: 'speed', reason: 'filler' }] });
  video.currentTime = 12;
  api.onCutTick({ target: video });
  assert.equal(video.playbackRate, 3);

  video.currentTime = 25;
  api.onCutTick({ target: video });
  assert.equal(video.playbackRate, 1.75);

  // Navigating to a new video resets channel-applied speed back to 1x.
  api.resetControls();
  assert.equal(video.playbackRate, 1);
});

test('submitSponsorBlock posts valid segment via proxy and saves local skip override', async () => {
  const { api, context } = harness();
  const localStore = {};
  context.chrome.storage.local = {
    get(keys, cb) {
      const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || localStore);
      const out = {};
      for (const k of list) if (k in localStore) out[k] = localStore[k];
      cb(out);
    },
    set(patch, cb) {
      Object.assign(localStore, patch);
      if (cb) cb();
      return Promise.resolve();
    },
    remove(keys, cb) {
      for (const k of [].concat(keys)) delete localStore[k];
      if (cb) cb();
      return Promise.resolve();
    },
  };
  const posted = [];
  api.setProxy(async (url, options) => {
    posted.push({ url, options });
    return { ok: true, status: 200, body: [] };
  });
  api.setPlan({ videoId: 'videoAAAAAA', rawSegments: [], segments: [], rows: [] });
  const res = await api.toolsApi.submitSponsorBlock({ start: 30, end: 55 }, 'sponsor');
  assert.equal(res.ok, true);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, 'https://sponsor.ajay.app/api/skipSegments');
  const payload = JSON.parse(posted[0].options.body);
  assert.equal(payload.videoID, 'videoAAAAAA');
  assert.equal(payload.startTime, 30);
  assert.equal(payload.endTime, 55);
  assert.equal(payload.category, 'sponsor');
  assert.equal(payload.userID.length, 32);
  assert.equal(localStore['yqnCutEditsV1:videoAAAAAA'][0].action, 'skip');
});

test('background chrome.commands forwards shortcut commands to the active tab', () => {
  let commandListener;
  const sent = [];
  const ctx = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout,
    importScripts() {},
    fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }),
    chrome: {
      runtime: { id: 'own-ext', onMessage: { addListener() {} } },
      commands: { onCommand: { addListener(fn) { commandListener = fn; } } },
      tabs: {
        query(_q, cb) { cb([{ id: 42 }]); },
        sendMessage(tabId, msg) { sent.push({ tabId, msg }); },
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), ctx);
  commandListener('bookmark-note');
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ tabId: 42, msg: { type: 'yqn-command', command: 'bookmark-note' } }]);
});

test('buildCutPlan starts SponsorBlock and page data in parallel and progressively publishes heatmap and Jev before slow AI', async () => {
  const { api, context } = harness();
  api.setSettings({
    cutMessaging: true,
    cutBoring: true,
    jevCuts: true,
    typesafeKey: 'jev-key',
    aiHighlights: true,
    anthropicKey: 'claude-key',
    thoroughAnalysis: false,
  });

  let sbStarted = false;
  let pageDataStartedWhileSbPending = false;
  let releaseSb;
  let releaseAi;

  api.setProxy(async (url) => {
    if (url.startsWith('https://sponsor.ajay.app/')) {
      sbStarted = true;
      await new Promise((r) => { releaseSb = r; });
      return {
        ok: true,
        status: 200,
        body: [{ videoID: 'videoAAAAAA', segments: [{ segment: [15, 35], category: 'sponsor', actionType: 'skip' }] }],
      };
    }
    if (url.startsWith('https://api.typesafe.ai/')) {
      return {
        ok: true,
        status: 200,
        body: { answers: { w0: { choice: 'sponsor', probabilities: { sponsor: 0.95 } } } },
      };
    }
    throw new Error('Unexpected proxy url: ' + url);
  });

  const heatmap = Array.from({ length: 20 }, (_, i) => ({
    start: i * 30,
    end: (i + 1) * 30,
    score: i >= 6 && i <= 8 ? 0.05 : 0.8,
  }));

  api.setPageData(async () => {
    pageDataStartedWhileSbPending = true;
    return {
      duration: 600,
      heatmap,
      transcript: Array.from({ length: 12 }, (_, i) => ({ start: i * 10, text: 'Spoken line ' + i })),
    };
  });

  context.YqnAI.request = async (url, options, _id, transport) => {
    if (transport) return transport(url, options);
    await new Promise((r) => { releaseAi = r; });
    return {
      ok: true,
      json: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            highlights: [{ start: 0, end: 500 }],
            skip: [{ start: 520, end: 560, reason: 'outro' }],
            chapters: [],
            summary: 'Done',
            takeaways: [],
            mentions: [],
          }),
        }],
      }),
    };
  };

  const published = [];
  const planPromise = api.realBuildCutPlan('videoAAAAAA', () => true, (segs, info) => {
    published.push({ segs: JSON.parse(JSON.stringify(segs)), sbCount: info.sbCount, jevCount: info.jevCount });
  });

  // Allow microtasks + SHA-256 to kick off both tasks without resolving SponsorBlock or Claude.
  for (let i = 0; i < 20 && (!sbStarted || !releaseAi); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(sbStarted, true);
  assert.equal(pageDataStartedWhileSbPending, true, 'Page data must not wait for SponsorBlock');
  // Heatmap and fast Jev cuts have ALREADY progressively published while SponsorBlock & Claude are still pending!
  assert.ok(published.length >= 2, 'Heatmap and Jev should progressively publish before slow AI finishes');
  assert.ok(published.some((p) => p.jevCount > 0), 'Jev cuts should publish before Claude finishes');

  releaseSb();
  releaseAi();
  const finalPlan = await planPromise;
  assert.equal(finalPlan.info.sbCount, 1);
  assert.ok(finalPlan.segments.some((s) => s.start === 15 && s.end === 35 && s.action === 'skip'));
  assert.ok(finalPlan.segments.some((s) => s.start === 520 && s.end === 560 && s.action === 'skip'));
});

test('startAutoCut reuses verified video metadata without a duplicate bridge round-trip', async () => {
  const { api } = harness();
  let categoryCalls = 0;
  api.setCategoryFn(async () => {
    categoryCalls++;
    return { category: 'Education', title: 'Tutorial', duration: 600 };
  });
  api.setLastMeta({ videoId: 'videoAAAAAA', category: 'Education', title: 'Tutorial', duration: 600, isLive: false });
  api.setSettings({ minCutMinutes: 2, autoIgnoreMusic: true });
  await api.startAutoCut(false, false);
  assert.equal(categoryCalls, 0, 'Cached complete video metadata must prevent duplicate bridge query');
  assert.equal(api.seen.builds, 1);
});

test('injected helper reads live ytd-watch-flexy SPA data without calling /youtubei/v1/next', async () => {
  const posted = [];
  const fetchCalls = [];
  const unrefTimeout = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };
  const flexy = {
    playerData: {
      videoDetails: { videoId: 'videoSPA123', lengthSeconds: '300', title: 'SPA Video', shortDescription: '' },
    },
    data: {
      currentVideoEndpoint: { watchEndpoint: { videoId: 'videoSPA123' } },
      frameworkUpdates: {
        entityBatchUpdate: {
          mutations: [{
            payload: {
              macroMarkersListEntity: {
                markersList: {
                  heatMarkers: [{ timeRangeStartMillis: 0, markerDurationMillis: 10000, heatMarkerIntensityScoreNormalized: 0.9 }],
                },
              },
            },
          }],
        },
      },
      engagementPanels: [{
        engagementPanelSectionListRenderer: {
          content: { continuationItemRenderer: { continuationEndpoint: { getTranscriptEndpoint: { params: 'spa-params' } } } },
        },
      }],
    },
  };
  const win = {
    location: { origin: 'https://www.youtube.com', search: '?v=videoSPA123' },
    ytInitialPlayerResponse: { videoDetails: { videoId: 'oldInitialVideo', lengthSeconds: '60' } },
    ytcfg: {
      get(k) {
        return ({ INNERTUBE_API_KEY: 'key123', INNERTUBE_CONTEXT: { client: { clientName: 'WEB' } } })[k];
      },
    },
    fetch: async (input) => {
      const url = typeof input === 'string' ? input : input.href;
      fetchCalls.push(url);
      if (url.includes('/youtubei/v1/get_transcript')) {
        const res = {
          ok: true,
          status: 200,
          json: async () => ({
            initialSegments: [{ transcriptSegmentRenderer: { startMs: '0', endMs: '5000', snippet: { runs: [{ text: 'SPA caption' }] } } }],
          }),
          clone() { return res; },
        };
        return res;
      }
      throw new Error('Unexpected fetch: ' + url);
    },
    XMLHttpRequest: function () {},
    addEventListener(type, fn) { if (type === 'message') win._onMsg = fn; },
    postMessage(data) { posted.push(data); },
  };
  win.XMLHttpRequest.prototype = { open() {}, send() {}, addEventListener() {} };
  const ctx = vm.createContext({
    window: win, location: win.location, fetch: (...a) => win.fetch(...a),
    document: {
      cookie: 'SAPISID=fake_sapisid; path=/',
      getElementById: () => null,
      querySelector: (sel) => (sel === 'ytd-watch-flexy' ? flexy : null),
    },
    URL, URLSearchParams, TextEncoder, crypto: require('node:crypto').webcrypto, console,
    setTimeout: unrefTimeout, clearTimeout, setInterval: unrefTimeout, clearInterval,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'topics.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'injected.js'), 'utf8'), ctx);

  win._onMsg({ source: win, data: { source: 'yqn', type: 'autocut-data', requestId: 'spa1', videoId: 'videoSPA123', needHeatmap: true, needTranscript: true } });
  for (let i = 0; i < 40 && !posted.some((m) => m.type === 'autocut-data' && m.requestId === 'spa1'); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const reply = posted.find((m) => m.type === 'autocut-data' && m.requestId === 'spa1');
  assert.ok(reply);
  assert.equal(reply.payload.duration, 300);
  assert.equal(reply.payload.heatmap.length, 1);
  assert.equal(reply.payload.transcript[0].text, 'SPA caption');
  assert.equal(fetchCalls.some((u) => u.includes('/youtubei/v1/next')), false, 'Should not call /next when ytd-watch-flexy already has current video data');
});

test('onCutTick applies soft-landing cushions, WPM-aware speeds, unbuffered short-skip bursts, Hold-to-2x protection and context skip toasts', () => {
  const { api, video } = harness();
  video.playbackRate = 1.25;
  video.paused = false;
  video.seeking = false;
  video.muted = false;
  video.volume = 1;

  api.setSettings({ speedRate: 3, cutSilence: true, shortcutsEnabled: true });
  api.setAudioDb(() => -55); // Even with silent audio, soft-landing cushion must NOT re-accelerate right before highlight speech!
  api.setPlan({
    videoId: 'videoAAAAAA',
    chapters: [{ start: 0, title: 'Intro' }, { start: 48, title: 'Architecture Deep Dive' }],
    segments: [
      { start: 10, end: 20, action: 'speed', reason: 'rapid recap', wpm: 210 },
      { start: 25, end: 27.5, action: 'skip', reason: 'throat clear', sponsor: false },
      { start: 30, end: 50, action: 'skip', reason: 'sponsor', sponsor: true },
    ],
  });

  // 1) Fast talker (210 WPM) at configured 3x tempers to 2x (420 WPM comprehension ceiling).
  video.currentTime = 12;
  api.onCutTick({ target: video });
  assert.equal(video.playbackRate, 2);

  // 2) YouTube native Hold-to-2x gesture during sped playback must NOT overwrite baseRate (1.25x).
  api.setHoldBoost(true);
  video.playbackRate = 2;
  api.onCutTick({ target: video, type: 'ratechange' });
  api.setHoldBoost(false);

  // 3) Soft-landing cushion (0.22s before 20s -> 19.78s..20s) drops smoothly back to 1.25x without dead-air re-boost.
  video.currentTime = 19.85;
  api.onCutTick({ target: video });
  assert.equal(video.playbackRate, 1.25, 'Must decelerate in pre-speech cushion and preserve 1.25x baseRate');

  // 4) Unbuffered short non-sponsor skip (25..27.5s) bursts at 4x instead of seeking into unbuffered MSE gap.
  let bufferedEnd = 26.0;
  video.buffered = {
    length: 1,
    start() { return 0; },
    end() { return bufferedEnd; },
  };
  video.currentTime = 25.2;
  api.onCutTick({ target: video });
  assert.equal(video.currentTime, 25.2, 'Unbuffered short skip must not stall MSE with a seek');
  assert.equal(video.playbackRate, 4, 'Unbuffered short skip bursts at 4x');

  // Once buffer catches up past 27.5s, it seeks cleanly to 27.51s and restores 1.25x.
  bufferedEnd = 60.0;
  video.currentTime = 25.6;
  api.onCutTick({ target: video });
  assert.ok(Math.abs(video.currentTime - 27.51) < 0.02);
  assert.equal(video.playbackRate, 1.25);

  // 5) Sponsor skip jumps immediately and shows skipped duration + landed topic + undo shortcut.
  video.currentTime = 30.2;
  api.onCutTick({ target: video });
  assert.ok(video.currentTime >= 50);
  assert.equal(api.seen.toasts.at(-1), 'Skipped 20s · sponsor → Architecture Deep Dive · Shift+Z undo');
});

test('fetchSponsorBlock and submitSponsorBlock handle poi_highlight cleanly without polluting skip segments', async () => {
  const { api, context } = harness();
  const localData = {};
  context.chrome.storage.local = {
    get(keys, cb) {
      const res = typeof keys === 'string' ? { [keys]: localData[keys] } :
        Array.isArray(keys) ? Object.fromEntries(keys.map(k => [k, localData[k]])) : { ...localData };
      if (cb) cb(res);
      return Promise.resolve(res);
    },
    set(obj, cb) { Object.assign(localData, obj); if (cb) cb(); return Promise.resolve(); },
    remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete localData[k]); if (cb) cb(); return Promise.resolve(); },
  };
  let seenGetUrl = '';
  let postedBody = null;
  api.setProxy(async (url, opts) => {
    if (opts?.method === 'POST') {
      postedBody = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    }
    seenGetUrl = url;
    return {
      ok: true,
      status: 200,
      body: [{
        videoID: 'videoAAAAAA',
        segments: [
          { segment: [15, 45], category: 'sponsor', actionType: 'skip' },
          { segment: [182.5, 182.5], category: 'poi_highlight', actionType: 'poi' },
        ],
      }],
    };
  });

  const segs = await api.fetchSponsorBlock('videoAAAAAA');
  assert.match(decodeURIComponent(seenGetUrl), /poi_highlight/);
  assert.match(decodeURIComponent(seenGetUrl), /"poi"/);
  assert.equal(segs.length, 1, 'POI highlight must never become a skip segment');
  assert.equal(segs[0].reason, 'sponsor');
  assert.deepEqual([...api.pois('videoAAAAAA')], [182.5]);

  const sub = await api.toolsApi.submitSponsorBlock({ start: 240, end: 240 }, 'poi_highlight');
  assert.equal(sub.ok, true);
  assert.equal(postedBody.category, 'poi_highlight');
  assert.equal(postedBody.actionType, 'poi');
  assert.equal(postedBody.startTime, 240);
  assert.equal(postedBody.endTime, 240);
  assert.deepEqual([...api.pois('videoAAAAAA')], [182.5, 240]);
  assert.equal('yqnCutEditsV1:videoAAAAAA' in localData, false, 'POI highlight submission must not write a local cut edit');
});

test('playlist outro auto-advance clicks .ytp-next-button once, flushes lifetime savings, and Shift+F opens Search tab', async () => {
  const { api, context, video } = harness();
  const localData = {};
  context.chrome.storage.local = {
    get(keys, cb) {
      const res = typeof keys === 'string' ? { [keys]: localData[keys] } :
        Array.isArray(keys) ? Object.fromEntries(keys.map(k => [k, localData[k]])) : { ...localData };
      if (cb) cb(res);
      return Promise.resolve(res);
    },
    set(obj, cb) { Object.assign(localData, obj); if (cb) cb(); return Promise.resolve(); },
  };
  let nextClicks = 0;
  context.location.search = '?v=videoAAAAAA&list=WL';
  context.document.querySelector = (sel) => {
    if (sel.includes('.ytp-next-button')) return { click() { nextClicks++; } };
    return null;
  };
  let openedTab = null;
  context.YqnVideoTools = { open(_api, tab) { openedTab = tab; return () => {}; } };
  assert.equal(api.runCommand('search-transcript'), true);
  assert.equal(openedTab, 'Search');

  video.duration = 600;
  video.paused = false;
  video.seeking = false;
  video.playbackRate = 1;
  api.setSettings({ autoAdvancePlaylist: true });
  api.setPlan({
    videoId: 'videoAAAAAA',
    segments: [{ start: 575, end: 599, action: 'skip', reason: 'outro', sponsor: false }],
  });
  video.currentTime = 576;
  api.onCutTick({ target: video });
  assert.equal(nextClicks, 1, 'Outro skip in playlist clicks YouTube Next button');
  assert.equal(api.seen.toasts.at(-1), '⏭ Skipped outro → next in playlist');

  // Second tick on same video must not double-click Next while YouTube transitions.
  api.onCutTick({ target: video });
  assert.equal(nextClicks, 1);

  await api.flushLifetimeSavings('videoAAAAAA');
  assert.ok(localData.yqnLifetimeSavingsV1, 'Lifetime savings flushed to local storage');
  assert.ok(localData.yqnLifetimeSavingsV1.total.skip >= 22);
});

test('A-B loop wraps playback, suppresses overlapping Auto-Cut skips, and Shorts auto-redirect uses location.replace', () => {
  const { api, context, video } = harness();
  let replacedUrl = null;
  context.location.replace = (url) => { replacedUrl = url; };

  video.duration = 600;
  video.paused = false;
  video.seeking = false;
  video.playbackRate = 1;
  api.setPlan({
    videoId: 'videoAAAAAA',
    segments: [{ start: 20, end: 50, action: 'skip', reason: 'sponsor', sponsor: true }],
  });

  // Set A at 18s, then B at 32s (straddling the [20,50] sponsor skip!).
  video.currentTime = 18;
  assert.equal(api.runCommand('toggle-ab-loop'), true);
  assert.match(api.seen.toasts.at(-1), /Loop start A set at 0:18/);

  video.currentTime = 32;
  assert.equal(api.runCommand('toggle-ab-loop'), true);
  assert.match(api.seen.toasts.at(-1), /Looping 0:18 → 0:32/);
  assert.equal(video.currentTime, 18, 'Activating B jumps immediately to loop start A');

  // Inside the A-B loop at 25s, the overlapping [20,50] skip MUST be suppressed.
  video.currentTime = 25;
  api.onCutTick({ target: video });
  assert.equal(video.currentTime, 25);

  // Reaching B (32s) wraps immediately back to A (18s).
  video.currentTime = 32;
  api.onCutTick({ target: video });
  assert.equal(video.currentTime, 18);

  // Third press clears the loop, so Auto-Cut skip resumes at 25s.
  assert.equal(api.runCommand('toggle-ab-loop'), true);
  assert.equal(api.seen.toasts.at(-1), '🔁 Loop cleared');
  video.currentTime = 25;
  api.onCutTick({ target: video });
  assert.ok(video.currentTime >= 50, 'Clearing loop restores normal Auto-Cut skipping');

  // Shorts auto-redirect replaces history entry cleanly once per Short ID.
  context.location.pathname = '/shorts/videoBBBBBB';
  context.location.search = '?t=9';
  context.location.href = 'https://www.youtube.com/shorts/videoBBBBBB?t=9';
  api.setSettings({ redirectShorts: true });
  assert.equal(api.handleShortsPage(), true);
  assert.equal(replacedUrl, 'https://www.youtube.com/watch?v=videoBBBBBB&t=9s');
});
