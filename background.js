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
  if (!msg || msg.type !== "yqn-proxy-fetch") return;
  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "unauthorized sender" });
    return;
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
