/* Pure helpers shared by the worker, popup and video tools. */
(() => {
  'use strict';
  const number = n => Number.isFinite(n) && n >= 0 ? n : 0;
  const day = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  // Standard direct API prices, USD / million tokens, checked 30 October 2026.
  // https://platform.claude.com/docs/en/about-claude/pricing
  function rates(model, prompt = 0, jevRate = 0) {
    if (model === 'jev-latest') return jevRate > 0 ? {input:jevRate,output:0,read:jevRate} : null;
    if (model === 'claude-haiku-5-5') return prompt > 100000 ? {input:0.5,output:2.5,read:0.05} : {input:0.1,output:0.5,read:0.01};
    if (model === 'claude-haiku-4-5-20251001') return {input:1,output:5,read:0.1};
    if (model === 'claude-sonnet-5') return {input:2,output:10,read:0.2};
    if (model === 'claude-sonnet-5-5') return {input:2,output:10,read:0.1};
    return null;
  }
  function price(model, usage, jevRate = 0) {
    if (!usage || !Number.isFinite(usage.input_tokens) || usage.input_tokens<0 || !Number.isFinite(usage.output_tokens) || usage.output_tokens<0) return null;
    const input=number(usage.input_tokens), output=number(usage.output_tokens);
    const read=number(usage.cache_read_input_tokens), write=number(usage.cache_creation_input_tokens);
    const hour=Math.min(write,number(usage.cache_creation?.ephemeral_1h_input_tokens));
    const r=rates(model,input+read+write,jevRate);
    return r ? (input*r.input+output*r.output+read*r.read+(write-hour)*r.input*1.25+hour*r.input*2)/1e6 : null;
  }
  function estimate(model, bytes, output, jevRate = 0) {
    // Reserve one input token per UTF-8 byte plus protocol/schema overhead.
    // This deliberately overestimates normal text. It is not a provider invoice cap.
    return price(model,{input_tokens:number(bytes)+4096,output_tokens:number(output)},jevRate);
  }
  function totals(ledger, videoId, today = day()) {
    const entries=Object.values(ledger?.entries || {});
    const sum=rows=>({usd:rows.reduce((s,r)=>s+number(r.usd),0),calls:rows.length,
      uncertain:rows.filter(r=>r.status!=='reported').length,unpriced:rows.filter(r=>r.usd===null).length,
      tokens:rows.reduce((s,r)=>s+number(r.tokens),0)});
    return {day:today,today:sum(entries.filter(r=>r.day===today)),video:sum(entries.filter(r=>r.videoId===videoId))};
  }
  function signature(rows) { return JSON.stringify(rows.map(s=>[s.start,s.end,s.action])); }
  function parseTime(value) {
    const text=String(value).trim();
    if (!/^\d+(?:\.\d+)?$|^\d+:\d{1,2}(?::\d{1,2})?(?:\.\d+)?$/.test(text)) return NaN;
    const parts=text.split(':').map(Number);
    if (parts.slice(1).some(n=>n>=60)) return NaN;
    return parts.reduce((a,n)=>a*60+n,0);
  }
  function range(start,end,duration) {
    const a=parseTime(start),b=parseTime(end);
    if (!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<=a||!Number.isFinite(duration)||b>duration) throw new Error('Enter a start before the end, within this video. Use seconds or mm:ss.');
    return {start:a,end:b};
  }
  const normal=s=>String(s || '').toLowerCase().replace(/\s+/g,' ').trim();
  const STOPWORDS=new Set(['what','when','where','which','who','whom','whose','why','how','the','this','that','these','those',
    'with','from','into','onto','about','does','did','done','have','has','had','been','were','was','are','can','could','would',
    'should','will','shall','may','might','must','they','them','their','there','here','your','yours','our','ours','video',
    'speaker','say','says','said','talk','talks','tell','tells','mention','mentions','mentioned','and','but','not','for']);
  function cjkBigrams(str) {
    const out=[];
    const runs=str.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]{2,}/gu)||[];
    for (const run of runs) for (let i=0;i<run.length-1;i++) out.push(run.slice(i,i+2));
    return [...new Set(out)];
  }
  function evidence(lines,question,maxChars=30000) {
    const full=lines.reduce((s,l)=>s+l.text.length+60,0);
    if (full<=maxChars) return {lines,partial:false};
    const q=normal(question);
    const rawWords=[...new Set(q.match(/[\p{L}\p{N}]{2,}/gu)||[])];
    const filtered=rawWords.filter(w=>!STOPWORDS.has(w));
    const words=filtered.length?filtered:rawWords;
    const bigrams=cjkBigrams(q);
    const terms=[...new Set([...words,...bigrams])];
    if (!terms.length) return {lines:[],partial:true};
    const normLines=lines.map(l=>normal(l.text));
    const weights=new Map(terms.map(t=>{
      let df=0;for (const text of normLines) if (text.includes(t)) df++;
      return [t,1+Math.log((lines.length+1)/(df+1))];
    }));
    const scored=normLines.map((text,i)=>({i,score:terms.reduce((s,t)=>s+(text.includes(t)?weights.get(t):0),0)}))
      .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.i-b.i);
    const chosen=new Set();let size=0;
    for (const {i} of scored) for (const j of [i,i-1,i+1,i-2,i+2].filter(j=>j>=0&&j<lines.length)) {
      if (!chosen.has(j) && size+lines[j].text.length+60<=maxChars) { chosen.add(j);size+=lines[j].text.length+60; }
    }
    return {lines:[...chosen].sort((a,b)=>a-b).map(i=>lines[i]),partial:true};
  }
  const answerSchema={type:'object',properties:{status:{type:'string',enum:['supported','not_covered']},answer:{type:'string'},citations:{type:'array',items:{type:'object',properties:{lineId:{type:'integer'},quote:{type:'string'}},required:['lineId','quote'],additionalProperties:false}}},required:['status','answer','citations'],additionalProperties:false};
  function validateAnswer(result,lines,partial) {
    const fallback={answer:partial?'I could not find this in the selected transcript excerpts. Try a more specific question.':'This is not covered in the available transcript.',citations:[],partial};
    if (result?.status!=='supported'||typeof result.answer!=='string'||!result.answer.trim()) return fallback;
    if (!Array.isArray(result.citations)||!result.citations.length||result.citations.length>20) return fallback;
    const citations=[];
    for (const c of result.citations) {
      const line=lines.find(l=>l.id===c?.lineId),quote=normal(c?.quote);
      if (!line||quote.length<12||!normal(line.text).includes(quote)) return fallback;
      citations.push({start:line.start,end:line.end,quote:String(c.quote).slice(0,1500)});
    }
    return {answer:result.answer.slice(0,6000),citations,partial};
  }
  function notesMarkdown(videoId,title,notes) {
    const escape=s=>String(s).replace(/([\\`*_{}[\]<>#!|])/g,'\\$1').replace(/\r?\n/g,'\n  ');
    return `# ${escape(title || 'Video notes')}\n\nhttps://www.youtube.com/watch?v=${encodeURIComponent(videoId)}\n\n`+
      notes.slice().sort((a,b)=>a.time-b.time).map(n=>`- [${Math.floor(n.time/60)}:${String(Math.floor(n.time%60)).padStart(2,'0')}](https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.floor(n.time)}s) ${escape(n.text || 'Bookmark')}`).join('\n')+'\n';
  }
  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function findHighlightRanges(text, terms, fullPhrase) {
    const intervals = [];
    const patterns = [...new Set([fullPhrase, ...terms].filter(Boolean))].sort((a, b) => b.length - a.length);
    for (const pat of patterns) {
      const re = new RegExp(escapeRegExp(pat), 'gi');
      let m;
      while ((m = re.exec(text))) {
        if (m[0].length > 0) intervals.push([m.index, m.index + m[0].length]);
        else re.lastIndex++;
      }
    }
    if (!intervals.length) return [];
    intervals.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
      const cur = intervals[i], last = merged[merged.length - 1];
      if (cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1]);
      else merged.push(cur);
    }
    return merged;
  }
  function normalizeCaptionLines(lines) {
    const seen = new Set();
    const raw = (Array.isArray(lines) ? lines : [])
      .filter(l => l && Number.isFinite(+l.start) && +l.start >= 0 && typeof l.text === 'string')
      .map(l => ({
        start: +l.start,
        end: Number.isFinite(+l.end) && +l.end > +l.start ? +l.end
          : (Number.isFinite(+l.duration) && +l.duration > 0 ? +l.start + +l.duration : 0),
        text: l.text.replace(/\s+/g, ' ').trim(),
      }))
      .filter(l => l.text.length > 0)
      .sort((a, b) => a.start - b.start)
      .filter(l => {
        const k = `${l.start}|${l.text}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    return raw.map((l, i) => {
      const nextStart = i + 1 < raw.length ? raw[i + 1].start : l.start + 6;
      const end = l.end > l.start ? l.end : Math.max(l.start + 1, Math.min(nextStart, l.start + 8));
      return { start: l.start, end, text: l.text };
    });
  }
  function findActiveCaptionIndex(lines, currentTime) {
    if (!Array.isArray(lines) || !lines.length || !Number.isFinite(+currentTime) || +currentTime < 0) return -1;
    const t = +currentTime;
    let lo = 0, hi = lines.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const start = +lines[mid]?.start;
      if (Number.isFinite(start) && start <= t + 0.15) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 0) return -1;
    const item = lines[best];
    const maxEnd = Math.max(Number.isFinite(+item.end) ? +item.end : 0, +item.start + 12) + 2;
    return t <= maxEnd ? best : -1;
  }
  function formatTranscriptQuote({ text = '', start = 0, videoId = '' } = {}) {
    const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleanText) return '';
    const sec = Math.max(0, Math.floor(+start || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const stamp = (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0');
    const cleanId = typeof videoId === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(videoId) ? videoId : '';
    const ref = cleanId ? `${stamp} — https://www.youtube.com/watch?v=${cleanId}&t=${sec}s` : stamp;
    return `"${cleanText}" (${ref})`;
  }
  function searchTranscript(lines, query = '', limit = 100) {
    const cleanLines = normalizeCaptionLines(lines).map(l => ({ ...l, lower: l.text.toLowerCase() }));
    const q = String(query || '').replace(/\s+/g, ' ').trim();
    if (!q) return { totalLines: cleanLines.length, totalMatches: 0, matches: [] };
    const qLower = q.toLowerCase();
    const terms = [...new Set(qLower.split(' ').filter(Boolean))];
    const matchedSingle = new Set();
    const allMatches = [];
    for (let i = 0; i < cleanLines.length; i++) {
      const l = cleanLines[i];
      if (l.lower.includes(qLower) || (terms.length > 1 && terms.every(t => l.lower.includes(t)))) {
        matchedSingle.add(i);
        allMatches.push({
          start: l.start,
          end: l.end,
          text: l.text,
          highlights: findHighlightRanges(l.text, terms, q),
        });
      }
    }
    if (terms.length > 1) {
      for (let i = 0; i < cleanLines.length - 1; i++) {
        if (matchedSingle.has(i) || matchedSingle.has(i + 1)) continue;
        const a = cleanLines[i], b = cleanLines[i + 1];
        if (b.start - a.end > 3) continue;
        const joinedText = `${a.text} ${b.text}`;
        const joinedLower = joinedText.toLowerCase();
        if (joinedLower.includes(qLower) || terms.every(t => joinedLower.includes(t))) {
          allMatches.push({
            start: a.start,
            end: b.end,
            text: joinedText,
            highlights: findHighlightRanges(joinedText, terms, q),
          });
          i++;
        }
      }
      allMatches.sort((a, b) => a.start - b.start);
    }
    const maxOut = Math.max(1, Math.min(500, +limit || 100));
    return { totalLines: cleanLines.length, totalMatches: allMatches.length, matches: allMatches.slice(0, maxOut) };
  }
  const sbCategories=[
    ['sponsor','Sponsor'],
    ['selfpromo','Unpaid / self-promotion'],
    ['interaction','Interaction reminder (subscribe/like)'],
    ['intro','Intermission / intro'],
    ['outro','Endcards / credits'],
    ['preview','Preview / recap'],
    ['filler','Tangent / filler'],
    ['poi_highlight','Highlight (point of interest)'],
  ];
  function sponsorBlockPayload({videoId,start,end,duration,category='sponsor',userId,version='1.45.1'}={}) {
    if (typeof videoId!=='string'||!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('This video does not have a valid 11-character YouTube video ID.');
    if (!sbCategories.some(([id])=>id===category)) throw new Error('Choose a valid SponsorBlock category.');
    if (typeof userId!=='string'||userId.trim().length<16) throw new Error('Local SponsorBlock submitter ID could not be generated.');
    const isPoi=category==='poi_highlight';
    let r;
    if (isPoi) {
      const a=typeof start==='number'?start:parseTime(start);
      if (!Number.isFinite(a)||a<0||(Number.isFinite(duration)&&duration>0&&a>duration)) {
        throw new Error('Enter a highlight timestamp within this video. Use seconds or mm:ss.');
      }
      r={start:a,end:a};
    } else {
      r=(typeof start==='number'&&typeof end==='number'&&Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&(!Number.isFinite(duration)||duration<=0||end<=duration))
        ? {start,end} : range(start,end,duration);
      if (r.end-r.start<0.5) throw new Error('SponsorBlock segments must be at least 0.5 seconds long.');
    }
    const out={
      videoID:videoId,
      startTime:Math.round(r.start*1000)/1000,
      endTime:Math.round(r.end*1000)/1000,
      category,
      userID:userId.trim(),
      userAgent:`YouTubeQuickNav/${String(version||'1.45.1').replace(/[^\w.-]/g,'')}`,
      actionType:isPoi?'poi':'skip',
    };
    if (Number.isFinite(duration)&&duration>0) out.videoDuration=Math.round(duration*1000)/1000;
    return out;
  }
  const UNSAFE_KEYS=new Set(['__proto__','constructor','prototype']);
  const SECRET_KEYS=new Set(['anthropicKey','typesafeKey']);
  const safeId=id=>typeof id==='string'&&id.length>=1&&id.length<=80&&!/\s/.test(id)&&!UNSAFE_KEYS.has(id);
  function cleanNoteList(raw) {
    return (Array.isArray(raw)?raw:[])
      .filter(n=>n&&typeof n.id==='string'&&n.id&&Number.isFinite(n.time)&&n.time>=0&&typeof n.text==='string')
      .map(n=>({id:n.id.slice(0,80),time:n.time,text:n.text.slice(0,5000)}))
      .slice(-500);
  }
  function searchAllNotes(localStore,query='') {
    const store=localStore&&typeof localStore==='object'?localStore:{};
    const metaMap=store.yqnNotesMetaV1&&typeof store.yqnNotesMetaV1==='object'&&!Array.isArray(store.yqnNotesMetaV1)?store.yqnNotesMetaV1:{};
    const terms=normal(query).split(' ').filter(Boolean);
    let totalNotes=0,totalVideos=0;
    const results=[];
    for (const [key,raw] of Object.entries(store)) {
      if (!key.startsWith('yqnNotesV1:')) continue;
      const videoId=key.slice('yqnNotesV1:'.length);
      if (!safeId(videoId)) continue;
      const list=cleanNoteList(raw);
      if (!list.length) continue;
      totalVideos++;
      totalNotes+=list.length;
      const meta=Object.prototype.hasOwnProperty.call(metaMap,videoId)&&metaMap[videoId]&&typeof metaMap[videoId]==='object'?metaMap[videoId]:{};
      const title=String(meta.title||'').trim()||videoId;
      const channelName=String(meta.channelName||'').trim();
      const updatedAt=number(meta.updatedAt);
      for (const n of list) {
        const hay=normal(`${n.text} ${title} ${channelName} ${videoId}`);
        if (terms.length&&!terms.every(t=>hay.includes(t))) continue;
        results.push({id:n.id,videoId,title,channelName,updatedAt,time:n.time,text:n.text});
      }
    }
    results.sort((a,b)=>(b.updatedAt-a.updatedAt)||a.videoId.localeCompare(b.videoId)||(a.time-b.time));
    return {totalNotes,totalVideos,results};
  }
  function allNotesMarkdown(results,query='') {
    const escape=s=>String(s).replace(/([\\`*_{}[\]<>#!|])/g,'\\$1').replace(/\r?\n/g,'\n  ');
    const groups=new Map();
    for (const item of Array.isArray(results)?results:[]) {
      if (!item||!safeId(item.videoId)||!Number.isFinite(item.time)) continue;
      if (!groups.has(item.videoId)) groups.set(item.videoId,{videoId:item.videoId,title:item.title||item.videoId,channelName:item.channelName||'',notes:[]});
      groups.get(item.videoId).notes.push(item);
    }
    const header=`# Saved YouTube notes${String(query||'').trim()?` (${escape(String(query).trim())})`:''}\n\n`;
    const sections=[...groups.values()].map(g=>
      `## ${escape(g.title)}${g.channelName?` — ${escape(g.channelName)}`:''}\n\nhttps://www.youtube.com/watch?v=${encodeURIComponent(g.videoId)}\n\n`+
      g.notes.slice().sort((a,b)=>a.time-b.time).map(n=>`- [${Math.floor(n.time/60)}:${String(Math.floor(n.time%60)).padStart(2,'0')}](https://www.youtube.com/watch?v=${encodeURIComponent(g.videoId)}&t=${Math.floor(n.time)}s) ${escape(n.text||'Bookmark')}`).join('\n')
    );
    return header+(sections.length?sections.join('\n\n')+'\n':'No matching notes.\n');
  }
  function sanitizeStampMap(raw,limit=500) {
    if (!raw||typeof raw!=='object'||Array.isArray(raw)) return {};
    const entries=Object.entries(raw)
      .filter(([k,v])=>safeId(k)&&Number.isFinite(Number(v))&&Number(v)>0)
      .map(([k,v])=>[k,Math.round(Number(v))])
      .sort((a,b)=>b[1]-a[1])
      .slice(0,limit);
    return Object.fromEntries(entries);
  }
  function sanitizeLifetimeSavings(raw) {
    if (!raw||typeof raw!=='object'||Array.isArray(raw)) return null;
    const buckets=['skip','speed','silence','reel'];
    const cleanCounts=obj=>{
      const out={skip:0,speed:0,silence:0,reel:0};
      if (!obj||typeof obj!=='object'||Array.isArray(obj)) return out;
      for (const b of buckets) {
        const n=Number(obj[b]);
        if (Number.isFinite(n)&&n>0) out[b]=Math.round(n*100)/100;
      }
      return out;
    };
    const byDay={};
    if (raw.byDay&&typeof raw.byDay==='object'&&!Array.isArray(raw.byDay)) {
      const keys=Object.keys(raw.byDay).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-90);
      for (const d of keys) byDay[d]=cleanCounts(raw.byDay[d]);
    }
    const total=cleanCounts(raw.total);
    const videosCount=Number.isFinite(+raw.videosCount)&&+raw.videosCount>=0?Math.min(1000000,Math.floor(+raw.videosCount)):0;
    const recentVideos=(Array.isArray(raw.recentVideos)?raw.recentVideos:[])
      .filter(id=>safeId(id)&&id.length<=30)
      .slice(-300);
    return {version:1,total,byDay,videosCount,recentVideos};
  }
  function buildBackup(syncStore,localStore,defaults={}) {
    const settings={};
    for (const [k,defVal] of Object.entries(defaults||{})) {
      if (SECRET_KEYS.has(k)||UNSAFE_KEYS.has(k)) continue;
      const val=syncStore&&Object.prototype.hasOwnProperty.call(syncStore,k)?syncStore[k]:defVal;
      if (typeof val===typeof defVal&&(typeof val!=='number'||Number.isFinite(val))) settings[k]=val;
    }
    const local={};
    for (const [k,v] of Object.entries(localStore||{})) {
      if (UNSAFE_KEYS.has(k)||v===undefined) continue;
      if (k==='cutIgnoreV1'||k==='cutAllowV1'||k==='yqnCutEditsIndexV1'||k==='yqnNotesMetaV1'||k==='yqnLifetimeSavingsV1'||
          /^yqn(Channel|ChannelSpeed|Learning|CutEdits|Notes)V1:[^\s]{1,80}$/.test(k)) {
        local[k]=JSON.parse(JSON.stringify(v));
      }
    }
    return {format:'yqn-backup-v1',version:1,exportedAt:new Date().toISOString(),settings,local};
  }
  function parseBackup(rawInput,defaults={}) {
    let obj=rawInput;
    if (typeof rawInput==='string') {
      try { obj=JSON.parse(rawInput); }
      catch { throw new Error('Choose a valid JSON backup file.'); }
    }
    if (!obj||typeof obj!=='object'||Array.isArray(obj)||obj.format!=='yqn-backup-v1') {
      throw new Error('This file is not a YouTube Quick Nav backup (expected yqn-backup-v1).');
    }
    const syncPatch={};
    if (obj.settings&&typeof obj.settings==='object'&&!Array.isArray(obj.settings)) {
      for (const [k,defVal] of Object.entries(defaults||{})) {
        if (SECRET_KEYS.has(k)||UNSAFE_KEYS.has(k)) continue;
        if (!Object.prototype.hasOwnProperty.call(obj.settings,k)) continue;
        const val=obj.settings[k];
        if (typeof val===typeof defVal&&(typeof val!=='number'||Number.isFinite(val))) {
          syncPatch[k]=typeof val==='string'?val.slice(0,120):val;
        }
      }
    }
    const localPatch={};
    const channelIds=new Set();
    let videosEditedCount=0,notesCount=0;
    const rawLocal=obj.local&&typeof obj.local==='object'&&!Array.isArray(obj.local)?obj.local:{};
    for (const [k,v] of Object.entries(rawLocal)) {
      if (UNSAFE_KEYS.has(k)) continue;
      if (k==='cutIgnoreV1'||k==='cutAllowV1') { localPatch[k]=sanitizeStampMap(v,500); continue; }
      if (k==='yqnCutEditsIndexV1') { localPatch[k]=sanitizeStampMap(v,300); continue; }
      if (k==='yqnLifetimeSavingsV1') { const cleaned=sanitizeLifetimeSavings(v); if (cleaned) localPatch[k]=cleaned; continue; }
      if (k==='yqnNotesMetaV1') {
        if (v&&typeof v==='object'&&!Array.isArray(v)) {
          const meta={};
          for (const [vid,m] of Object.entries(v).slice(0,1000)) {
            if (!safeId(vid)||!m||typeof m!=='object'||Array.isArray(m)) continue;
            meta[vid]={title:String(m.title||'').slice(0,300),channelName:String(m.channelName||'').slice(0,160),updatedAt:number(m.updatedAt)};
          }
          localPatch[k]=meta;
        }
        continue;
      }
      const match=k.match(/^yqn(Channel|ChannelSpeed|Learning|CutEdits|Notes)V1:([^\s]{1,80})$/);
      if (!match||!safeId(match[2])) continue;
      const [,kind,id]=match;
      if (kind==='Channel'&&v&&typeof v==='object'&&!Array.isArray(v)) {
        const prefs={};
        if (v.preferences&&typeof v.preferences==='object'&&!Array.isArray(v.preferences)) {
          for (const [pk,pv] of Object.entries(v.preferences)) {
            if (SECRET_KEYS.has(pk)||UNSAFE_KEYS.has(pk)) continue;
            if (typeof pv==='boolean'||(typeof pv==='number'&&Number.isFinite(pv))||(typeof pv==='string'&&pv.length<=40)) prefs[pk]=pv;
          }
        }
        localPatch[k]={name:String(v.name||'This channel').slice(0,160),preferences:prefs};
        channelIds.add(id);
      } else if (kind==='ChannelSpeed'&&v&&typeof v==='object'&&!Array.isArray(v)) {
        const rate=Number(v.rate);
        if (Number.isFinite(rate)&&rate>=0.5&&rate<=4) {
          localPatch[k]={name:String(v.name||'This channel').slice(0,160),rate:Math.round(rate*100)/100};
          channelIds.add(id);
        }
      } else if (kind==='Learning'&&v&&typeof v==='object'&&!Array.isArray(v)) {
        const samples=(Array.isArray(v.samples)?v.samples:[])
          .filter(s=>s&&safeId(s.videoId)&&typeof s.kind==='string'&&s.kind.length<=40&&['keep','speed','skip'].includes(s.action))
          .map(s=>({videoId:s.videoId,kind:s.kind,action:s.action}))
          .slice(-240);
        const approved={};
        if (v.approved&&typeof v.approved==='object'&&!Array.isArray(v.approved)) {
          for (const [ak,av] of Object.entries(v.approved)) {
            if (!UNSAFE_KEYS.has(ak)&&ak.length<=40&&['keep','speed','skip'].includes(av)) approved[ak]=av;
          }
        }
        localPatch[k]={samples,approved};
        channelIds.add(id);
      } else if (kind==='CutEdits') {
        const edits=(Array.isArray(v)?v:[])
          .filter(e=>e&&Number.isFinite(e.start)&&Number.isFinite(e.end)&&e.start>=0&&e.end>e.start&&['keep','speed','skip'].includes(e.action))
          .map(({start,end,action})=>({start,end,action}))
          .slice(-500);
        if (edits.length) { localPatch[k]=edits; videosEditedCount++; }
      } else if (kind==='Notes') {
        const cleaned=cleanNoteList(v);
        if (cleaned.length) { localPatch[k]=cleaned; notesCount+=cleaned.length; }
      }
    }
    return {
      syncPatch,
      localPatch,
      summary:{settingsCount:Object.keys(syncPatch).length,channelsCount:channelIds.size,videosEditedCount,notesCount}
    };
  }
  function diagnosis(s) {
    const why=[];
    if (!s.enabled) why.push(s.channelOff?'Auto-Cut is off for this channel.':'Auto-Cut is off.');
    if (s.adPlaying) why.push('An advert is currently playing; Auto-Cut pauses until the video resumes.');
    if (s.ignored) why.push('This video is ignored'+(s.ignoreReason==='short'?' because it is short':s.ignoreReason==='music'?' because it is music':s.ignoreReason==='live'?' because it is a live stream':'')+'.');
    if (s.preview) why.push('A section is being replayed at normal speed.');
    if (s.awaitingReview) why.push('Proposed cuts are waiting for your approval.');
    if (s.planning) why.push('Analysis is still running; later sections may not be ready.');
    if (s.row?.edited && s.row.action==='keep') why.push('Your saved Keep override protects this section.');
    else if (s.row?.action==='keep') why.push('This section is kept by the current analysis or viewing preferences.');
    if (s.errors?.length) why.push(...s.errors);
    if (!s.row) why.push('No cut covers this timestamp. A missed sponsor can be marked in Video tools.');
    if (!why.length) why.push(s.row?.action==='speed'?'This section is set to play faster.':'This section is set to skip.');
    if (Number.isFinite(s.channelBaseSpeed) && s.channelBaseSpeed>0) why.push(`Normal playback speed for this channel is ${s.channelBaseSpeed}×.`);
    if (s.silenceActive) why.push('Real-time silence speedup is currently active.');
    // Intentionally construct an allowlist: no keys, prompts, transcript or raw provider errors.
    return {version:1,videoId:String(s.videoId||'').slice(0,30),time:number(s.time),reasons:why,
      channelBaseSpeed:number(s.channelBaseSpeed),silenceSpeedup:!!s.silenceActive,
      sources:{community:!!s.community,claude:!!s.claude,jev:!!s.jev,thorough:!!s.thorough,silence:!!s.cutSilence},
      captionLines:number(s.captionLines),analysis:s.analysisAudit ? Object.fromEntries(
        ['reviewedKeep','proposedCut','acceptedCut','proposedSpeed','acceptedSpeed','proposedSkip','acceptedSkip','quoteMismatch','lowCertainty','disagreement','missingReview','overlappingReview','invalidSections']
          .map(key=>[key,number(s.analysisAudit[key])])) : null,
      coverage:s.analysisCoverage ? {checked:number(s.analysisCoverage.checked),total:number(s.analysisCoverage.total),recoveries:number(s.analysisCoverage.recoveries)} : null,
      failedSections:(Array.isArray(s.analysisFailures)?s.analysisFailures:[]).slice(0,60).map(f=>({
        start:number(f.start),end:number(f.end),phase:['analyse','review'].includes(f.phase)?f.phase:'unknown',
        code:['response_limit','budget','request_failed'].includes(f.code)?f.code:'unknown'})),
      section:s.row?{start:s.row.start,end:s.row.end,action:s.row.action,edited:!!s.row.edited}:null};
  }
  const GITHUB_REPO='rendez2k/yt-quicknav';
  function compareSemver(a,b) {
    const parse=v=>{
      const m=String(v||'').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
      return m?[+m[1],+m[2],+m[3]]:null;
    };
    const pa=parse(a),pb=parse(b);
    if (!pa||!pb) return 0;
    for (let i=0;i<3;i++) if (pa[i]!==pb[i]) return pa[i]>pb[i]?1:-1;
    return 0;
  }
  function parseReleaseUpdate(releaseJson,currentVersion='0.0.0',repo=GITHUB_REPO) {
    const cleanCur=String(currentVersion||'0.0.0').trim().replace(/^v/i,'');
    const safeRepo=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo||''))?String(repo):GITHUB_REPO;
    const fallbackUrl=`https://github.com/${safeRepo}/releases/latest`;
    if (!releaseJson||typeof releaseJson!=='object'||releaseJson.draft||releaseJson.prerelease) {
      return {valid:false,hasUpdate:false,currentVersion:cleanCur,latestVersion:'',zipUrl:'',releaseUrl:fallbackUrl,summary:''};
    }
    const tagMatch=String(releaseJson.tag_name||'').trim().match(/^v?(\d+\.\d+\.\d+)$/i);
    if (!tagMatch) {
      return {valid:false,hasUpdate:false,currentVersion:cleanCur,latestVersion:'',zipUrl:'',releaseUrl:fallbackUrl,summary:''};
    }
    const latestVersion=tagMatch[1];
    const hasUpdate=compareSemver(latestVersion,cleanCur)>0;
    const rawHtml=typeof releaseJson.html_url==='string'?releaseJson.html_url.trim():'';
    const releaseUrl=rawHtml.startsWith(`https://github.com/${safeRepo}/releases/`)?rawHtml:fallbackUrl;
    let zipUrl=releaseUrl;
    if (Array.isArray(releaseJson.assets)) {
      const zipAsset=releaseJson.assets.find(a=>
        a&&typeof a.name==='string'&&a.name.toLowerCase().endsWith('.zip')&&
        typeof a.browser_download_url==='string'&&
        a.browser_download_url.startsWith(`https://github.com/${safeRepo}/releases/download/`)
      );
      if (zipAsset) zipUrl=zipAsset.browser_download_url;
    }
    const rawBody=typeof releaseJson.body==='string'?releaseJson.body:'';
    const firstBullet=rawBody.split(/\r?\n/).filter(l=>!/^\s*#/.test(l)).map(l=>l.replace(/^[-*\s]+/,'').replace(/\*\*/g,'').trim()).find(l=>l.length>=10)||'';
    const summary=(firstBullet||String(releaseJson.name||'').trim()).slice(0,140);
    return {valid:true,hasUpdate,currentVersion:cleanCur,latestVersion,zipUrl,releaseUrl,summary};
  }
  globalThis.YqnToolsModel={GITHUB_REPO,compareSemver,parseReleaseUpdate,day,rates,price,estimate,totals,signature,parseTime,range,evidence,answerSchema,validateAnswer,notesMarkdown,normalizeCaptionLines,findActiveCaptionIndex,formatTranscriptQuote,searchTranscript,sbCategories,sponsorBlockPayload,searchAllNotes,allNotesMarkdown,buildBackup,parseBackup,diagnosis};
})();
