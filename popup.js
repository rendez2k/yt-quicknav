const DEFAULTS = { ...YqnControls.defaults };

// Fields that are text/number/select inputs rather than checkboxes.
const VALUE_FIELDS = {
  cutPreset: "string",
  tldrDepth: "string",
  prepareBatchSize: "number",
  aiDailyBudget: "number",
  aiVideoBudget: "number",
  jevInputPrice: "number",
  anthropicKey: "string",
  typesafeKey: "string",
  speedRate: "number",
  aiModel: "string",
  minCutMinutes: "number",
  volumeBoost: "number",
};

// Reset the per-video ignore + music/short override lists (stored locally).
const clearBtn = document.getElementById("clearIgnores");
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    chrome.storage.local.remove(["cutIgnoreV1", "cutAllowV1"], () => {
      clearBtn.textContent = "Cleared ✓";
      setTimeout(() => (clearBtn.textContent = "Reset list"), 1500);
    });
  });
}

let applyPopupSettings = null;

chrome.storage.sync.get(DEFAULTS, (settings) => {
  const hint = document.getElementById("presetHint");
  const showPreset = (id) => {
    if (hint) hint.textContent = (YqnControls.presets[id]?.description || "") +
      " Defaults apply unless a channel has saved settings. Presets keep your AI switches unchanged.";
  };
  applyPopupSettings = (patch) => {
    for (const [k, v] of Object.entries(patch)) {
      settings[k] = v;
      const input = document.getElementById(k);
      if (input) { if (VALUE_FIELDS[k]) input.value = v; else input.checked = !!v; }
    }
    showPreset(settings.cutPreset);
  };
  showPreset(settings.cutPreset);
  const save = (key, value) => {
    const patch = key === "cutPreset" ? YqnControls.presetPatch(value) :
      { [key]: value, ...(YqnControls.presetKeys.includes(key) ? {cutPreset:"custom"} : {}) };
    applyPopupSettings(patch);
    chrome.storage.sync.set(patch);
  };
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    if (!el) continue;

    if (VALUE_FIELDS[key]) {
      el.value = settings[key];
      el.addEventListener("change", () => {
        // Zero is a legitimate value (e.g. minCutMinutes 0 = disabled), so
        // only fall back to the default on empty/invalid input.
        let val =
          VALUE_FIELDS[key] === "number"
            ? el.value === "" || isNaN(+el.value)
              ? DEFAULTS[key]
              : +el.value
            : el.value.trim();
        if (VALUE_FIELDS[key] === "number") {
          if (el.min !== "" && el.min != null) val = Math.max(Number(el.min), val);
          if (el.max !== "" && el.max != null) val = Math.min(Number(el.max), val);
          el.value = val;
        }
        save(key, val);
      });
    } else {
      el.checked = !!settings[key];
      el.addEventListener("change", () => {
        save(key, el.checked);
      });
    }
  }
});

/* ---------- API key tests ----------
 * One minimal real call per service — the cheapest request that still
 * exercises auth. 401 means the key itself is bad; getting past auth (even
 * to a rate limit or validation error) proves the key is real. Runs from
 * the popup, where host_permissions allow these calls directly.
 */
function setupKeyTest(testId, inputId, statusId, call) {
  const btn = document.getElementById(testId);
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);
  if (!btn || !input || !status) return;
  btn.addEventListener("click", async () => {
    const key = input.value.trim();
    if (!key) {
      status.textContent = "Enter a key first";
      status.className = "keystatus err";
      return;
    }
    status.textContent = "Testing…";
    status.className = "keystatus";
    btn.disabled = true;
    try {
      status.textContent = await call(key);
      status.className = "keystatus ok";
    } catch (e) {
      status.textContent = "✗ " + (e && e.message ? e.message : "request failed");
      status.className = "keystatus err";
    } finally {
      btn.disabled = false;
    }
  });
}

setupKeyTest("testAnthropicKey", "anthropicKey", "anthropicKeyStatus", async (key) => {
  const res = await YqnAI.request("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: document.getElementById("aiModel").value || DEFAULTS.aiModel,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
  }, "key-test");
  refreshUsage();
  if (res.ok) return "✓ Key works";
  if (res.status === 401) throw new Error("Invalid key (401)");
  throw new Error(`Test did not succeed (HTTP ${res.status}); check the selected model and account, then retry`);
});

setupKeyTest("testTypesafeKey", "typesafeKey", "typesafeKeyStatus", async (key) => {
  const res = await YqnAI.request("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + key,
    },
    body: JSON.stringify({
      state: "The sky is blue.",
      model: "jev-latest",
      questions: { ok: { type: "noul", instructions: "The sky is blue" } },
    }),
  }, "key-test");
  refreshUsage();
  if (res.ok) return "✓ Key works";
  if (res.status === 401) throw new Error("Invalid key (401)");
  throw new Error(`Test did not succeed (HTTP ${res.status}); retry when the service is available`);
});

