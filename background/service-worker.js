import { catalogStats, pickAgent } from "../lib/catalog.js";

const SETTINGS_KEY = "settings";
const TAB_STATE_KEY = "tabAgents";
const RULE_BASE = 10000;
const ROTATION_ALARM = "ua-rotation";
const HEALTH_ALARM = "ua-health";
const SUPPORTED_MODES = new Set(["navigation", "focus", "tab", "interval30", "interval300"]);
const ALL_RESOURCES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object",
  "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport",
  "webbundle", "other"
];

const DEFAULTS = {
  enabled: false,
  mode: "tab",
  browsers: ["Chrome", "Firefox", "Edge", "Safari"],
  platforms: ["Windows", "Linux", "macOS", "Android", "iOS"],
  excludedDomains: ["localhost", "127.0.0.1"]
};

const BADGES = {
  Chrome: { text: "CH", color: "#2563eb" },
  Edge: { text: "ED", color: "#0f9d8f" },
  Firefox: { text: "FF", color: "#e55b13" },
  Safari: { text: "SF", color: "#4385f5" }
};

let updateChain = Promise.resolve();

function queue(task) {
  const run = updateChain.then(task, task);
  updateChain = run.catch(() => {});
  return run;
}

async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULTS, ...(data[SETTINGS_KEY] || {}) };
}

async function saveSettings(patch) {
  if (Array.isArray(patch.excludedDomains)) {
    patch = {
      ...patch,
      excludedDomains: [...new Set(patch.excludedDomains.map((value) => {
        const raw = String(value || "").trim().toLowerCase();
        if (!raw) return "";
        try {
          return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
        } catch {
          return raw.replace(/^\.+|\.+$/g, "").split("/")[0].split(":")[0];
        }
      }).filter(Boolean))]
    };
  }
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

function importableSettings(value) {
  const source = value?.settings && typeof value.settings === "object" ? value.settings : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Settings file must contain a JSON object");
  }
  const stats = catalogStats();
  const browsers = Array.isArray(source.browsers)
    ? source.browsers.filter((value) => stats.browsers.includes(value))
    : DEFAULTS.browsers;
  const platforms = Array.isArray(source.platforms)
    ? source.platforms.filter((value) => stats.platforms.includes(value))
    : DEFAULTS.platforms;
  if (!browsers.length || !platforms.length) {
    throw new Error("Imported settings must include at least one browser and platform");
  }
  return {
    enabled: Boolean(source.enabled),
    mode: SUPPORTED_MODES.has(source.mode) ? source.mode : DEFAULTS.mode,
    browsers: [...new Set(browsers)],
    platforms: [...new Set(platforms)],
    excludedDomains: Array.isArray(source.excludedDomains) ? source.excludedDomains : DEFAULTS.excludedDomains
  };
}

async function getTabStates() {
  const data = await chrome.storage.session.get(TAB_STATE_KEY);
  return data[TAB_STATE_KEY] || {};
}

async function setTabStates(states) {
  await chrome.storage.session.set({ [TAB_STATE_KEY]: states });
}

function ruleId(tabId) {
  return RULE_BASE + tabId;
}

function validTab(tab) {
  const url = tab?.url || tab?.pendingUrl || "";
  return Number.isInteger(tab?.id) && !tab.incognito && /^https?:\/\//i.test(url);
}

function hostnameFor(tab) {
  try { return new URL(tab?.url || tab?.pendingUrl || "").hostname.toLowerCase(); }
  catch { return ""; }
}

function domainMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isExcluded(tab, settings) {
  const hostname = hostnameFor(tab);
  return Boolean(hostname && (settings.excludedDomains || []).some((domain) => domainMatches(hostname, domain)));
}

