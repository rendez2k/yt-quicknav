importScripts("video-tools-model.js", "usage-ledger.js", "plan-cache.js", "prepare-worker.js");

/* YouTube Quick Nav + Cinema — background fetch proxy.
 * Content scripts run in the page's origin, so their cross-origin calls are
 * subject to the page's CORS rules — which blocks APIs that don't send CORS
 * headers (TypeSafe/Jev). A service worker's fetches use the extension's
 * host_permissions instead and are not CORS-bound. This proxy is restricted
 * to the extension's own API hosts.
 */

const ALLOWED_HOSTS = ["https://api.typesafe.ai/", "https://api.anthropic.com/", "https://sponsor.ajay.app/"];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || (msg.type !== "yqn-proxy-fetch" && msg.type !== "yqn-storyboard")) return;
  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "unauthorized sender" });
    return;
  }
  if (msg.type === "yqn-storyboard") {
    decodeStoryboard(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: (e && e.message) || "decode failed" }));
    return true;
  }

  let url;
  try {
    url = new URL(msg.url).href;
  } catch {
    sendResponse({ ok: false, error: "bad url" });
    return;
  }
  if (!ALLOWED_HOSTS.some((prefix) => url.startsWith(prefix))) {
    sendResponse({ ok: false, error: "host not allowed" });
    return;
  }

  (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), url.startsWith("https://sponsor.ajay.app/") ? 5000 : 90000);
    try {
      const res = await fetch(url, { ...msg.options, signal: controller.signal, redirect: "error" });
      let body = null;
      let errorText = "";
      if (typeof res.text === "function") {
        const raw = await res.text();
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            errorText = raw.trim().slice(0, 200);
          }
        }
      } else if (typeof res.json === "function") {
        try {
          body = await res.json();
        } catch {}
      }
      sendResponse({ ok: res.ok, status: res.status, body, ...(errorText ? { errorText } : {}) });
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || "fetch failed" });
    } finally {
      clearTimeout(timeout);
    }
  })();
  return true; // response is async
});

/* Storyboard decoding — YouTube's seek-preview sprite sheets on i.ytimg.com
 * carry no CORS headers, so pixels can only be read here. "signatures" mode
 * returns a 16×9 greyscale fingerprint per frame (for local stillness
 * checks); "frames" mode returns a few small JPEG frames for the optional
 * Claude look at silent stretches. */
const STORYBOARD_PREFIX = "https://i.ytimg.com/sb/";

async function loadSheet(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "error", credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await createImageBitmap(await res.blob());
  } finally {
    clearTimeout(timer);
  }
}

async function decodeStoryboard(msg) {
  const cols = Math.floor(msg.cols), rows = Math.floor(msg.rows), count = Math.floor(msg.count);
  const w = Math.floor(msg.width), h = Math.floor(msg.height);
  const sheets = Array.isArray(msg.sheets) ? msg.sheets.slice(0, 40) : [];
  if (![cols, rows, count, w, h].every((n) => n > 0 && n <= 2000) || !sheets.length ||
      !sheets.every((u) => typeof u === "string" && u.startsWith(STORYBOARD_PREFIX))) {
    return { ok: false, error: "bad storyboard request" };
  }
  const perSheet = cols * rows;
  const cell = (bitmap, index) => {
    const k = index % perSheet;
    return [(k % cols) * w, Math.floor(k / cols) * h];
  };
  if (msg.mode === "signatures") {
    const canvas = new OffscreenCanvas(16, 9), ctx = canvas.getContext("2d", { willReadFrequently: true });
    const signatures = [];
    for (let j = 0; j < sheets.length && signatures.length < count; j++) {
      const bitmap = await loadSheet(sheets[j]);
      for (let k = 0; k < perSheet && signatures.length < count; k++) {
        const [sx, sy] = cell(bitmap, k);
        if (sx + w > bitmap.width || sy + h > bitmap.height) break;
        ctx.drawImage(bitmap, sx, sy, w, h, 0, 0, 16, 9);
        const px = ctx.getImageData(0, 0, 16, 9).data, sig = new Array(144);
        for (let p = 0; p < 144; p++) sig[p] = Math.round(0.299 * px[p * 4] + 0.587 * px[p * 4 + 1] + 0.114 * px[p * 4 + 2]);
        signatures.push(sig);
      }
      bitmap.close?.();
    }
    return { ok: true, signatures };
  }
  if (msg.mode === "frames") {
    const wanted = [...new Set((msg.frames || []).map(Math.floor).filter((i) => i >= 0 && i < count))].slice(0, 24);
    const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext("2d");
    const frames = {};
    for (const j of [...new Set(wanted.map((i) => Math.floor(i / perSheet)))]) {
      if (!sheets[j]) continue;
      const bitmap = await loadSheet(sheets[j]);
      for (const i of wanted.filter((i) => Math.floor(i / perSheet) === j)) {
        const [sx, sy] = cell(bitmap, i);
        if (sx + w > bitmap.width || sy + h > bitmap.height) continue;
        ctx.drawImage(bitmap, sx, sy, w, h, 0, 0, w, h);
        const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 })).arrayBuffer());
        let bin = "";
        for (let b = 0; b < bytes.length; b++) bin += String.fromCharCode(bytes[b]);
        frames[i] = btoa(bin);
      }
      bitmap.close?.();
    }
    return { ok: true, frames };
  }
  return { ok: false, error: "unknown mode" };
}

