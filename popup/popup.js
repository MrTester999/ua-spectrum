const els = {
  enabled: document.getElementById("enabled"), statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"), catalogCount: document.getElementById("catalogCount"),
  identity: document.getElementById("identity"), currentUa: document.getElementById("currentUa"),
  coverageText: document.getElementById("coverageText"), siteBadge: document.getElementById("siteBadge"),
  coverageValue: document.getElementById("coverageValue"), coverageFill: document.getElementById("coverageFill"),
  coverageTrack: document.querySelector(".coverage-track"),
  browserValue: document.getElementById("browserValue"), platformValue: document.getElementById("platformValue"),
  policyValue: document.getElementById("policyValue"), changedValue: document.getElementById("changedValue"),
  copyUa: document.getElementById("copyUa"), rotate: document.getElementById("rotate"),
  rotateAll: document.getElementById("rotateAll"), lockIdentity: document.getElementById("lockIdentity"),
  toggleSite: document.getElementById("toggleSite"), mode: document.getElementById("mode"),
  browsers: document.getElementById("browsers"), platforms: document.getElementById("platforms"),
  excluded: document.getElementById("excluded"), save: document.getElementById("save"),
  exportSettings: document.getElementById("exportSettings"),
  importSettings: document.getElementById("importSettings"),
  settingsFile: document.getElementById("settingsFile"),
  toast: document.getElementById("toast")
};

const MODE_LABELS = {
  navigation: "Per navigation",
  focus: "On focus",
  tab: "Per tab",
  interval30: "Every 30 sec",
  interval300: "Every 5 min"
};

let tabId = null;
let state = null;
let toastTimer = null;
let formSignature = "";

async function call(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, tabId, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Action failed");
  return response.data;
}

