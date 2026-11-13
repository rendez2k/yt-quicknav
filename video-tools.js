/* A stable, keyboard-accessible drawer. Analysis refreshes never replace drafts. */
(() => {
  'use strict';
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,fn)=>{const n=el('button',text);n.type='button';n.addEventListener('click',fn);return n;};
  const stamp=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
  const money=x=>x.unpriced?`$${x.usd.toFixed(4)} + unpriced calls`:`$${x.usd.toFixed(4)}`;
  function open(api,initialPane='Mark sponsor') {
    const existing=document.getElementById('yqn-tools');if(existing){existing.dispatchEvent(new CustomEvent('yqn-select-pane',{detail:initialPane}));existing.querySelector('button').focus();return existing.yqnClose;}
    const videoId=api.state().videoId,controller=new AbortController();
    const current=()=>api.state().videoId===videoId && panel.isConnected;
    const panel=el('aside',null,'yqn-tools');panel.id='yqn-tools';panel.setAttribute('aria-label','Video tools');
    const previousFocus=document.activeElement;
    const header=el('div',null,'yqn-tools-head');header.append(el('strong','Video tools'));
    let onNotesChanged=null;
    const close=()=>{controller.abort();clearInterval(topicTimer);window.removeEventListener('yqn-topics-changed',renderTopics);if(onNotesChanged)window.removeEventListener('yqn-notes-changed',onNotesChanged);api.stopPreview();panel.remove();if(previousFocus?.isConnected)previousFocus.focus();};
    panel.yqnClose=close;
    header.append(button('Close',close));panel.append(header);
    panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();}});
    const status=el('div',null,'yqn-tools-status');status.setAttribute('role','status');
    const nav=el('div',null,'yqn-tools-nav'),body=el('div',null,'yqn-tools-body');panel.append(nav,status,body);
    const panes=[];
    function pane(name,onSelect) {
      const section=el('section');section.hidden=panes.length>0;section.setAttribute('aria-label',name);
      const tab=button(name,()=>{for(const p of panes){p.section.hidden=p!==item;p.tab.setAttribute('aria-pressed',String(p===item));}status.textContent='';onSelect?.();});
      const item={section,tab,name};tab.setAttribute('aria-pressed',String(!panes.length));panes.push(item);nav.append(tab);body.append(section);return section;
    }
    const hint=(parent,text)=>parent.append(el('p',text,'yqn-tools-hint'));
    function field(parent,label,type='text',options=[]) {
      const wrap=el('label',label),input=el(type==='textarea'?'textarea':type==='select'?'select':'input');
      if(type!=='textarea'&&type!=='select')input.type=type;
      if(type==='select')for(const [val,text] of options){const opt=el('option',text);opt.value=val;input.append(opt);}
      input.setAttribute('aria-label',label);wrap.append(input);parent.append(wrap);return input;
    }
    function task(label,fn) {return button(label,async e=>{const b=e.currentTarget;b.disabled=true;status.textContent='';try{await fn();}catch(error){if(current()&&!controller.signal.aborted)status.textContent=error.message||'Could not save. Please try again.';}finally{b.disabled=false;}});}
    const mark=pane('Mark sponsor');
    hint(mark,'Mark a missed sponsor, segment, or community highlight. Preview a range, save a local override on this device, or submit to SponsorBlock.');
    const start=field(mark,'Start (seconds or mm:ss)'),end=field(mark,'End (seconds or mm:ss)');
    const category=field(mark,'Category','select',YqnToolsModel.sbCategories);
    category.addEventListener('change',()=>{end.placeholder=category.value==='poi_highlight'?'Not needed for highlight':'';});
    const marking=el('div',null,'yqn-tools-actions');
    marking.append(button('Mark start',()=>{start.value=api.state().time.toFixed(1);}),button('Mark end',()=>{end.value=api.state().time.toFixed(1);}));mark.append(marking);
    const getRange=()=>YqnToolsModel.range(start.value,end.value,api.state().duration);
    const getPoiPoint=()=>{
      const a=YqnToolsModel.parseTime(start.value),dur=api.state().duration;
      if(!Number.isFinite(a)||a<0||(Number.isFinite(dur)&&dur>0&&a>dur))throw new Error('Enter a highlight timestamp in Start (seconds or mm:ss) within this video.');
      return {start:a,end:a};
    };
    mark.append(task('Preview range',async()=>{api.preview(getRange());status.textContent='Previewing at your normal speed; playback pauses at the end.';}),button('Stop preview',()=>api.stopPreview()),
      task('Save sponsor skip',async()=>{const r=getRange();await api.saveRange(r,'skip');if(current())status.textContent=api.state().awaitingReview?'Sponsor saved. Approve the proposed cuts in Auto-Cut to apply it.':'Sponsor skip saved on this device.';}),
      task('Submit to SponsorBlock',async()=>{const r=category.value==='poi_highlight'?getPoiPoint():getRange();const res=await api.submitSponsorBlock(r,category.value);if(current())status.textContent=res?.message||(category.value==='poi_highlight'?'Highlight submitted to SponsorBlock and pinned on this video.':'Submitted to SponsorBlock and saved on this device.');}),
      task('Remove saved override',async()=>{await api.saveRange(getRange(),'default');if(current())status.textContent='Saved override removed. The analysis decision applies again.';}));

    let captionLines=null,normalizedLines=[],loadingCaptions=null,ensureCaptions=()=>{};
    let followPlayback=true,searchHovering=false,liveWindowStart=0,lastSyncedIdx=-2,activeRowEl=null;
    const searchPane=pane('Search',()=>{ensureCaptions();syncActiveCaption(true);queueMicrotask(()=>{if(current()&&!searchPane.hidden)searchInput.focus();});});
    hint(searchPane,'Instant free keyword search & live-synced transcript (Shift+F). No AI key required. Click any line or press Enter to jump, or 📋 to copy a timestamped quote.');
    const searchInput=field(searchPane,'Search captions','search');searchInput.placeholder='Type keywords or a phrase (leave empty for live transcript)…';searchInput.maxLength=200;
    const searchBar=el('div',null,'yqn-search-bar');
    const searchSummary=el('p','','yqn-tools-hint yqn-search-summary');
    const followBtn=button('Follow playback',()=>{
      followPlayback=!followPlayback;
      followBtn.setAttribute('aria-pressed',String(followPlayback));
      lastSyncedIdx=-2;
      if(!searchInput.value.trim()){
        if(normalizedLines.length)searchSummary.textContent=`${normalizedLines.length} caption lines ready — live follow ${followPlayback?'on':'paused'}.`;
        syncActiveCaption(true);
      }
    });
    followBtn.className='yqn-search-follow';followBtn.setAttribute('aria-pressed','true');followBtn.hidden=true;
    searchBar.append(searchSummary,followBtn);
    const searchList=el('div',null,'yqn-search-list');
    searchList.addEventListener('pointerenter',()=>{searchHovering=true;});
    searchList.addEventListener('pointerleave',()=>{searchHovering=false;});
    function renderHighlightedText(text,highlights){
      const span=el('span',null,'yqn-search-text');
      if(!Array.isArray(highlights)||!highlights.length){span.textContent=text;return span;}
      let cursor=0;
      for(const [from,to] of highlights){
        if(from>cursor)span.append(document.createTextNode(text.slice(cursor,from)));
        span.append(el('mark',text.slice(from,to),'yqn-search-hit'));
        cursor=to;
      }
      if(cursor<text.length)span.append(document.createTextNode(text.slice(cursor)));
      return span;
    }
    function buildTranscriptRow(item,highlights,lineIdx=-1){
      const wrap=el('div',null,'yqn-search-row');
      if(lineIdx>=0)wrap.dataset.lineIdx=String(lineIdx);
      const jumpBtn=button('',()=>api.jump({start:item.start,end:Math.max(item.end||0,item.start+6)}));
      jumpBtn.className='yqn-search-jump';
      jumpBtn.append(el('span',stamp(item.start),'yqn-search-stamp'),document.createTextNode(' · '),renderHighlightedText(item.text,highlights));
      const copyBtn=button('📋',async()=>{
        const quote=YqnToolsModel.formatTranscriptQuote({text:item.text,start:item.start,videoId});
        try{await navigator.clipboard.writeText(quote);status.textContent='Quote copied to clipboard.';}
        catch{status.textContent='Clipboard unavailable. Focus the page and retry.';}
      });
      copyBtn.className='yqn-search-copy';
      copyBtn.title='Copy quote with timestamp link';
      copyBtn.setAttribute('aria-label',`Copy quote at ${stamp(item.start)}`);
      wrap.append(jumpBtn,copyBtn);
      return wrap;
    }
    function syncActiveCaption(forceScroll=false){
      if(!current()||searchPane.hidden||searchInput.value.trim()||!normalizedLines.length)return;
      const st=api.state();
      const idx=st.adPlaying?-1:YqnToolsModel.findActiveCaptionIndex(normalizedLines,st.time||0);
      if(normalizedLines.length>500&&followPlayback&&idx>=0&&(idx<liveWindowStart+20||idx>=liveWindowStart+380)){
        renderSearchResults();return;
      }
      if(idx===lastSyncedIdx&&!forceScroll)return;
      if(activeRowEl){activeRowEl.classList.remove('yqn-search-active');activeRowEl.removeAttribute('aria-current');activeRowEl=null;}
      lastSyncedIdx=idx;
      if(idx>=0){
        const nextEl=searchList.querySelector(`[data-line-idx="${idx}"]`);
        if(nextEl){
          activeRowEl=nextEl;
          nextEl.classList.add('yqn-search-active');
          nextEl.setAttribute('aria-current','true');
          if(followPlayback&&(!searchHovering||forceScroll))nextEl.scrollIntoView?.({block:'nearest'});
        }
      }
    }
    function renderSearchResults(){
      searchList.replaceChildren();activeRowEl=null;lastSyncedIdx=-2;
      if(captionLines===null){followBtn.hidden=true;searchSummary.textContent=loadingCaptions?'Loading captions…':'Captions not loaded yet.';return;}
      if(!normalizedLines.length){followBtn.hidden=true;searchSummary.textContent='No captions available for this video.';return;}
      if(!searchInput.value.trim()){
        followBtn.hidden=false;
        searchSummary.textContent=`${normalizedLines.length} caption lines ready — live follow ${followPlayback?'on':'paused'}.`;
        let from=0,to=normalizedLines.length;
        if(normalizedLines.length>500){
          const center=Math.max(0,YqnToolsModel.findActiveCaptionIndex(normalizedLines,api.state().time||0));
          from=Math.max(0,Math.min(normalizedLines.length-400,center-120));
          to=Math.min(normalizedLines.length,from+400);
        }
        liveWindowStart=from;
        for(let i=from;i<to;i++)searchList.append(buildTranscriptRow(normalizedLines[i],null,i));
        syncActiveCaption(true);
        return;
      }
      followBtn.hidden=true;
      const res=YqnToolsModel.searchTranscript(normalizedLines,searchInput.value,120);
      searchSummary.textContent=!res.totalMatches?'No caption matches found.':
        res.totalMatches>res.matches.length?`Showing first ${res.matches.length} of ${res.totalMatches} matches.`:
        `${res.totalMatches} match${res.totalMatches===1?'':'es'} across ${res.totalLines} caption lines.`;
      for(const m of res.matches)searchList.append(buildTranscriptRow(m,m.highlights,-1));
    }
    ensureCaptions=()=>{
      if(captionLines!==null||loadingCaptions){renderSearchResults();return;}
      loadingCaptions=Promise.resolve(api.getTranscript?api.getTranscript(controller.signal):[]).then(lines=>{
        if(!current())return;
        captionLines=Array.isArray(lines)?lines:[];
        normalizedLines=YqnToolsModel.normalizeCaptionLines(captionLines);
        loadingCaptions=null;renderSearchResults();
      },err=>{
        if(!current())return;
        captionLines=[];normalizedLines=[];loadingCaptions=null;followBtn.hidden=true;
        searchSummary.textContent=err?.message||'Captions unavailable for this video.';
      });
      renderSearchResults();
    };
    const liveSyncTimer=setInterval(()=>syncActiveCaption(false),250);
    controller.signal.addEventListener('abort',()=>clearInterval(liveSyncTimer),{once:true});
    searchInput.addEventListener('input',renderSearchResults);
    searchInput.addEventListener('keydown',e=>{if(e.key==='Enter'){const first=searchList.querySelector('button.yqn-search-jump')||searchList.querySelector('button');if(first){e.preventDefault();first.click();}}});
    searchPane.append(searchBar,searchList);

    const ask=pane('Ask video');
    hint(ask,'Ask about the available captions. Your question and relevant transcript excerpts are sent to your configured Claude model. Budget limits apply. Answers cannot inspect visual-only content.');
    const question=field(ask,'Question','textarea');question.maxLength=2000;
    const answer=el('div',null,'yqn-tools-answer');answer.setAttribute('aria-live','polite');
    ask.append(task('Ask this video',async()=>{
      if(!question.value.trim())throw new Error('Enter a question first.');
      answer.textContent='Reading captions…';
      try {
        const result=await api.ask(question.value.trim(),controller.signal);
        if(!current())return;
        answer.replaceChildren(el('p',result.answer));
        if(result.partial)hint(answer,'Searched relevant excerpts from a long transcript; the rest was not sent to Claude.');
        for(const cite of result.citations)answer.append(button(`${stamp(cite.start)} · ${cite.quote}`,()=>api.jump(cite)));
      } catch(error) {if(current())answer.textContent='';throw error;}
    }),answer);

    const notesPane=pane('Notes'),noteKey=`yqnNotesV1:${videoId}`;
    hint(notesPane,'Bookmarks and notes stay on this device. Press Shift+B on any video for a quick bookmark. Export includes links back to exact timestamps.');
    const note=field(notesPane,'Note (optional)','textarea');note.maxLength=5000;
    const notesList=el('div',null,'yqn-notes-list');let notes=[],noteQueue=Promise.resolve();
    async function readNotes(){const stored=await chrome.storage.local.get(noteKey);return Array.isArray(stored[noteKey])?stored[noteKey].filter(n=>n&&typeof n.id==='string'&&Number.isFinite(n.time)&&n.time>=0&&typeof n.text==='string').slice(-500):[];}
    let notifyingNotes=false;
    function changeNotes(update){const job=noteQueue.then(async()=>{const fresh=await readNotes();if(!current())return;const next=update(fresh);await chrome.storage.local.set({[noteKey]:next});await api.saveNoteMeta?.(next.length>0);if(current()){notes=next;renderNotes();notifyingNotes=true;try{window.dispatchEvent(new Event('yqn-notes-changed'));}finally{notifyingNotes=false;}}});noteQueue=job.catch(()=>{});return job;}
    function renderNotes(){
      notesList.replaceChildren();if(!notes.length)hint(notesList,'No bookmarks yet.');
      for(const n of [...notes].sort((a,b)=>a.time-b.time)){
        const row=el('div',null,'yqn-note');
        row.append(button(stamp(n.time),()=>api.jump({start:n.time,end:Math.min(api.state().duration,n.time+10)})));
        const text=field(row,`Note at ${stamp(n.time)}`,'textarea');text.value=n.text;text.maxLength=5000;
        row.append(task('Save note',()=>changeNotes(list=>list.map(item=>item.id===n.id?{...item,text:text.value}:item))),task('Delete note',()=>changeNotes(list=>list.filter(item=>item.id!==n.id))));notesList.append(row);
      }
    }
    notesPane.append(task('Bookmark current time',async()=>{
      const time=api.state().time,text=note.value;
      await changeNotes(list=>{if(list.length>=500)throw new Error('This video has 500 bookmarks. Export them and remove a bookmark before adding another.');return [...list,{id:crypto.randomUUID(),time,text}];});if(current()){note.value='';status.textContent=`Bookmark saved at ${stamp(time)}.`;}
    }),task('Export notes (.md)',async()=>{
      notes=await readNotes();if(!current())return;if(!notes.length)throw new Error('Add a bookmark before exporting.');
      const blob=new Blob([YqnToolsModel.notesMarkdown(videoId,api.state().title,notes)],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob);
      const link=el('a');link.href=url;link.download=`youtube-notes-${videoId.replace(/[^\w-]/g,'')}.md`;panel.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }),notesList);
    readNotes().then(list=>{if(current()){notes=list;renderNotes();}},()=>{if(current())status.textContent='Notes could not be loaded. Try reopening Video tools.';});

    let refreshAllNotes=()=>{};
    const allNotesPane=pane('All notes',()=>void refreshAllNotes());
    hint(allNotesPane,'Search bookmarks and notes across every video saved on this device. Click a note to jump right to that moment.');
    const allSearch=field(allNotesPane,'Search all saved notes','search');allSearch.placeholder='Filter by note text, video title, channel or ID…';allSearch.maxLength=200;
    const allSummary=el('p','','yqn-tools-hint'),allList=el('div',null,'yqn-all-notes-list');
    let lastAllFound={totalNotes:0,totalVideos:0,results:[]};
    refreshAllNotes=async()=>{
      const allStore=await chrome.storage.local.get(null);
      if(!current())return;
      lastAllFound=YqnToolsModel.searchAllNotes(allStore,allSearch.value);
      allSummary.textContent=!lastAllFound.totalNotes?'No saved notes across any video yet.':
        `${lastAllFound.results.length} matching of ${lastAllFound.totalNotes} note${lastAllFound.totalNotes===1?'':'s'} across ${lastAllFound.totalVideos} video${lastAllFound.totalVideos===1?'':'s'}.`;
      allList.replaceChildren();
      for(const item of lastAllFound.results.slice(0,200)){
        const card=el('div',null,'yqn-all-note');
        const meta=el('div',`${item.title}${item.channelName?` · ${item.channelName}`:''}${item.videoId===api.state().videoId?' · current video':''}`,'yqn-all-note-meta');
        const jumpBtn=button(`${stamp(item.time)} · ${item.text||'Bookmark'}`,()=>{
          if(item.videoId===api.state().videoId)api.jump({start:item.time,end:Math.min(api.state().duration||item.time+10,item.time+10)});
          else window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}&t=${Math.floor(item.time)}s`,'_blank','noopener,noreferrer');
        });
        card.append(meta,jumpBtn);allList.append(card);
      }
    };
    allSearch.addEventListener('input',()=>void refreshAllNotes());
    allNotesPane.append(task('Export matching notes (.md)',async()=>{
      await refreshAllNotes();if(!current())return;
      if(!lastAllFound.results.length)throw new Error('No matching notes to export.');
      const blob=new Blob([YqnToolsModel.allNotesMarkdown(lastAllFound.results,allSearch.value)],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob);
      const link=el('a');link.href=url;link.download='youtube-all-notes.md';panel.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }),allSummary,allList);
    onNotesChanged=()=>{
      if(!notifyingNotes)readNotes().then(list=>{if(current()){notes=list;renderNotes();}},()=>{});
      if(!allNotesPane.hidden)void refreshAllNotes();
    };
    window.addEventListener('yqn-notes-changed',onNotesChanged);

    const diagnostics=pane('Diagnostics');
    hint(diagnostics,'Explain the current timestamp. Reports include the video ID, enabled sources and cut state, without API keys, transcript text or raw provider responses.');
    const report=el('pre');report.tabIndex=0;
    const refresh=()=>{report.textContent=JSON.stringify(YqnToolsModel.diagnosis(api.state()),null,2);};
    diagnostics.append(button('Why wasn’t this skipped?',refresh),task('Copy diagnostic report',async()=>{refresh();try{await navigator.clipboard.writeText(report.textContent);status.textContent='Diagnostic report copied.';}catch{status.textContent='Clipboard unavailable. Select and copy the report below.';const range=document.createRange();range.selectNodeContents(report);getSelection().removeAllRanges();getSelection().addRange(range);}}),report);
    refresh();
    const usagePane=pane('AI usage'),usage=el('p');
    hint(usagePane,'Estimated USD for requests made by this extension. Includes pending and uncertain calls; actual provider bills can differ. Daily limits use this computer’s local date. Video totals cover retained history (90 days). Configure limits in the extension popup.');
    async function refreshUsage(){const value=await YqnAI.usage(videoId);if(current())usage.textContent=`Today: ${money(value.today)} · ${value.today.calls} calls (${value.today.uncertain} estimated/pending). This video: ${money(value.video)} · ${value.video.calls} calls. Reported tokens today: ${value.today.tokens.toLocaleString()}.`;}
    usagePane.append(task('Refresh usage',refreshUsage),usage);refreshUsage().catch(()=>{if(current())usage.textContent='Usage unavailable. Reopen Video tools to retry.';});

    const topicsPane=pane('Topics'),topicSummary=el('p'),topicList=el('div',null,'yqn-topic-list');
    hint(topicsPane,'Jump to the next app or subject with ⏭, or pick one below. YouTube chapters are available without AI; AI topics appear as the review progresses when the video has no chapters.');
    topicsPane.append(button('Previous topic',()=>{api.nextTopic(-1);renderTopics();}),button('Next topic',()=>{api.nextTopic(1);renderTopics();}),topicSummary,topicList);
    let topicFingerprint='';
    function renderTopics(){
      const state=api.state(),topics=state.topics || [];
      topicSummary.textContent=`${topics.length} topics${topics.length ? (topics[0].source==='ai'?' · AI':' · YouTube') : ''}. `+
        (state.planning?'Auto-Cut is still checking; skip and speed results may change.':state.enabled?`${state.errors?.length?'Analysis incomplete. ':''}${state.skipCount} skip · ${state.speedCount} speed${state.awaitingReview?' · approval required':''}.`:'Auto-Cut is off. Topic navigation still works.');
      const fingerprint=JSON.stringify(topics);
      if(fingerprint!==topicFingerprint){
        topicFingerprint=fingerprint;topicList.replaceChildren();
        if(!topics.length)hint(topicList,'No topics available yet. The arrow buttons move by one minute until a topic map is available.');
        for(const c of topics){const row=button(`${stamp(c.start)} · ${c.title}`,()=>{api.topic(c);renderTopics();});row.dataset.start=String(c.start);topicList.append(row);}
      }
      const active=topics.filter(c=>c.start<=state.time+0.1).at(-1);
      for(const row of topicList.querySelectorAll('button'))row.setAttribute('aria-current',String(Number(row.dataset.start)===active?.start));
    }
    window.addEventListener('yqn-topics-changed',renderTopics);
    const topicTimer=setInterval(()=>{if(!topicsPane.hidden)renderTopics();},1000);
    panel.addEventListener('yqn-select-pane',event=>panes.find(p=>p.name===event.detail)?.tab.click());
    panes.find(p=>p.name===initialPane)?.tab.click();renderTopics();
    document.body.append(panel);header.querySelector('button').focus();
    return close;
  }
  globalThis.YqnVideoTools={open};
})();
