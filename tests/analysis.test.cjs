const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../analysis-engine.js'); require('../cut-controls.js');
const A=globalThis.YqnAnalysis;
const transcript=Array.from({length:65},(_,id)=>({start:id*10,end:id*10+10,text:
  id>=28&&id<=30 ? 'This video is sponsored by Acme. Use our discount code today.' : 'A useful explanation and demonstration of this process '+id}));
const response=(input,overrides={})=>({summary:'Section notes',takeaways:['A useful fact'],sections:input.lines
  .filter(l=>l.id>=input.coreFirst&&l.id<=input.coreLast).map(l=>({firstLine:l.id,lastLine:l.id,
    action:l.text.includes('sponsored')?'skip':'keep',kind:l.text.includes('sponsored')?'sponsor':'demonstration',
    certainty:'high',evidence:l.text,reason:l.text.includes('sponsored')?'Sponsor read':'Useful demo',...overrides}))});

test('chunking covers every caption once and supplies overlap even beyond the old 300k cap',()=>{
  const lines=A.prepare(Array.from({length:900},(_,i)=>({start:i*5,text:'Useful content '.repeat(30)+i})),4500);
  assert.ok(lines.map(l=>l.text).join('').length>300000);
  const chunks=A.chunksFor(lines),ids=chunks.flatMap(c=>c.lines.filter(l=>l.id>=c.first&&l.id<=c.last).map(l=>l.id));
  assert.equal(ids.length,900);assert.equal(new Set(ids).size,900);assert.equal(ids.at(-1),899);
  assert.ok(chunks[1].lines[0].id<chunks[1].first);assert.ok(chunks[0].lines.at(-1).id>chunks[0].last);
});

test('dense captions are bounded by output-sized cores, not only video minutes',()=>{
  const lines=A.prepare(Array.from({length:288},(_,i)=>({start:i*2.5,end:(i+1)*2.5,text:'A short spoken caption '+i})),720);
  const chunks=A.chunksFor(lines),ids=[];
  assert.equal(chunks.length,8);
  for(const c of chunks){assert.ok(c.last-c.first+1<=40);assert.ok(c.lines.length<=56);ids.push(...c.lines.filter(l=>l.id>=c.first&&l.id<=c.last).map(l=>l.id));}
  assert.equal(new Set(ids).size,288);assert.equal(ids.length,288);
});

test('explicit output limits split draft or review sections and recover early speed coverage without double counting',async()=>{
  const dense=Array.from({length:120},(_,i)=>({start:i*2.5,end:(i+1)*2.5,text:'Repeating this background explanation without changing the result '+i}));
  const progress=[];
  const r=await A.run({transcript:dense,duration:300,onProgress:s=>progress.push(s.stage),request:async q=>{
    const large=q.input.coreLast-q.input.coreFirst+1>20,review=q.system.includes('PASS: review');
    if(large && ((q.input.coreFirst===0&&!review)||(q.input.coreFirst===40&&review)))
      throw Object.assign(new Error('max_tokens'),{code:'YQN_OUTPUT_LIMIT'});
    return response(q.input,{action:'speed',kind:'repetition'});
  }});
  assert.equal(r.complete,true);assert.equal(r.checked,120);assert.equal(r.recoveries,2);assert.equal(r.requests,13);
  assert.equal(r.total,5);assert.equal(r.done,5);assert.deepEqual(r.failures,[]);assert.deepEqual(r.errors,[]);
  assert.equal(r.audit.acceptedSpeed,120);assert.equal(r.segments.filter(s=>s.action==='speed').length,120);
  assert.equal(r.segments.find(s=>s.action==='speed').start,0);assert.ok(progress.some(s=>s.includes('retrying smaller')));
});

test('persistent output limits have bounded recovery and leave failed ranges visible',async()=>{
  let calls=0;
  const r=await A.run({transcript,duration:650,request:async()=>{calls++;throw Object.assign(new Error('max_tokens'),{code:'YQN_OUTPUT_LIMIT'});}});
  assert.equal(r.complete,false);assert.equal(r.checked,0);assert.equal(r.recoveries,3);assert.ok(calls<=9);
  assert.ok(r.failures.length>0);assert.ok(r.failures.every(f=>f.code==='response_limit'&&f.end>f.start));
  const limited=await A.run({transcript,duration:650,maxChunks:1,request:async()=>{throw Object.assign(new Error('max_tokens'),{code:'YQN_OUTPUT_LIMIT'});}});
  assert.equal(limited.recoveries,0);assert.ok(limited.requests<=2);assert.match(limited.errors.join(),/limit reached/);
});

