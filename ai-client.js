/* All paid requests reserve budget before dispatch. Never retry a lost POST. */
(() => {
  'use strict';
  async function message(body) {
    const result=await chrome.runtime.sendMessage(body);
    if (!result?.ok) throw new Error(result?.error || 'Extension usage service unavailable; reload this tab.');
    return result;
  }
  async function request(url,options,videoId,transport=fetch) {
    const body=JSON.parse(options.body),bytes=new TextEncoder().encode(options.body).length;
    options.signal?.throwIfAborted();
    const {id}=await message({type:'yqn-usage-reserve',model:body.model,bytes,output:body.max_tokens||0,videoId});
    let dispatched=false,usage,unbilledError=false;
    try {
      options.signal?.throwIfAborted();dispatched=true;
      const result=await transport(url,options);
      if (typeof result.clone==='function') {
        try { usage=(await result.clone().json()).usage; } catch { /* retain estimated reservation on unreadable 2xx */ }
      } else usage=result.body?.usage;
      if (!usage && result && result.ok===false && Number.isInteger(result.status) &&
          [400,401,403,404,413,422,429,500,502,503,529].includes(result.status)) {
        unbilledError=true;
      }
      return result;
    } finally {
      try { await message({type:'yqn-usage-settle',id,usage,cancelledBeforeSend:!dispatched,unbilledError}); }
      catch { /* Persisted reservation remains charged if the worker disconnects. */ }
    }
  }
  globalThis.YqnAI={request,usage:videoId=>message({type:'yqn-usage-read',videoId})};
})();