function clientHintHeaders(agent) {
  const highEntropy = [
    "sec-ch-ua-arch", "sec-ch-ua-bitness", "sec-ch-ua-full-version",
    "sec-ch-ua-full-version-list", "sec-ch-ua-model", "sec-ch-ua-platform-version",
    "sec-ch-ua-wow64"
  ].map((header) => ({ header, operation: "remove" }));

  if (agent.browser !== "Chrome" && agent.browser !== "Edge") {
    return [
      { header: "sec-ch-ua", operation: "remove" },
      { header: "sec-ch-ua-mobile", operation: "remove" },
      { header: "sec-ch-ua-platform", operation: "remove" },
      ...highEntropy
    ];
  }

  const marker = agent.browser === "Edge" ? /Edg\/(\d+)/ : /Chrome\/(\d+)/;
  const major = agent.ua.match(marker)?.[1] || agent.ua.match(/Chrome\/(\d+)/)?.[1] || "120";
  const brand = agent.browser === "Edge" ? "Microsoft Edge" : "Google Chrome";
  const mobile = agent.platform === "Android" ? "?1" : "?0";
  return [
    {
      header: "sec-ch-ua",
      operation: "set",
      value: `\"Not_A Brand\";v=\"99\", \"Chromium\";v=\"${major}\", \"${brand}\";v=\"${major}\"`
    },
    { header: "sec-ch-ua-mobile", operation: "set", value: mobile },
    { header: "sec-ch-ua-platform", operation: "set", value: `\"${agent.platform}\"` },
    ...highEntropy
  ];
}

function makeRule(tabId, agent, settings) {
  const excludedDomains = settings.excludedDomains || [];
  const condition = { tabIds: [tabId], resourceTypes: ALL_RESOURCES };
  if (excludedDomains.length) {
    condition.excludedRequestDomains = excludedDomains;
    condition.excludedInitiatorDomains = excludedDomains;
  }
  return {
    id: ruleId(tabId),
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "user-agent", operation: "set", value: agent.ua },
        ...clientHintHeaders(agent)
      ]
    },
    condition
  };
}

async function updateBadge(tabId, agent, enabled = true) {
  if (!Number.isInteger(tabId)) return;
  const badge = BADGES[agent?.browser] || { text: "UA", color: "#7c3aed" };
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ tabId, color: enabled ? badge.color : "#475569" }).catch(() => {}),
    chrome.action.setBadgeText({ tabId, text: enabled ? badge.text : "" }).catch(() => {}),
    chrome.action.setTitle({
      tabId,
      title: enabled && agent ? `UA Spectrum: ${agent.browser} · ${agent.platform}` : "UA Spectrum: Off"
    }).catch(() => {})
  ]);
}

async function rotateTabNow(tabId, force = false) {
  return queue(async () => {
    const [settings, tab, states] = await Promise.all([
      getSettings(),
      chrome.tabs.get(tabId).catch(() => null),
      getTabStates()
    ]);
    if (!settings.enabled || !validTab(tab) || isExcluded(tab, settings)) {
      if (states[String(tabId)]) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId(tabId)] }).catch(() => {});
        delete states[String(tabId)];
        await setTabStates(states);
      }
      await updateBadge(tabId, null, false);
      return null;
    }
    if (states[String(tabId)]?.locked) return states[String(tabId)];
    if (!force && states[String(tabId)]) return states[String(tabId)];
    const previous = states[String(tabId)]?.ua || "";
    const agent = pickAgent(settings, previous);
    const current = { ...agent, changedAt: Date.now() };
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId(tabId)],
      addRules: [makeRule(tabId, agent, settings)]
    });
    states[String(tabId)] = current;
    await setTabStates(states);
    await updateBadge(tabId, agent, !isExcluded(tab, settings));
    return current;
  });
}

async function setTabLocked(tabId, locked) {
  if (locked) await rotateTabNow(tabId, false);
  return queue(async () => {
    const [settings, tab, states] = await Promise.all([
      getSettings(),
      chrome.tabs.get(tabId).catch(() => null),
      getTabStates()
    ]);
    const key = String(tabId);
    if (!settings.enabled || !validTab(tab) || isExcluded(tab, settings) || !states[key]) {
      throw new Error("Open an eligible protected page before locking its identity");
    }
    states[key] = { ...states[key], locked: Boolean(locked) };
    await setTabStates(states);
    await updateBadge(tabId, states[key], true);
    return states[key];
  });
}