test('network, budget and refusal failures never trigger size retries',async()=>{
  for(const message of ['Network connection lost','Budget reached','Incomplete Claude response (refusal)']){
    let calls=0;
    const r=await A.run({transcript:transcript.slice(0,30),duration:300,request:async()=>{calls++;throw new Error(message);}});
    assert.equal(calls,1);assert.equal(r.recoveries,0);assert.equal(r.complete,false);
  }
  let current=true,calls=0;
  await assert.rejects(A.run({transcript,duration:650,current:()=>current,request:async()=>{
    calls++;current=false;throw Object.assign(new Error('max_tokens'),{code:'YQN_OUTPUT_LIMIT'});
  }}));assert.equal(calls,1);
});
test('two-pass review finds a sponsor across a chunk boundary with exact caption ends',async()=>{
  const calls=[],progress=[];
  const result=await A.run({transcript,duration:650,request:async q=>{calls.push(q);return response(q.input);},onProgress:p=>progress.push(p.checked)});
  assert.equal(result.complete,true);assert.equal(result.checked,65);assert.equal(calls.length,6);
  assert.ok(calls[0].system.includes('NO target amount'));assert.ok(calls[1].system.includes('Independently verify'));
  const cuts=result.segments.filter(s=>s.action==='skip');assert.equal(cuts[0].start,280);assert.equal(cuts.at(-1).end,310);
  assert.deepEqual(cuts.map(s=>s.start),[280,290,300]);assert.ok(progress.some(n=>n>0&&n<65));
});
test('review can discover a sponsor omitted by the draft',()=>{
  const lines=A.prepare(transcript,650),chunk=A.chunksFor(lines)[0];
  const input={lines:chunk.lines,coreFirst:chunk.first,coreLast:chunk.last};
  const result=A.reconcile(response(input,{action:'keep'}),response(input),chunk);
  assert.equal(result.segments.find(s=>s.start===280).action,'skip');
});

test('commercial self-promotion reaches both passes and a verified store pitch preserves neighbouring review facts',async()=>{
  const speech=[{start:0,end:5,text:'The display is brighter outdoors and has better viewing angles.'},
    {start:5,end:10,text:'I own an import store that sells these phones worldwide.'},
    {start:10,end:15,text:'The global version includes a UK charger and local warranty.'}];
  const prompts=[];
  const r=await A.run({transcript:speech,duration:15,request:async q=>{
    prompts.push(q.system);
    return {sections:q.input.lines.map(l=>({firstLine:l.id,lastLine:l.id,action:l.id===1&&q.system.includes('PASS: review')?'skip':'keep',
      kind:l.id===1?'sponsor':'explanation',certainty:'high',evidence:l.text,reason:l.id===1?'Own store promotion':'Review facts'}))};
  }});
  for(const p of prompts){assert.match(p,/own shop, store, import business/);assert.match(p,/without outside payment/);assert.match(p,/bare conflict-of-interest disclosure/);assert.match(p,/Super Thanks or Super Chats/);assert.match(p,/not protected tutorial instructions/);}
  assert.equal(r.complete,true);assert.deepEqual(r.segments.slice(1).map(s=>s.action),['keep','skip','keep']);
  assert.equal(r.segments[2].sponsor,true);
});

