const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','signals.js'),'utf8'),ctx);
const S=ctx.YqnSignals;
const plain=v=>JSON.parse(JSON.stringify(v));

test('creator chapter names: labels cut, look-alike titles do not',()=>{
  const chapters=[
    {start:0,title:'Intro',source:'youtube'},
    {start:40,title:'Intro to React hooks',source:'youtube'},
    {start:200,title:'02 — Sponsor: NordVPN',source:'youtube'},
    {start:260,title:'Adding sponsors to the database',source:'youtube'},
    {start:400,title:'Patreon shout-outs',source:'description'},
    {start:460,title:'Thanks to Squarespace for sponsoring',source:'youtube'},
    {start:520,title:'Introduction',source:'youtube'},
    {start:900,title:'Outro',source:'youtube'},
  ];
  const cuts=plain(S.chapterCuts(chapters,960));
  assert.deepEqual(cuts.map(c=>[c.start,c.end,c.action,c.kind,c.sponsor]),[
    [0,40,'speed','intro',false],
    [200,260,'skip','sponsor',true],
    [400,460,'skip','selfpromo',true],
    [460,520,'skip','sponsor',true],
    [900,960,'speed','intro',false],
  ]);
  assert.equal(cuts[1].source,'chapters');
  assert.match(cuts[1].reason,/Sponsor: NordVPN/);
});

test('creator chapter names: long labelled sections are softened or ignored, AI topics never count',()=>{
  const cuts=plain(S.chapterCuts([{start:0,title:'Sponsor',source:'youtube'},{start:400,title:'Intro',source:'youtube'},
    {start:700,title:'Main',source:'youtube'},{start:800,title:'Sponsor',source:'ai'}],1000));
  assert.deepEqual(cuts.map(c=>[c.start,c.end,c.action,c.sponsor]),[[0,400,'speed',false]]);
});

const pitch='if you want to go deeper join my community hub where members get weekly live calls templates and early access to every project file '+
  'it is the best way to support the channel and the link is in the description so go check it out today and i will see you inside';
const lineify=(text,start,step=3,per=6)=>{const w=text.split(' '),out=[];for(let i=0;i<w.length;i+=per)out.push({start:start+(i/per)*step,text:w.slice(i,i+per).join(' ')});return out;};
const filler=(n,start,seed)=>Array.from({length:n},(_,i)=>({start:start+i*3,text:`${seed} topic number ${i} covers wiring ${i*7} and soldering ${i*13} details`}));

