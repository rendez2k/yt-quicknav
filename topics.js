/* Topic markers are navigation data, never evidence for a playback cut. */
(() => {
  'use strict';
  function clean(items, duration=0, source='ai') {
    const seen=new Set();
    return (Array.isArray(items)?items:[]).filter(c=>c && typeof c.start==='number' &&
      Number.isFinite(c.start) && c.start>=0 && (!duration || c.start<duration) &&
      typeof c.title==='string' && c.title.trim()).sort((a,b)=>a.start-b.start)
      .filter(c=>{if(seen.has(c.start))return false;seen.add(c.start);return true;})
      .slice(0,100).map(c=>({start:c.start,title:c.title.trim().slice(0,100),source}));
  }
  function fromDescription(description,duration) {
    const items=[];
    for(const line of String(description || '').split(/\r?\n/)) {
      const match=line.match(/^\s*(\d{1,3}:\d{2}(?::\d{2})?)\s+(?:[-–—|]\s*)?(.+?)\s*$/);
      if(!match)continue;
      const parts=match[1].split(':').map(Number);
      if(parts.at(-1)>=60 || (parts.length===3 && parts[1]>=60))continue;
      items.push({start:parts.reduce((total,n)=>total*60+n,0),title:match[2]});
    }
    // A chapter list starts at zero and runs forward. Incidental timestamps
    // elsewhere in a description are not a reliable navigation map.
    if(items.length<2 || items[0].start!==0 || items.some((c,i)=>i && c.start<=items[i-1].start))return [];
    return clean(items,duration,'description');
  }
  function fromPlayerData(data,duration) {
    let chapters=[];
    function walk(value) {
      if(!value || typeof value!=='object' || chapters.length)return;
      if(Array.isArray(value.chapters)) {
        chapters=clean(value.chapters.flatMap(item=>{
          const c=item?.chapterRenderer;
          if(!c || c.timeRangeStartMillis===undefined || c.timeRangeStartMillis===null)return [];
          return [{start:Number(c.timeRangeStartMillis)/1000,title:c.title?.simpleText ||
            c.title?.runs?.map(r=>r.text || '').join('') || ''}];
        }),duration,'youtube');
        if(chapters.length<2)chapters=[];
      }
      for(const item of Object.values(value))walk(item);
    }
    // Only the current player's bar; recommendation cards can have chapters too.
    walk(data?.playerOverlays);
    return chapters;
  }
  globalThis.YqnTopics={clean,fromDescription,fromPlayerData};
})();