test('two sections run concurrently while each review waits for its own draft and recovery stays bounded',async()=>{
  const dense=Array.from({length:100},(_,i)=>({start:i*2,end:i*2+2,text:'Repeating this background explanation without a new fact '+i}));
  let active=0,peak=0;const drafted=new Set();
  const r=await A.run({transcript:dense,duration:200,concurrency:2,request:async q=>{
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;
    const id=q.input.coreFirst+':'+q.input.coreLast,review=q.system.includes('PASS: review');
    if(review)assert.ok(drafted.has(id),'A review must follow its own draft');else drafted.add(id);
    if(review&&q.input.coreLast-q.input.coreFirst+1>20)throw Object.assign(new Error('max_tokens'),{code:'YQN_OUTPUT_LIMIT'});
    return response(q.input,{action:'speed',kind:'repetition'});
  }});
  assert.equal(peak,2);assert.equal(active,0);assert.equal(r.complete,true);assert.equal(r.checked,100);
  assert.equal(r.recoveries,2);assert.equal(new Set(r.segments.slice(1).map(s=>s.start)).size,100);assert.ok(r.requests<=120);
  let current=true,calls=0;
  await assert.rejects(A.run({transcript:dense,duration:200,concurrency:2,current:()=>current,request:async q=>{
    calls++;await new Promise(resolve=>setTimeout(resolve,2));current=false;return response(q.input);
  }}));await new Promise(resolve=>setTimeout(resolve,5));assert.equal(calls,2);
});
test('typographic quote differences preserve exact words without allowing paraphrases',()=>{
  const lines=A.prepare([{start:0,end:8,text:'Today’s sponsor — Acme — says “save now”.'}],8),chunk=A.chunksFor(lines)[0];
  const input={lines,coreFirst:0,coreLast:0};
  const good=response(input,{action:'skip',kind:'sponsor',evidence:'Today\'s sponsor - Acme - says "save now".'});
  assert.equal(A.reconcile(good,good,chunk).segments[0].action,'skip');
  const invented=response(input,{action:'skip',kind:'sponsor',evidence:'Today\'s sponsor - Acme - says "buy now".'});
  const rejected=A.reconcile(good,invented,chunk);
  assert.equal(rejected.segments[0].action,'keep');assert.equal(rejected.audit.quoteMismatch,1);
});
test('audit separates deliberate keeps, accepted cuts and verification failures',()=>{
  const chunk=A.chunksFor(A.prepare(transcript,650))[0],input={lines:chunk.lines,coreFirst:chunk.first,coreLast:chunk.last};
  const draft=response(input),review=response(input);
  review.sections[28].evidence='A fabricated sponsor quote';review.sections[29].certainty='medium';
  const result=A.reconcile(draft,review,chunk);
  assert.equal(result.audit.reviewedKeep,28);assert.equal(result.audit.proposedCut,2);
  assert.equal(result.audit.acceptedCut,0);assert.equal(result.audit.quoteMismatch,1);assert.equal(result.audit.lowCertainty,1);
  assert.match(A.auditText(result.audit),/quote mismatches.*low-confidence/);
});
test('fabricated evidence, ambiguous certainty and conflicting non-sponsor decisions keep content',()=>{
  const chunk=A.chunksFor(A.prepare(transcript,650))[0],input={lines:chunk.lines,coreFirst:chunk.first,coreLast:chunk.last};
  for (const patch of [{evidence:'fabricated promotion not in the source'},{certainty:'medium'}]) {
    const r=A.reconcile(response(input),response(input,patch),chunk);assert.ok(r.segments.every(s=>s.action==='keep'));
  }
  const r=A.reconcile(response(input,{action:'keep'}),response(input,{action:'skip',kind:'intro'}),chunk);
  assert.ok(r.segments.every(s=>s.action==='keep'));
});
test('review keeps an ordinary product review even when the draft proposes an advert cut',()=>{
  const chunk=A.chunksFor(A.prepare(transcript,650))[0],input={lines:chunk.lines,coreFirst:chunk.first,coreLast:chunk.last};
  const r=A.reconcile(response(input,{action:'skip',kind:'sponsor'}),response(input,{action:'keep',kind:'explanation'}),chunk);
  assert.ok(r.segments.every(s=>s.action==='keep'));
});

test('two grounded speed decisions survive category differences and medium confidence',()=>{
  const chunk=A.chunksFor(A.prepare(transcript,650))[0],input={lines:chunk.lines,coreFirst:chunk.first,coreLast:chunk.last};
  for(const [firstCertainty,secondCertainty] of [['high','high'],['medium','high'],['high','medium'],['medium','medium']]){
    const draft=response(input,{action:'speed',kind:'repetition',certainty:firstCertainty});
    const review=response(input,{action:'speed',kind:'explanation',certainty:secondCertainty});
    const result=A.reconcile(draft,review,chunk);
    assert.ok(result.segments.every(s=>s.action==='speed'),`${firstCertainty}/${secondCertainty} agreed speed should survive a category change`);
  }
});