async function removeTabRule(tabId) {
  return queue(async () => {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId(tabId)] }).catch(() => {});
    const states = await getTabStates();
    delete states[String(tabId)];
    await setTabStates(states);
    await updateBadge(tabId, null, false);
  });
}

async function applyToAllTabs({ rotate = false, rebuild = false } = {}) {
  return queue(async () => {
    const [settings, tabs, states, rules] = await Promise.all([
      getSettings(),
      chrome.tabs.query({}),
      getTabStates(),
      chrome.declarativeNetRequest.getSessionRules()
    ]);
    const ownedRules = rules.filter((rule) => rule.id >= RULE_BASE);
    const ownedRuleIds = ownedRules.map((rule) => rule.id);

    if (!settings.enabled) {
      if (ownedRuleIds.length) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ownedRuleIds });
      }
      await setTabStates({});
      await Promise.all(tabs.map((tab) => updateBadge(tab.id, null, false)));
      return { eligible: 0, protected: 0 };
    }

    const eligible = tabs.filter((tab) => validTab(tab) && !isExcluded(tab, settings));
    const liveIds = new Set(eligible.map((tab) => String(tab.id)));
    const nextStates = Object.fromEntries(Object.entries(states).filter(([id]) => liveIds.has(id)));
    const ownedIds = new Set(ownedRuleIds);
    const targetRuleIds = new Set(eligible.map((tab) => ruleId(tab.id)));
    const removeRuleIds = ownedRuleIds.filter((id) => !targetRuleIds.has(id));
    const addRules = [];

    for (const tab of eligible) {
      const key = String(tab.id);
      const previous = nextStates[key];
      const needsIdentity = !previous || (rotate && !previous.locked);
      const agent = needsIdentity ? pickAgent(settings, previous?.ua || "") : previous;
      nextStates[key] = needsIdentity
        ? { ...agent, changedAt: Date.now(), locked: Boolean(previous?.locked) }
        : previous;
      if (rebuild || needsIdentity || !ownedIds.has(ruleId(tab.id))) {
        if (ownedIds.has(ruleId(tab.id)) && !removeRuleIds.includes(ruleId(tab.id))) {
          removeRuleIds.push(ruleId(tab.id));
        }
        addRules.push(makeRule(tab.id, nextStates[key], settings));
      }
    }

    if (removeRuleIds.length || addRules.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
    }
    if (rotate || rebuild || JSON.stringify(nextStates) !== JSON.stringify(states)) {
      await setTabStates(nextStates);
    }
    if (rotate || rebuild || removeRuleIds.length || addRules.length) {
      await Promise.all(tabs.map((tab) => {
        const agent = nextStates[String(tab.id)];
        return updateBadge(tab.id, agent, Boolean(agent));
      }));
    }

    return { eligible: eligible.length, protected: eligible.length };
  });
}

async function toggleSiteExclusion(tabId) {
  const [settings, tab] = await Promise.all([
    getSettings(),
    chrome.tabs.get(tabId).catch(() => null)
  ]);
  const hostname = hostnameFor(tab);
  if (!hostname || !validTab(tab)) throw new Error("Open an HTTP(S) page first");
  const excludedDomains = new Set(settings.excludedDomains || []);
  if (excludedDomains.has(hostname)) excludedDomains.delete(hostname);
  else excludedDomains.add(hostname);
  await saveSettings({ excludedDomains: [...excludedDomains] });
  await applyToAllTabs({ rebuild: true });
  return popupState(tabId);
}

async function configureAlarms(settings) {
  await Promise.all([chrome.alarms.clear(ROTATION_ALARM), chrome.alarms.clear(HEALTH_ALARM)]);
  if (!settings.enabled) return;
  chrome.alarms.create(HEALTH_ALARM, { periodInMinutes: 15 });
  const minutes = settings.mode === "interval30" ? 0.5 : settings.mode === "interval300" ? 5 : 0;
  if (minutes) chrome.alarms.create(ROTATION_ALARM, { periodInMinutes: minutes });
}

