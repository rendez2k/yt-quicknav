/* Shared cache identity; credentials are represented only by presence. */
(() => {
  const defaults={cutMessaging:true,cutBoring:true,autoCutPlus:false,aiHighlights:false,aiModel:'claude-haiku-5-5',anthropicKey:'',jevCuts:false,typesafeKey:'',thoroughAnalysis:false};
  const key=s=>JSON.stringify([s.cutMessaging,s.cutBoring,s.autoCutPlus,s.aiHighlights,s.aiModel,!!s.anthropicKey,s.jevCuts,!!s.typesafeKey,s.thoroughAnalysis]);
  globalThis.YqnCache={storageKey:'cutCacheV15',ttl:3*86400000,defaults,key};
})();