test('channel memory: a pitch cut in one video is recognised in the next',()=>{
  const v1=[...filler(10,0,'alpha'),...lineify(pitch,30),...filler(10,72,'beta')];
  const spans=plain(S.memorableSpans([{start:30,end:72,action:'skip',sponsor:true,kind:'sponsor',reason:'AI: community pitch',source:'ai'}],v1,'vid1'));
  assert.equal(spans.length,1);
  assert.ok(spans[0].h.length>=6);
  const v2=[...filler(20,0,'gamma'),...lineify(pitch,120),...filler(10,162,'delta')];
  const hits=plain(S.matchMemory(v2,spans,{videoId:'vid2'}));
  assert.equal(hits.length,1,JSON.stringify(hits));
  assert.ok(hits[0].start>=119 && hits[0].start<=121 && hits[0].end>=144,'covers the repeated pitch: '+JSON.stringify(hits[0]));
  assert.equal(hits[0].action,'skip');
  assert.equal(hits[0].sponsor,true);
  assert.equal(hits[0].source,'channel-memory');
  assert.match(hits[0].reason,/repeat of this channel's community pitch/);
  assert.equal(S.matchMemory(v2,spans,{videoId:'vid1'}).length,0,'same video never matches itself');
  assert.equal(S.matchMemory(filler(30,0,'epsilon'),spans,{videoId:'vid3'}).length,0,'unrelated speech');
});

test('channel memory: only evidence-based skips are remembered',()=>{
  const v1=[...lineify(pitch,0),...filler(5,42,'z')];
  for(const seg of [{action:'speed',source:'ai',sponsor:true},{action:'skip',source:'heatmap',sponsor:true},
    {action:'skip',source:'channel-memory',sponsor:true},{action:'skip',source:'comments',sponsor:true},{action:'skip',source:'visual'}])
    assert.equal(S.memorableSpans([{start:0,end:42,kind:'',...seg}],v1,'v').length,0,JSON.stringify(seg));
});

test('channel memory learns any evidence-based skip, e.g. an AI "community pitch" that names no sponsor',()=>{
  const v1=[...lineify(pitch,0),...filler(5,42,'z')];
  const spans=plain(S.memorableSpans([{start:0,end:42,action:'skip',source:'ai',sponsor:false,reason:'AI: community pitch'}],v1,'v'));
  assert.equal(spans.length,1);
  assert.equal(spans[0].s,false);
});

test('channel memory store is bounded and newest-first',()=>{
  let mem={channels:{}};
  const span=n=>[{v:'x',a:'skip',s:true,k:'sponsor',r:'r',h:Array.from({length:n},(_,i)=>i)}];
  for(let i=0;i<20;i++)mem=S.rememberSpans(mem,'chanA','v'+i,span(10),1000+i,{maxVideos:15});
  assert.equal(Object.keys(mem.channels.chanA.videos).length,15);
  assert.ok(mem.channels.chanA.videos.v19 && !mem.channels.chanA.videos.v0);
  mem=S.rememberSpans(mem,'chanB','b1',span(10),5000,{maxHashes:100});
  assert.ok(mem.channels.chanB && !mem.channels.chanA,'oldest channel evicted past the hash budget');
  assert.equal(S.channelSpans(mem,'chanB').length,1);
  mem=S.rememberSpans(mem,'chanB','b1',[],6000);
  assert.equal(mem.channels.chanB,undefined,'a video with nothing to remember is dropped');
});

const SPEC='https://i.ytimg.com/sb/abcdefghijk/storyboard3_L$L/$N.jpg?sqp=xyz|48#27#100#10#10#0#default#rs$AAA|80#45#120#10#10#5000#M$M#rs$BBB|160#90#120#5#5#5000#M$M#rs$CCC';
test('storyboard spec parsing picks small frames for analysis and sharper ones for AI',()=>{
  const levels=plain(S.parseStoryboardSpec(SPEC,600));
  assert.equal(levels.length,3);
  assert.equal(levels[1].sheetUrls.length,2);
  assert.equal(levels[1].sheetUrls[1],'https://i.ytimg.com/sb/abcdefghijk/storyboard3_L1/M1.jpg?sqp=xyz&sigh=rs%24BBB');
  assert.equal(levels[2].sheetUrls.length,5);
  assert.equal(levels[1].interval,5);
  const {analysis,vision}=S.pickLevels(levels);
  assert.equal(analysis.width,80);
  assert.equal(vision.width,160);
  assert.deepEqual(plain(S.parseStoryboardSpec('https://evil.example/x|80#45#10#10#1#0#M$M#s',100)),[]);
});

test('stillness: frozen and silent is sped up, frozen with talking is not, moving silence becomes an AI gap',()=>{
  const interval=5,frames=80; // 400s
  const sig=v=>Array.from({length:16},()=>v);
  const signatures=Array.from({length:frames},(_,i)=>{
    if(i>=20&&i<30)return sig(100);          // 100–150s frozen, silent  -> speed
    if(i>=40&&i<50)return sig(50);           // 200–250s frozen, talking -> keep
    return sig((i*37)%200);                  // otherwise changing
  });
  const talk=(a,b)=>Array.from({length:Math.floor((b-a)/3)},(_,k)=>({start:a+k*3,text:'we are talking here about the thing'}));
  const transcript=[...talk(0,95),...talk(160,290),...talk(330,400)];
  const {segments,gaps}=plain(S.visualSignals({signatures,interval,transcript,duration:400}));
  assert.equal(segments.length,1);
  assert.ok(segments[0].start>=95 && segments[0].start<=100 && segments[0].end>=145 && segments[0].end<=155,JSON.stringify(segments));
  assert.equal(segments[0].source,'visual');
  assert.equal(gaps.length,1,'only the moving silent stretch 290–330s is left for AI');
  assert.ok(gaps[0].start>=290 && gaps[0].end<=330 && gaps[0].times.length===4);
  assert.deepEqual(plain(S.visualSignals({signatures,interval,transcript:[],duration:400})),{segments:[],gaps:[]},'no captions: no judgement');
});

test('AI visual verdicts map to speeds; demos are capped at 2×, unclear changes nothing',()=>{
  const gaps=[{start:10,end:40},{start:100,end:160},{start:200,end:230}];
  const segs=plain(S.visualVerdictSegments(gaps,[{id:0,verdict:'waiting'},{id:1,verdict:'demo'},{id:2,verdict:'unclear'},{id:9,verdict:'filler'}]));
  assert.equal(segs.length,2);
  assert.equal(segs[0].rateCap,undefined);
  assert.equal(segs[1].rateCap,2);
  assert.ok(segs.every(s=>s.action==='speed'&&s.source==='visual'));
});

test('comment timestamps: sponsor ranges, intro ends and popular moments',()=>{
  const comments=[
    {text:'Sponsor 4:30 - 5:45',likes:0},
    {text:'sponsored segment 4:32 to 5:44, you are welcome',likes:2},
    {text:'ad from 9:00-9:30',likes:0},
    {text:'Video actually starts at 1:10',likes:12},
    {text:'12:40 had me crying 😂',likes:3},
    {text:'12:45 is the best part',likes:1},
    {text:'12:41 lol',likes:0},
    {text:'Great video, timestamps please',likes:100},
    {text:'Intro to the series 0:05 - 0:20',likes:0},
  ];
  const out=plain(S.commentSignals(comments,1200));
  const sp=out.filter(s=>s.kind==='sponsor');
  assert.deepEqual(sp.map(s=>[s.start,s.end,s.action]),[[270,345,'skip'],[540,570,'speed']]);
  assert.match(sp[0].reason,/2 viewers'/);
  const intro=out.find(s=>s.kind==='intro');
  assert.deepEqual([intro.start,intro.end,intro.action],[0,70,'skip']);
  const moment=out.find(s=>s.kind==='highlight');
  assert.equal(moment.action,'keep');
  assert.ok(moment.start>=757&&moment.start<=762);
  assert.ok(out.every(s=>s.source==='comments'));
});

test('comment timestamps ignore impossible and too-late values',()=>{
  const out=plain(S.commentSignals([{text:'sponsor 1:00-1:02',likes:0},{text:'sponsor 30:00-31:00',likes:0},
    {text:'skip to 9:00',likes:0},{text:'skip to 0:30',likes:50}],600));
  assert.deepEqual(out.map(s=>[s.kind,s.start,s.end,s.action]),[['intro',0,30,'skip']]);
});
