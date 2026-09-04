/* Runs in the YouTube page context (not the isolated content-script world)
 * so it can read YouTube's InnerTube config (ytcfg) and auth cookies, then
 * add/remove the current video from Watch Later with a single API call.
 * Communicates with content.js via window.postMessage.
 */
(() => {
  "use strict";
  if (window.__yqnInjected) return;
  window.__yqnInjected = true;

  // Gated logging — content.js flips this via a 'set-debug' message.
  let YQN_DEBUG = false;
  function dlog(...args) {
    if (YQN_DEBUG) console.log(...args);
  }
  dlog("[YQN] page helper loaded");

  // Capture YouTube's own get_transcript response (full transcript, no DOM
  // rendering/visibility needed) by wrapping fetch. Installed at
  // document_start so it sees the request whenever the panel loads.
  window.__yqnTx = null;
  (function patchFetchForTranscript() {
    const of = window.fetch;
    if (!of) return;
    window.fetch = function (...a) {
      const p = of.apply(this, a);
      try {
        const url = typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || "";
        if (url.indexOf("/youtubei/v1/get_transcript") !== -1) {
          p.then((r) => r.clone().json())
            .then((j) => {
              const segs = parseTranscriptResponse(j);
              if (segs.length) {
                window.__yqnTx = segs;
                dlog("[YQN] captured transcript:", segs.length, "segments");
              }
            })
            .catch(() => {});
        }
      } catch {}
      return p;
    };
  })();

  // Some InnerTube calls go through XHR rather than fetch — capture those too.
  (function patchXhrForTranscript() {
    const XHR = window.XMLHttpRequest;
    if (!XHR) return;
    const open = XHR.prototype.open;
    XHR.prototype.open = function (method, url) {
      this.__yqnIsTx =
        typeof url === "string" && url.indexOf("/youtubei/v1/get_transcript") !== -1;
      return open.apply(this, arguments);
    };
    const send = XHR.prototype.send;
    XHR.prototype.send = function () {
      if (this.__yqnIsTx) {
        this.addEventListener("load", () => {
          try {
            const j = JSON.parse(this.responseText);
            const segs = parseTranscriptResponse(j);
            if (segs.length) {
              window.__yqnTx = segs;
              dlog("[YQN] captured transcript (xhr):", segs.length, "segments");
            }
          } catch {}
        });
      }
      return send.apply(this, arguments);
    };
  })();

  // Find the getTranscriptEndpoint params anywhere in a response tree.
  function findTranscriptParams(obj) {
    let p = null;
    (function walk(o) {
      if (p || !o || typeof o !== "object") return;
      if (o.getTranscriptEndpoint && o.getTranscriptEndpoint.params) {
        p = o.getTranscriptEndpoint.params;
        return;
      }
      for (const k in o) {
        if (!p) walk(o[k]);
      }
    })(obj);
    return p;
  }

  function parseTranscriptResponse(j) {
    const segs = deepFindArray(j, "initialSegments") || [];
    const out = [];
    for (const s of segs) {
      const r = s.transcriptSegmentRenderer;
      if (!r) continue;
      const runs = (r.snippet && r.snippet.runs) || [];
      const text = runs
        .map((x) => x.text || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (text) out.push({ start: (+r.startMs || 0) / 1000, text });
    }
    return out;
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function sha1Hex(str) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // YouTube authorises mutating InnerTube calls with a SAPISIDHASH header.
  async function buildAuthHeader(origin) {
    const sapisid =
      getCookie("SAPISID") ||
      getCookie("__Secure-3PAPISID") ||
      getCookie("__Secure-1PAPISID");
    if (!sapisid) return null;
    const ts = Math.floor(Date.now() / 1000);
    const hash = await sha1Hex(`${ts} ${sapisid} ${origin}`);
    return `SAPISIDHASH ${ts}_${hash}`;
  }

  function getCfg(key) {
    try {
      if (window.ytcfg && typeof window.ytcfg.get === "function") {
        return window.ytcfg.get(key);
      }
    } catch {}
    return null;
  }

  const ORIGIN = "https://www.youtube.com";

  // Shared config + auth needed for any InnerTube call.
  async function getApiBits() {
    const apiKey = getCfg("INNERTUBE_API_KEY");
    const context = getCfg("INNERTUBE_CONTEXT");
    if (!apiKey || !context) {
      return { error: "Couldn't read YouTube API config." };
    }
    const auth = await buildAuthHeader(ORIGIN);
    if (!auth) {
      return { error: "Not signed in to YouTube." };
    }
    return { apiKey, context, auth };
  }

  function innertubeFetch(path, apiKey, auth, body) {
    const headers = {
      "Content-Type": "application/json",
      "X-Origin": ORIGIN,
      "X-Goog-AuthUser": "0",
    };
    if (auth) headers.Authorization = auth; // optional for read endpoints
    return fetch(
      `${ORIGIN}/youtubei/v1/${path}?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
      {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(body),
      }
    );
  }

  // Find the first array stored under `key` anywhere in an object tree.
  function deepFindArray(obj, key) {
    let res = null;
    (function walk(o) {
      if (res || !o || typeof o !== "object") return;
      if (Array.isArray(o[key])) {
        res = o[key];
        return;
      }
      for (const k in o) {
        if (!res) walk(o[k]);
      }
    })(obj);
    return res;
  }

  function mapHeatMarkers(markers) {
    return markers
      .map((m) => m.heatMarkerRenderer || m)
      .filter((r) => r && isFinite(r.timeRangeStartMillis))
      .map((r) => ({
        start: r.timeRangeStartMillis / 1000,
        end: (r.timeRangeStartMillis + (r.markerDurationMillis || 0)) / 1000,
        score: r.heatMarkerIntensityScoreNormalized || 0,
      }));
  }

  function decodeEntities(s) {
    return s
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&amp;/g, "&");
  }

  // Download a caption track. YouTube's json3 format often returns 200 with
  // zero events now, so try the default XML/timedtext format first (the one
  // that still works), then fall back to json3. XML is parsed by regex, not
  // DOMParser, because YouTube's Trusted Types policy blocks DOMParser here.
  async function fetchTranscript(baseUrl, diag) {
    // Strip any pre-existing fmt so we control the format.
    const clean = baseUrl.replace(/&fmt=[^&]*/g, "");

    // 1) default XML format, no credentials (mirrors what works elsewhere)
    try {
      const r = await fetch(clean, { credentials: "omit" });
      diag.ttXmlStatus = r.status;
      const xml = await r.text();
      const out = [];
      const re = /<text[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
      let m;
      while ((m = re.exec(xml))) {
        const text = decodeEntities(m[2].replace(/<[^>]+>/g, ""))
          .replace(/\s+/g, " ")
          .trim();
        if (text) out.push({ start: parseFloat(m[1]) || 0, text });
      }
      diag.xmlNodes = out.length;
      if (out.length) return out;
    } catch (e) {
      diag.ttXmlErr = e && e.message;
    }

    // 2) json3 fallback
    try {
      const r = await fetch(clean + "&fmt=json3", { credentials: "omit" });
      diag.timedtextStatus = r.status;
      const tj = await r.json().catch(() => ({}));
      diag.transcriptEvents = (tj.events || []).length;
      return (tj.events || [])
        .filter((ev) => ev.segs)
        .map((ev) => ({
          start: (ev.tStartMs || 0) / 1000,
          text: ev.segs.map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim(),
        }))
        .filter((x) => x.text);
    } catch (e) {
      diag.transcriptErr = e && e.message;
    }
    return [];
  }

  function getMoviePlayer() {
    const el = document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player");
    return el && typeof el.getPlayerResponse === "function" ? el : null;
  }

  // The player's own live player-response for the CURRENT video — always
  // fresh, unlike window.ytInitialPlayerResponse after SPA navigation.
  function getLivePlayerResponse(videoId) {
    try {
      const mp = getMoviePlayer();
      if (!mp) return null;
      const pr = mp.getPlayerResponse();
      const id = pr && pr.videoDetails && pr.videoDetails.videoId;
      if (!id || id === videoId) return pr;
    } catch {}
    return null;
  }

  // Gather Auto-Cut data (most-replayed heatmap + transcript) for a video.
  // Prefer the player's live data; fall back to page globals then the API.
  async function gatherAutocut(videoId, needHeatmap, needTranscript) {
    const payload = { heatmap: [], transcript: [] };
    const diag = { videoId };

    const pr = window.ytInitialPlayerResponse;
    const freshGlobals = !!(pr && pr.videoDetails && pr.videoDetails.videoId === videoId);
    diag.freshGlobals = freshGlobals;

    const livePr = getLivePlayerResponse(videoId);
    diag.livePlayer = !!livePr;

    const apiKey = getCfg("INNERTUBE_API_KEY");
    const context = getCfg("INNERTUBE_CONTEXT");
    const auth = await buildAuthHeader(ORIGIN).catch(() => null);

    // Fetch the `next` response once and reuse it (heatmap + transcript params).
    let nextJson;
    async function getNext() {
      if (nextJson !== undefined) return nextJson;
      nextJson = null;
      if (apiKey && context) {
        try {
          const res = await innertubeFetch("next", apiKey, auth, { context, videoId });
          nextJson = await res.json().catch(() => ({}));
          diag.nextKeys = Object.keys(nextJson || {});
          if (nextJson && nextJson.error) diag.nextError = nextJson.error.status;
        } catch (e) {
          diag.nextErr = e && e.message;
        }
      }
      return nextJson;
    }

    if (needHeatmap) {
      let markers = null;
      let src = "none";
      if (freshGlobals && window.ytInitialData) {
        markers = deepFindArray(window.ytInitialData, "heatMarkers");
        if (markers) src = "ytInitialData";
      }
      if (!markers) {
        const nj = await getNext();
        markers = nj && deepFindArray(nj, "heatMarkers");
        if (markers) src = "next-api";
      }
      if (markers) payload.heatmap = mapHeatMarkers(markers);
      diag.heatmapSrc = src;
      dlog("[YQN] autocut heatmap points:", payload.heatmap.length, diag);
    }

    if (needTranscript) {
      let tsrc = "none";

      // Video description — often carries the real URLs for things the
      // speaker mentions, so the AI can link mentions accurately.
      const prAny = livePr || (freshGlobals ? pr : null);
      payload.description =
        (prAny && prAny.videoDetails && prAny.videoDetails.shortDescription) || "";

      // 1) get_transcript endpoint — the same API the transcript panel uses,
      //    so it works where the timedtext download is token-gated. Params
      //    come free from ytInitialData on a fresh load, else from `next`.
      if (apiKey && context) {
        let params =
          freshGlobals && window.ytInitialData
            ? findTranscriptParams(window.ytInitialData)
            : null;
        diag.paramsFromInitial = !!params;
        if (!params) {
          const nj = await getNext();
          params = findTranscriptParams(nj);
        }
        diag.transcriptParams = !!params;
        if (params) {
          try {
            const res = await innertubeFetch("get_transcript", apiKey, auth, {
              context,
              params,
            });
            const gj = await res.json().catch(() => ({}));
            const segs = parseTranscriptResponse(gj);
            diag.getTranscript = segs.length;
            if (segs.length) {
              payload.transcript = segs;
              tsrc = "get_transcript";
            }
          } catch (e) {
            diag.getTranscriptErr = e && e.message;
          }
        }
      }

      // 2) caption track download (fallback; often token-gated now)
      if (!payload.transcript.length) {
        let tracks =
          (livePr && deepFindArray(livePr, "captionTracks")) ||
          (freshGlobals && deepFindArray(pr, "captionTracks"));
        if (!tracks && apiKey && context) {
          try {
            const res = await innertubeFetch("player", apiKey, auth, { context, videoId });
            const json = await res.json().catch(() => ({}));
            if (json && json.playabilityStatus) diag.playability = json.playabilityStatus.status;
            tracks = deepFindArray(json, "captionTracks");
          } catch (e) {
            diag.playerErr = e && e.message;
          }
        }
        diag.captionTracks = tracks ? tracks.length : 0;
        if (tracks && tracks.length) {
          const track =
            tracks.find((t) => (t.languageCode || "").startsWith("en")) || tracks[0];
          payload.transcript = await fetchTranscript(track.baseUrl, diag);
          if (payload.transcript.length) tsrc = "captions";
        }
      }

      diag.captionSrc = tsrc;
      dlog("[YQN] autocut transcript lines:", payload.transcript.length, diag);
    }

    payload.diag = diag;
    return payload;
  }

  async function editWatchLater(videoId, action) {
    const bits = await getApiBits();
    if (bits.error) return { ok: false, message: bits.error };
    const { apiKey, context, auth } = bits;

    const playlistAction =
      action === "remove"
        ? { action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: videoId }
        : { action: "ACTION_ADD_VIDEO", addedVideoId: videoId };

    try {
      const res = await innertubeFetch("browse/edit_playlist", apiKey, auth, {
        context,
        playlistId: "WL",
        actions: [playlistAction],
      });

      if (!res.ok) {
        return { ok: false, message: `YouTube returned ${res.status}.` };
      }
      const json = await res.json().catch(() => ({}));
      if (json && json.status && json.status !== "STATUS_SUCCEEDED") {
        return { ok: false, message: "YouTube rejected the change." };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: "Network error talking to YouTube." };
    }
  }

  // Find whether the "WL" playlist is marked as containing this video in
  // a get_add_to_playlist response (the data behind the Save dialog).

  // Locate the Watch Later option object (the playlist row for "WL").
  function findWLOption(obj) {
    let found = null;
    (function walk(o) {
      if (found || !o || typeof o !== "object") return;
      if (o.playlistId === "WL") {
        found = o;
        return;
      }
      // Some shapes key the row by title instead of id.
      const title = o.title && (o.title.simpleText || textFromRuns(o.title));
      if (typeof title === "string" && title.trim().toLowerCase() === "watch later") {
        found = o;
        return;
      }
      for (const k in o) {
        if (!found) walk(o[k]);
      }
    })(obj);
    return found;
  }

  function textFromRuns(t) {
    if (t && Array.isArray(t.runs)) return t.runs.map((r) => r.text).join("");
    return null;
  }

  // Interpret a WL option object as in/out of Watch Later, tolerant of the
  // several field names YouTube has used.
  function interpretMembership(opt) {
    if (!opt || typeof opt !== "object") return null;
    if (typeof opt.selected === "boolean") return opt.selected;
    if (typeof opt.isSelected === "boolean") return opt.isSelected;
    const c = opt.containsSelectedVideos;
    if (typeof c === "string") {
      if (/NONE|EMPTY|UNSELECTED|FALSE/i.test(c)) return false;
      if (/ALL|SOME|SELECTED|TRUE/i.test(c)) return true;
    }
    return null;
  }

  // Read-only: is this video already in Watch Later?
  async function checkWatchLater(videoId) {
    const bits = await getApiBits();
    if (bits.error) {
      dlog("[YQN] WL check setup error:", bits.error);
      return { ok: false, message: bits.error };
    }
    const { apiKey, context, auth } = bits;

    try {
      const res = await innertubeFetch("playlist/get_add_to_playlist", apiKey, auth, {
        context,
        videoIds: [videoId],
        excludeWatchLater: false,
      });
      if (!res.ok) {
        dlog("[YQN] WL check HTTP error", res.status);
        return { ok: false, message: `HTTP ${res.status}` };
      }
      const json = await res.json().catch(() => ({}));
      const opt = findWLOption(json);
      const inWL = interpretMembership(opt);
      dlog("[YQN] WL check result", { videoId, inWL, option: opt, response: json });
      if (inWL === null) {
        return { ok: false, message: opt ? "WL field not recognised" : "WL row not found" };
      }
      return { ok: true, inWL };
    } catch (err) {
      return { ok: false, message: "network error" };
    }
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "yqn") return;

    if (data.type === "set-debug") {
      YQN_DEBUG = !!data.debug;
      return;
    }

    if (data.type === "transcript-reset") {
      window.__yqnTx = null;
      return;
    }

    if (data.type === "transcript-get") {
      window.postMessage(
        {
          source: "yqn-injected",
          type: "transcript-capture",
          segments: window.__yqnTx || [],
        },
        window.location.origin
      );
      return;
    }

    // Video category (e.g. "Music") + title from the player response, used by
    // the content script to auto-ignore music videos (but not trailers).
    if (data.type === "video-category") {
      let category = null;
      let title = null;
      try {
        const initial = window.ytInitialPlayerResponse;
        const pr =
          getLivePlayerResponse(data.videoId) ||
          (initial &&
          initial.videoDetails &&
          initial.videoDetails.videoId === data.videoId
            ? initial
            : null);
        category =
          (pr &&
            pr.microformat &&
            pr.microformat.playerMicroformatRenderer &&
            pr.microformat.playerMicroformatRenderer.category) ||
          null;
        title = (pr && pr.videoDetails && pr.videoDetails.title) || null;
      } catch {}
      window.postMessage(
        {
          source: "yqn-injected",
          type: "video-category",
          videoId: data.videoId,
          category,
          title,
        },
        window.location.origin
      );
      return;
    }

    if (data.type === "autocut-data") {
      const payload = await gatherAutocut(
        data.videoId,
        !!data.needHeatmap,
        !!data.needTranscript
      );
      window.postMessage(
        {
          source: "yqn-injected",
          type: "autocut-data",
          videoId: data.videoId,
          payload,
        },
        window.location.origin
      );
      return;
    }

    if (data.type === "wl-request") {
      const result = await editWatchLater(data.videoId, data.action);
      window.postMessage(
        {
          source: "yqn-injected",
          type: "wl-result",
          videoId: data.videoId,
          action: data.action,
          ok: result.ok,
          message: result.message || "",
        },
        window.location.origin
      );
    } else if (data.type === "wl-check") {
      const result = await checkWatchLater(data.videoId);
      window.postMessage(
        {
          source: "yqn-injected",
          type: "wl-status",
          videoId: data.videoId,
          ok: result.ok,
          inWL: !!result.inWL,
          reason: result.message || "",
        },
        window.location.origin
      );
    }
  });
})();