async function refreshUsage() {
  const target=document.getElementById('aiUsage');
  try {const u=await YqnAI.usage('key-test');target.textContent='Today: $'+u.today.usd.toFixed(4)+(u.today.unpriced?' + unpriced calls':'')+' · '+u.today.calls+' calls · '+u.today.uncertain+' estimated/pending. Usage shown for this extension only.';}
  catch {target.textContent='Usage unavailable. Reopen the popup to retry.';}
}
document.getElementById('refreshUsage').addEventListener('click',refreshUsage);
refreshUsage();

async function refreshPreparation(){
  const target=document.getElementById('preparationStatus');
  try{const r=await chrome.runtime.sendMessage({type:'yqn-prepare-status'});target.textContent=r.message||'Not started';}catch{target.textContent='Preparation unavailable; reload the extension.';}
}
for(const [id,type] of [['prepareNow','yqn-prepare-start'],['prepareStop','yqn-prepare-stop']]){
  document.getElementById(id).addEventListener('click',async()=>{
    try{const r=await chrome.runtime.sendMessage({type});if(!r?.ok){document.getElementById('preparationStatus').textContent=r?.error||'Preparation unavailable';return;}await refreshPreparation();}catch{document.getElementById('preparationStatus').textContent='Preparation unavailable';}
  });
}
function formatSavedDuration(sec) {
  const s = Math.max(0, Math.round(+sec || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return rem > 0 && m < 10 ? `${m}m ${rem}s` : `${m}m`;
}

async function refreshTimeSaved() {
  const todayEl = document.getElementById("savedToday");
  const weekEl = document.getElementById("savedWeek");
  const totalEl = document.getElementById("savedTotal");
  const breakdownEl = document.getElementById("savedBreakdown");
  if (!todayEl || !weekEl || !totalEl || !breakdownEl) return;
  try {
    const store = await chrome.storage.local.get("yqnLifetimeSavingsV1");
    const s = YqnControls.summarizeLifetimeSavings(store?.yqnLifetimeSavingsV1);
    todayEl.textContent = formatSavedDuration(s.todaySec);
    weekEl.textContent = formatSavedDuration(s.weekSec);
    totalEl.textContent = formatSavedDuration(s.allTimeSec);
    if (s.allTimeSec >= 1) {
      const parts = [];
      if (s.breakdown.skip >= 1) parts.push(`Skips ${formatSavedDuration(s.breakdown.skip)}`);
      if (s.breakdown.speed >= 1) parts.push(`Speed-ups ${formatSavedDuration(s.breakdown.speed)}`);
      if (s.breakdown.silence >= 1) parts.push(`Dead air ${formatSavedDuration(s.breakdown.silence)}`);
      if (s.breakdown.reel >= 1) parts.push(`TL;DR ${formatSavedDuration(s.breakdown.reel)}`);
      if (s.videosCount > 0) parts.push(`${s.videosCount} video${s.videosCount === 1 ? "" : "s"}`);
      breakdownEl.textContent = parts.join(" · ");
    } else {
      breakdownEl.textContent = "Watch videos with Auto-Cut or TL;DR to track time saved.";
    }
  } catch {
    breakdownEl.textContent = "Time saved unavailable.";
  }
}

const resetSavedBtn = document.getElementById("resetTimeSaved");
resetSavedBtn?.addEventListener("click", () => {
  chrome.storage.local.remove("yqnLifetimeSavingsV1", () => {
    void refreshTimeSaved();
    resetSavedBtn.textContent = "Cleared ✓";
    setTimeout(() => { resetSavedBtn.textContent = "Reset"; }, 1400);
  });
});

chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes.yqnPreparationV1)void refreshPreparation();
  if(area==='local'&&('yqnLifetimeSavingsV1' in changes))void refreshTimeSaved();
});
void refreshPreparation();
void refreshTimeSaved();

const UPDATE_STORAGE_KEY = "yqnUpdateStatusV1";
const UPDATE_TTL_MS = 12 * 60 * 60 * 1000;
const currentExtVersion = chrome.runtime?.getManifest?.()?.version || "1.45.1";
const extVersionEl = document.getElementById("extVersion");
if (extVersionEl) extVersionEl.textContent = `v${currentExtVersion}`;

