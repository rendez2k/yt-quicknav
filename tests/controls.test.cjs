const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../cut-controls.js');
const {
  presetPatch, applyEdits, editRange, normalizeBaseSpeed,
  cycleQuickSpeed, stepQuickSpeed, shouldAutoAdvancePlaylist, computeThumbnailBadge,
  computeRemainingWatchTime, formatRemainingClock, advanceAbLoop, parseShortsPath, buildFrameFilename,
  recordLifetimeSavings, summarizeLifetimeSavings,
  coalesceMicroGaps, annotateSpeechDensity, resolveSpeedRate,
  effectiveSpeedEnd, nextBoundaryDelayMs, isTimeBuffered,
  shouldBurstShortSkip, formatSkipToast, tldrReelBudget, buildTldrDigest, formatTldrMarkdown,
  SavingsTracker, SilenceDetector,
}=globalThis.YqnControls;
const raw=[{start:0,end:10,action:'skip',reason:'intro'},
  {start:10,end:30,action:'skip',reason:'sponsor'},
  {start:40,end:60,action:'speed',reason:'filler'}];

test('presets keep paid provider switches and keys untouched',()=>{
  for (const id of ['custom','sponsors','gentle','quick','tldr']) {
    for (const key of ['anthropicKey','typesafeKey','aiHighlights','jevCuts','autoCut'])
      assert.equal(key in presetPatch(id),false);
  }
});
test('TL;DR preset upgrades speed segments to skip unless speedOnly is enabled',()=>{
  assert.deepEqual(applyEdits(raw,[],presetPatch('tldr')).map(s=>s.action),['skip','skip','skip']);
  assert.deepEqual(applyEdits(raw,[],{...presetPatch('tldr'),speedOnly:true}).map(s=>s.action),['speed','skip','speed']);
});
test('Sponsors only keeps intros and filler while Gentle speeds intros',()=>{
  assert.deepEqual(applyEdits(raw,[],presetPatch('sponsors')).map(s=>s.action),['keep','skip','keep']);
  assert.deepEqual(applyEdits(raw,[],presetPatch('gentle')).map(s=>s.action),['speed','skip','speed']);
});
test('explicit section changes override a preset and restore with Auto',()=>{
  const edits=editRange([],10,30,'keep');
  assert.equal(applyEdits(raw,edits,presetPatch('sponsors'))[1].action,'keep');
  assert.equal(applyEdits(raw,editRange(edits,10,30,'default'),presetPatch('sponsors'))[1].action,'skip');
});
test('edits survive changed source boundaries and preserve neighbouring actions',()=>{
  let edits=editRange([],5,25,'keep');
  edits=editRange(edits,15,20,'speed');
  const rows=applyEdits(raw,edits,{speedOnly:false});
  assert.equal(rows.find(s=>s.start===10).action,'keep');
  assert.equal(rows.find(s=>s.start===15).action,'speed');
  assert.equal(rows.find(s=>s.start===20).action,'keep');
  assert.equal(rows.find(s=>s.start===25).action,'skip');
  const restored=editRange(edits,15,20,'default');
  assert.equal(applyEdits(raw,restored,{}) .find(s=>s.start===15).action,'skip');
});
test('saved edits stay visible if a later source omits that section',()=>{
  const rows=applyEdits([], [{start:10,end:20,action:'keep'}], {});
  assert.equal(rows[0].reason,'Your saved section');
  assert.equal(rows[0].action,'keep');
});
test('invalid persisted data cannot produce a cut',()=>{
  assert.deepEqual(applyEdits([], [{start:-1,end:5,action:'skip'}, {start:1,end:9,action:'unknown'}],{}),[]);
});
test('savings count real speed progress, but not pauses, seeks or stalls',()=>{
  const tracker=new SavingsTracker(); const element={};
  const sample=(time,now,extra={})=>tracker.sample({time,now,paused:false,seeking:false,rate:3,baseRate:1.5,sped:true,element,...extra});
  sample(0,0);sample(3,1000);
  assert.equal(tracker.total,1);
  sample(6,2000,{paused:true});sample(9,3000,{paused:true});
  sample(300,4000,{seeking:true});sample(300,5000);sample(300,6000);
  assert.equal(tracker.total,1);
});
test('undo refunds skip credit once and paused jumps earn no time',()=>{
  const tracker=new SavingsTracker();
  assert.equal(tracker.skip(30,1.5,true),20);
  assert.equal(tracker.skip(30,1.5,false),0);
  tracker.refund(20);assert.equal(tracker.total,0);
});
test('normalizeBaseSpeed clamps valid channel playback speeds and treats 0 or invalid as default',()=>{
  assert.equal(normalizeBaseSpeed(0),0);
  assert.equal(normalizeBaseSpeed(-1),0);
  assert.equal(normalizeBaseSpeed(NaN),0);
  assert.equal(normalizeBaseSpeed('bad'),0);
  assert.equal(normalizeBaseSpeed(0.25),0.5);
  assert.equal(normalizeBaseSpeed(1.25),1.25);
  assert.equal(normalizeBaseSpeed(1.3333),1.33);
  assert.equal(normalizeBaseSpeed(8),4);
});
test('SilenceDetector ignores silent/CORS-zeroed tracks until real audio is heard, then applies hysteresis',()=>{
  const d=new SilenceDetector({thresholdDb:-42,minSilenceMs:550,releaseMs:100});
  const silentSamples=new Float32Array(256);
  assert.ok(SilenceDetector.rmsToDb(silentSamples)<-100);
  const loudSamples=new Float32Array(256).fill(0.2);
  assert.ok(SilenceDetector.rmsToDb(loudSamples)>-15);

  // Never speeds up a zeroed/silent audio track before real audio is heard.
  assert.equal(d.update({db:-80,now:0,active:true}),false);
  assert.equal(d.update({db:-80,now:2000,active:true}),false);

  // Hear speech (-18 dBFS), then a brief 300ms pause (below 550ms threshold).
  assert.equal(d.update({db:-18,now:2100,active:true}),false);
  assert.equal(d.hasHeardAudio,true);
  assert.equal(d.update({db:-55,now:2200,active:true}),false);
  assert.equal(d.update({db:-55,now:2500,active:true}),false);
  assert.equal(d.update({db:-18,now:2550,active:true}),false);

  // Sustained dead air >= 550ms activates silence speedup, and speech drops out immediately.
  assert.equal(d.update({db:-55,now:3000,active:true}),false);
  assert.equal(d.update({db:-55,now:3560,active:true}),true);
  assert.equal(d.update({db:-40,now:3600,active:true}),true,'Hysteresis band holds state without chatter');
  assert.equal(d.update({db:-20,now:3620,active:true}),false,'Strong speech onset exits silence immediately');

  // resetAll clears hasHeardAudio for a newly routed video element.
  d.resetAll();
  assert.equal(d.hasHeardAudio,false);
  assert.equal(d.update({db:-55,now:5000,active:true}),false);
});
test('SilenceDetector adaptive noise-floor speeds up pauses over quiet background music without misfiring on continuous speech',()=>{
  const d=new SilenceDetector();
  assert.equal(d.minSilenceMs,320);
  // Speaker talking at -14 dBFS establishes speech envelope.
  assert.equal(d.update({db:-14,now:0,active:true}),false);
  assert.equal(d.update({db:-13,now:100,active:true}),false);
  // Continuous loud music/speech between -14 and -19 dBFS never false-triggers.
  for (let t=200;t<=1200;t+=100) {
    assert.equal(d.update({db:-18,now:t,active:true}),false);
  }
  // Speaker pauses while -34 dBFS background music/room tone continues (well above fixed -42 dBFS).
  assert.equal(d.update({db:-34,now:1300,active:true}),false);
  assert.equal(d.update({db:-34,now:1630,active:true}),true,'Adaptive floor catches pause over -34 dBFS BGM after 320ms');
  // Speaker resumes (-16 dBFS) -> drops back to normal speed in 0ms.
  assert.equal(d.update({db:-16,now:1660,active:true}),false);
});
test('coalesceMicroGaps bridges tiny unverified gaps without eating verified or protected highlights',()=>{
  // Two identical speed segments separated by 1.5s merge into one continuous block.
  const merged=coalesceMicroGaps([
    {start:10,end:20,action:'speed',reason:'low replays'},
    {start:21.5,end:35,action:'speed',reason:'low replays'},
  ]);
  assert.equal(merged.length,1);
  assert.deepEqual({start:merged[0].start,end:merged[0].end},{start:10,end:35});

  // Distinct reasons (intro + sponsor separated by 0.6s breath) close the seam while keeping both badges.
  const bridged=coalesceMicroGaps([
    {start:0,end:14.4,action:'skip',reason:'intro',sponsor:false},
    {start:15,end:40,action:'skip',reason:'sponsor',sponsor:true},
  ]);
  assert.equal(bridged.length,2);
  assert.equal(bridged[0].end,15);
  assert.equal(bridged[1].start,15);

  // Unverified 1.2s keep sandwiched between two speeds is absorbed; verified/protected keeps are never touched.
  const withKeep=coalesceMicroGaps([
    {start:0,end:10,action:'speed',reason:'filler'},
    {start:10,end:11.2,action:'keep',source:'unreviewed'},
    {start:11.2,end:20,action:'speed',reason:'filler'},
    {start:20,end:21.2,action:'keep',protect:true,source:'ai'},
    {start:21.2,end:30,action:'speed',reason:'filler'},
  ]);
  assert.equal(withKeep.length,3);
  assert.equal(withKeep[0].start,0);
  assert.equal(withKeep[0].end,20);
  assert.equal(withKeep[1].action,'keep');
  assert.equal(withKeep[2].start,21.2);
});
test('annotateSpeechDensity and resolveSpeedRate temper rapid talkers and boost silent B-roll',()=>{
  const fastText=Array.from({length:35},(_,i)=>`word${i}`).join(' '); // 35 words in 10s = 210 WPM
  const normalText=Array.from({length:11},(_,i)=>`word${i}`).join(' '); // 11 words in 10s = 66 WPM
  const transcript=[
    {start:0,duration:10,text:fastText},
    {start:10,duration:10,text:normalText},
    {start:20,duration:10,text:''},
  ];
  const segs=annotateSpeechDensity([
    {start:0,end:10,action:'speed',reason:'rapid tangent'},
    {start:10,end:20,action:'speed',reason:'normal tangent'},
    {start:20,end:30,action:'speed',reason:'silent b-roll'},
  ],transcript);
  assert.equal(segs[0].wpm,210);
  assert.equal(segs[1].wpm,66);
  assert.equal(segs[2].wpm,0);
  // 210 WPM at 3x would be 630 WPM -> capped to 2x (420 WPM) for intelligibility.
  assert.equal(resolveSpeedRate(segs[0],1,3),2);
  // Normal 66 WPM stays at configured 3x.
  assert.equal(resolveSpeedRate(segs[1],1,3),3);
  // Silent 10s B-roll boosts from 3x to 3.5x.
  assert.equal(resolveSpeedRate(segs[2],1,3),3.5);
  // Never drops below user baseRate.
  assert.equal(resolveSpeedRate(segs[0],2.5,3),2.5);
});
test('effectiveSpeedEnd cushions transitions to normal speech and nextBoundaryDelayMs accounts for playbackRate',()=>{
  const segs=[
    {start:10,end:20,action:'speed',reason:'filler'},
    {start:30,end:40,action:'speed',reason:'lead-in'},
    {start:40,end:55,action:'skip',reason:'sponsor',sponsor:true},
  ];
  // Standalone speed segment decelerates 0.22s early so key speech onset is not clipped at 3x.
  assert.equal(effectiveSpeedEnd(segs[0],segs),19.78);
  // Speed segment immediately followed by a skip holds speed right up to the skip boundary.
  assert.equal(effectiveSpeedEnd(segs[1],segs),40);
  // At t=19.18 playing at 3x, 0.6s video time remains -> 200ms wall-clock delay.
  assert.equal(nextBoundaryDelayMs(19.18,3,segs),200);
});
test('shouldBurstShortSkip and formatSkipToast handle MSE buffers and topic context cleanly',()=>{
  const buffered={
    length:1,
    start(i){if(i!==0)throw new Error('oob');return 0;},
    end(i){if(i!==0)throw new Error('oob');return 11;},
  };
  // Short non-sponsor skip (2.5s) whose target (12.5s) is outside buffered [0..11] bursts instead of stalling.
  assert.equal(shouldBurstShortSkip({start:10,end:12.5,action:'skip',sponsor:false},10.2,buffered,true),true);
  // Sponsor skips always jump immediately even when unbuffered.
  assert.equal(shouldBurstShortSkip({start:10,end:12.5,action:'skip',sponsor:true},10.2,buffered,true),false);
  // Once buffered covers target, instant jump is used.
  assert.equal(isTimeBuffered(buffered,10.8),true);
  assert.equal(shouldBurstShortSkip({start:9,end:10.8,action:'skip',sponsor:false},9.2,buffered,true),false);

  const msg=formatSkipToast({
    skippedSec:29.8,
    reason:'sponsor',
    landedTime:50.01,
    chapters:[{start:0,title:'Intro'},{start:48,title:'Pricing comparison'}],
    shortcutsEnabled:true,
  });
  assert.equal(msg,'Skipped 30s · sponsor → Pricing comparison · Shift+Z undo');
});
test('buildTldrDigest and formatTldrMarkdown build hybrid AI and free heatmap+caption digests without sponsor leaks',()=>{
  const chapters=[
    {start:0,title:'Intro'},
    {start:80,title:'Benchmarks'},
    {start:200,title:'Final verdict'},
  ];
  const heatmap=Array.from({length:30},(_,i)=>{
    const start=i*10, end=(i+1)*10;
    const score=i===9 ? 0.95 : i===21 ? 0.91 : 0.18;
    return {start,end,score};
  });
  const transcript=[
    {start:4,duration:6,text:'Hey guys welcome back to the channel!'},
    {start:35,duration:10,text:'This video is sponsored by Acme VPN, use discount code SAVE20 and smash subscribe.'},
    {start:92,duration:8,text:'Compared to v1, latency dropped by 48% across 10,000 requests in our benchmark.'},
    {start:140,duration:8,text:'Next let us look at the default configuration file.'},
    {start:212,duration:9,text:'In conclusion, the new cache architecture cuts memory usage in half while staying simple.'},
  ];
  const freeDigest=buildTldrDigest({
    duration:300,
    chapters,
    heatmap,
    transcript,
    cutPlan:{rawSegments:[{start:30,end:60,action:'skip',reason:'sponsor',sponsor:true}]},
  });
  assert.match(freeDigest.sourceLabel,/Most Replayed/);
  assert.match(freeDigest.sourceLabel,/Captions/);
  assert.ok(!/Acme|discount|subscribe/i.test(freeDigest.summary),'Sponsor/promo text excluded from summary');
  assert.ok(/48%|memory usage in half/i.test(freeDigest.summary));
  assert.ok(freeDigest.takeaways.length>=2);
  assert.ok(freeDigest.highlights.length>=2);
  assert.ok(freeDigest.highlights.every(c=>c.end<=30||c.start>=60),'Highlights never include sponsor block');
  assert.ok(freeDigest.savedPercent>=70);

  const md=formatTldrMarkdown({title:'Cache Benchmark',videoId:'videoAAAAAA',digest:freeDigest});
  assert.match(md,/# TL;DR: Cache Benchmark/);
  assert.match(md,/https:\/\/www\.youtube\.com\/watch\?v=videoAAAAAA&t=92s/);

  const aiDigest=buildTldrDigest({
    duration:300,
    chapters,
    heatmap,
    transcript,
    cutPlan:{
      summary:'AI verified bottom line: 48% lower latency and 50% less memory.',
      takeaways:[
        'Latency dropped by 48% across 10,000 requests in our benchmark',
        'The new cache architecture cuts memory usage in half',
      ],
      rawSegments:[
        {start:0,end:88,action:'speed',reason:'intro & setup'},
        {start:30,end:60,action:'skip',reason:'sponsor',sponsor:true},
        {start:108,end:208,action:'speed',reason:'routine detail'},
        {start:228,end:300,action:'skip',reason:'outro'},
      ],
    },
  });
  assert.match(aiDigest.sourceLabel,/^AI/);
  assert.equal(aiDigest.summary,'AI verified bottom line: 48% lower latency and 50% less memory.');
  assert.equal(aiDigest.takeaways[0].start,92,'AI takeaway mapped to matching caption timestamp');
  assert.equal(aiDigest.highlights.length,2);
  assert.equal(aiDigest.highlights[0].label,'Benchmarks');
  assert.equal(aiDigest.highlights[1].label,'Final verdict');
});
test('buildTldrDigest stitches chopped 3s YouTube auto-captions into complete sentences and rejects dangling fragments',()=>{
  const choppedAsr=[
    {start:120,duration:3,text:"I've been testing this phone as my"},
    {start:123,duration:3,text:'daily driver for the better part of'},
    {start:126,duration:3,text:'three weeks, and battery life easily lasts all day.'},
    {start:734,duration:2,text:"Maybe I'm a little biased"},
    {start:736,duration:3,text:"because I've been using it for 20 years,"},
    {start:739,duration:3,text:'so switching ecosystems takes effort.'},
    {start:754,duration:3,text:'Photos render much more natural skin'},
    {start:757,duration:3,text:'color, and her camera system is better.'},
    {start:819,duration:2,text:'So is this phone'},
    {start:821,duration:3,text:'better than the other iPhones? And in my'},
    {start:824,duration:4,text:'opinion, from a value standpoint it is worth it for most people.'},
    {start:873,duration:3,text:'Even with fewer lenses'},
    {start:876,duration:3,text:'than an iPhone 18 Pro objectively better'},
  ];
  const digest=buildTldrDigest({duration:900,transcript:choppedAsr});
  assert.ok(Number.isFinite(digest.totalDuration) && digest.totalDuration===900);
  assert.ok(Number.isFinite(digest.reelDuration) && digest.reelDuration>0);
  assert.equal(digest.reelSeconds,digest.reelDuration);
  assert.equal(digest.duration,digest.totalDuration);
  // Bottom line is the stitched verdict sentence, never two unrelated cues glued with ' — '.
  assert.equal(digest.summary,'In my opinion, from a value standpoint it is worth it for most people.');
  assert.ok(!digest.summary.includes(' — '));
  // Takeaways are stitched complete sentences, never mid-sentence fragments or questions.
  assert.ok(digest.takeaways.length>=2);
  for (const t of digest.takeaways) {
    assert.ok(!t.text.includes('?'),'Questions excluded from takeaways');
    assert.ok(!/,\s*$/.test(t.text),'Trailing comma fragments excluded');
    assert.ok(!/\b(of|my|in|and)\s*\.?$/i.test(t.text),'Dangling function-word endings excluded');
    assert.ok(!/^than\b/i.test(t.text),'Dangling comparative fragments excluded');
  }
  assert.ok(digest.takeaways.some(t=>t.text.includes('daily driver for the better part of three weeks')));
  assert.ok(digest.takeaways.some(t=>t.text.includes('natural skin color, and her camera system is better.')));
});

test('cycleQuickSpeed, stepQuickSpeed, shouldAutoAdvancePlaylist and computeThumbnailBadge cover all v1.42 controls',()=>{
  assert.equal(cycleQuickSpeed(1),1.25);
  assert.equal(cycleQuickSpeed(1.25),1.5);
  assert.equal(cycleQuickSpeed(1.35),1.5);
  assert.equal(cycleQuickSpeed(1.75),2);
  assert.equal(cycleQuickSpeed(2),1);
  assert.equal(stepQuickSpeed(1,1),1.1);
  assert.equal(stepQuickSpeed(1,-1),0.9);
  assert.equal(stepQuickSpeed(0.5,-3),0.5);
  assert.equal(stepQuickSpeed(2.95,2),3);

  assert.equal(shouldAutoAdvancePlaylist({
    autoAdvancePlaylist:true,listId:'WL',playing:true,duration:300,
    seg:{start:280,end:298,action:'skip'},alreadyAdvanced:false
  }),true);
  assert.equal(shouldAutoAdvancePlaylist({
    autoAdvancePlaylist:true,listId:'',playing:true,duration:300,
    seg:{start:280,end:298,action:'skip'},alreadyAdvanced:false
  }),false,'Must not auto-advance outside a playlist');
  assert.equal(shouldAutoAdvancePlaylist({
    autoAdvancePlaylist:true,listId:'WL',playing:true,duration:300,
    seg:{start:100,end:130,action:'skip'},alreadyAdvanced:false
  }),false,'Mid-video skip must not advance playlist');

  const runtimeBadge=computeThumbnailBadge({
    durationSec:600,
    segments:[{start:10,end:40,action:'skip'},{start:30,end:60,action:'speed'}],
    poiHighlights:[125],
    speedRate:3,
  });
  // 10..40 skip = 30s, 40..60 speed@3x = 20*(2/3)=13.33s -> ~43s saved -> 557s (9:17)
  assert.equal(runtimeBadge.savedSec,43);
  assert.equal(runtimeBadge.effectiveSec,557);
  assert.equal(runtimeBadge.label,'→ 9:17');
  assert.match(runtimeBadge.title,/★ highlight at 2:05/);

  assert.equal(computeThumbnailBadge({durationSec:0,segments:[{start:0,end:45,action:'skip'}]}).label,'−0:45');
  assert.equal(computeThumbnailBadge({durationSec:600,segments:[{start:10,end:50,action:'skip'}],prepared:true}).label,'⚡ → 9:20');
  assert.match(computeThumbnailBadge({durationSec:600,segments:[{start:10,end:50,action:'skip'}],prepared:true}).title,/^Prepared · Effective runtime 9:20/);
  assert.equal(computeThumbnailBadge({durationSec:0,segments:[{start:0,end:45,action:'skip'}],prepared:true}).label,'⚡ −0:45');
  assert.equal(computeThumbnailBadge({durationSec:300,segments:[],prepared:true}).label,'⚡ Ready');
  assert.equal(computeThumbnailBadge({durationSec:300,segments:[],poiHighlights:[80]}).label,'★ 1:20');
  assert.equal(computeThumbnailBadge({durationSec:300,segments:[{start:0,end:2,action:'skip'}]}).label,'');
});

test('SavingsTracker breakdown, drainDelta, refund and lifetime Today/7-day/All-time aggregation stay accurate',()=>{
  const tracker=new SavingsTracker();
  const el={};
  tracker.skip(15,1,true,'reel');
  tracker.skip(30,1,true,'skip');
  tracker.sample({time:60,now:1000,paused:false,seeking:false,rate:3,baseRate:1,sped:true,silent:false,element:el});
  tracker.sample({time:64.5,now:2500,paused:false,seeking:false,rate:3,baseRate:1,sped:true,silent:false,element:el});
  tracker.sample({time:69,now:4000,paused:false,seeking:false,rate:3,baseRate:1,sped:true,silent:false,element:el}); // +6s speed across two 1.5s ticks
  tracker.sample({time:69,now:4000,paused:false,seeking:false,rate:3,baseRate:1,sped:true,silent:true,element:el});
  tracker.sample({time:75,now:6000,paused:false,seeking:false,rate:3,baseRate:1,sped:true,silent:true,element:el}); // +4s silence in 2.0s tick

  const d1=tracker.drainDelta(0.1);
  assert.equal(Math.round(d1.skip),30);
  assert.equal(Math.round(d1.reel),15);
  assert.equal(Math.round(d1.speed),6);
  assert.equal(Math.round(d1.silence),4);
  assert.equal(tracker.drainDelta(0.1),null,'Already drained');

  let store=recordLifetimeSavings(null,d1,{dayStr:'2026-11-11',videoId:'videoAAAAAA'});
  store=recordLifetimeSavings(store,{skip:20,speed:0,silence:0,reel:0},{dayStr:'2026-11-08',videoId:'videoBBBBBB'});
  store=recordLifetimeSavings(store,{skip:100,speed:0,silence:0,reel:0},{dayStr:'2026-10-01',videoId:'videoAAAAAA'}); // older than 7d, same videoId

  // Undo last skip propagates negative delta cleanly without going below 0.
  tracker.refund(10);
  const refundDelta=tracker.drainDelta(0.1);
  assert.equal(refundDelta.skip,-10);
  store=recordLifetimeSavings(store,refundDelta,{dayStr:'2026-11-11',videoId:'videoAAAAAA'});

  const summary=summarizeLifetimeSavings(store,'2026-11-11');
  assert.equal(summary.todaySec,45); // 55 - 10
  assert.equal(summary.weekSec,65);  // 45 + 20
  assert.equal(summary.allTimeSec,165); // 65 + 100
  assert.equal(summary.videosCount,2);
  assert.deepEqual(summary.breakdown,{skip:140,speed:6,silence:4,reel:15});

  // SponsorBlock POI highlights feed into buildTldrDigest even with no AI or heatmap.
  const poiDigest=buildTldrDigest({
    duration:300,
    poiHighlights:[140],
    transcript:[{start:138,duration:5,text:'Ultimately the benchmark proves the new thermal design runs 15% cooler.'}],
  });
  assert.match(poiDigest.sourceLabel,/Community highlight/);
  assert.equal(poiDigest.highlights[0].source,'poi');
  assert.ok(poiDigest.highlights[0].label.includes('Community highlight'));
});

test('v1.43 helpers: computeRemainingWatchTime, formatRemainingClock, advanceAbLoop, parseShortsPath and buildFrameFilename',()=>{
  // 600s video at t=100s (500s raw left):
  // - 50s already passed skip [20,70] (ignored)
  // - 60s upcoming skip [200,260] (0s wall)
  // - 90s upcoming speed [300,390] at 3x (30s wall)
  // - remaining 350s normal at 1.4x (250s wall) -> total 280s = 4:40 left!
  const fixedNow=new Date(2026,10,11,16,0,0).getTime();
  const rem=formatRemainingClock({
    currentTime:100,
    duration:600,
    baseRate:1.4,
    speedRate:3,
    segments:[
      {start:20,end:70,action:'skip'},
      {start:200,end:260,action:'skip'},
      {start:300,end:390,action:'speed'},
    ],
    nowMs:fixedNow,
  });
  assert.equal(Math.round(rem.rawRemainingSec),500);
  assert.equal(Math.round(rem.realRemainingSec),280);
  assert.equal(rem.label,'· 4:40 left');
  assert.equal(rem.finishClock,'16:04');
  assert.match(rem.title,/finishes ~16:04.*cuts ahead/);
  assert.equal(computeRemainingWatchTime({currentTime:600,duration:600}).realRemainingSec,0);

  // A-B loop state machine: A -> AB (including reverse order swap) -> Off
  const s1=advanceAbLoop(null,80,600,'videoAAAAAA');
  assert.equal(s1.stage,'a');
  assert.deepEqual(s1.loop,{videoId:'videoAAAAAA',start:80,end:null});
  const s2=advanceAbLoop(s1.loop,65,600,'videoAAAAAA'); // B before A swaps cleanly
  assert.equal(s2.stage,'ab');
  assert.deepEqual(s2.loop,{videoId:'videoAAAAAA',start:65,end:80});
  const s3=advanceAbLoop(s2.loop,72,600,'videoAAAAAA');
  assert.equal(s3.stage,'off');
  assert.equal(s3.loop,null);
  // Rapid double-tap creates a 5s loop instead of degenerating to 0-length.
  const tapA=advanceAbLoop(null,40,600,'videoAAAAAA');
  const tapB=advanceAbLoop(tapA.loop,40.1,600,'videoAAAAAA');
  assert.deepEqual(tapB.loop,{videoId:'videoAAAAAA',start:40,end:45});

  // Shorts URL parser & loop-prevention escape hatch
  assert.deepEqual(parseShortsPath('/shorts/videoAAAAAA'),{videoId:'videoAAAAAA',watchPath:'/watch?v=videoAAAAAA'});
  assert.deepEqual(parseShortsPath('/shorts/videoAAAAAA/','?t=12'),{videoId:'videoAAAAAA',watchPath:'/watch?v=videoAAAAAA&t=12s'});
  assert.equal(parseShortsPath('/shorts/videoAAAAAA','?yqn_keep_short=1'),null);
  assert.equal(parseShortsPath('/watch','?v=videoAAAAAA'),null);
  assert.equal(parseShortsPath('/shorts/short'),null);

  // Safe native frame capture filename builder
  assert.equal(buildFrameFilename('My: "Awesome" <Tutorial>? | Part 1/2*',252),'My Awesome Tutorial Part 1 2 - 04m12s.png');
  assert.equal(buildFrameFilename('',3723),'youtube-frame - 1h02m03s.png');
});

test('v1.44: long-video Highlight Reel scales across chapters, includes setup lead-in sentences, and obeys Skim < Balanced < Deep',()=>{
  const dur=3600; // 60-minute talk with 100 heatmap buckets (36s each) and 7 chapters
  const chapters=[
    {start:0,title:'Introduction'},
    {start:180,title:'Architecture overview'},
    {start:720,title:'Database sharding'},
    {start:1320,title:'Caching layer'},
    {start:1920,title:'Failure recovery'},
    {start:2520,title:'Production benchmarks'},
    {start:3120,title:'Final recommendations'},
  ];
  // Only 2 early heatmap peaks (so old v1.43 logic stopped at 2 short clips and starved the remaining 45 minutes!)
  const heatmap=Array.from({length:100},(_,i)=>({
    start:i*36,
    end:(i+1)*36,
    score:(i===6||i===14)?0.92:0.18,
  }));
  const transcript=[];
  for (let m=1;m<60;m++) {
    const base=m*60;
    transcript.push({start:base,duration:5,text:`In minute ${m} we examine how cluster throughput scales under heavy load.`});
    transcript.push({start:base+6,duration:6,text:`Overall, this configuration improves throughput by ${15+m}% compared to baseline in production.`});
    transcript.push({start:base+24,duration:6,text:`We also verified tail latency stayed below ${100-m} milliseconds across three regions.`});
  }
  const sponsorPlan={rawSegments:[{start:600,end:690,action:'skip',reason:'sponsor',sponsor:true}]};

  const skim=buildTldrDigest({duration:dur,chapters,heatmap,transcript,cutPlan:sponsorPlan,depth:'skim'});
  const balanced=buildTldrDigest({duration:dur,chapters,heatmap,transcript,cutPlan:sponsorPlan,depth:'balanced'});
  const deep=buildTldrDigest({duration:dur,chapters,heatmap,transcript,cutPlan:sponsorPlan,depth:'deep'});

  assert.equal(skim.depth,'skim');
  assert.equal(balanced.depth,'balanced');
  assert.equal(deep.depth,'deep');

  // Duration scales strictly: Skim < Balanced < Deep, and Balanced on a 60m video is substantial (> 4 min, >= 7 clips)
  assert.ok(skim.reelDuration < balanced.reelDuration,`Expected skim (${skim.reelDuration}s) < balanced (${balanced.reelDuration}s)`);
  assert.ok(balanced.reelDuration < deep.reelDuration,`Expected balanced (${balanced.reelDuration}s) < deep (${deep.reelDuration}s)`);
  assert.ok(balanced.reelDuration >= 240,`Balanced 60m reel should be >= 4m, got ${balanced.reelDuration}s`);
  assert.ok(balanced.highlights.length >= 7,`Balanced 60m reel should span >= 7 clips, got ${balanced.highlights.length}`);
  assert.ok(deep.reelDuration >= 480,`Deep 60m reel should be >= 8m, got ${deep.reelDuration}s`);

  // Later chapters (minutes 22..59) are covered instead of starving after the 2 early heatmap peaks
  const coveredLabels=new Set(balanced.highlights.map(h=>h.label));
  assert.ok(coveredLabels.has('Caching layer')||coveredLabels.has('Failure recovery'));
  assert.ok(coveredLabels.has('Production benchmarks')||coveredLabels.has('Final recommendations'));

  // Setup-sentence lead-in: a verdict at base+6 pulls in the immediately preceding setup sentence at base when in Balanced/Deep
  const withSetup=balanced.highlights.some(h=>h.start%60===0);
  assert.equal(withSetup,true,'Balanced clips include preceding setup sentence lead-in');

  // Never overlaps sponsor block [600, 690]
  for (const d of [skim,balanced,deep]) {
    assert.ok(d.highlights.every(c=>c.end<=600||c.start>=690),'No highlight clip overlaps sponsor segment');
  }
  assert.ok(tldrReelBudget(3600,'deep').targetSec > tldrReelBudget(3600,'balanced').targetSec);
});
