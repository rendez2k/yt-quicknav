/* Serialise reservations across tabs; storage is authoritative after worker restarts. */
(() => {
  'use strict';
  const key='yqnUsageV1';let queue=Promise.resolve();
  async function handle(msg) {
    const stored=await chrome.storage.local.get(key),ledger=stored[key] || {entries:{}};
    const today=YqnToolsModel.day();
    const oldest=new Date();oldest.setDate(oldest.getDate()-90);
    for (const [entryId,entry] of Object.entries(ledger.entries)) if (entry.day<YqnToolsModel.day(oldest)) delete ledger.entries[entryId];
    const settings=await chrome.storage.sync.get({aiDailyBudget:0,aiVideoBudget:0,jevInputPrice:0});
    // A supplied Jev rate can price earlier unpriced requests without dropping them.
    for (const entry of Object.values(ledger.entries)) if(entry.usd===null && entry.model==='jev-latest' && settings.jevInputPrice>0) {
      entry.usd=YqnToolsModel.estimate(entry.model,entry.bytes,entry.output,settings.jevInputPrice);
      entry.jevRate=settings.jevInputPrice;
    }
    if (msg.type==='yqn-usage-read') return {ok:true,...YqnToolsModel.totals(ledger,msg.videoId,today)};
    if (msg.type==='yqn-usage-reserve') {
      const videoId=typeof msg.videoId==='string'?msg.videoId.slice(0,30):'key-test';
      const totals=YqnToolsModel.totals(ledger,videoId,today);
      const daily=Math.max(0,Number(settings.aiDailyBudget)||0),video=Math.max(0,Number(settings.aiVideoBudget)||0);
      const usd=YqnToolsModel.estimate(msg.model,Math.max(0,Number(msg.bytes)||0),Math.max(0,Number(msg.output)||0),settings.jevInputPrice);
      if ((daily||video) && (usd===null || totals.today.unpriced || totals.video.unpriced)) return {ok:false,error:'AI budget paused: pricing is unknown. Set the Jev input price or use a supported Claude model.'};
      if ((daily && totals.today.usd+usd>daily) || (video && totals.video.usd+usd>video)) return {ok:false,error:'AI budget reached: this request would exceed the daily or per-video estimate limit. Adjust limits in the extension popup.'};
      const id=crypto.randomUUID();
      ledger.entries[id]={day:today,videoId,model:msg.model,usd,status:'reserved',jevRate:settings.jevInputPrice,tokens:0,bytes:msg.bytes,output:msg.output};
      // Keep accounting bounded without discarding current-day reservations. Per-video
      // budgets describe retained usage (90 days), explicitly labelled in the UI.
      await chrome.storage.local.set({[key]:ledger});
      return {ok:true,id};
    }
    const entry=ledger.entries[msg.id];
    if (!entry || entry.status!=='reserved') return {ok:true};
    if (msg.cancelledBeforeSend || (msg.unbilledError && !msg.usage)) delete ledger.entries[msg.id];
    else {
      const usd=YqnToolsModel.price(entry.model,msg.usage,entry.jevRate);
      if (usd!==null) { entry.usd=usd;entry.status='reported';entry.tokens=['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'].reduce((s,k)=>s+Math.max(0,Number(msg.usage[k])||0),0); }
      else entry.status='estimated'; // Lost/aborted replies retain the reservation.
    }
    await chrome.storage.local.set({[key]:ledger});
    return {ok:true};
  }
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if (!['yqn-usage-read','yqn-usage-reserve','yqn-usage-settle'].includes(msg?.type)) return;
    if (sender.id!==chrome.runtime.id) { reply({ok:false,error:'Unknown extension sender'});return; }
    const job=queue.then(()=>handle(msg));queue=job.catch(()=>{});
    job.then(reply,()=>reply({ok:false,error:'AI usage could not be saved. No new request was authorised.'}));
    return true;
  });
})();