chrome.commands?.onCommand?.addListener((command) => {
  try {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null) return;
      chrome.tabs.sendMessage(tab.id, { type: "yqn-command", command }, () => void chrome.runtime.lastError);
    });
  } catch {}
});

const UPDATE_ALARM = "yqn-update-check";
const UPDATE_STORAGE_KEY = "yqnUpdateStatusV1";
const UPDATE_TTL_MS = 12 * 60 * 60 * 1000;

function applyUpdateBadge(hasUpdate) {
  try {
    chrome.action?.setBadgeText?.({ text: hasUpdate ? "↑" : "" });
    if (hasUpdate) chrome.action?.setBadgeBackgroundColor?.({ color: "#0a8f3c" });
  } catch {}
}

async function syncCachedUpdateBadge() {
  try {
    const currentVersion = chrome.runtime?.getManifest?.()?.version || "0.0.0";
    const stored = await chrome.storage.local.get(UPDATE_STORAGE_KEY);
    const cached = stored?.[UPDATE_STORAGE_KEY];
    if (!cached || typeof cached !== "object") return;
    const stillNewer = cached.latestVersion && YqnToolsModel.compareSemver(cached.latestVersion, currentVersion) > 0;
    if (!stillNewer && cached.hasUpdate) {
      await chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: { ...cached, currentVersion, hasUpdate: false } });
    }
    applyUpdateBadge(!!stillNewer);
  } catch {}
}

async function runPeriodicUpdateCheck() {
  try {
    const currentVersion = chrome.runtime?.getManifest?.()?.version || "0.0.0";
    const stored = await chrome.storage.local.get(UPDATE_STORAGE_KEY);
    const cached = stored?.[UPDATE_STORAGE_KEY];
    if (cached && Number.isFinite(cached.checkedAt) && Date.now() - cached.checkedAt < UPDATE_TTL_MS) {
      const stillNewer = cached.latestVersion && YqnToolsModel.compareSemver(cached.latestVersion, currentVersion) > 0;
      applyUpdateBadge(!!stillNewer);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`https://api.github.com/repos/${YqnToolsModel.GITHUB_REPO}/releases/latest`, {
        headers: { accept: "application/vnd.github+json" },
        signal: controller.signal,
      });
      if (!res.ok) return;
      const json = await res.json();
      const parsed = YqnToolsModel.parseReleaseUpdate(json, currentVersion, YqnToolsModel.GITHUB_REPO);
      if (!parsed.valid) return;
      const next = { ...parsed, checkedAt: Date.now() };
      await chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: next });
      applyUpdateBadge(next.hasUpdate);
    } finally {
      clearTimeout(timer);
    }
  } catch {}
}

try {
  chrome.alarms?.create?.(UPDATE_ALARM, { delayInMinutes: 15, periodInMinutes: 720 });
  chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm && alarm.name === UPDATE_ALARM) void runPeriodicUpdateCheck();
  });
  void syncCachedUpdateBadge();
} catch {}
