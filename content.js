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
    showCopyLink: true,
    showPeak: true,
    showJump: true,
    // Auto-Cut
    showCut: true,
    autoCut: false,
    cutMessaging: true,
    cutBoring: true,
    autoCutPlus: false,
    speedOnly: false,
    autoIgnoreMusic: true,
    minCutMinutes: 2, // ignore videos shorter than this; 0 disables
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
    if (
      hasLinks &&
      (settings.showLike ||
        settings.showToggle ||
        settings.showCut ||
        settings.showCopyLink ||
        settings.showPeak ||
        settings.showJump)
    ) {
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

    if (settings.showCopyLink) {
      const btn = document.createElement("button");
      btn.id = "yqn-copy-btn";
      btn.className = "yqn-pill yqn-pill-action";
      btn.type = "button";
      btn.title = "Copy a link to this video at the current time";
      btn.innerHTML = `<span class="yqn-ico">🔗</span><span>Copy Link</span>`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        copyTimestampLink();
      });
      bar.appendChild(btn);
    }

    if (settings.showPeak) {
      const btn = document.createElement("button");
      btn.id = "yqn-peak-btn";
      btn.className = "yqn-pill yqn-pill-action";
      btn.type = "button";
      btn.title = "Jump to the most-replayed moment (press again for the next hot spot)";
      btn.innerHTML = `<span class="yqn-ico">🔥</span><span>Peak</span>`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        jumpToPeak();
      });
      bar.appendChild(btn);
    }

    if (settings.showJump) {
      const mk = (id, icon, title, dir) => {
        const btn = document.createElement("button");
        btn.id = id;
        btn.className = "yqn-pill yqn-pill-action yqn-pill-compact";
        btn.type = "button";
        btn.title = title;
        btn.innerHTML = `<span class="yqn-ico">${icon}</span>`;
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          jumpChapter(dir);
        });
        bar.appendChild(btn);
      };
      mk(
        "yqn-back-btn",
        "⏮",
        "Back to the start of this chapter — press again for the previous one (no chapters: back 60s)",
        -1
      );
      mk("yqn-fwd-btn", "⏭", "Jump to the next chapter (no chapters: forward 60s)", 1);
    }

    return bar;
  }

  // Previous/next hop through the AI chapters; ±60s when a video has none.
  // Back behaves like a music player: first press returns to the start of the
  // current chapter, pressing again (near its start) goes to the previous one.
  function jumpChapter(dir) {
    const v = getVideoEl();
    if (!v) return;
    const t = v.currentTime || 0;
    const chapters =
      (cutPlan && cutPlan.videoId === getVideoId() && cutPlan.chapters) || [];
    if (chapters.length) {
      if (dir > 0) {
        const next = chapters.find((c) => c.start > t + 1);
        if (!next) {
          toast("No later chapter", 1400);
          return;
        }
        v.currentTime = next.start + 0.05;
        toast("⏭ " + next.title, 2000);
      } else {
        const before = chapters.filter((c) => c.start < t - 3);
        const target = before.length ? before[before.length - 1] : null;
        v.currentTime = target ? target.start + 0.05 : 0;
        toast("⏮ " + (target ? target.title : "Start"), 2000);
      }
      if (v.play) v.play().catch(() => {});
      return;
    }
    // No chapters for this video — plain one-minute hop.
    const max = isFinite(v.duration) && v.duration > 1 ? v.duration - 1 : Infinity;
    v.currentTime = Math.max(0, Math.min(max, t + dir * 60));
    toast(dir > 0 ? "⏭ 1 min" : "⏮ 1 min", 1200);
  }

  /* ---------- Jump to peak (most-replayed) ---------- */
  const peakCache = new Map(); // videoId -> peaks sorted by score desc
  let peakCycle = { vid: null, idx: 0 };

  // Jump to the hottest point on YouTube's "most replayed" graph. Repeated
  // presses cycle through the top few hot spots. Reuses the same page-helper
  // heatmap fetch Auto-Cut uses, so it works whether or not Auto-Cut is on.
  async function jumpToPeak() {
    const vid = getVideoId();
    if (!vid) return;
    let peaks = peakCache.get(vid);
    if (!peaks) {
      toast("Finding the peak…");
      const data = await requestAutocutData(vid, true, false);
      peaks = ((data && data.heatmap) || [])
        .filter((h) => isFinite(h.start))
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      peakCache.set(vid, peaks);
    }
    if (!peaks.length) {
      toast("No 'most replayed' data for this video yet");
      return;
    }
    const top = Math.min(5, peaks.length);
    if (peakCycle.vid !== vid) peakCycle = { vid, idx: 0 };
    const idx = peakCycle.idx % top;
    const target = peaks[idx];
    peakCycle.idx = (idx + 1) % top;
    const v = getVideoEl();
    if (v) {
      v.currentTime = Math.max(0, target.start);
      if (v.play) v.play().catch(() => {});
    }
    toast(`Jumped to peak ${idx + 1}/${top} · ${fmtTime(target.start)}`);
  }

  // Copy a "watch at current time" URL to the clipboard.
  async function copyTimestampLink() {
    const vid = getVideoId();
    if (!vid) return;
    const v = getVideoEl();
    const t = v ? Math.floor(v.currentTime || 0) : 0;
    const url = `https://www.youtube.com/watch?v=${vid}` + (t > 0 ? `&t=${t}s` : "");
    try {
      await navigator.clipboard.writeText(url);
      toast(t > 0 ? `Link copied at ${fmtTime(t)}` : "Link copied");
    } catch {
      toast("Couldn't copy link");
    }
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
      if (settings.autoCut && cutIgnored)
        label.textContent =
          cutIgnoredWhy === "short"
            ? "Auto-Cut · short"
            : cutIgnoredWhy === "music"
              ? "Auto-Cut · music"
              : "Auto-Cut · ignored";
      else if (settings.autoCut && havePlan) label.textContent = `Auto-Cut · ${n}`;
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
    positionCutPanel();
    window.addEventListener("resize", positionCutPanel);
    document.addEventListener("keydown", cutPanelKey, true);
    setTimeout(() => document.addEventListener("click", cutPanelOutside, true), 0);
  }

  // Close the panel on Escape.
  function cutPanelKey(e) {
    if (e.key === "Escape" && document.getElementById("yqn-cut-panel")) {
      e.stopPropagation();
      closeCutPanel();
    }
  }

  // Anchor the panel under the Auto-Cut button and cap its height to the space
  // left below it, so a long cut list scrolls inside the panel instead of
  // running off the bottom of the viewport.
  function positionCutPanel() {
    const panel = document.getElementById("yqn-cut-panel");
    if (!panel) return;
    const btn = document.getElementById("yqn-cut-btn");
    if (!btn) return;
    const margin = 8;
    const r = btn.getBoundingClientRect();
    const top = r.bottom + 6;
    panel.style.top = top + "px";
    panel.style.left = Math.max(margin, r.left) + "px";
    panel.style.maxHeight = Math.max(120, window.innerHeight - top - margin) + "px";
  }

  function closeCutPanel() {
    const p = document.getElementById("yqn-cut-panel");
    if (p) p.remove();
    window.removeEventListener("resize", positionCutPanel);
    document.removeEventListener("keydown", cutPanelKey, true);
    document.removeEventListener("click", cutPanelOutside, true);
  }

  function cutPanelOutside(e) {
    const panel = document.getElementById("yqn-cut-panel");
    if (!panel) return;
    if (panel.contains(e.target)) return;
    if (e.target.closest && e.target.closest("#yqn-cut-btn")) return;
    closeCutPanel();
  }

  // Clickable AI chapter list — jump to (or past) a topic on videos whose
  // creator didn't add chapter markers.
  function appendChapterList(body) {
    const chapters = cutPlan && cutPlan.chapters;
    if (!chapters || !chapters.length) return;
    const head = document.createElement("div");
    head.className = "yqn-cp-chaphead";
    head.textContent = "Chapters (AI)";
    body.appendChild(head);
    for (const c of chapters) {
      const row = document.createElement("div");
      row.className = "yqn-cp-chap";
      row.innerHTML =
        `<span class="yqn-cp-time">${fmtTime(c.start)}</span>` +
        `<span class="yqn-cp-chaptitle"></span>`;
      row.querySelector(".yqn-cp-chaptitle").textContent = c.title;
      row.title = "Jump to " + fmtTime(c.start);
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const v = getVideoEl();
        if (v) {
          v.currentTime = c.start + 0.05;
          if (v.play) v.play().catch(() => {});
        }
      });
      body.appendChild(row);
    }
  }

  // Takeaways (bulleted) and mentioned items (linked when the AI could pin a
  // URL, preferring real links from the video description).
  function appendAIExtras(body) {
    const take = cutPlan && cutPlan.takeaways;
    if (take && take.length) {
      const head = document.createElement("div");
      head.className = "yqn-cp-chaphead";
      head.textContent = "Takeaways";
      body.appendChild(head);
      const ul = document.createElement("ul");
      ul.className = "yqn-cp-takeaways";
      for (const t of take) {
        const li = document.createElement("li");
        li.textContent = t;
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
    const men = cutPlan && cutPlan.mentions;
    if (men && men.length) {
      const head = document.createElement("div");
      head.className = "yqn-cp-chaphead";
      head.textContent = "Mentioned in this video";
      body.appendChild(head);
      for (const m of men) {
        const row = document.createElement("div");
        row.className = "yqn-cp-mention";
        if (m.url) {
          const a = document.createElement("a");
          a.href = m.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = m.name;
          a.title = m.url;
          row.appendChild(a);
        } else {
          row.textContent = m.name;
        }
        body.appendChild(row);
      }
    }
  }

  // Human name for the AI model that produced a plan, shown in the panel so
  // different models' cut quality can be compared.
  function shortModelName(id) {
    if (/haiku/i.test(id)) return "AI: Haiku";
    if (/sonnet/i.test(id)) return "AI: Sonnet";
    if (/opus/i.test(id)) return "AI: Opus";
    return "AI: " + id;
  }

  // Estimated wall-clock time saved by a plan: skipped segments are removed
  // entirely; sped-up segments save the fraction (1 − 1/rate) of their length.
  function cutTimeSaved(segments) {
    const rate = Math.max(1.25, Math.min(4, +settings.speedRate || 3));
    let saved = 0;
    for (const s of segments) {
      const dur = Math.max(0, s.end - s.start);
      saved += s.action === "skip" ? dur : dur * (1 - 1 / rate);
    }
    return saved;
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
    const ign = document.createElement("button");
    ign.type = "button";
    ign.className = "yqn-cp-ignore" + (cutIgnored ? " on" : "");
    ign.textContent = cutIgnored ? "Ignored" : "Ignore";
    ign.title = cutIgnored
      ? "Auto-Cut is leaving this video alone — click to re-enable"
      : "Never cut this video (handy for music)";
    ign.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleIgnoreVideo();
    });
    const ctrls = document.createElement("span");
    ctrls.className = "yqn-cp-ctrls";
    ctrls.appendChild(ign);
    ctrls.appendChild(sw);
    head.appendChild(ctrls);

    const body = document.createElement("div");
    body.className = "yqn-cp-body";

    if (!settings.autoCut) {
      body.innerHTML = `<div class="yqn-cp-msg">Auto-Cut is off. Turn it on to trim this video.</div>`;
    } else if (cutIgnored) {
      body.innerHTML =
        cutIgnoredWhy === "short"
          ? `<div class="yqn-cp-msg">Shorter than ${settings.minCutMinutes} min — Auto-Cut leaves short videos alone (threshold in the popup). Click "Ignored" to cut it anyway.</div>`
          : cutIgnoredWhy === "music"
            ? `<div class="yqn-cp-msg">🎵 Detected as a music video — Auto-Cut is leaving it alone. Click "Ignored" if you want it cut anyway.</div>`
            : `<div class="yqn-cp-msg">This video is ignored — nothing will be skipped or sped up here (handy for music). Click "Ignored" to re-enable.</div>`;
    } else if (!havePlan) {
      body.innerHTML = `<div class="yqn-cp-msg">Analysing this video…</div>`;
    } else if (!cutPlan.segments.length) {
      body.innerHTML = `<div class="yqn-cp-msg">${emptyReason(false)}</div>`;
      const diagText = diagString();
      if (diagText) {
        const diag = document.createElement("div");
        diag.className = "yqn-cp-diag";
        diag.textContent = diagText;
        body.appendChild(diag);
      }
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "yqn-cp-retry";
      retry.textContent = "↻ Re-analyse";
      retry.title = "Throw the empty result away and analyse this video again";
      retry.addEventListener("click", (e) => {
        e.stopPropagation();
        cutPlan = null;
        cutPlanningFor = null;
        startAutoCut(true);
        renderCutPanel();
      });
      const retryWrap = document.createElement("div");
      retryWrap.className = "yqn-cp-retry-wrap";
      retryWrap.appendChild(retry);
      body.appendChild(retryWrap);
      appendChapterList(body);
      appendAIExtras(body);
    } else {
      if (cutPlan.summary) {
        const summary = document.createElement("div");
        summary.className = "yqn-cp-summary";
        summary.textContent = cutPlan.summary;
        body.appendChild(summary);
      }
      const skips = cutPlan.segments.filter((s) => s.action === "skip").length;
      const speeds = cutPlan.segments.length - skips;
      const saved = cutTimeSaved(cutPlan.segments);
      const sum = document.createElement("div");
      sum.className = "yqn-cp-sum";
      sum.textContent =
        `${cutPlan.segments.length} cuts · ${skips} skipped · ${speeds} sped up` +
        (saved >= 1 ? ` · ~${fmtTime(saved)} saved` : "") +
        (cutPlan.aiModel ? ` · ${shortModelName(cutPlan.aiModel)}` : "");
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
      appendChapterList(body);
      appendAIExtras(body);
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
    if (cutIgnored) return "Auto-Cut is ignoring this video — open the panel to re-enable";
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

    // Video category + title for music auto-ignore.
    if (data.type === "video-category") {
      const waiter = categoryWaiters.get(data.videoId);
      if (waiter) waiter({ category: data.category || null, title: data.title || "" });
      return;
    }

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

  /* ---------- per-video ignore list ----------
   * Some videos should never be cut — music above all, where "low engagement"
   * stretches and lyric transcripts make every source misfire. The panel's
   * Ignore button exempts the current video permanently (until un-ignored).
   */
  const CUT_IGNORE_KEY = "cutIgnoreV1"; // user said: never cut this video
  const CUT_ALLOW_KEY = "cutAllowV1"; // user overrode music auto-ignore
  const CUT_IGNORE_MAX = 500;
  let cutIgnored = false; // for the current video; refreshed on navigation
  let cutIgnoredAuto = false; // auto-ignored (music / short), not by the user
  let cutIgnoredWhy = null; // "music" | "short" | null

  function videoFlagGet(key, videoId) {
    return new Promise((resolve) => {
      if (!videoId) return resolve(false);
      localGet({ [key]: {} }, (store) => {
        resolve(!!(store[key] || {})[videoId]);
      });
      // localGet no-ops on an orphaned extension context — don't hang forever.
      setTimeout(() => resolve(false), 1000);
    });
  }

  function videoFlagSet(key, videoId, on) {
    if (!videoId) return;
    localGet({ [key]: {} }, (store) => {
      const map = store[key] || {};
      if (on) map[videoId] = Date.now();
      else delete map[videoId];
      const keys = Object.keys(map);
      if (keys.length > CUT_IGNORE_MAX) {
        keys
          .sort((a, b) => (map[a] || 0) - (map[b] || 0))
          .slice(0, keys.length - CUT_IGNORE_MAX)
          .forEach((k) => delete map[k]);
      }
      localSet({ [key]: map });
    });
  }

  const isVideoIgnored = (v) => videoFlagGet(CUT_IGNORE_KEY, v);
  const setVideoIgnored = (v, on) => videoFlagSet(CUT_IGNORE_KEY, v, on);
  const isVideoAllowed = (v) => videoFlagGet(CUT_ALLOW_KEY, v);
  const setVideoAllowed = (v, on) => videoFlagSet(CUT_ALLOW_KEY, v, on);

  function toggleIgnoreVideo() {
    const vid = getVideoId();
    if (!vid) return;
    if (cutIgnored) {
      // Un-ignore. If this was a music auto-ignore, record the override so
      // the video isn't re-ignored on the next visit.
      cutIgnored = false;
      setVideoIgnored(vid, false);
      if (cutIgnoredAuto) setVideoAllowed(vid, true);
      cutIgnoredAuto = false;
      cutIgnoredWhy = null;
      toast("Auto-Cut re-enabled for this video");
      // Skip the storage re-read: the un-ignore write may not have committed
      // yet, and re-reading could race back to the stale "ignored" state.
      if (settings.autoCut) startAutoCut(true);
    } else {
      cutIgnored = true;
      cutIgnoredAuto = false;
      cutIgnoredWhy = null;
      setVideoIgnored(vid, true);
      setVideoAllowed(vid, false);
      cutPlan = null;
      cutPlanningFor = null;
      removeCutMarkers();
      const v = getVideoEl();
      if (v) v.playbackRate = 1;
      toast("Auto-Cut will leave this video alone");
    }
    updateCutButton();
    renderCutPanelIfOpen();
  }

  const CUT_CACHE_TTL = 3 * 24 * 60 * 60 * 1000; // 3 days
  const CUT_CACHE_MAX = 300;

  // v10 key: v1.29.0 could cache plans that sped the entire video (empty AI
  // highlights + whole-video fallback) — drop them so videos re-analyse with
  // the coverage guards.
  const CUT_CACHE_KEY = "cutCacheV10";

  function getCachedPlan(videoId) {
    return new Promise((resolve) => {
      localGet({ [CUT_CACHE_KEY]: {} }, (store) => {
        const cache = store[CUT_CACHE_KEY] || {};
        const hit = cache[videoId];
        // Only serve non-empty cached plans.
        if (hit && hit.segments && hit.segments.length && Date.now() - hit.ts < CUT_CACHE_TTL) {
          resolve({
            segments: hit.segments,
            aiModel: hit.aiModel || null,
            summary: hit.summary || null,
            chapters: hit.chapters || null,
            takeaways: hit.takeaways || null,
            mentions: hit.mentions || null,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  function setCachedPlan(videoId, segments, aiModel, summary, chapters, takeaways, mentions) {
    // Never cache empty plans — a transient failure shouldn't stick.
    if (!segments || !segments.length) return;
    localGet({ [CUT_CACHE_KEY]: {} }, (store) => {
      const cache = store[CUT_CACHE_KEY] || {};
      cache[videoId] = {
        segments,
        ts: Date.now(),
        aiModel: aiModel || null,
        summary: summary || null,
        chapters: chapters && chapters.length ? chapters : null,
        takeaways: takeaways && takeaways.length ? takeaways : null,
        mentions: mentions && mentions.length ? mentions : null,
      };
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
    if (i.aiEnabled && i.transcriptLines > 0) {
      parts.push(
        `AI:${i.aiSkips != null ? i.aiSkips : "-"}skip/` +
          `${i.aiHighlights != null ? i.aiHighlights : "-"}hl` +
          `${i.aiHlPct != null ? `(${i.aiHlPct}%)` : ""}→` +
          `${i.aiCut != null ? i.aiCut : "-"}seg`
      );
      if (i.aiError) parts.push(`aiErr:${i.aiError}`);
    }
    if (d.transcriptParams != null) {
      parts.push(
        `gt:${d.transcriptParams ? "p" : "-"}/` +
          `${d.getTranscript != null ? d.getTranscript : d.getTranscriptErr ? "err" : "-"}`
      );
    }
    if (d.ttCaptured != null) parts.push(`ttcap:${d.ttCaptured}`);
    if (d.nudge != null) parts.push(`nudge:${d.nudge}`);
    if (i.silence != null) parts.push(`silent:${i.silence}`);
    if (i.duration != null) parts.push(`dur:${i.duration}s`);
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
        const d = i.diag || {};
        if ((d.captionTracks || 0) > 0 || (d.getTranscript || 0) > 0) {
          return (
            "Nothing to cut — this video has captions, but YouTube wouldn't hand " +
            "them over this time (token-gated download). Hit ↻ Re-analyse; turning " +
            "captions (CC) on briefly also lets the retry capture them."
          );
        }
        return "Nothing to cut — this video has no captions for AI, and no SponsorBlock/most-replayed data.";
      }
      if (i.duration === 0) {
        return "Nothing to cut — the player hadn't reported the video length yet, so speed-throughs couldn't be placed. Hit ↻ Re-analyse.";
      }
      if (i.aiError) {
        return `Nothing to cut — the AI analysis didn't complete (${i.aiError}). Hit ↻ Re-analyse.`;
      }
      if ((i.aiHighlights || 0) > 0 && (i.aiHlPct || 0) < 10 && i.aiCut === 0) {
        return (
          `Nothing to cut — AI highlights covered only ${i.aiHlPct || 0}% of the ` +
          "runtime, too sparse to trust for speeding the rest. Hit ↻ Re-analyse " +
          "(or try the Sonnet model in the popup)."
        );
      }
      if ((i.aiHighlights || 0) > 0 && (i.aiSkips || 0) === 0 && i.aiCut === 0) {
        return `Nothing to cut — AI marked the whole video worth watching (${i.aiHighlights} highlight${i.aiHighlights === 1 ? "" : "s"}, no junk, no gaps long enough to speed).`;
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

  // Wait for the player to know the video's duration (metadata can lag a
  // moment behind navigation). Resolves 0 if it never arrives.
  function getVideoDuration(timeoutMs) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const check = () => {
        const v = getVideoEl();
        const d = v && isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
        if (d) return resolve(d);
        if (Date.now() - t0 >= timeoutMs) return resolve(0);
        setTimeout(check, 200);
      };
      check();
    });
  }

  // Speed-only mode: nothing is jumped over — segments that would be skipped
  // are played fast instead, so no content is ever missed. Exception: sponsor
  // segments (SponsorBlock's category or an AI reason naming a sponsor) have
  // no value at any speed and stay cut outright. Applied when a plan is
  // loaded (the cache keeps the raw plan), so toggling is instant.
  const SPONSOR_REASON_RE = /sponsor/i;

  function maybeSpeedOnly(segments) {
    if (!settings.speedOnly) return segments;
    return segments.map((s) =>
      s.action === "skip" && !SPONSOR_REASON_RE.test(s.reason || "")
        ? { ...s, action: "speed" }
        : s
    );
  }

  async function startAutoCut(skipIgnoreCheck) {
    if (!settings.autoCut || !isWatchPage()) return;
    const videoId = getVideoId();
    if (!videoId || cutPlanningFor === videoId) return;
    // Claim the video immediately: run() fires on both of YouTube's
    // navigation events, and without this two overlapping calls could both
    // reach planning (and both pay for an AI analysis).
    cutPlanningFor = videoId;
    if (!skipIgnoreCheck) {
      cutIgnored = await isVideoIgnored(videoId);
      cutIgnoredAuto = false;
      cutIgnoredWhy = null;
      const minSecs = Math.max(0, +settings.minCutMinutes || 0) * 60;
      if (!cutIgnored && (settings.autoIgnoreMusic || minSecs > 0)) {
        const allowed = await isVideoAllowed(videoId);
        if (!allowed && getVideoId() === videoId) {
          // Short videos first: nothing worth cutting, and skipping the
          // analysis entirely also means no transcript scraping.
          const dur = minSecs > 0 ? await getVideoDuration(3000) : 0;
          if (minSecs > 0 && dur > 0 && dur < minSecs) {
            cutIgnored = true;
            cutIgnoredAuto = true;
            cutIgnoredWhy = "short";
          } else if (settings.autoIgnoreMusic && getVideoId() === videoId) {
            // Auto-ignore videos YouTube categorises as Music, unless the
            // user explicitly un-ignored this one before. Trailers/teasers
            // are exempt: labels often categorise them as Music, but they're
            // regular videos with sponsor reads and filler worth cutting.
            const info = await getVideoCategory(videoId);
            const isTrailer =
              info && /\b(trailer|teaser)\b/i.test(info.title || "");
            if (info && info.category === "Music" && !isTrailer) {
              cutIgnored = true;
              cutIgnoredAuto = true;
              cutIgnoredWhy = "music";
            }
          }
        }
      }
      if (getVideoId() !== videoId) {
        cutPlanningFor = null;
        return;
      }
    }
    if (cutIgnored) {
      // Release the claim so un-ignoring can re-enter and plan.
      cutPlanningFor = null;
      cutPlan = null;
      removeCutMarkers();
      setCutTooltip(
        cutIgnoredWhy === "short"
          ? "Auto-Cut: short video — leaving it alone"
          : cutIgnoredWhy === "music"
            ? "Auto-Cut: music video — leaving it alone"
            : "Auto-Cut: ignoring this video"
      );
      updateCutButton();
      renderCutPanelIfOpen();
      return;
    }
    cutPlan = null;
    removeCutMarkers();
    setCutTooltip("Auto-Cut — analysing…");
    attachCutController();

    // Serve an instant plan from cache if we've analysed this video recently.
    const cached = await getCachedPlan(videoId);
    if (cached && getVideoId() === videoId && settings.autoCut) {
      cutPlan = {
        videoId,
        segments: maybeSpeedOnly(cached.segments),
        aiModel: cached.aiModel,
        summary: cached.summary,
        chapters: cached.chapters,
        takeaways: cached.takeaways,
        mentions: cached.mentions,
      };
      dlog("[YQN] cut plan (cached)", { videoId, segments: cutPlan.segments });
      announcePlan(cutPlan.segments, true);
      scheduleMarkerRender();
      return;
    }

    try {
      const segments = await buildCutPlan(videoId);
      // Ignore if the user navigated away meanwhile.
      if (getVideoId() !== videoId || !settings.autoCut) return;
      const aiModel = (lastPlanInfo && lastPlanInfo.aiModelUsed) || null;
      const summary = (lastPlanInfo && lastPlanInfo.aiSummary) || null;
      const chapters = (lastPlanInfo && lastPlanInfo.aiChaptersArr) || null;
      const takeaways = (lastPlanInfo && lastPlanInfo.aiTakeawaysArr) || null;
      const mentions = (lastPlanInfo && lastPlanInfo.aiMentionsArr) || null;
      cutPlan = {
        videoId,
        segments: maybeSpeedOnly(segments),
        aiModel,
        summary,
        chapters,
        takeaways,
        mentions,
      };
      // Only cache a *complete* plan. If AI was enabled but the transcript
      // came back empty (a fetch failure, not genuinely no captions) or the
      // AI call itself errored/timed out, don't cache — otherwise a partial
      // SponsorBlock-only plan gets stuck and AI never retries on revisits.
      const aiIncomplete =
        lastPlanInfo &&
        lastPlanInfo.aiEnabled &&
        (lastPlanInfo.transcriptLines === 0 || lastPlanInfo.aiError);
      if (!aiIncomplete)
        setCachedPlan(videoId, segments, aiModel, summary, chapters, takeaways, mentions);
      dlog("[YQN] cut plan", { videoId, segments, cached: !aiIncomplete });
      announcePlan(cutPlan.segments, false);
      scheduleMarkerRender();
    } catch (err) {
      dlog("[YQN] cut plan failed:", err && err.message);
      // Release the claim so the next navigation (or Re-analyse) can retry.
      if (cutPlanningFor === videoId) cutPlanningFor = null;
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
  // While scraping, park the transcript panel off-screen so opening it doesn't
  // reflow the page and push the video up — the data still loads and is read
  // via the network capture or the (off-screen) DOM.
  function setTranscriptPanelHidden(hidden) {
    const id = "yqn-hide-transcript-style";
    const existing = document.getElementById(id);
    if (!hidden) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent =
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]{' +
      "position:fixed !important;left:-10000px !important;top:0 !important;" +
      "width:400px !important;max-height:80vh !important;z-index:-1 !important;}";
    document.documentElement.appendChild(style);
  }

  async function getTranscriptFromPanel() {
    // Rows already rendered (panel open — by the user, or left over from an
    // earlier attempt)? Read them directly: no clicking, no closing.
    const preRows = readTranscriptSegments();
    if (preRows.length) {
      dlog("[YQN] transcript: read", preRows.length, "rows from open panel");
      return preRows.sort((a, b) => a.start - b.start);
    }

    // Track whether we opened the panel / expanded the description, so we can
    // undo both afterwards instead of leaving the page shifted.
    let weOpened = false;
    let weExpandedDescription = false;
    const collapseDescription = () => {
      if (!weExpandedDescription) return;
      weExpandedDescription = false;
      const collapse = document.querySelector(
        "ytd-watch-metadata #collapse, tp-yt-paper-button#collapse, #description #collapse"
      );
      if (collapse && collapse.offsetParent !== null) collapse.click();
    };

    // YouTube's own handlers scroll the page towards the description /
    // transcript when those buttons are clicked. Pin the scroll position for
    // a short window after each synthetic click — long enough to undo YT's
    // async scrolls, short enough not to fight a user who scrolls later.
    const scrollTimers = [];
    const pinScroll = () => {
      const el = document.scrollingElement || document.documentElement;
      const y = el.scrollTop;
      const restore = () => {
        if (Math.abs(el.scrollTop - y) > 2) el.scrollTop = y;
      };
      [0, 150, 400, 800].forEach((ms) => scrollTimers.push(setTimeout(restore, ms)));
    };

    try {
      window.postMessage({ source: "yqn", type: "transcript-reset" }, location.origin);

      const openPanel = async () => {
        let btn = findShowTranscriptButton();
        if (!btn) {
          const expand = document.querySelector(
            "ytd-watch-metadata #expand, tp-yt-paper-button#expand, #description #expand"
          );
          if (expand && expand.offsetParent !== null) {
            pinScroll();
            expand.click();
            weExpandedDescription = true;
            await sleep(400);
            btn = findShowTranscriptButton();
          }
        }
        if (btn) {
          pinScroll();
          btn.click();
          return true;
        }
        return false;
      };

      const poll = async (n) => {
        let out = [];
        for (let i = 0; i < n && !out.length; i++) {
          await sleep(200);
          if (i === 2) {
            pinScroll();
            clickTranscriptTab(); // in case it opened on Chapters
          }
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
      if (!alreadyOpen) {
        setTranscriptPanelHidden(true);
        if (!(await openPanel())) {
          dlog("[YQN] transcript: no 'Show transcript' button found");
          return [];
        }
        weOpened = true;
      }

      // Phase 1 (hidden): rely on the network capture — the off-screen panel
      // still triggers YouTube's get_transcript fetch, but its virtualised
      // rows may not render, so the DOM read can't be trusted here.
      let result = await poll(18);

      // Phase 2 (visible): capture missed, so unhide the panel briefly — the
      // rows only render on-screen. Scroll is pinned; the panel is closed
      // right after. A short flash beats reporting "no captions" wrongly.
      if (!result.length) {
        pinScroll();
        setTranscriptPanelHidden(false);
        await sleep(300);
        result = await poll(25);
      }

      // Stale already-open panel — force a fresh fetch by closing/reopening.
      if (!result.length && alreadyOpen) {
        for (let i = 0; i < 6 && !closeTranscriptPanel(); i++) await sleep(200);
        await sleep(400);
        if (await openPanel()) {
          weOpened = true;
          result = await poll(30);
        }
      }

      if (weOpened) {
        setTranscriptPanelHidden(false);
        for (let i = 0; i < 6 && !closeTranscriptPanel(); i++) await sleep(200);
      }

      dlog("[YQN] transcript:", result.length, result.length ? "(ok)" : "(empty)");
      return result.sort((a, b) => a.start - b.start);
    } catch (e) {
      dlog("[YQN] transcript panel error:", e && e.message);
      return [];
    } finally {
      pinScroll();
      collapseDescription();
      setTranscriptPanelHidden(false);
      // Belt and braces: if the panel we opened somehow survived (a failed
      // close on a hidden panel used to leave it sitting open on screen),
      // keep trying to close it for a couple of seconds.
      if (weOpened) {
        let tries = 0;
        const lateClose = () => {
          const open = document.querySelector(
            "ytd-transcript-renderer, ytd-transcript-segment-renderer"
          );
          if (!open || closeTranscriptPanel() || ++tries >= 6) return;
          setTimeout(lateClose, 350);
        };
        setTimeout(lateClose, 300);
      }
      setTimeout(() => scrollTimers.forEach(clearTimeout), 1200);
    }
  }

  async function buildCutPlan(videoId) {
    const segs = [];
    const info = {
      sbEnabled: !!settings.cutMessaging,
      sbCount: 0,
      heatmapEnabled: !!(settings.cutBoring || settings.autoCutPlus),
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

    // 2/4) Data that needs the page context (heatmap + transcript). The
    // transcript is also fetched for "trim dull parts" alone, so silent
    // stretches can be detected without AI.
    const needHeatmap = !!(settings.cutBoring || settings.autoCutPlus);
    const needTranscript = info.aiEnabled || !!settings.cutBoring;
    let pageData = null;
    if (needHeatmap || needTranscript) {
      pageData = await requestAutocutData(videoId, needHeatmap, needTranscript);
      info.diag = pageData && pageData.diag;
    }
    dlog("[YQN] plan: pageData", {
      heatmap: (pageData && pageData.heatmap && pageData.heatmap.length) || 0,
      transcript: (pageData && pageData.transcript && pageData.transcript.length) || 0,
    });

    // Await the real duration — a synchronous read of 0 (metadata not loaded
    // yet) silently disables every AI speed-through, since gaps outside
    // highlights can't be computed without knowing where the video ends.
    const duration = await getVideoDuration(4000);
    info.duration = Math.round(duration);

    if ((settings.cutBoring || settings.autoCutPlus) && pageData && pageData.heatmap) {
      info.heatmapPoints = pageData.heatmap.length;
      if (pageData.heatmap.length) segs.push(...boringFromHeatmap(pageData.heatmap));
    }

    // Silent stretches: a big jump between caption timestamps means nobody is
    // talking — a demo or montage that rarely needs real time. Deterministic,
    // no AI required; the AI can't see inside these gaps anyway.
    if (settings.cutBoring && !info.aiEnabled) {
      const t = (pageData && pageData.transcript) || [];
      if (t.length) {
        const sil = silenceFromTranscript(t, duration);
        info.silence = sil.length;
        segs.push(...sil);
      }
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

      if (settings.cutBoring && transcript.length) {
        const sil = silenceFromTranscript(transcript, duration);
        info.silence = sil.length;
        segs.push(...sil);
      }

      if (transcript.length) {
        if (getVideoId() === videoId && settings.autoCut) {
          toast("Auto-Cut: AI analysing transcript…", 4000);
          setCutTooltip("Auto-Cut: AI analysing transcript…");
        }
        // Long videos + the full structured response (cuts, chapters,
        // takeaways, mentions) regularly need more than the old 40s budget —
        // and a failure must be reported as one, not as "AI found nothing".
        let ai = null;
        try {
          ai = await Promise.race([
            aiHighlights(transcript, duration, (pageData && pageData.description) || ""),
            new Promise((_, rej) =>
              setTimeout(() => rej(new Error("timed out after 90s")), 90000)
            ),
          ]);
        } catch (e) {
          info.aiError = (e && e.message) || "failed";
        }
        dlog("[YQN] AI result", ai || info.aiError);
        if (ai) {
          const aiSegs = segmentsFromAI(ai, duration);
          info.aiCut = aiSegs.length;
          info.aiHighlights = ai.highlights.length;
          info.aiHlPct = duration
            ? Math.round(
                (100 / duration) *
                  ai.highlights.reduce((a, h) => a + Math.max(0, h.end - h.start), 0)
              )
            : 0;
          info.aiSkips = ai.skip.length;
          info.aiModelUsed = settings.aiModel || "claude-haiku-4-5-20251001";
          info.aiSummary = ai.summary || "";
          info.aiChaptersArr = ai.chapters || [];
          info.aiTakeawaysArr = ai.takeaways || [];
          info.aiMentionsArr = ai.mentions || [];
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

  /* ----- Silence -> speed. -----
   * Caption lines carry start times; a long jump between consecutive starts
   * means nobody is talking (silent demo, montage, b-roll). Speed those
   * stretches. Conservative: only gaps of 20s+, with an 8s lead so the tail
   * of the last spoken line isn't clipped, and a 1s buffer before speech
   * resumes.
   */
  function silenceFromTranscript(transcript, duration) {
    if (!transcript || transcript.length < 3) return [];
    const MIN_GAP = 20;
    const LEAD = 8;
    const ts = transcript
      .map((t) => +t.start)
      .filter((s) => isFinite(s))
      .sort((a, b) => a - b);
    if (ts.length < 3) return [];
    // Only a per-line transcript (typical gap a few seconds) can support
    // silence inference. A coarse one — paragraph- or chapter-level rows —
    // makes every gap look like 20s+ of "silence" and ambers the whole video.
    const gaps = [];
    for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
    const median = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    if (median > 8) return [];
    const out = [];
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - ts[i - 1] >= MIN_GAP) {
        out.push({
          start: ts[i - 1] + LEAD,
          end: ts[i] - 1,
          action: "speed",
          reason: "no talking",
        });
      }
    }
    // Silence after the last caption line until the end of the video.
    if (duration && duration - ts[ts.length - 1] >= MIN_GAP + LEAD) {
      out.push({
        start: ts[ts.length - 1] + LEAD,
        end: duration,
        action: "speed",
        reason: "no talking",
      });
    }
    const found = out.filter((s) => s.end - s.start >= 10);
    // Silence covering nearly the whole video means the transcript is
    // untrustworthy, not that the video is that silent. Lenient on purpose:
    // a demo-heavy video can legitimately be half silence — the median-gap
    // check above is the real guard against coarse transcripts.
    const total = found.reduce((a, s) => a + (s.end - s.start), 0);
    if (duration && total > duration * 0.7) return [];
    return found;
  }

  /* ----- Most replayed -> tiered trim. -----
   * A marker is "dull" when it dips well below its LOCAL neighbourhood, not
   * below a fraction of the video's single hottest spike. Comparing against a
   * rolling median makes decisions consistent across videos: one viral moment
   * no longer drags everything else under the threshold, a flat heatmap cuts
   * nothing, and a naturally decaying heatmap only cuts genuine local dips.
   * Scores are smoothed first so single noisy markers can't flip a tier.
   * Plus mode raises the bar so much more of the video qualifies.
   */
  function boringFromHeatmap(heatmap) {
    // heatmap: [{start, end, score(0..1)}] — typically ~100 markers.
    const n = heatmap.length;
    if (!n) return [];
    const plus = !!settings.autoCutPlus;
    const minSkip = plus ? 4 : 6;
    const minSpeed = plus ? 3 : 5;
    const speedK = plus ? 1.0 : 0.8; // below this × baseline -> speed
    const skipK = plus ? 0.5 : 0.35; // below this × baseline -> dead zone -> skip

    // 1) Smooth single-marker noise (3-wide moving average).
    const raw = heatmap.map((h) => h.score || 0);
    const sm = raw.map((_, i) => {
      let sum = 0;
      let c = 0;
      for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) {
        sum += raw[j];
        c++;
      }
      return sum / c;
    });

    // 2) Baseline per marker: rolling local median (±10% of the video),
    //    capped at 1.5× the global median so an extremely hot neighbourhood
    //    doesn't set an unfairly high bar for its own edges.
    const median = (arr) => {
      const a = [...arr].sort((x, y) => x - y);
      const m = a.length >> 1;
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    };
    const glob = Math.max(median(sm), 0.0001);
    const W = Math.max(5, Math.round(n * 0.1));
    const baseAt = (i) => {
      const lo = Math.max(0, i - W);
      const hi = Math.min(n - 1, i + W);
      return Math.min(Math.max(median(sm.slice(lo, hi + 1)), 0.0001), glob * 1.5);
    };

    const tier = (i) => {
      const b = baseAt(i);
      if (sm[i] < skipK * b) return 2; // skip
      if (sm[i] < speedK * b) return 1; // speed
      return 0; // keep
    };

    const out = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
      const t = tier(i);
      if (t === 0) {
        if (cur) {
          out.push(cur);
          cur = null;
        }
        continue;
      }
      if (cur && cur._tier === t) {
        cur.end = heatmap[i].end;
      } else {
        if (cur) out.push(cur);
        cur = {
          start: heatmap[i].start,
          end: heatmap[i].end,
          action: t === 2 ? "skip" : "speed",
          reason: t === 2 ? "dead zone" : "low replays",
          _tier: t,
        };
      }
    }
    if (cur) out.push(cur);

    // Min lengths so we don't stutter: skips a touch longer than speed-ups.
    return out
      .filter((s) => (s.action === "skip" ? s.end - s.start >= minSkip : s.end - s.start >= minSpeed))
      .map(({ _tier, ...s }) => s);
  }

  // ----- AI highlights (Claude): returns { highlights, skip } -----

  // JSON schema for structured outputs — guarantees the response parses.
  const AI_CUT_SCHEMA = {
    type: "object",
    properties: {
      summary: { type: "string" },
      highlights: {
        type: "array",
        items: {
          type: "object",
          properties: { start: { type: "number" }, end: { type: "number" } },
          required: ["start", "end"],
          additionalProperties: false,
        },
      },
      skip: {
        type: "array",
        items: {
          type: "object",
          properties: {
            start: { type: "number" },
            end: { type: "number" },
            reason: { type: "string" },
          },
          required: ["start", "end", "reason"],
          additionalProperties: false,
        },
      },
      chapters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            start: { type: "number" },
            title: { type: "string" },
          },
          required: ["start", "title"],
          additionalProperties: false,
        },
      },
      takeaways: { type: "array", items: { type: "string" } },
      mentions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            url: { type: "string" },
          },
          required: ["name", "url"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "highlights", "skip", "chapters", "takeaways", "mentions"],
    additionalProperties: false,
  };

  async function aiHighlights(transcript, duration, description) {
    // Compact the transcript to timestamped lines. The cap covers hours of
    // speech; when exceeded, the model is told where the transcript ends and
    // the unseen tail is kept at normal speed instead of fast-forwarded.
    const MAX_TRANSCRIPT_CHARS = 300000;
    const full = transcript
      .map((t) => `[${Math.round(t.start)}] ${t.text}`)
      .join("\n");
    const truncated = full.length > MAX_TRANSCRIPT_CHARS;
    const lines = truncated ? full.slice(0, MAX_TRANSCRIPT_CHARS) : full;
    let seenUpTo = duration;
    if (truncated) {
      const m = lines.match(/\[(\d+)\][^[]*$/);
      seenUpTo = m ? +m[1] : 0;
    }

    // Plus mode makes the AI markedly more aggressive, matching the heatmap.
    const plusAI = !!settings.autoCutPlus;
    const sys =
      "You edit a YouTube video down to its worthwhile parts using its " +
      "timestamped transcript. Return ONLY JSON of the form " +
      '{"summary":s,"highlights":[{"start":n,"end":n}],"skip":[{"start":n,"end":n,"reason":s}],"chapters":[{"start":n,"title":s}],"takeaways":[s],"mentions":[{"name":s,"url":s}]} ' +
      "with times in seconds. " +
      "takeaways = 3-6 crisp bullets a viewer should remember: the concrete " +
      "facts, recommendations and conclusions FROM the content, not " +
      "descriptions of the video. " +
      "mentions = every distinct product, tool, site, book or resource the " +
      "speaker discusses: name plus a full https URL. Prefer exact URLs from " +
      "the description when provided; otherwise use the domain as spoken " +
      '(e.g. "shadscan dot com" -> "https://shadscan.com"); if genuinely ' +
      'unknown use "" for url. ' +
      "chapters = 3-12 topical markers spanning the whole video, one at each " +
      "real topic change, with concrete 2-6 word titles that let a viewer " +
      'jump to or past a topic (e.g. "Tool 3: Cursor", "Pricing comparison" ' +
      '- never vague ones like "Introduction continues"). The first chapter ' +
      "starts at 0. If the creator covers a numbered list of items, give " +
      "each item its own chapter. " +
      "summary = 2-3 plain sentences on what the video actually covers and " +
      "its main takeaways - concrete, no fluff, no 'this video...' framing. " +
      "highlights = the genuinely interesting/substantive moments worth " +
      "watching at normal speed. Aim for highlights covering roughly " +
      (plusAI ? "15-35%" : "30-60%") +
      " of the total runtime, as segments of about 15-90 seconds each. Cover " +
      "the WHOLE video from 0s to the end - later parts matter as much as " +
      "the opening. Be selective: everything you leave out of highlights " +
      "will be fast-forwarded, and that is the point - do not mark a stretch " +
      "as a highlight unless it truly earns normal speed. " +
      (plusAI
        ? "Be ruthless: keep only the clearly best moments, and when a " +
          "stretch is borderline junk, skip it rather than keep it. "
        : "") +
      "skip = parts to cut entirely: sponsor reads, subscribe/like/bell " +
      "reminders, intros, outros, dead air, long off-topic tangents or " +
      "rambling, and self-promo of ANY kind - the creator pitching their own " +
      "community, Discord, course, newsletter, membership, merch or other " +
      "products counts as self-promo even when it sounds like friendly " +
      "advice. Give every skip a concise 2-5 word reason " +
      'naming what it is (e.g. "sponsor read", "intro", "repeats earlier point"). ' +
      "Highlights must contain only substantive content: never let a " +
      "highlight span a sponsor read, a self-promo pitch, or a stretch where " +
      "the transcript timestamps jump and nobody is talking - split the " +
      "highlight around those instead. But splitting means trimming, never " +
      "abandoning: a normal video ALWAYS has several highlights, and an " +
      "empty or near-empty highlights list is wrong unless the video truly " +
      "is wall-to-wall junk. " +
      "Segments must not overlap and must stay within the video duration. " +
      "No prose.";
    const user =
      `Video duration: ${Math.round(duration)}s.\n` +
      (truncated
        ? `The transcript below is truncated at ${Math.round(seenUpTo)}s — only judge what is shown.\n`
        : "") +
      (description
        ? `Video description (often contains the real links for mentions):\n${String(description).slice(0, 5000)}\n\n`
        : "") +
      `Transcript:\n${lines}\n\nReturn the JSON.`;

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
        max_tokens: 8000,
        system: sys,
        output_config: { format: { type: "json_schema", schema: AI_CUT_SCHEMA } },
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error("Claude HTTP " + res.status);
    const data = await res.json();
    if (data.stop_reason === "max_tokens") dlog("[YQN] AI response hit max_tokens");
    const text = (data.content || []).map((c) => c.text || "").join("");
    let obj;
    try {
      // Structured outputs guarantee the text is valid schema-shaped JSON.
      obj = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("no JSON in response");
      obj = JSON.parse(match[0]);
    }
    const clean = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .filter((r) => r && isFinite(r.start) && isFinite(r.end) && r.end > r.start)
        .map((r) => ({
          start: +r.start,
          end: +r.end,
          reason: typeof r.reason === "string" ? r.reason.slice(0, 60) : undefined,
        }));
    const cleanChapters = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .filter(
          (c) =>
            c &&
            isFinite(c.start) &&
            c.start >= 0 &&
            (!duration || c.start < duration) &&
            typeof c.title === "string" &&
            c.title.trim()
        )
        .map((c) => ({ start: +c.start, title: c.title.trim().slice(0, 80) }))
        .sort((a, b) => a.start - b.start)
        .filter((c, i, a) => i === 0 || c.start - a[i - 1].start >= 10) // ≥10s apart
        .slice(0, 20);
    const cleanTakeaways = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .filter((t) => typeof t === "string" && t.trim())
        .map((t) => t.trim().slice(0, 220))
        .slice(0, 8);
    const cleanMentions = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .filter((m) => m && typeof m.name === "string" && m.name.trim())
        .map((m) => {
          let url = typeof m.url === "string" ? m.url.trim() : "";
          // Accept bare domains ("shadscan.com"); reject anything that isn't
          // clearly an http(s) URL so the panel never links to junk.
          if (url && !/^https?:\/\//i.test(url)) {
            url = /^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(url) ? "https://" + url : "";
          }
          if (!/^https?:\/\/[\w-]+(\.[\w-]+)+/i.test(url)) url = "";
          return { name: m.name.trim().slice(0, 60), url: url.slice(0, 300) };
        })
        .filter(
          (m, i, a) =>
            a.findIndex((x) => x.name.toLowerCase() === m.name.toLowerCase()) === i
        )
        .slice(0, 15);
    const out = {
      highlights: clean(obj.highlights),
      skip: clean(obj.skip),
      summary: typeof obj.summary === "string" ? obj.summary.slice(0, 800) : "",
      chapters: cleanChapters(obj.chapters),
      takeaways: cleanTakeaways(obj.takeaways),
      mentions: cleanMentions(obj.mentions),
    };
    // Don't fast-forward the part of the video the model never saw.
    if (truncated && duration - seenUpTo > 1) {
      out.highlights.push({ start: seenUpTo, end: duration });
    }
    return out;
  }

  // Turn the AI result into cut segments: skip the junk, speed the gaps
  // between highlights. (normalizeSegments gives skip precedence on overlap.)
  function segmentsFromAI(ai, duration) {
    const segs = ai.skip.map((s) => ({
      start: s.start,
      end: s.end,
      action: "skip",
      reason: s.reason ? "AI: " + s.reason : "AI cut",
    }));
    segs.push(...speedOutsideHighlights(ai.highlights, duration));
    return segs;
  }

  // Speed through everything outside the AI's highlights.
  function speedOutsideHighlights(highlights, duration) {
    if (!duration) return [];
    const MIN_GAP = 5; // shorter dull stretches aren't worth the rate flicker
    const keep = [...highlights].sort((a, b) => a.start - b.start);
    // Highlights covering almost none of the runtime mean the model's
    // highlight channel failed, not that the whole video is junk — speeding
    // "everything outside" would fast-forward the entire video. Skips still
    // apply, and the deterministic sources (heatmap, silence) keep providing
    // speed-throughs.
    const covered = keep.reduce((a, h) => a + Math.max(0, h.end - h.start), 0);
    if (covered < duration * 0.1) return [];
    const gaps = [];
    let cursor = 0;
    for (const h of keep) {
      if (h.start - cursor >= MIN_GAP) {
        gaps.push({ start: cursor, end: h.start, action: "speed", reason: "off-highlight" });
      }
      cursor = Math.max(cursor, h.end);
    }
    if (duration - cursor >= MIN_GAP) {
      gaps.push({ start: cursor, end: duration, action: "speed", reason: "off-highlight" });
    }
    return gaps;
  }

  /* ----- merge/normalise -----
   * Skips win over speeds only where they actually overlap: speed stretches
   * are clipped around skips, not swallowed by them. (The old version merged
   * any touching segments into one and turned the whole thing into a skip if
   * either half was one — a 10s sponsor skip touching a 3-minute speed
   * stretch skipped all three minutes.)
   */
  function normalizeSegments(segs, duration) {
    const clean = segs
      .map((s) => ({
        start: Math.max(0, +s.start),
        end: duration ? Math.min(duration, +s.end) : +s.end,
        action: s.action,
        reason: s.reason,
      }))
      .filter((s) => isFinite(s.start) && isFinite(s.end) && s.end - s.start > 0.5);

    // Union same-action segments, bridging small gaps so the playback rate
    // doesn't flicker across slivers.
    const mergeClass = (list, gap) => {
      const sorted = [...list].sort((a, b) => a.start - b.start);
      const out = [];
      for (const s of sorted) {
        const last = out[out.length - 1];
        if (last && s.start <= last.end + gap) {
          if (s.end > last.end) last.end = s.end;
        } else {
          out.push({ ...s });
        }
      }
      return out;
    };

    const skips = mergeClass(clean.filter((s) => s.action === "skip"), 1);
    const speeds = mergeClass(clean.filter((s) => s.action === "speed"), 3);

    // Clip each speed stretch against the skip set, splitting around skips.
    const clipped = [];
    for (const sp of speeds) {
      let pieces = [{ ...sp }];
      for (const sk of skips) {
        const next = [];
        for (const p of pieces) {
          if (sk.end <= p.start || sk.start >= p.end) {
            next.push(p);
            continue;
          }
          if (sk.start > p.start) next.push({ ...p, end: sk.start });
          if (sk.end < p.end) next.push({ ...p, start: sk.end });
        }
        pieces = next;
      }
      clipped.push(...pieces);
    }

    // Drop speed slivers left by clipping — not worth a rate change.
    return [...skips, ...clipped.filter((s) => s.end - s.start >= 4)].sort(
      (a, b) => a.start - b.start
    );
  }

  // ----- video category + title (for auto-ignoring music) -----
  const categoryWaiters = new Map(); // videoId -> fn({category, title})

  function getVideoCategory(videoId) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (info) => {
        if (settled) return;
        settled = true;
        categoryWaiters.delete(videoId);
        resolve(info);
      };
      // Early pokes can beat the player's data — only settle on a real
      // category; the timeout resolves null for uncategorised videos.
      categoryWaiters.set(videoId, (info) => {
        if (info && info.category) finish(info);
      });
      const poke = () => {
        if (!settled) {
          window.postMessage(
            { source: "yqn", type: "video-category", videoId },
            location.origin
          );
        }
      };
      poke();
      setTimeout(poke, 600);
      setTimeout(poke, 1400);
      setTimeout(() => finish(null), 2400);
    });
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
      setTimeout(poke, 3500);
      // Generous timeout: the API chain (next + get_transcript + captions)
      // can be slow, and giving up early forces the janky panel-scrape
      // fallback that touches the page.
      setTimeout(() => {
        if (!settled) {
          settled = true;
          autocutWaiters.delete(videoId);
          resolve({});
        }
      }, 12000);
    });
  }

  // ----- progress-bar markers -----
  function removeCutMarkers() {
    const el = document.getElementById("yqn-markers");
    if (el) el.remove();
  }

  function renderCutMarkers() {
    removeCutMarkers();
    const chapters = (cutPlan && cutPlan.chapters) || [];
    if (!settings.autoCut || !cutPlan || (!cutPlan.segments.length && !chapters.length))
      return;
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
    // AI chapter ticks (skip the one at 0 — it'd just mark the bar's edge).
    for (const c of chapters) {
      if (c.start < 1) continue;
      const t = document.createElement("div");
      t.className = "yqn-chap-tick";
      t.style.left = (100 * c.start) / dur + "%";
      t.title = c.title;
      wrap.appendChild(t);
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
      (cutPlan.segments.length || (cutPlan.chapters && cutPlan.chapters.length))
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
    if (settings.autoCut) {
      // startAutoCut owns the ignore-state derivation (user list + music +
      // short checks). Don't also refresh it here — the two async writes
      // raced, and this one could clobber the derived auto state.
      startAutoCut();
    } else {
      // Auto-Cut off: keep the Ignore button state fresh for the panel.
      const vid = getVideoId();
      isVideoIgnored(vid).then((ig) => {
        if (getVideoId() === vid && !settings.autoCut) {
          cutIgnored = ig;
          cutIgnoredAuto = false;
          cutIgnoredWhy = null;
          updateCutButton();
        }
      });
    }
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
        "autoCutPlus",
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
      // speedOnly / autoIgnoreMusic / minCutMinutes change how a plan is
      // applied, not the analysis — re-derive from cache instead of clearing.
      if (
        ("speedOnly" in changes ||
          "autoIgnoreMusic" in changes ||
          "minCutMinutes" in changes) &&
        !cutChanged
      ) {
        cutPlanningFor = null;
        cutPlan = null;
        removeCutMarkers();
        const v = getVideoEl();
        if (v && v.playbackRate !== 1) v.playbackRate = 1;
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

  // Keyboard shortcut: Shift+C toggles Auto-Cut on watch pages.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.defaultPrevented) return;
      if (e.code !== "KeyC" || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (!isWatchPage()) return;
      const el = document.activeElement;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      e.stopPropagation();
      toggleAutoCut();
      updateCutButton();
      renderCutPanelIfOpen();
    },
    true
  );

  // SPA navigation hooks.
  window.addEventListener("yt-navigate-finish", run);
  document.addEventListener("yt-page-data-updated", run);

  loadSettings().then(() => {
    syncDebugToPage();
    run();
  });
})();