async function popupState(tabId) {
  const [settings, states, tab, tabs, rules] = await Promise.all([
    getSettings(),
    getTabStates(),
    Number.isInteger(tabId) ? chrome.tabs.get(tabId).catch(() => null) : null,
    chrome.tabs.query({}),
    chrome.declarativeNetRequest.getSessionRules()
  ]);
  const hostname = hostnameFor(tab);
  const excluded = isExcluded(tab, settings);
  const protectedRuleIds = new Set(rules.filter((rule) => rule.id >= RULE_BASE).map((rule) => rule.id));
  const targetTabs = tabs.filter((item) => validTab(item) && !isExcluded(item, settings));
  const protectedTabs = settings.enabled
    ? targetTabs.filter((item) => states[String(item.id)] && protectedRuleIds.has(ruleId(item.id)))
    : [];
  return {
    settings,
    current: states[String(tabId)] || null,
    stats: catalogStats(),
    nativeUa: navigator.userAgent,
    coverage: {
      eligible: targetTabs.length,
      protected: protectedTabs.length,
      excluded: tabs.filter((item) => validTab(item) && isExcluded(item, settings)).length
    },
    tab: { hostname, eligible: validTab(tab), excluded }
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    if (message?.type === "getState") return popupState(message.tabId);
    if (message?.type === "rotateNow") {
      await rotateTabNow(message.tabId, true);
      return popupState(message.tabId);
    }
    if (message?.type === "rotateAll") {
      await applyToAllTabs({ rotate: true });
      return popupState(message.tabId);
    }
    if (message?.type === "setLocked") {
      await setTabLocked(message.tabId, Boolean(message.locked));
      return popupState(message.tabId);
    }
    if (message?.type === "toggleSiteExclusion") {
      return toggleSiteExclusion(message.tabId);
    }
    if (message?.type === "importSettings") {
      const settings = await saveSettings(importableSettings(message.value));
      await configureAlarms(settings);
      await applyToAllTabs({ rotate: true, rebuild: true });
      return popupState(message.tabId);
    }
    if (message?.type === "setEnabled") {
      const settings = await saveSettings({ enabled: Boolean(message.enabled) });
      await configureAlarms(settings);
      await applyToAllTabs({ rotate: true, rebuild: true });
      return popupState(message.tabId);
    }
    if (message?.type === "saveSettings") {
      const settings = await saveSettings(message.patch || {});
      await configureAlarms(settings);
      await applyToAllTabs({ rotate: true, rebuild: true });
      return popupState(message.tabId);
    }
    throw new Error("Unknown action");
  })().then(
    (data) => sendResponse({ ok: true, data }),
    (error) => sendResponse({ ok: false, error: error?.message || String(error) })
  );
  return true;
});

chrome.tabs.onCreated.addListener((tab) => {
  setTimeout(() => void rotateTabNow(tab.id, false), 250);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  if (validTab(tab)) void rotateTabNow(tabId, false);
  else void removeTabRule(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void removeTabRule(removedTabId).then(() => rotateTabNow(addedTabId, false));
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void getSettings().then((settings) => {
    if (settings.enabled && settings.mode === "focus") return rotateTabNow(tabId, true);
    return rotateTabNow(tabId, false);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => void removeTabRule(tabId));

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  void getSettings().then((settings) => {
    if (settings.enabled && settings.mode === "navigation") return rotateTabNow(details.tabId, true);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ROTATION_ALARM) void applyToAllTabs({ rotate: true });
  if (alarm.name === HEALTH_ALARM) void applyToAllTabs();
});

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    const settings = await getSettings();
    await configureAlarms(settings);
    await applyToAllTabs({ rebuild: true });
  })();
});
chrome.runtime.onStartup.addListener(() => {
  void getSettings().then(configureAlarms).then(() => applyToAllTabs());
});
