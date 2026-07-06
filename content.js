/* YouTube Quick Nav + Cinema
 * - Injects a row of quick-access pill buttons on YouTube watch pages.
 * - Auto-enables cinema (theater) mode on watch pages.
 * YouTube is a single-page app, so we re-run on every in-app navigation.
 */
(() => {
  "use strict";

  const BAR_ID = "yqn-quick-bar";

  const DEFAULTS = {
    cinemaMode: true,
    showHistory: true,
    showWatchLater: true,
    showSubscriptions: true,
    showLiked: true,
    showLibrary: true,
    showLike: true,
    showToggle: true,
    // Auto-Cut
    showCut: true,
    autoCut: false,
    cutMessaging: true,
    cutBoring: true,
    aiHighlights: false,
    anthropicKey: "",
    aiModel: "claude-haiku-4-5-20251001",
    speedRate: 3,
    debug: false,
  };

  let settings = { ...DEFAULTS };

  // Gated logging — only prints when the Debug setting is on.
  function dlog(...args) {
    if (settings.debug) console.log(...args);
  }

  /* ---------- safe chrome.* access ----------
   * After the extension is reloaded/updated, content scripts already
   * running in open tabs are orphaned and any chrome.* call throws
   * "Extension context invalidated". These guards make the stale script
   * no-op quietly until the page is refreshed.
   */
  function alive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function localGet(defaults, cb) {
    if (!alive()) return;
    try {
      chrome.storage.local.get(defaults, (res) => {
        if (chrome.runtime.lastError) return;
        try {
          cb(res);
        } catch {}
      });
    } catch {}
  }

  function localSet(obj) {
    if (!alive()) return;
    try {
      chrome.storage.local.set(obj, () => void chrome.runtime.lastError);
    } catch {}
  }

  // Quick-link definitions. `key` matches a setting flag.
  const LINKS = [
    { key: "showHistory",       label: "History",       icon: "🕘", href: "/feed/history" },
    { key: "showWatchLater",    label: "Watch Later",   icon: "🕒", href: "/playlist?list=WL" },
    { key: "showSubscriptions", label: "Subscriptions", icon: "📺", href: "/feed/subscriptions" },
    { key: "showLiked",         label: "Liked",         icon: "👍", href: "/playlist?list=LL" },
    { key: "showLibrary",       label: "Library",       icon: "📚", href: "/feed/library" },
  ];

  /* ---------- helpers ---------- */

  function isWatchPage() {
    return location.pathname === "/watch";
  }

  // Resolve when a matching element exists, or null after timeout.
  function waitFor(selector, timeout = 8000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        resolve(document.querySelector(selector));
      }, timeout);
    });
  }

  function toast(message, duration) {
    let t = document.getElementById("yqn-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "yqn-toast";
      document.body.appendChild(t);
    }
    t.textContent = message;
    t.classList.add("yqn-toast-show");
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => t.classList.remove("yqn-toast-show"), duration || 2200);
  }

  // Keep the Auto-Cut button's tooltip in sync with the latest status, so the
  // explanation is still reachable after the toast fades.
  function setCutTooltip(text) {
    const btn = document.getElementById("yqn-cut-btn");
    if (btn) btn.title = text;
  }

  /* ---------- quick-nav bar ---------- */

  function buildBar() {
    const bar = document.createElement("div");
    bar.id = BAR_ID;

    let hasLinks = false;
    for (const link of LINKS) {
      if (!settings[link.key]) continue;
      const a = document.createElement("a");
      a.className = "yqn-pill";
      a.href = link.href;
      a.innerHTML = `<span class="yqn-ico">${link.icon}</span><span>${link.label}</span>`;
      bar.appendChild(a);
      hasLinks = true;
    }

    // Separate the link section from the action toggles.
    if (hasLinks && (settings.showLike || settings.showToggle || settings.showCut)) {
      const sep = document.createElement("span");
      sep.className = "yqn-sep";
      bar.appendChild(sep);
    }

    if (settings.showCut) {
      const btn = document.createElement("button");
      btn.id = "yqn-cut-btn";
      btn.className = "yqn-pill yqn-pill-action";
      btn.type = "button";
      btn.title = "Auto-Cut: skip sponsors/messaging and speed through the dull parts";
      btn.innerHTML = `<span class="yqn-ico">✂️</span><span>Auto-Cut</span>`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleCutPanel();
      });
      bar.appendChild(btn);
    }

    if (settings.showLike) {
      const btn = document.createElement("button");
      btn.id = "yqn-like-btn";
      btn.className = "yqn-pill yqn-pill-action";
      btn.type = "button";
      btn.innerHTML = `<span class="yqn-ico">👍</span><span>Like</span>`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleLike();
      });
      bar.appendChild(btn);
    }

    if (settings.showToggle) {
      const btn = document.createElement("button");
      btn.id = "yqn-wl-btn";
      btn.className = "yqn-pill yqn-pill-action";
      btn.type = "button";
      btn.innerHTML = `<span class="yqn-ico">🕒</span><span>Watch Later</span>`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleWatchLater();
      });
      bar.appendChild(btn);
    }

    return bar;
  }

  // Paint a toggle button green (on) or red (off).
  function applyState(btn, on) {
    if (!btn) return;
    btn.classList.toggle("yqn-state-on", !!on);
    btn.classList.toggle("yqn-state-off", !on);
  }

  // Keep the ✂️ button's colour, label (with cut count) and tooltip in sync
  // with the real plan — YouTube rebuilds the button on every navigation and
  // would otherwise reset it to its default, hiding that Auto-Cut ran.
  function updateCutButton() {
    const btn = document.getElementById("yqn-cut-btn");
    if (!btn) return;
    applyState(btn, settings.autoCut);

    const vid = getVideoId();
    const havePlan = cutPlan && cutPlan.videoId === vid;
    const n = havePlan ? cutPlan.segments.length : 0;

    const label = btn.querySelectorAll("span")[1];
    if (label) {
      if (settings.autoCut && havePlan) label.textContent = `Auto-Cut · ${n}`;
      else if (settings.autoCut && cutPlanningFor === vid) label.textContent = "Auto-Cut …";
      else label.textContent = "Auto-Cut";
    }
    btn.title = cutStatusText();
  }

  /* ---------- Auto-Cut list panel ---------- */

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = h ? String(m).padStart(2, "0") : String(m);
    return (h ? h + ":" : "") + mm + ":" + String(s).padStart(2, "0");
  }

  function toggleCutPanel() {
    const existing = document.getElementById("yqn-cut-panel");
    if (existing) {
      closeCutPanel();
      return;
    }
    const panel = document.createElement("div");
    panel.id = "yqn-cut-panel";
    document.body.appendChild(panel);
    renderCutPanel();
    const btn = document.getElementById("yqn-cut-btn");
    if (btn) {
      const r = btn.getBoundingClientRect();
      panel.style.top = r.bottom + 6 + "px";
      panel.style.left = Math.max(8, r.left) + "px";
    }
    setTimeout(() => document.addEventListener("click", cutPanelOutside, true), 0);
  }

  function closeCutPanel() {
    const p = document.getElementById("yqn-cut-panel");
    if (p) p.remove();
    document.removeEventListener("click", cutPanelOutside, true);
  }

  function cutPanelOutside(e) {
    const panel = document.getElementById("yqn-cut-panel");
    if (!panel) return;
    if (panel.contains(e.target)) return;
    if (e.target.closest && e.target.closest("#yqn-cut-btn")) return;
    closeCutPanel();
  }

  function renderCutPanel() {
    const panel = document.getElementById("yqn-cut-panel");
    if (!panel) return;
    const vid = getVideoId();
    const havePlan = cutPlan && cutPlan.videoId === vid;

    const head = document.createElement("div");
    head.className = "yqn-cp-head";
    head.innerHTML = `<span>✂️ Auto-Cut</span>`;
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "yqn-cp-switch " + (settings.autoCut ? "on" : "off");
    sw.textContent = settings.autoCut ? "On" : "Off";
    sw.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleAutoCut();
      renderCutPanel();
    });
    head.appendChild(sw);

    const body = document.createElement("div");
    body.className = "yqn-cp-body";

    if (!settings.autoCut) {
      body.innerHTML = `<div class="yqn-cp-msg">Auto-Cut is off. Turn it on to trim this video.</div>`;
    } else if (!havePlan) {
      body.innerHTML = `<div class="yqn-cp-msg">Analysing this video…</div>`;
    } else if (!cutPlan.segments.length) {
      body.innerHTML = `<div class="yqn-cp-msg">${emptyReason(false)}</div>`;
    } else {
      const skips = cutPlan.segments.filter((s) => s.action === "skip").length;
      const speeds = cutPlan.segments.length - skips;
      const sum = document.createElement("div");
      sum.className = "yqn-cp-sum";
      sum.textContent = `${cutPlan.segments.length} cuts · ${skips} skipped · ${speeds} sped up`;
      body.appendChild(sum);

      const list = document.createElement("div");
      list.className = "yqn-cp-list";
      [...cutPlan.segments]
        .sort((a, b) => a.start - b.start)
        .forEach((s) => {
          const row = document.createElement("div");
          row.className = "yqn-cp-row";
          const isSkip = s.action === "skip";
          row.innerHTML =
            `<span class="yqn-cp-time">${fmtTime(s.start)}–${fmtTime(s.end)}</span>` +
            `<span class="yqn-cp-badge ${isSkip ? "skip" : "speed"}">${isSkip ? "Skip" : "Speed"}</span>` +
            `<span class="yqn-cp-reason">${s.reason || ""}</span>`;
          row.title = "Jump to " + fmtTime(s.start);
          row.addEventListener("click", (e) => {
            e.stopPropagation();
            const v = getVideoEl();
            if (v) {
              v.currentTime = s.start + 0.05;
              v.play && v.play().catch(() => {});
            }
          });
          list.appendChild(row);
        });
      body.appendChild(list);
    }

    panel.innerHTML = "";
    panel.appendChild(head);
    panel.appendChild(body);
  }

  function renderCutPanelIfOpen() {
    if (document.getElementById("yqn-cut-panel")) renderCutPanel();
  }

  function cutStatusText() {
    if (!settings.autoCut) return "Auto-Cut is off — click to trim this video";
    const vid = getVideoId();
    if (cutPlan && cutPlan.videoId === vid) {
      if (!cutPlan.segments.length) return emptyReason(false) + "\n" + diagString();
      const skips = cutPlan.segments.filter((s) => s.action === "skip").length;
      const speeds = cutPlan.segments.filter((s) => s.action === "speed").length;
      return `Auto-Cut active: ${skips} skip, ${speeds} speed\n` + diagString();
    }
    if (cutPlanningFor === vid) return "Auto-Cut — analysing…";
    return "Auto-Cut: skip sponsors/messaging and speed through the dull parts";
  }

  // Video IDs for which YouTube has confirmed Watch Later membership,
  // so we stop re-asking once we have a real answer.
  const wlStatusFor = new Set();

  // Sync the toggle buttons' colours with current state.
  function refreshStates() {
    const likeBtn = document.getElementById("yqn-like-btn");
    if (likeBtn) applyState(likeBtn, isVideoLiked());

    updateCutButton();

    const wlBtn = document.getElementById("yqn-wl-btn");
    if (wlBtn) {
      const videoId = getVideoId();
      // Watching from the Watch Later playlist? Then it's definitely in WL.
      const fromWL = new URLSearchParams(location.search).get("list") === "WL";
      localGet({ wlState: {} }, ({ wlState }) => {
        applyState(wlBtn, fromWL || (videoId && !!wlState[videoId]));
      });
      if (fromWL) {
        applyState(wlBtn, true);
        if (videoId) wlStatusFor.add(videoId);
      }
      // Ask YouTube whether it's really in Watch Later. Retry on each
      // refresh until we get an answer — the injected helper may not have
      // loaded yet on the first attempt (postMessage isn't queued).
      if (videoId && !wlStatusFor.has(videoId)) {
        window.postMessage(
          { source: "yqn", type: "wl-check", videoId },
          location.origin
        );
      }
    }
  }

  async function injectBar() {
    if (!isWatchPage()) return;
    const anyButton =
      settings.showToggle ||
      settings.showLike ||
      settings.showCut ||
      LINKS.some((l) => settings[l.key]);
    if (!anyButton) return;

    const metadata = await waitFor("ytd-watch-metadata");
    if (!metadata || !isWatchPage()) return;

    // Avoid duplicates / stale bars.
    const existing = document.getElementById(BAR_ID);
    if (existing) existing.remove();

    const bar = buildBar();
    const title = metadata.querySelector("#title");
    if (title && title.parentElement) {
      title.parentElement.insertBefore(bar, title.nextSibling);
    } else {
      metadata.prepend(bar);
    }

    // Colour the toggle buttons; re-check as the player/metadata settle.
    // Multiple ticks also cover the case where injected.js loads after the
    // first Watch Later check is sent.
    [0, 400, 1000, 2000, 3500, 6000].forEach((ms) => setTimeout(refreshStates, ms));
  }

  /* ---------- Watch Later toggle (one click, no dialog) ---------- */

  // The page-context helper does the actual API call. We talk to it via
  // postMessage. Per-video membership is remembered so one button both
  // adds and removes; a failed REMOVE self-heals the stored state.
  let wlBusy = false;
  let wlPending = null; // { videoId, action }

  function getVideoId() {
    return new URLSearchParams(location.search).get("v");
  }

  /* ---------- Like toggle (drives YouTube's own like button) ---------- */

  function findNativeLikeButton() {
    const metadata = document.querySelector("ytd-watch-metadata");
    const scope = metadata || document;
    const buttons = scope.querySelectorAll("button[aria-label]");
    for (const b of buttons) {
      const label = (b.getAttribute("aria-label") || "").toLowerCase();
      if (label.includes("dislike")) continue;
      if (label.includes("like this video") || label === "like" || label.startsWith("like ")) {
        return b;
      }
    }
    return null;
  }

  function isVideoLiked() {
    const b = findNativeLikeButton();
    return !!b && b.getAttribute("aria-pressed") === "true";
  }

  function toggleLike() {
    const btn = findNativeLikeButton();
    if (!btn) {
      toast("Couldn't find the Like button.");
      return;
    }
    const wasLiked = btn.getAttribute("aria-pressed") === "true";
    btn.click();
    // Let YouTube update aria-pressed, then reflect the real state.
    setTimeout(() => {
      const nowLiked = isVideoLiked();
      applyState(document.getElementById("yqn-like-btn"), nowLiked);
      toast(nowLiked ? "Liked" : wasLiked ? "Like removed" : "Like removed");
    }, 150);
  }

  function toggleWatchLater() {
    if (wlBusy) return;
    const videoId = getVideoId();
    if (!videoId) {
      toast("No video detected.");
      return;
    }

    // Decide from the button's shown state (green = in WL), which reflects
    // the most reliable signal we have (API check or list=WL), not just
    // whatever happens to be in local storage.
    const wlBtn = document.getElementById("yqn-wl-btn");
    const inWL = !!wlBtn && wlBtn.classList.contains("yqn-state-on");
    const action = inWL ? "remove" : "add";

    wlBusy = true;
    wlPending = { videoId, action };
    toast(action === "add" ? "Adding to Watch Later…" : "Removing from Watch Later…");
    window.postMessage(
      { source: "yqn", type: "wl-request", videoId, action },
      location.origin
    );
    // Safety timeout so the button can't get stuck.
    setTimeout(() => {
      if (wlBusy) {
        wlBusy = false;
        wlPending = null;
      }
    }, 8000);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "yqn-injected") return;

    // Page-context data for Auto-Cut (heatmap + transcript).
    if (data.type === "autocut-data") {
      const waiter = autocutWaiters.get(data.videoId);
      if (waiter) {
        autocutWaiters.delete(data.videoId);
        waiter(data.payload || {});
      }
      return;
    }

    // Authoritative Watch Later membership from YouTube (on load).
    if (data.type === "wl-status") {
      if (!data.ok) {
        dlog("[YQN] WL check failed:", data.reason || "unknown");
        return;
      }
      wlStatusFor.add(data.videoId);
      localGet({ wlState: {} }, ({ wlState }) => {
        if (data.inWL) wlState[data.videoId] = true;
        else delete wlState[data.videoId];
        localSet({ wlState });
        if (getVideoId() === data.videoId) {
          applyState(document.getElementById("yqn-wl-btn"), data.inWL);
        }
      });
      return;
    }

    if (data.type !== "wl-result") return;
    if (!wlPending || data.videoId !== wlPending.videoId) return;

    wlBusy = false;
    const { action } = wlPending;
    wlPending = null;

    if (!data.ok) {
      toast(data.message || "Watch Later update failed.");
      return;
    }

    localGet({ wlState: {} }, ({ wlState }) => {
      const added = action === "add";
      if (added) {
        wlState[data.videoId] = true;
        toast("Added to Watch Later");
      } else {
        delete wlState[data.videoId];
        toast("Removed from Watch Later");
      }
      localSet({ wlState });
      applyState(document.getElementById("yqn-wl-btn"), added);
    });
  });

  /* ---------- cinema (theater) mode ---------- */

  async function enableCinema() {
    if (!settings.cinemaMode || !isWatchPage()) return;

    const flexy = await waitFor("ytd-watch-flexy", 8000);
    if (!flexy || !isWatchPage()) return;

    // Already in theater mode.
    if (flexy.hasAttribute("theater")) return;

    const sizeBtn = await waitFor(".ytp-size-button.ytp-button", 8000);
    if (!sizeBtn) return;

    // Re-check just before clicking (player may have settled into theater).
    if (!flexy.hasAttribute("theater")) sizeBtn.click();
  }

  /* ================= Auto-Cut ================= *
   * Builds a "cut plan" of time segments for the current video and, during
   * playback, either jumps past them ("skip") or plays them fast ("speed").
   * Sources:
   *   - SponsorBlock  -> messaging (sponsor/subscribe/intro/outro/…): skip;
   *                      filler/tangent: speed
   *   - Most replayed -> low-engagement stretches: speed
   *   - AI (Claude)   -> everything outside the chosen highlights: speed
   */

  // Current plan: { videoId, segments: [{start, end, action, reason}] }
  let cutPlan = null;
  let cutPlanningFor = null;
  let lastPlanInfo = null; // why a plan was empty, for user messaging
  const autocutWaiters = new Map(); // videoId -> resolve fn
  let lastSkipToast = "";

  function getVideoEl() {
    return document.querySelector("video.html5-main-video, video");
  }

  function toggleAutoCut() {
    settings.autoCut = !settings.autoCut;
    try {
      chrome.storage.sync.set({ autoCut: settings.autoCut });
    } catch {}
    applyState(document.getElementById("yqn-cut-btn"), settings.autoCut);
    if (settings.autoCut) {
      toast("Auto-Cut on — analysing…");
      setCutTooltip("Auto-Cut on — analysing…");
      startAutoCut();
    } else {
      cutPlan = null;
      cutPlanningFor = null;
      removeCutMarkers();
      const v = getVideoEl();
      if (v) v.playbackRate = 1;
      toast("Auto-Cut off");
      setCutTooltip("Auto-Cut is off — click to trim this video");
    }
  }

  const CUT_CACHE_TTL = 3 * 24 * 60 * 60 * 1000; // 3 days
  const CUT_CACHE_MAX = 300;

  // v3 key so previously-cached partial plans (SponsorBlock-only, before the
  // AI transcript fix) are dropped and re-analysed.
  const CUT_CACHE_KEY = "cutCacheV4";

  function getCachedPlan(videoId) {
    return new Promise((resolve) => {
      localGet({ [CUT_CACHE_KEY]: {} }, (store) => {
        const cache = store[CUT_CACHE_KEY] || {};
        const hit = cache[videoId];
        // Only serve non-empty cached plans.
        if (hit && hit.segments && hit.segments.length && Date.now() - hit.ts < CUT_CACHE_TTL) {
          resolve(hit.segments);
        } else {
          resolve(null);
        }
      });
    });
  }

  function setCachedPlan(videoId, segments) {
    // Never cache empty plans — a transient failure shouldn't stick.
    if (!segments || !segments.length) return;
    localGet({ [CUT_CACHE_KEY]: {} }, (store) => {
      const cache = store[CUT_CACHE_KEY] || {};
      cache[videoId] = { segments, ts: Date.now() };
      const keys = Object.keys(cache);
      if (keys.length > CUT_CACHE_MAX) {
        keys
          .sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0))
          .slice(0, keys.length - CUT_CACHE_MAX)
          .forEach((k) => delete cache[k]);
      }
      localSet({ [CUT_CACHE_KEY]: cache });
    });
  }

  function announcePlan(segments, cached) {
    let msg;
    if (segments.length) {
      const skips = segments.filter((s) => s.action === "skip").length;
      const speeds = segments.filter((s) => s.action === "speed").length;
      msg = `Auto-Cut ready${cached ? " (cached)" : ""}: ${skips} skip, ${speeds} speed`;
      toast(msg, 3200);
    } else {
      msg = emptyReason(cached);
      toast(msg, 5200);
    }
    // Append a compact diagnostic so hovering the button shows what each
    // source returned (helps explain empty results).
    setCutTooltip(msg + (cached ? "" : "\n" + diagString()));
    updateCutButton();
    renderCutPanelIfOpen();
  }

  function diagString() {
    const i = lastPlanInfo;
    if (!i) return "";
    const d = i.diag || {};
    const parts = [
      `SB:${i.sbCount}`,
      `heat:${i.heatmapPoints}(${d.heatmapSrc || "-"})`,
      `cap:${d.captionTracks != null ? d.captionTracks : "-"}(${d.captionSrc || "-"})`,
      `xml:${d.ttXmlStatus != null ? d.ttXmlStatus : "-"}/${d.xmlNodes != null ? d.xmlNodes : "-"}`,
      `lines:${i.transcriptLines}(${i.transcriptSrc || "-"})`,
    ];
    if (d.timedtextStatus != null) parts.push(`json3:${d.timedtextStatus}/${d.transcriptEvents}`);
    if (d.nextError) parts.push(`nextErr:${d.nextError}`);
    if (d.playability) parts.push(`play:${d.playability}`);
    return "diag " + parts.join(" ");
  }

  // Explain *why* there was nothing to cut, so an empty result reads as a
  // genuine "no data here" rather than a glitch.
  function emptyReason(cached) {
    const i = lastPlanInfo;
    if (cached || !i) return "Auto-Cut: nothing to cut on this video";

    const noSB = !i.sbEnabled || i.sbCount === 0;
    const noHeat = !i.heatmapEnabled || i.heatmapPoints === 0;

    if (i.aiEnabled) {
      if (i.transcriptLines === 0) {
        return "Nothing to cut — this video has no captions for AI, and no SponsorBlock/most-replayed data.";
      }
      // AI ran but found nothing worth cutting.
      return "Nothing to cut — AI found no clear junk or filler to trim.";
    }

    if (i.aiKeyMissing) {
      return "Nothing to cut. Add your Anthropic API key in the popup to enable AI highlights (much wider coverage).";
    }

    if (noSB && noHeat) {
      return "Nothing to cut — no SponsorBlock or 'most replayed' data for this video. Turn on AI highlights in the popup for coverage on almost any video.";
    }
    return "Auto-Cut: nothing to cut on this video";
  }

  async function startAutoCut() {
    if (!settings.autoCut || !isWatchPage()) return;
    const videoId = getVideoId();
    if (!videoId || cutPlanningFor === videoId) return;
    cutPlanningFor = videoId;
    cutPlan = null;
    removeCutMarkers();
    setCutTooltip("Auto-Cut — analysing…");
    attachCutController();

    // Serve an instant plan from cache if we've analysed this video recently.
    const cached = await getCachedPlan(videoId);
    if (cached && getVideoId() === videoId && settings.autoCut) {
      cutPlan = { videoId, segments: cached };
      dlog("[YQN] cut plan (cached)", { videoId, segments: cached });
      announcePlan(cached, true);
      scheduleMarkerRender();
      return;
    }

    try {
      const segments = await buildCutPlan(videoId);
      // Ignore if the user navigated away meanwhile.
      if (getVideoId() !== videoId || !settings.autoCut) return;
      cutPlan = { videoId, segments };
      // Only cache a *complete* plan. If AI was enabled but the transcript
      // came back empty (a fetch failure, not genuinely no captions), don't
      // cache — otherwise a partial SponsorBlock-only plan gets stuck and AI
      // never retries on revisits.
      const aiIncomplete =
        lastPlanInfo && lastPlanInfo.aiEnabled && lastPlanInfo.transcriptLines === 0;
      if (!aiIncomplete) setCachedPlan(videoId, segments);
      dlog("[YQN] cut plan", { videoId, segments, cached: !aiIncomplete });
      announcePlan(segments, false);
      scheduleMarkerRender();
    } catch (err) {
      dlog("[YQN] cut plan failed:", err && err.message);
      toast("Auto-Cut analysis failed");
    }
  }

  function withTimeout(promise, ms, fallback) {
    return Promise.race([
      Promise.resolve(promise).catch(() => fallback),
      new Promise((res) => setTimeout(() => res(fallback), ms)),
    ]);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ----- Transcript via YouTube's own panel (fallback when the caption
  // download endpoint returns empty, which it now does without a token) -----
  function parseTimestamp(s) {
    if (!s) return 0;
    const parts = s.trim().split(":").map(Number);
    if (parts.some((n) => isNaN(n))) return 0;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }

  const TS_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

  function readTranscriptSegments() {
    // 1) Classic transcript renderer.
    const out = [];
    document.querySelectorAll("ytd-transcript-segment-renderer").forEach((r) => {
      const ts = r.querySelector(".segment-timestamp");
      const tx = r.querySelector(".segment-text");
      const text = tx && tx.textContent ? tx.textContent.trim() : "";
      if (text) out.push({ start: parseTimestamp(ts && ts.textContent), text });
    });
    if (out.length) return out;

    // 2) Generic: the newer "In this video" panel uses different elements, so
    //    scan any engagement panel for rows that begin with a timestamp.
    const panels = document.querySelectorAll(
      "ytd-engagement-panel-section-list-renderer"
    );
    for (const p of panels) {
      const seen = new Set();
      const rows = [];
      p.querySelectorAll("*").forEach((el) => {
        // A row whose direct child is exactly a timestamp label.
        const tsEl = [...el.children].find((c) =>
          TS_RE.test((c.textContent || "").trim())
        );
        if (!tsEl) return;
        const stamp = tsEl.textContent.trim();
        const text = (el.textContent || "")
          .replace(stamp, "")
          .replace(/\s+/g, " ")
          .trim();
        const key = stamp + "|" + text;
        if (text && !seen.has(key)) {
          seen.add(key);
          rows.push({ start: parseTimestamp(stamp), text });
        }
      });
      if (rows.length > 3) return rows.sort((a, b) => a.start - b.start);
    }
    return out;
  }

  function findShowTranscriptButton() {
    const els = document.querySelectorAll(
      "ytd-video-description-transcript-section-renderer button, " +
        "ytd-menu-service-item-renderer, tp-yt-paper-button, yt-button-shape button, button"
    );
    for (const el of els) {
      const label =
        ((el.getAttribute && el.getAttribute("aria-label")) || "") +
        " " +
        (el.textContent || "");
      if (/show transcript/i.test(label)) return el;
    }
    return null;
  }

  function closeTranscriptPanel() {
    const panels = document.querySelectorAll(
      "ytd-engagement-panel-section-list-renderer"
    );
    for (const p of panels) {
      if (!p.querySelector("ytd-transcript-renderer, ytd-transcript-segment-list-renderer"))
        continue;
      const header = p.querySelector("ytd-engagement-panel-title-header-renderer") || p;
      const clickable = header.querySelectorAll("button, yt-icon-button, #visibility-button");
      // Prefer an explicit close/visibility control.
      for (const c of clickable) {
        const lbl = (c.getAttribute("aria-label") || "").toLowerCase();
        if (lbl.includes("close") || c.id === "visibility-button") {
          const b = c.matches("button") ? c : c.querySelector("button") || c;
          b.click();
          return true;
        }
      }
      // Fallback: the X is usually the last icon button in the header.
      if (clickable.length) {
        const last = clickable[clickable.length - 1];
        const b = last.matches("button") ? last : last.querySelector("button") || last;
        b.click();
        return true;
      }
    }
    return false;
  }

  // The transcript engagement panel can open on the "Chapters" tab — click the
  // "Transcript" tab/chip if present so rows actually render.
  function clickTranscriptTab() {
    const chips = document.querySelectorAll(
      "ytd-engagement-panel-section-list-renderer tp-yt-paper-tab, " +
        "ytd-engagement-panel-section-list-renderer yt-chip-cloud-chip-renderer, " +
        "ytd-engagement-panel-section-list-renderer [role='tab']"
    );
    for (const c of chips) {
      if (/^\s*transcript\s*$/i.test(c.textContent || "")) {
        c.click();
        return true;
      }
    }
    return false;
  }

  // Ask the page helper for the get_transcript response it captured.
  function getCapturedTranscript() {
    return new Promise((resolve) => {
      const h = (e) => {
        if (
          e.source === window &&
          e.data &&
          e.data.source === "yqn-injected" &&
          e.data.type === "transcript-capture"
        ) {
          window.removeEventListener("message", h);
          resolve(e.data.segments || []);
        }
      };
      window.addEventListener("message", h);
      window.postMessage({ source: "yqn", type: "transcript-get" }, location.origin);
      setTimeout(() => {
        window.removeEventListener("message", h);
        resolve([]);
      }, 800);
    });
  }

  // Get the transcript. Primary: capture YouTube's own get_transcript network
  // response (full, no rendering needed) — we open the panel to trigger it.
  // Fallback: scrape the rendered panel rows if capture didn't happen.
  async function getTranscriptFromPanel() {
    try {
      window.postMessage({ source: "yqn", type: "transcript-reset" }, location.origin);

      const openPanel = async () => {
        let btn = findShowTranscriptButton();
        if (!btn) {
          const expand = document.querySelector(
            "ytd-watch-metadata #expand, tp-yt-paper-button#expand, #description #expand"
          );
          if (expand) {
            expand.click();
            await sleep(400);
            btn = findShowTranscriptButton();
          }
        }
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      };

      const poll = async (n) => {
        let out = [];
        for (let i = 0; i < n && !out.length; i++) {
          await sleep(200);
          if (i === 2) clickTranscriptTab(); // in case it opened on Chapters
          const cap = await getCapturedTranscript();
          if (cap.length) return cap;
          const dom = readTranscriptSegments();
          if (dom.length) out = dom;
        }
        return out;
      };

      const alreadyOpen = !!document.querySelector(
        "ytd-transcript-renderer, ytd-transcript-segment-renderer"
      );
      let weOpened = false;
      if (!alreadyOpen) {
        if (!(await openPanel())) {
          dlog("[YQN] transcript: no 'Show transcript' button found");
          return [];
        }
        weOpened = true;
      }

      // First pass: use the panel as-is (works when it's visible).
      let result = await poll(30);

      // Empty and it was already open (maybe hidden/stale) — force a fresh
      // fetch by closing and reopening.
      if (!result.length && alreadyOpen) {
        for (let i = 0; i < 6 && !closeTranscriptPanel(); i++) await sleep(200);
        await sleep(400);
        if (await openPanel()) {
          weOpened = true;
          result = await poll(40);
        }
      }

      if (weOpened) {
        for (let i = 0; i < 6 && !closeTranscriptPanel(); i++) await sleep(200);
      }

      dlog("[YQN] transcript:", result.length, result.length ? "(ok)" : "(empty)");
      return result.sort((a, b) => a.start - b.start);
    } catch (e) {
      dlog("[YQN] transcript panel error:", e && e.message);
      return [];
    }
  }

  async function buildCutPlan(videoId) {
    const segs = [];
    const info = {
      sbEnabled: !!settings.cutMessaging,
      sbCount: 0,
      heatmapEnabled: !!settings.cutBoring,
      heatmapPoints: 0,
      aiEnabled: !!(settings.aiHighlights && settings.anthropicKey),
      aiKeyMissing: !!settings.aiHighlights && !settings.anthropicKey,
      transcriptLines: 0,
      aiCut: 0,
    };
    dlog("[YQN] plan start", {
      videoId,
      cutMessaging: info.sbEnabled,
      cutBoring: info.heatmapEnabled,
      aiEnabled: info.aiEnabled,
    });

    // 1) SponsorBlock — public API, no auth needed.
    if (settings.cutMessaging) {
      const sb = await withTimeout(fetchSponsorBlock(videoId), 8000, []);
      info.sbCount = sb.length;
      segs.push(...sb);
    }
    dlog("[YQN] plan: SponsorBlock", info.sbCount);

    // 2/4) Data that needs the page context (heatmap + transcript).
    const needHeatmap = !!settings.cutBoring;
    const needTranscript = info.aiEnabled;
    let pageData = null;
    if (needHeatmap || needTranscript) {
      pageData = await requestAutocutData(videoId, needHeatmap, needTranscript);
      info.diag = pageData && pageData.diag;
    }
    dlog("[YQN] plan: pageData", {
      heatmap: (pageData && pageData.heatmap && pageData.heatmap.length) || 0,
      transcript: (pageData && pageData.transcript && pageData.transcript.length) || 0,
    });

    const duration = (() => {
      const v = getVideoEl();
      return v && isFinite(v.duration) ? v.duration : 0;
    })();

    if (settings.cutBoring && pageData && pageData.heatmap) {
      info.heatmapPoints = pageData.heatmap.length;
      if (pageData.heatmap.length) segs.push(...boringFromHeatmap(pageData.heatmap));
    }

    if (info.aiEnabled) {
      // Prefer the caption download; fall back to YouTube's transcript panel
      // (which the page can load with its own token when the endpoint can't).
      let transcript = (pageData && pageData.transcript) || [];
      info.transcriptSrc = transcript.length ? "captions" : "";
      if (!transcript.length) {
        transcript = await getTranscriptFromPanel();
        if (transcript.length) info.transcriptSrc = "panel";
      }
      info.transcriptLines = transcript.length;

      dlog(`[YQN] transcript ${transcript.length} lines (${info.transcriptSrc || "-"})`);

      if (transcript.length) {
        if (getVideoId() === videoId && settings.autoCut) {
          toast("Auto-Cut: AI analysing transcript…", 4000);
          setCutTooltip("Auto-Cut: AI analysing transcript…");
        }
        const ai = await withTimeout(aiHighlights(transcript, duration), 40000, null);
        dlog("[YQN] AI result", ai);
        if (ai) {
          const aiSegs = segmentsFromAI(ai, duration);
          info.aiCut = aiSegs.length;
          segs.push(...aiSegs);
        } else {
          dlog("[YQN] AI highlights: no result (timeout or error)");
        }
      }
    }

    dlog(
      `[YQN] SUMMARY sb=${info.sbCount} heat=${info.heatmapPoints} ` +
        `transcript=${info.transcriptLines}(${info.transcriptSrc || "-"}) aiCut=${info.aiCut}`
    );
    dlog("[YQN] plan: AI cut segments", info.aiCut);

    lastPlanInfo = info;
    return normalizeSegments(segs, duration);
  }

  // ----- SponsorBlock (privacy-preserving hash-prefix endpoint) -----
  const SB_SKIP = new Set([
    "sponsor",
    "selfpromo",
    "interaction",
    "intro",
    "outro",
    "preview",
    "music_offtopic",
  ]);

  async function fetchSponsorBlock(videoId) {
    const cats = [...SB_SKIP, "filler"];
    const hashHex = await sha256Hex(videoId);
    const prefix = hashHex.slice(0, 4);
    const url =
      `https://sponsor.ajay.app/api/skipSegments/${prefix}` +
      `?categories=${encodeURIComponent(JSON.stringify(cats))}`;
    const res = await fetch(url);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error("SB HTTP " + res.status);
    const rows = await res.json().catch(() => []);
    const mine = rows.find((r) => r.videoID === videoId);
    if (!mine || !Array.isArray(mine.segments)) return [];
    return mine.segments
      .filter((s) => Array.isArray(s.segment) && s.segment.length === 2)
      .map((s) => ({
        start: s.segment[0],
        end: s.segment[1],
        action: s.category === "filler" ? "speed" : "skip",
        reason: labelForCategory(s.category),
      }));
  }

  function labelForCategory(cat) {
    return (
      {
        sponsor: "sponsor",
        selfpromo: "self-promo",
        interaction: "subscribe reminder",
        intro: "intro",
        outro: "outro",
        preview: "recap/preview",
        music_offtopic: "non-music",
        filler: "filler",
      }[cat] || cat
    );
  }

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ----- Most replayed -> tiered trim. Aggressive: dead zones are skipped,
  // low-engagement stretches are sped through. -----
  function boringFromHeatmap(heatmap) {
    // heatmap: [{start, end, score(0..1)}]
    const max = Math.max(...heatmap.map((h) => h.score || 0), 0.0001);
    const speedT = 0.62 * max; // below this = low engagement -> speed
    const skipT = 0.28 * max; // below this = dead zone -> skip

    const tier = (h) => {
      const s = h.score || 0;
      if (s < skipT) return 2; // skip
      if (s < speedT) return 1; // speed
      return 0; // keep
    };

    const out = [];
    let cur = null;
    for (const h of heatmap) {
      const t = tier(h);
      if (t === 0) {
        if (cur) {
          out.push(cur);
          cur = null;
        }
        continue;
      }
      if (cur && cur._tier === t) {
        cur.end = h.end;
      } else {
        if (cur) out.push(cur);
        cur = {
          start: h.start,
          end: h.end,
          action: t === 2 ? "skip" : "speed",
          reason: t === 2 ? "dead zone" : "low replays",
          _tier: t,
        };
      }
    }
    if (cur) out.push(cur);

    // Min lengths so we don't stutter: skips a touch longer than speed-ups.
    return out
      .filter((s) => (s.action === "skip" ? s.end - s.start >= 6 : s.end - s.start >= 5))
      .map(({ _tier, ...s }) => s);
  }

  // ----- AI highlights (Claude): returns { highlights, skip } -----
  async function aiHighlights(transcript, duration) {
    // Compact the transcript to timestamped lines.
    const lines = transcript
      .map((t) => `[${Math.round(t.start)}] ${t.text}`)
      .join("\n")
      .slice(0, 90000);

    const sys =
      "You edit a YouTube video down to its worthwhile parts using its " +
      "timestamped transcript. Return ONLY JSON of the form " +
      '{"highlights":[{"start":n,"end":n}],"skip":[{"start":n,"end":n}]} ' +
      "with times in seconds. " +
      "highlights = the genuinely interesting/substantive moments worth " +
      "watching at normal speed. " +
      "skip = parts to cut entirely: sponsor reads, subscribe/like/bell " +
      "reminders, intros, outros, self-promo, dead air, and long off-topic " +
      "tangents or rambling. " +
      "Anything you list in neither will be played back fast. No prose.";
    const user =
      `Video duration: ${Math.round(duration)}s.\nTranscript:\n${lines}\n\n` +
      `Return the JSON.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: settings.aiModel || "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system: sys,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error("Claude HTTP " + res.status);
    const data = await res.json();
    const text = (data.content || []).map((c) => c.text || "").join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON in response");
    const obj = JSON.parse(match[0]);
    const clean = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .filter((r) => r && isFinite(r.start) && isFinite(r.end) && r.end > r.start)
        .map((r) => ({ start: +r.start, end: +r.end }));
    return { highlights: clean(obj.highlights), skip: clean(obj.skip) };
  }

  // Turn the AI result into cut segments: skip the junk, speed the gaps
  // between highlights. (normalizeSegments gives skip precedence on overlap.)
  function segmentsFromAI(ai, duration) {
    const segs = ai.skip.map((s) => ({
      start: s.start,
      end: s.end,
      action: "skip",
      reason: "AI cut",
    }));
    segs.push(...speedOutsideHighlights(ai.highlights, duration));
    return segs;
  }

  function speedOutsideHighlights(highlights, duration) {
    if (!duration || !highlights.length) return [];
    const keep = [...highlights].sort((a, b) => a.start - b.start);
    const gaps = [];
    let cursor = 0;
    for (const h of keep) {
      if (h.start - cursor >= 8) {
        gaps.push({ start: cursor, end: h.start, action: "speed", reason: "off-highlight" });
      }
      cursor = Math.max(cursor, h.end);
    }
    if (duration - cursor >= 8) {
      gaps.push({ start: cursor, end: duration, action: "speed", reason: "off-highlight" });
    }
    return gaps;
  }

  // ----- merge/normalise; skip beats speed on overlap -----
  function normalizeSegments(segs, duration) {
    const clean = segs
      .map((s) => ({
        start: Math.max(0, +s.start),
        end: duration ? Math.min(duration, +s.end) : +s.end,
        action: s.action,
        reason: s.reason,
      }))
      .filter((s) => isFinite(s.start) && isFinite(s.end) && s.end - s.start > 0.5)
      .sort((a, b) => a.start - b.start);

    const merged = [];
    for (const s of clean) {
      const last = merged[merged.length - 1];
      if (last && s.start <= last.end + 0.3) {
        last.end = Math.max(last.end, s.end);
        if (s.action === "skip") {
          last.action = "skip";
          last.reason = s.reason;
        }
      } else {
        merged.push({ ...s });
      }
    }
    return merged;
  }

  // ----- request page-context data (heatmap + transcript) -----
  function requestAutocutData(videoId, needHeatmap, needTranscript) {
    return new Promise((resolve) => {
      let settled = false;
      autocutWaiters.set(videoId, (payload) => {
        if (settled) return;
        settled = true;
        resolve(payload || {});
      });
      // Poke the page helper a few times in case it isn't ready yet.
      const poke = () =>
        window.postMessage(
          { source: "yqn", type: "autocut-data", videoId, needHeatmap, needTranscript },
          location.origin
        );
      poke();
      setTimeout(poke, 500);
      setTimeout(poke, 1500);
      setTimeout(() => {
        if (!settled) {
          settled = true;
          autocutWaiters.delete(videoId);
          resolve({});
        }
      }, 6000);
    });
  }

  // ----- progress-bar markers -----
  function removeCutMarkers() {
    const el = document.getElementById("yqn-markers");
    if (el) el.remove();
  }

  function renderCutMarkers() {
    removeCutMarkers();
    if (!settings.autoCut || !cutPlan || !cutPlan.segments.length) return;
    const bar =
      document.querySelector(".ytp-progress-bar") ||
      document.querySelector(".ytp-progress-bar-container");
    const v = getVideoEl();
    const dur = v && isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    if (!bar || !dur) return;

    // Absolute markers need a positioned ancestor.
    const pos = getComputedStyle(bar).position;
    if (pos === "static" || !pos) bar.style.position = "relative";

    const wrap = document.createElement("div");
    wrap.id = "yqn-markers";
    for (const s of cutPlan.segments) {
      const m = document.createElement("div");
      m.className =
        "yqn-marker " + (s.action === "skip" ? "yqn-marker-skip" : "yqn-marker-speed");
      m.style.left = (100 * s.start) / dur + "%";
      m.style.width = Math.max(0.15, (100 * (s.end - s.start)) / dur) + "%";
      m.title = (s.action === "skip" ? "Skip: " : "Speed: ") + (s.reason || "");
      wrap.appendChild(m);
    }
    bar.appendChild(wrap);
    dlog("[YQN] markers rendered:", wrap.children.length, "dur", Math.round(dur));
  }

  // YouTube can rebuild the progress bar (theater toggle, resize, hover, ads);
  // re-draw shortly after the plan lands and keep them alive via a poll that
  // re-renders whenever our overlay goes missing.
  function markersWanted() {
    return !!(
      settings.autoCut &&
      cutPlan &&
      cutPlan.videoId === getVideoId() &&
      cutPlan.segments.length
    );
  }

  function scheduleMarkerRender() {
    [0, 600, 1800, 4000].forEach((ms) => setTimeout(renderCutMarkers, ms));

    // Re-render the instant YouTube rebuilds the progress bar and drops our
    // overlay (otherwise the markers visibly flash away until the next poll).
    if (!scheduleMarkerRender._obs) {
      const player = document.querySelector("#movie_player, .html5-video-player");
      if (player) {
        let raf = 0;
        const obs = new MutationObserver(() => {
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0;
            if (markersWanted() && !document.getElementById("yqn-markers")) {
              renderCutMarkers();
            }
          });
        });
        obs.observe(player, { childList: true, subtree: true });
        scheduleMarkerRender._obs = obs;
      }
    }

    // Fallback poll (also keeps the button label in sync).
    if (!scheduleMarkerRender._keeper) {
      scheduleMarkerRender._keeper = setInterval(() => {
        updateCutButton();
        if (markersWanted() && !document.getElementById("yqn-markers")) {
          renderCutMarkers();
        }
      }, 2000);
    }
  }

  // ----- playback controller -----
  async function attachCutController() {
    const v = await waitFor("video.html5-main-video, video", 10000);
    if (!v || v.__yqnCutHooked) return;
    v.__yqnCutHooked = true;
    v.addEventListener("timeupdate", onCutTick);
  }

  function onCutTick(e) {
    const v = e.target;
    if (!settings.autoCut || !cutPlan || cutPlan.videoId !== getVideoId()) {
      if (v.playbackRate !== 1 && v.__yqnSped) {
        v.playbackRate = 1;
        v.__yqnSped = false;
      }
      return;
    }
    const t = v.currentTime;
    const seg = cutPlan.segments.find((s) => t >= s.start && t < s.end - 0.15);
    if (!seg) {
      if (v.__yqnSped) {
        v.playbackRate = 1;
        v.__yqnSped = false;
      }
      return;
    }
    if (seg.action === "skip") {
      v.currentTime = seg.end + 0.05;
      if (v.__yqnSped) {
        v.playbackRate = 1;
        v.__yqnSped = false;
      }
      if (lastSkipToast !== seg.start + seg.reason) {
        lastSkipToast = seg.start + seg.reason;
        toast(`Skipped ${seg.reason}`);
      }
    } else {
      const rate = Math.max(1.25, Math.min(4, +settings.speedRate || 3));
      if (v.playbackRate !== rate) {
        v.playbackRate = rate;
        v.__yqnSped = true;
      }
    }
  }

  /* ---------- lifecycle ---------- */

  async function run() {
    closeCutPanel();
    if (!isWatchPage()) {
      const bar = document.getElementById(BAR_ID);
      if (bar) bar.remove();
      return;
    }
    injectBar();
    enableCinema();
    if (settings.autoCut) startAutoCut();
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULTS, (stored) => {
          settings = { ...DEFAULTS, ...(stored || {}) };
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }

  // React to settings changes from the popup.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      const cutKeys = [
        "autoCut",
        "cutMessaging",
        "cutBoring",
        "aiHighlights",
        "anthropicKey",
        "aiModel",
        "speedRate",
      ];
      let cutChanged = false;
      for (const [k, v] of Object.entries(changes)) {
        settings[k] = v.newValue;
        if (cutKeys.includes(k)) cutChanged = true;
        if (k === "debug") syncDebugToPage();
      }
      if (cutChanged) {
        // Force a fresh plan with the new settings; drop cached plans since
        // they were built under the old settings.
        cutPlanningFor = null;
        cutPlan = null;
        removeCutMarkers();
        try {
          chrome.storage.local.remove([CUT_CACHE_KEY, "cutCacheV3", "cutCacheV2", "cutCache"]);
        } catch {}
        if (!settings.autoCut) {
          const v = getVideoEl();
          if (v) v.playbackRate = 1;
        }
        applyState(document.getElementById("yqn-cut-btn"), settings.autoCut);
      }
      run();
    });
  } catch {}

  // Tell the page helper (MAIN world) whether to log.
  function syncDebugToPage() {
    window.postMessage(
      { source: "yqn", type: "set-debug", debug: !!settings.debug },
      location.origin
    );
  }

  // SPA navigation hooks.
  window.addEventListener("yt-navigate-finish", run);
  document.addEventListener("yt-page-data-updated", run);

  loadSettings().then(() => {
    syncDebugToPage();
    run();
  });
})();