test('speed still requires two grounded non-low decisions; skip thresholds stay strict',()=>{
  const chunk=A.chunksFor(A.prepare(transcript,650))[0],input={lines:chunk.lines,coreFirst:chunk.first,coreLast:chunk.last};
  const speed=()=>response(input,{action:'speed',kind:'repetition',certainty:'high'});
  for(const patch of [{certainty:'low'},{certainty:'unknown'},{evidence:'Fabricated words not in these captions'},{action:'keep'}]){
    assert.ok(A.reconcile(speed(),response(input,{action:'speed',kind:'repetition',...patch}),chunk).segments.every(s=>s.action==='keep'));
    assert.ok(A.reconcile(response(input,{action:'speed',kind:'repetition',...patch}),speed(),chunk).segments.every(s=>s.action==='keep'));
  }
  const skip=kind=>response(input,{action:'skip',kind,certainty:'medium'});
  for(const kind of ['intro','sponsor'])assert.ok(A.reconcile(skip(kind),skip(kind),chunk).segments.every(s=>s.action==='keep'));
  assert.ok(A.reconcile(response(input,{action:'skip',kind:'intro'}),response(input,{action:'skip',kind:'outro'}),chunk).segments.every(s=>s.action==='keep'));
});

test('Thorough pacing reaches both passes without changing core facts or protection for caption gaps',async()=>{
  for(const pacing of ['balanced','quick']){
    const calls=[];
    await A.run({transcript:transcript.slice(0,3),duration:30,pacing,request:async q=>{calls.push(q);return response(q.input);}});
    assert.equal(calls.length,2);
    for(const q of calls){
      assert.equal(q.input.pacing,pacing);
      assert.match(q.system,/pacing pass/);
      assert.match(q.system,/key facts/);
      assert.match(q.system,/caption gap/i);
      if(pacing==='quick')assert.match(q.system,/QUICK WATCH/);
      else assert.match(q.system,/BALANCED/);
    }
  }
});
test('omitted and overlapping review ranges remain unchecked and cannot cut',()=>{
  const chunk=A.chunksFor(A.prepare(transcript,650))[0],input={lines:chunk.lines,coreFirst:chunk.first,coreLast:chunk.last};
  const review=response(input);review.sections.pop();review.sections.push({...review.sections[0]});
  const r=A.reconcile(response(input),review,chunk);assert.equal(r.covered,28);
  assert.equal(r.segments[0].action,'keep');assert.equal(r.segments.at(-1).action,'keep');
});
test('a failed review preserves successful sections and reports partial coverage',async()=>{
  const r=await A.run({transcript,duration:650,request:async q=>{
    if(q.input.coreFirst===30&&q.system.includes('PASS: review'))throw new Error('HTTP 503');return response(q.input);
  }});
  assert.equal(r.complete,false);assert.equal(r.checked,35);assert.match(r.errors.join(),/503/);
  assert.equal(r.segments.filter(s=>s.action==='skip').length,2);assert.equal(r.segments[0].action,'keep');
});
test('cancelling after a first pass makes no second provider call or late progress update',async()=>{
  let current=true,calls=0;const progress=[];
  await assert.rejects(A.run({transcript,duration:650,current:()=>current,onProgress:p=>progress.push(p.stage),
    request:async q=>{calls++;current=false;return response(q.input);}}),/cancelled/);
  assert.equal(calls,1);assert.ok(!progress.some(s=>s.includes('Checking sponsors')));
});
test('per-video bounds report unreviewed remainder instead of declaring completion',async()=>{
  const r=await A.run({transcript,duration:650,maxChunks:1,request:async q=>response(q.input)});
  assert.equal(r.complete,false);assert.equal(r.checked,30);assert.match(r.errors.join(),/limit reached/);
});
test('caption gaps remain unknown and real caption end times bound cuts',()=>{
  const lines=A.prepare([{start:0,end:2,text:'Hello world explanation'},{start:50,text:'Back to the demonstration'}],100);
  assert.equal(lines[0].end,2);assert.equal(lines[1].end,58);
});

