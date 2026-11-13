/* Runs in the YouTube page context (not the isolated content-script world)
 * so it can read YouTube's InnerTube config (ytcfg) and auth cookies, then
 * add/remove the current video from Watch Later with a single API call.
 * Communicates with content.js via window.postMessage.
 */
(() => {
  "use strict";
  if (window.__yqnInjected) return;
  Object.defineProperty(window, "__yqnInjected", { value: true, configurable: false });

  // Gated logging — content.js flips this via a 'set-debug' message.
  let YQN_DEBUG = false;
  function dlog(...args) {
    if (YQN_DEBUG) console.log(...args);
  }
  dlog("[YQN] page helper loaded");

  // Capture YouTube's own get_transcript response (full transcript, no DOM
  // rendering/visibility needed) by wrapping fetch. Installed at
  // document_start so it sees the request whenever the panel loads.
  // Timedtext (caption) traffic is captured the same way: the player's own
  // requests carry the pot (proof-of-origin) token that plain baseUrl
  // requests now lack — without it YouTube answers 200 with an empty body.
  // Stored in private closure variables so untrusted page scripts cannot read
  // or poison captured transcripts.
  let capturedTx = null;
  let capturedTt = null; // {videoId, segs} from the player's caption traffic
  const ttWaiters = new Set();
  let navigationGeneration = 0;
  window.addEventListener("yt-navigate-start", () => {
    navigationGeneration++;
    capturedTx = null;
    capturedTt = null;
  });

  function pushTranscriptCapture(videoId, segs) {
    try {
      window.postMessage(
        { source: "yqn-injected", type: "transcript-capture", videoId, segments: segs },
        window.location.origin
      );
    } catch {}
  }

  function parseTimedtextXml(xml) {
    const out = [];
    const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    let m;
    while ((m = re.exec(xml))) {
      const attrs = m[1];
      const startMatch = attrs.match(/\bstart="([\d.]+)"/);
      if (!startMatch) continue;
      const durMatch = attrs.match(/\bdur="([\d.]+)"/);
      const text = decodeEntities(m[2].replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      const seg = { start: parseFloat(startMatch[1]) || 0, text };
      if (durMatch) {
        const dur = parseFloat(durMatch[1]);
        if (Number.isFinite(dur) && dur > 0) seg.duration = dur;
      }
      out.push(seg);
    }
    return out;
  }

  function captureTimedtext(url, body) {
    try {
      const u = new URL(url, location.origin);
      const vid = u.searchParams.get("v");
      if (!vid || !body) return;
      let segs = [];
      if (body.charAt(0) === "{") {
        const tj = JSON.parse(body);
        segs = (tj.events || [])
          .filter((ev) => ev.segs)
          .map((ev) => ({
            start: (ev.tStartMs || 0) / 1000,
            duration: (ev.dDurationMs || 0) / 1000,
            text: ev.segs.map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim(),
          }))
          .filter((x) => x.text);
      } else if (body.indexOf("<text") !== -1) {
        segs = parseTimedtextXml(body);
      }
      if (segs.length) {
        capturedTt = { videoId: vid, segs };
        for (const fn of [...ttWaiters]) {
          try { fn(vid, segs); } catch {}
        }
        dlog("[YQN] captured timedtext:", segs.length, "lines for", vid);
      }
    } catch {}
  }

  (function patchFetchForTranscript() {
    const of = window.fetch;
    if (!of) return;
    window.fetch = function (...a) {
      const generation = navigationGeneration;
      const videoId = new URLSearchParams(location.search).get("v");
      const p = of.apply(this, a);
      try {
        const url =
          typeof a[0] === "string"
            ? a[0]
            : a[0] instanceof URL
              ? a[0].href
              : (a[0] && a[0].url) || "";
        if (url.indexOf("/youtubei/v1/get_transcript") !== -1) {
          p.then((r) => r.clone().json())
            .then((j) => {
              const segs = parseTranscriptResponse(j);
              if (segs.length && generation === navigationGeneration) {
                capturedTx = { videoId, segs };
                pushTranscriptCapture(videoId, segs);
                dlog("[YQN] captured transcript:", segs.length, "segments");
              }
            })
            .catch(() => {});
        } else if (url.indexOf("/api/timedtext") !== -1) {
          p.then((r) => r.clone().text())
            .then((body) => captureTimedtext(url, body))
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
      const u = typeof url === "string" ? url : url instanceof URL ? url.href : "";
      this.__yqnIsTx = u.indexOf("/youtubei/v1/get_transcript") !== -1;
      this.__yqnTtUrl = u.indexOf("/api/timedtext") !== -1 ? u : null;
      return open.apply(this, arguments);
    };
    const send = XHR.prototype.send;
    XHR.prototype.send = function () {
      const generation = navigationGeneration;
      const videoId = new URLSearchParams(location.search).get("v");
      if (this.__yqnTtUrl) {
        this.addEventListener("load", () => {
          try {
            captureTimedtext(this.__yqnTtUrl, this.responseText);
          } catch {}
        });
      }
      if (this.__yqnIsTx) {
        this.addEventListener("load", () => {
          try {
            const j = JSON.parse(this.responseText);
            const segs = parseTranscriptResponse(j);
            if (segs.length && generation === navigationGeneration) {
              capturedTx = { videoId, segs };
              pushTranscriptCapture(videoId, segs);
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
    if (!obj || typeof obj !== "object") return null;
    if (obj.getTranscriptEndpoint?.params) return obj.getTranscriptEndpoint.params;
    let p = null;
    function walk(o) {
      if (p || !o || typeof o !== "object") return;
      if (o.getTranscriptEndpoint && o.getTranscriptEndpoint.params) {
        p = o.getTranscriptEndpoint.params;
        return;
      }
      const keys = Object.keys(o);
      for (let i = 0; i < keys.length; i++) {
        if (p) return;
        walk(o[keys[i]]);
      }
    }
    // Engagement panels hold the transcript endpoint on watch responses; check
    // them first before traversing large sidebar/comment trees.
    if (obj.engagementPanels) walk(obj.engagementPanels);
    if (!p) walk(obj);
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
      if (text) out.push({ start: (+r.startMs || 0) / 1000,
        end: (+r.endMs || 0) / 1000, duration: (+r.durationMs || 0) / 1000, text });
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
    const sessionIndex = getCfg("SESSION_INDEX");
    const authUser =
      sessionIndex !== null && sessionIndex !== undefined && String(sessionIndex) !== ""
        ? String(sessionIndex)
        : "0";
    const headers = {
      "Content-Type": "application/json",
      "X-Origin": ORIGIN,
      "X-Goog-AuthUser": authUser,
    };
    if (auth) {
      headers.Authorization = auth; // optional for read endpoints
      const pageId = getCfg("DELEGATED_SESSION_ID");
      if (typeof pageId === "string" && pageId) headers["X-Goog-PageId"] = pageId;
    }
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
    if (!obj || typeof obj !== "object") return null;
    let res = null;
    (function walk(o) {
      if (res || !o || typeof o !== "object") return;
      if (Array.isArray(o[key])) {
        res = o[key];
        return;
      }
      const keys = Object.keys(o);
      for (let i = 0; i < keys.length; i++) {
        if (res) return;
        walk(o[keys[i]]);
      }
    })(obj);
    return res;
  }

  function findHeatMarkers(obj) {
    if (!obj || typeof obj !== "object") return null;
    return (
      deepFindArray(obj.frameworkUpdates, "heatMarkers") ||
      deepFindArray(obj.playerOverlays, "heatMarkers") ||
      deepFindArray(obj, "heatMarkers")
    );
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
      const out = parseTimedtextXml(xml);
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
          duration: (ev.dDurationMs || 0) / 1000,
          text: ev.segs.map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim(),
        }))
        .filter((x) => x.text);
    } catch (e) {
      diag.transcriptErr = e && e.message;
    }
    return [];
  }

  // Make the player load a caption track with its own (pot-signed) request,
  // wait for the interceptor to capture the response, then restore state.
  // Captions may flash on for under a second — a fair trade against wrongly
  // reporting "no captions" on a video that has 21 caption tracks.
  async function nudgePlayerCaptions(videoId, track, diag) {
    const generation = navigationGeneration;
    const current = () => generation === navigationGeneration &&
      new URLSearchParams(location.search).get("v") === videoId;
    if (!current() || !getLivePlayerResponse(videoId)) return null;
    const p = getMoviePlayer();
    if (!p || typeof p.loadModule !== "function" || typeof p.setOption !== "function") {
      return null;
    }
    let wasOn = false;
    try {
      const cur = p.getOption("captions", "track");
      wasOn = !!(cur && cur.languageCode);
    } catch {}
    try {
      p.loadModule("captions");
      p.setOption("captions", "track", { languageCode: track.languageCode || "en" });
    } catch (e) {
      diag.nudgeErr = e && e.message;
      return null;
    }
    const got = await new Promise((resolve) => {
      let done = false;
      let timer = null;
      let poll = null;
      const finish = (segs) => {
        if (done) return;
        done = true;
        ttWaiters.delete(onCapture);
        clearTimeout(timer);
        clearInterval(poll);
        resolve(segs || null);
      };
      const onCapture = (vid, segs) => {
        if (!current()) return finish(null);
        if (vid === videoId && segs && segs.length) finish(segs);
      };
      const tt = capturedTt;
      if (tt && tt.videoId === videoId && tt.segs && tt.segs.length) {
        resolve(tt.segs);
        return;
      }
      ttWaiters.add(onCapture);
      poll = setInterval(() => {
        if (!current()) return finish(null);
        const cur = capturedTt;
        if (cur && cur.videoId === videoId && cur.segs && cur.segs.length) finish(cur.segs);
      }, 60);
      timer = setTimeout(() => finish(null), 3500);
    });
    try {
      if (!wasOn && current()) {
        p.setOption("captions", "track", {});
        p.unloadModule("captions");
      }
    } catch {}
    diag.nudge = got ? got.length : 0;
    return got;
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
      if (mp) {
        const pr = mp.getPlayerResponse();
        if (pr && pr.videoDetails && pr.videoDetails.videoId === videoId) return pr;
      }
      const flexy = document.querySelector("ytd-watch-flexy");
      for (const cand of [flexy?.playerData, flexy?.__data?.playerData]) {
        if (cand?.videoDetails?.videoId === videoId) return cand;
      }
    } catch {}
    return null;
  }

  // Current watch-next response (`ytd-watch-flexy.data` on SPA navigations, or
  // `ytInitialData` on fresh document loads), verified against `videoId`.
  function getLiveWatchData(videoId) {
    try {
      const flexy = document.querySelector("ytd-watch-flexy");
      for (const cand of [flexy?.data, flexy?.watchNextData, flexy?.__data?.data]) {
        if (cand?.currentVideoEndpoint?.watchEndpoint?.videoId === videoId) return cand;
      }
    } catch {}
    const pr = window.ytInitialPlayerResponse;
    if (pr?.videoDetails?.videoId === videoId && window.ytInitialData) {
      return window.ytInitialData;
    }
    return null;
  }

  function videoChapters(videoId, response) {
    const duration=Number(response?.videoDetails?.lengthSeconds) || 0;
    const watchData=getLiveWatchData(videoId);
    const native=watchData ? YqnTopics.fromPlayerData(watchData,duration) : [];
    return native.length ? native : YqnTopics.fromDescription(response?.videoDetails?.shortDescription,duration);
  }

  // Gather Auto-Cut data (most-replayed heatmap + transcript) for a video.
  // Prefer the player's live data; fall back to page globals then the API.
  async function gatherAutocut(videoId, needHeatmap, needTranscript) {
    const payload = { heatmap: [], transcript: [] };
    const diag = { videoId };
    const generation = navigationGeneration;
    const current = () => generation === navigationGeneration &&
      new URLSearchParams(location.search).get("v") === videoId;
    if (!current()) return payload;

    const pr = window.ytInitialPlayerResponse;
    const freshGlobals = !!(pr && pr.videoDetails && pr.videoDetails.videoId === videoId);
    diag.freshGlobals = freshGlobals;

    const livePr = getLivePlayerResponse(videoId);
    const liveWatch = getLiveWatchData(videoId);
    const prAny = livePr || (freshGlobals ? pr : null);
    payload.duration = Number(prAny?.videoDetails?.lengthSeconds) || 0;
    payload.chapters = videoChapters(videoId, prAny);
    diag.livePlayer = !!livePr;

    const apiKey = getCfg("INNERTUBE_API_KEY");
    const context = getCfg("INNERTUBE_CONTEXT");
    let authPromise = null;
    const getAuth = () => (authPromise ||= buildAuthHeader(ORIGIN).catch(() => null));

    // Fetch the `next` response at most once and share its in-flight promise
    // across concurrent heatmap + transcript lookups.
    let nextPromise = null;
    function getNext() {
      if (nextPromise) return nextPromise;
      nextPromise = (async () => {
        if (!apiKey || !context || !current()) return null;
        try {
          const auth = await getAuth();
          if (!current()) return null;
          const res = await innertubeFetch("next", apiKey, auth, { context, videoId });
          const nextJson = await res.json().catch(() => ({}));
          if (current() && !payload.chapters.length) {
            payload.chapters = YqnTopics.fromPlayerData(nextJson, payload.duration);
          }
          diag.nextKeys = Object.keys(nextJson || {});
          if (nextJson && nextJson.error) diag.nextError = nextJson.error.status;
          return nextJson;
        } catch (e) {
          diag.nextErr = e && e.message;
          return null;
        }
      })();
      return nextPromise;
    }

    const heatmapTask = needHeatmap
      ? (async () => {
          let markers = null;
          let src = "none";
          if (liveWatch) {
            markers = findHeatMarkers(liveWatch);
            if (markers) src = freshGlobals ? "ytInitialData" : "watchFlexy";
          }
          if (!markers) {
            const nj = await getNext();
            if (!current()) return;
            markers = nj && findHeatMarkers(nj);
            if (markers) src = "next-api";
          }
          if (markers) payload.heatmap = mapHeatMarkers(markers);
          diag.heatmapSrc = src;
          dlog("[YQN] autocut heatmap points:", payload.heatmap.length, diag);
        })()
      : null;

    const transcriptTask = needTranscript
      ? (async () => {
          let tsrc = "none";

          // Video description — often carries the real URLs for things the
          // speaker mentions, so the AI can link mentions accurately.
          payload.description =
            (prAny && prAny.videoDetails && prAny.videoDetails.shortDescription) || "";
          payload.title = prAny?.videoDetails?.title || "";

          // 1) get_transcript endpoint — the same API the transcript panel uses,
          //    so it works where the timedtext download is token-gated. Params
          //    come free from live watch data or ytInitialData, else from `next`.
          if (apiKey && context) {
            let params = liveWatch ? findTranscriptParams(liveWatch) : null;
            diag.paramsFromInitial = !!params;
            if (!params) {
              const nj = await getNext();
              if (!current()) return;
              params = findTranscriptParams(nj);
            }
            diag.transcriptParams = !!params;
            if (params) {
              try {
                const auth = await getAuth();
                if (!current()) return;
                const res = await innertubeFetch("get_transcript", apiKey, auth, {
                  context,
                  params,
                });
                const gj = await res.json().catch(() => ({}));
                if (!current()) return;
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

          // 2) captions the player already downloaded for its own display —
          //    those requests carried a valid pot token, so they work even when
          //    the direct download below is token-gated.
          if (!payload.transcript.length) {
            if (!current()) return;
            const tt = capturedTt;
            if (tt && tt.videoId === videoId && tt.segs && tt.segs.length) {
              payload.transcript = tt.segs;
              tsrc = "player-captions";
              diag.ttCaptured = tt.segs.length;
            }
          }

          // 3) caption track download (often token-gated now — empty 200s)
          if (!payload.transcript.length) {
            if (!current()) return;
            let tracks =
              (livePr && deepFindArray(livePr, "captionTracks")) ||
              (freshGlobals && deepFindArray(pr, "captionTracks"));
            if (!tracks && apiKey && context) {
              try {
                const auth = await getAuth();
                if (!current()) return;
                const res = await innertubeFetch("player", apiKey, auth, { context, videoId });
                const json = await res.json().catch(() => ({}));
                if (!current()) return;
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
              if (!current()) return;
              if (payload.transcript.length) tsrc = "captions";

              // 4) last resort: ask the player itself to load the caption track.
              //    Its request carries a valid pot token and the interceptor
              //    above captures the response; the module is unloaded straight
              //    after so nothing visibly changes for long.
              if (!payload.transcript.length) {
                const got = await nudgePlayerCaptions(videoId, track, diag);
                if (got) {
                  payload.transcript = got;
                  tsrc = "player-nudge";
                }
              }
            }
          }

          diag.captionSrc = tsrc;
          dlog("[YQN] autocut transcript lines:", payload.transcript.length, diag);
        })()
      : null;

    await Promise.all([heatmapTask, transcriptTask].filter(Boolean));
    if (!current()) return payload;
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
    } catch {
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
    } catch {
      return { ok: false, message: "network error" };
    }
  }

  const dataRequests = new Map();
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "yqn") return;

    if (data.type === "set-debug") {
      YQN_DEBUG = !!data.debug;
      return;
    }

    if (data.type === "transcript-reset") {
      capturedTx = null;
      return;
    }

    if (data.type === "transcript-get") {
      window.postMessage(
        {
          source: "yqn-injected",
          type: "transcript-capture",
          videoId: data.videoId,
          segments: capturedTx?.videoId === data.videoId ? capturedTx.segs : [],
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
      let duration = 0;
      let channelId = "";
      let channelName = "";
      let isLive = false;
      let chapters=[];
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
        duration = Number(pr?.videoDetails?.lengthSeconds) || 0;
        channelId = typeof pr?.videoDetails?.channelId === "string" ? pr.videoDetails.channelId : "";
        channelName = typeof pr?.videoDetails?.author === "string" ? pr.videoDetails.author : "";
        const liveNow = pr?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow;
        isLive = !!(pr?.videoDetails?.isLive || pr?.videoDetails?.isUpcoming || liveNow);
        if(pr)chapters=videoChapters(data.videoId,pr);
      } catch {}
      window.postMessage(
        {
          source: "yqn-injected",
          type: "video-category",
          videoId: data.videoId,
          requestId: data.requestId,
          category,
          title,
          duration,
          channelId,
          channelName,
          isLive,
          chapters,
        },
        window.location.origin
      );
      return;
    }

    if (data.type === "autocut-data") {
      if (!data.requestId || dataRequests.has(data.requestId)) return;
      dataRequests.set(data.requestId, true);
      setTimeout(() => dataRequests.delete(data.requestId), 30000);
      let payload;
      try {
        payload = await gatherAutocut(data.videoId, !!data.needHeatmap, !!data.needTranscript);
      } catch {
        payload = {error: "YouTube data could not be read"};
      }
      window.postMessage(
        {
          source: "yqn-injected",
          type: "autocut-data",
          videoId: data.videoId,
          requestId: data.requestId,
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