function renderUpdateBanner(info) {
  const banner = document.getElementById("updateBanner");
  const titleEl = document.getElementById("updateTitle");
  const summaryEl = document.getElementById("updateSummary");
  const dlLink = document.getElementById("updateDownloadLink");
  const notesLink = document.getElementById("updateNotesLink");
  if (!banner || !titleEl || !dlLink || !notesLink) return;
  const active = !!(
    info &&
    info.latestVersion &&
    YqnToolsModel.compareSemver(info.latestVersion, currentExtVersion) > 0
  );
  banner.hidden = !active;
  try {
    chrome.action?.setBadgeText?.({ text: active ? "↑" : "" });
    if (active) chrome.action?.setBadgeBackgroundColor?.({ color: "#0a8f3c" });
  } catch {}
  if (!active) return;
  titleEl.textContent = `⬆ Update v${info.latestVersion} available`;
  if (summaryEl) {
    summaryEl.textContent = info.summary || "";
    summaryEl.hidden = !info.summary;
  }
  dlLink.href = info.zipUrl || `https://github.com/${YqnToolsModel.GITHUB_REPO}/releases/latest`;
  notesLink.href = info.releaseUrl || `https://github.com/${YqnToolsModel.GITHUB_REPO}/releases/latest`;
}

async function checkExtensionUpdate({ force = false } = {}) {
  try {
    const stored = await chrome.storage.local.get(UPDATE_STORAGE_KEY);
    const cached = stored?.[UPDATE_STORAGE_KEY];
    if (cached && typeof cached === "object") {
      renderUpdateBanner(cached);
      if (!force && Number.isFinite(cached.checkedAt) && Date.now() - cached.checkedAt < UPDATE_TTL_MS) {
        return cached;
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`https://api.github.com/repos/${YqnToolsModel.GITHUB_REPO}/releases/latest`, {
        headers: { accept: "application/vnd.github+json" },
        signal: controller.signal,
      });
      if (res.status === 404) {
        const empty = { valid: false, hasUpdate: false, currentVersion: currentExtVersion, latestVersion: "", checkedAt: Date.now() };
        await chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: empty });
        renderUpdateBanner(empty);
        return empty;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const parsed = YqnToolsModel.parseReleaseUpdate(json, currentExtVersion, YqnToolsModel.GITHUB_REPO);
      const next = { ...parsed, checkedAt: Date.now() };
      await chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: next });
      renderUpdateBanner(next);
      return next;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

const checkUpdatesBtn = document.getElementById("checkUpdatesBtn");
checkUpdatesBtn?.addEventListener("click", async () => {
  checkUpdatesBtn.disabled = true;
  checkUpdatesBtn.textContent = "Checking…";
  const info = await checkExtensionUpdate({ force: true });
  checkUpdatesBtn.disabled = false;
  if (!info) {
    checkUpdatesBtn.textContent = "Offline";
  } else if (info.latestVersion && YqnToolsModel.compareSemver(info.latestVersion, currentExtVersion) > 0) {
    checkUpdatesBtn.textContent = `v${info.latestVersion} ready`;
  } else {
    checkUpdatesBtn.textContent = "Up to date ✓";
  }
  setTimeout(() => {
    if (checkUpdatesBtn) checkUpdatesBtn.textContent = "Check updates";
  }, 2200);
});
void checkExtensionUpdate({ force: false });

document.getElementById("openExtensionsBtn")?.addEventListener("click", () => {
  try {
    chrome.tabs.create({ url: "chrome://extensions" });
  } catch {}
});

document.getElementById("openShortcuts")?.addEventListener("click", () => {
  try {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  } catch {}
});

document.getElementById("exportBackup")?.addEventListener("click", async () => {
  const status = document.getElementById("backupStatus");
  try {
    const [syncStore, localStore] = await Promise.all([
      chrome.storage.sync.get(DEFAULTS),
      chrome.storage.local.get(null),
    ]);
    const backup = YqnToolsModel.buildBackup(syncStore, localStore, DEFAULTS);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `youtube-quick-nav-backup-${YqnToolsModel.day()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    if (status) status.textContent = "Backup exported (API keys excluded).";
  } catch (e) {
    if (status) status.textContent = (e && e.message) || "Could not export backup.";
  }
});

const importBtn = document.getElementById("importBackup");
const importFile = document.getElementById("importBackupFile");
importBtn?.addEventListener("click", () => importFile?.click());
importFile?.addEventListener("change", async () => {
  const file = importFile.files && importFile.files[0];
  importFile.value = "";
  if (!file) return;
  const status = document.getElementById("backupStatus");
  try {
    const raw = await file.text();
    const parsed = YqnToolsModel.parseBackup(raw, DEFAULTS);
    if (Object.keys(parsed.syncPatch).length) await chrome.storage.sync.set(parsed.syncPatch);
    if (Object.keys(parsed.localPatch).length) await chrome.storage.local.set(parsed.localPatch);
    applyPopupSettings?.(parsed.syncPatch);
    void refreshTimeSaved();
    const s = parsed.summary;
    if (status) {
      status.textContent = `Restored ${s.settingsCount} settings, ${s.channelsCount} channels, ${s.videosEditedCount} video overrides and ${s.notesCount} notes.`;
    }
  } catch (e) {
    if (status) status.textContent = (e && e.message) || "Could not import backup.";
  }
});
