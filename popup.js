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
  showCut: true,
  autoCut: false,
  cutMessaging: true,
  cutBoring: true,
  autoCutPlus: false,
  aiHighlights: false,
  anthropicKey: "",
  aiModel: "claude-haiku-4-5-20251001",
  speedRate: 3,
  debug: false,
};

// Fields that are text/number inputs rather than checkboxes.
const VALUE_FIELDS = { anthropicKey: "string", speedRate: "number" };

chrome.storage.sync.get(DEFAULTS, (settings) => {
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    if (!el) continue;

    if (VALUE_FIELDS[key]) {
      el.value = settings[key];
      el.addEventListener("change", () => {
        const val =
          VALUE_FIELDS[key] === "number" ? Number(el.value) || DEFAULTS[key] : el.value;
        chrome.storage.sync.set({ [key]: val });
      });
    } else {
      el.checked = !!settings[key];
      el.addEventListener("change", () => {
        chrome.storage.sync.set({ [key]: el.checked });
      });
    }
  }
});