test('duplicate timestamps combine their context instead of producing conflicting cuts',()=>{
  const lines=A.prepare([{start:0,end:4,text:'Sponsored message here'},{start:0,end:5,text:'Useful explanation here'},{start:5,text:'Another useful caption'}],10);
  assert.equal(lines.length,2);assert.match(lines[0].text,/Sponsored.*Useful/);assert.equal(lines[0].end,5);
});

test('chapter anchors and resource links are retained only from verified supplied data',async()=>{
  const result=await A.run({transcript:transcript.slice(0,3),duration:30,description:'The tool is https://example.org/tool',
    request:async q=>({...response(q.input),chapters:[{firstLine:0,title:'First topic'},{firstLine:900,title:'Invented'}],
      mentions:[{name:'Tool',url:'https://example.org/tool'},{name:'Unknown',url:'https://invented.example'},{name:'Bad',url:'javascript:alert(1)'}]})});
  assert.deepEqual(result.chapters,[{start:0,title:'First topic'}]);
  assert.deepEqual(result.mentions.map(m=>m.url),['https://example.org/tool','','']);
});
test('learning requires distinct videos and only approved suggestions affect a future plan',()=>{
  const section={start:10,end:20,action:'skip',reason:'intro',kind:'intro'};let record={};
  for(let i=0;i<5;i++)record=A.learn(record,'same',section,'keep');
  assert.equal(A.suggestions(record).length,0);
  record=A.learn(record,'second',section,'keep');record=A.learn(record,'third',section,'keep');
  assert.deepEqual(A.suggestions(record),[{kind:'intro',action:'keep',count:3}]);
  assert.equal(globalThis.YqnControls.applyEdits([section],[],{},record.approved)[0].action,'skip');
  record.approved={intro:'keep'};
  const row=globalThis.YqnControls.applyEdits([section],[],{},record.approved)[0];assert.equal(row.action,'keep');assert.match(row.learned,/keep intro/);
  assert.equal(globalThis.YqnControls.applyEdits([section],[{...section,action:'skip'}],{},record.approved)[0].action,'skip');
  record=A.learn(record,'third',section,'default');assert.equal(record.samples.length,2);
});
test('concurrent out-of-order chunk completions preserve chronological summaries, takeaways, mentions and chapters',async()=>{
  const r=await A.run({transcript,duration:650,concurrency:2,description:'https://first.example https://second.example',request:async q=>{
    const idx=q.input.coreFirst===0?0:1;
    if(idx===0)await new Promise(res=>setTimeout(res,25));
    return {...response(q.input),
      summary:`Summary-${idx}`,
      takeaways:[`Takeaway-${idx}`],
      chapters:[{firstLine:q.input.coreFirst,title:`Chapter-${idx}`}],
      mentions:[{name:`Tool-${idx}`,url:idx===0?'https://first.example':'https://second.example'}]};
  }});
  assert.deepEqual(r.summaries.slice(0,2),['Summary-0','Summary-1']);
  assert.deepEqual(r.takeaways.slice(0,2),['Takeaway-0','Takeaway-1']);
  assert.deepEqual(r.mentions.slice(0,2).map(m=>m.name),['Tool-0','Tool-1']);
  assert.ok(r.chapters[0].start<=r.chapters[1].start);
  assert.deepEqual(A.sampleAcross(['S0','S1','S2','S3','S4','S5'],3),['S0','S3','S5']);
});
test('playhead-first scheduling verifies the viewer current section first and still completes the full video',async()=>{
  const long=Array.from({length:120},(_,i)=>({start:i*10,end:(i+1)*10,text:'Detailed explanation and walkthrough of step '+i}));
  const order=[];
  const r=await A.run({transcript:long,duration:1200,concurrency:1,playhead:()=>650,request:async q=>{
    if(!q.system.includes('PASS: review'))order.push(q.input.coreFirst);
    return {...response(q.input),summary:`S-${q.input.coreFirst}`};
  }});
  assert.equal(r.complete,true);
  assert.equal(r.checked,120);
  // 650s falls inside chunk starting at line 60 (600..899s), so it runs before chunk 0.
  assert.equal(order[0],60);
  assert.ok(order.includes(0));
  assert.equal(r.summaries[0],'S-0');
});
