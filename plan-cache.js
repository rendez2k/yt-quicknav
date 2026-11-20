/* Shared cache identity; credentials are represented only by presence. */
(() => {
  const defaults={cutMessaging:true,cutBoring:true,autoCutPlus:false,aiHighlights:false,aiModel:'claude-haiku-5-5',anthropicKey:'',jevCuts:false,typesafeKey:'',thoroughAnalysis:false,chapterCuts:true,channelMemory:true,commentSignals:true,visualCheck:true,visualAI:true};
  const key=s=>JSON.stringify(['v4',s.cutMessaging,s.cutBoring,s.autoCutPlus,s.aiHighlights,s.aiModel,!!s.anthropicKey,s.jevCuts,!!s.typesafeKey,s.thoroughAnalysis,
    s.chapterCuts!==false,s.channelMemory!==false,s.commentSignals!==false,s.visualCheck!==false,s.visualAI!==false]);
  globalThis.YqnCache={storageKey:'cutCacheV16',ttl:3*86400000,defaults,key};
})();