function toast(message, error = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", error);
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function renderChips(host, values, selected) {
  host.replaceChildren();
  for (const value of values) {
    const label = document.createElement("label");
    label.className = "chip";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.checked = selected.includes(value);
    const text = document.createElement("span");
    text.textContent = value;
    label.append(input, text);
    host.append(label);
  }
}

function selected(host) {
  return [...host.querySelectorAll("input:checked")].map((input) => input.value);
}

function relativeTime(timestamp) {
  if (!timestamp) return "Native";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function settingsSignature(settings, stats) {
  return JSON.stringify({
    mode: settings.mode,
    browsers: settings.browsers,
    platforms: settings.platforms,
    excludedDomains: settings.excludedDomains,
    catalogBrowsers: stats.browsers,
    catalogPlatforms: stats.platforms
  });
}

function renderSettings(force = false) {
  const { settings, stats } = state;
  const signature = settingsSignature(settings, stats);
  if (!force && signature === formSignature) return;
  formSignature = signature;
  els.mode.value = settings.mode;
  els.excluded.value = (settings.excludedDomains || []).join("\n");
  renderChips(els.browsers, stats.browsers, settings.browsers || []);
  renderChips(els.platforms, stats.platforms, settings.platforms || []);
}

function renderLive() {
  const { settings, current, stats, nativeUa, tab, coverage } = state;
  els.enabled.checked = settings.enabled;
  const active = Boolean(settings.enabled && current && tab.eligible && !tab.excluded);
  els.statusDot.classList.toggle("on", active);
  els.statusDot.classList.toggle("warning", settings.enabled && !active);
  els.statusText.textContent = active
    ? "Network identity protected"
    : settings.enabled ? "Waiting for eligible page" : "Spoofing disabled";
  els.coverageText.textContent = active
    ? current.locked
      ? "Identity locked · automatic rotation paused for this tab"
      : "Applied to every HTTP(S) request in this tab"
    : tab.excluded ? "This site is excluded" : "Native browser identity is in use";
  els.catalogCount.textContent = `${stats.total.toLocaleString()} agents`;
  els.rotate.disabled = !settings.enabled || !tab.eligible || tab.excluded || Boolean(current?.locked);
  els.rotateAll.disabled = !settings.enabled || coverage.eligible === 0;
  els.lockIdentity.disabled = !active;
  els.lockIdentity.classList.toggle("active", Boolean(active && current.locked));
  els.lockIdentity.setAttribute("aria-pressed", String(Boolean(active && current.locked)));
  els.lockIdentity.innerHTML = current?.locked
    ? "<span>◇</span> Unlock identity"
    : "<span>◆</span> Lock identity";
  els.toggleSite.disabled = !tab.eligible || !tab.hostname;
  els.toggleSite.classList.toggle("warning", Boolean(tab.excluded));
  els.toggleSite.innerHTML = tab.excluded
    ? "<span>✓</span> Include this site"
    : "<span>⊘</span> Exclude this site";

  const eligible = coverage.eligible || 0;
  const protectedCount = coverage.protected || 0;
  const percent = eligible ? Math.round((protectedCount / eligible) * 100) : 0;
  els.coverageValue.textContent = `${protectedCount} / ${eligible} protected`;
  els.coverageFill.style.width = `${percent}%`;
  els.coverageTrack.setAttribute("aria-valuenow", String(percent));
  els.coverageTrack.classList.toggle("complete", Boolean(eligible && protectedCount === eligible));

  if (active) {
    els.identity.classList.remove("empty");
    els.identity.textContent = `${current.browser} · ${current.platform}`;
    els.currentUa.textContent = current.ua;
    els.browserValue.textContent = current.browser;
    els.platformValue.textContent = current.platform;
    els.changedValue.textContent = relativeTime(current.changedAt);
  } else {
    els.identity.classList.add("empty");
    els.identity.textContent = tab.excluded
      ? "Native identity · excluded site"
      : settings.enabled
        ? "Open an HTTP(S) page to assign an identity."
        : "Native User-Agent";
    els.currentUa.textContent = nativeUa || "No User-Agent available";
    els.browserValue.textContent = "Native";
    els.platformValue.textContent = "System";
    els.changedValue.textContent = "Native";
  }
  els.policyValue.textContent = settings.enabled ? MODE_LABELS[settings.mode] || settings.mode : "Off";
  els.siteBadge.textContent = tab.hostname || "Internal page";
  els.siteBadge.classList.toggle("excluded", tab.excluded);
}

function render(forceSettings = false) {
  renderSettings(forceSettings);
  renderLive();
}

els.enabled.addEventListener("change", async () => {
  try {
    state = await call("setEnabled", { enabled: els.enabled.checked });
    render();
    toast(els.enabled.checked ? "Protection enabled on all eligible tabs" : "Spoofing disabled");
  } catch (error) {
    els.enabled.checked = !els.enabled.checked;
    toast(error.message, true);
  }
});

els.rotate.addEventListener("click", async () => {
  try {
    state = await call("rotateNow");
    renderLive();
    toast("Current tab identity rotated");
  } catch (error) { toast(error.message, true); }
});

els.rotateAll.addEventListener("click", async () => {
  try {
    els.rotateAll.disabled = true;
    state = await call("rotateAll");
    renderLive();
    toast(`Rotated ${state.coverage.protected} protected tabs`);
  } catch (error) { toast(error.message, true); }
  finally { els.rotateAll.disabled = !state?.settings?.enabled || !state?.coverage?.eligible; }
});

els.lockIdentity.addEventListener("click", async () => {
  try {
    const locked = !state?.current?.locked;
    state = await call("setLocked", { locked });
    renderLive();
    toast(locked ? "Identity locked for this tab" : "Automatic rotation restored");
  } catch (error) { toast(error.message, true); }
});

els.toggleSite.addEventListener("click", async () => {
  try {
    const wasExcluded = Boolean(state?.tab?.excluded);
    state = await call("toggleSiteExclusion");
    render(true);
    toast(wasExcluded ? "Site included in protection" : "Site added to exclusions");
  } catch (error) { toast(error.message, true); }
});

els.copyUa.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.currentUa.textContent);
    els.copyUa.textContent = "Copied";
    toast("User-Agent copied");
    setTimeout(() => { els.copyUa.textContent = "Copy"; }, 1200);
  } catch { toast("Unable to copy User-Agent", true); }
});

els.save.addEventListener("click", async () => {
  const browsers = selected(els.browsers);
  const platforms = selected(els.platforms);
  if (!browsers.length || !platforms.length) return toast("Choose at least one browser and platform", true);
  const excludedDomains = els.excluded.value.split(/[\n,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  try {
    state = await call("saveSettings", {
      patch: { mode: els.mode.value, browsers, platforms, excludedDomains }
    });
    render(true);
    toast("Configuration applied to all tabs");
  } catch (error) { toast(error.message, true); }
});

els.exportSettings.addEventListener("click", () => {
  try {
    const payload = {
      app: "UA Spectrum",
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      settings: state.settings
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ua-spectrum-settings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Settings exported");
  } catch (error) { toast(error.message, true); }
});

els.importSettings.addEventListener("click", () => els.settingsFile.click());

els.settingsFile.addEventListener("change", async () => {
  const [file] = els.settingsFile.files || [];
  els.settingsFile.value = "";
  if (!file) return;
  try {
    const value = JSON.parse(await file.text());
    state = await call("importSettings", { value });
    render(true);
    toast("Settings imported and applied");
  } catch (error) {
    toast(error instanceof SyntaxError ? "Invalid settings JSON" : error.message, true);
  }
});

void (async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  state = await call("getState");
  render(true);
  setInterval(async () => {
    try {
      state = await call("getState");
      renderLive();
    } catch { /* Popup may be closing. */ }
  }, 5000);
})().catch((error) => toast(error.message, true));
