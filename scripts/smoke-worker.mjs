import assert from "node:assert/strict";

function event() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) { listeners.push(listener); }
  };
}

const local = {};
const session = {};
const tabs = [
  { id: 1, url: "https://one.example/", incognito: false },
  { id: 2, url: "https://two.example/path", incognito: false },
  { id: 3, url: "chrome://extensions/", incognito: false },
  { id: 4, url: "http://localhost:8080/", incognito: false }
];
let rules = [];
const updates = [];

function area(store) {
  return {
    async get(key) { return { [key]: structuredClone(store[key]) }; },
    async set(values) { Object.assign(store, structuredClone(values)); }
  };
}

const events = {
  message: event(), installed: event(), startup: event(),
  created: event(), updated: event(), replaced: event(), activated: event(), removed: event(),
  navigation: event(), alarm: event()
};

globalThis.chrome = {
  storage: { local: area(local), session: area(session) },
  tabs: {
    async query() { return structuredClone(tabs); },
    async get(tabId) { return structuredClone(tabs.find((tab) => tab.id === tabId)); },
    onCreated: events.created,
    onUpdated: events.updated,
    onReplaced: events.replaced,
    onActivated: events.activated,
    onRemoved: events.removed
  },
  declarativeNetRequest: {
    async getSessionRules() { return structuredClone(rules); },
    async updateSessionRules({ removeRuleIds = [], addRules = [] }) {
      rules = rules.filter((rule) => !removeRuleIds.includes(rule.id));
      rules.push(...structuredClone(addRules));
      updates.push({ removeRuleIds: [...removeRuleIds], addRules: structuredClone(addRules) });
    }
  },
  action: {
    async setBadgeBackgroundColor() {}, async setBadgeText() {}, async setTitle() {}
  },
  alarms: {
    async clear() { return true; }, create() {}, onAlarm: events.alarm
  },
  runtime: {
    onMessage: events.message,
    onInstalled: events.installed,
    onStartup: events.startup
  },
  webNavigation: { onBeforeNavigate: events.navigation }
};

await import("../background/service-worker.js");
assert.equal(events.message.listeners.length, 1, "Message API was not registered");
assert.equal(events.replaced.listeners.length, 1, "Replaced-tab recovery was not registered");

async function message(payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Message timed out: ${payload.type}`)), 3000);
    events.message.listeners[0](payload, {}, (response) => {
      clearTimeout(timeout);
      if (!response?.ok) reject(new Error(response?.error || "Unknown message error"));
      else resolve(response.data);
    });
  });
}

function validateRule(rule) {
  assert.ok(Number.isInteger(rule.id) && rule.id > 0, "Invalid rule id");
  assert.equal(rule.action.type, "modifyHeaders");
  assert.ok(rule.condition.tabIds.length === 1, "Rule must target one tab");
  const headers = rule.action.requestHeaders;
  const ua = headers.find((header) => header.header === "user-agent");
  assert.equal(ua.operation, "set");
  assert.match(ua.value, /^Mozilla\/5\.0/);
  for (const header of headers) {
    if (header.operation === "set") assert.equal(typeof header.value, "string");
    if (header.operation === "remove") assert.equal("value" in header, false);
  }
  if (rule.condition.excludedRequestDomains) {
    assert.ok(rule.condition.excludedRequestDomains.length > 0, "Empty exclusion list must be omitted");
  }
}

const enabled = await message({ type: "setEnabled", tabId: 1, enabled: true });
assert.equal(enabled.settings.enabled, true);
assert.deepEqual(enabled.coverage, { eligible: 2, protected: 2, excluded: 1 });
assert.equal(rules.length, 2, "Every non-excluded HTTP(S) tab should receive an isolated rule");
assert.equal(updates.length, 1, "All tabs should be installed in one batch update");
rules.forEach(validateRule);

events.alarm.listeners[0]({ name: "ua-health" });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(updates.length, 1, "Healthy rules must not be rewritten by maintenance");

const before = Object.fromEntries(Object.entries(session.tabAgents).map(([id, agent]) => [id, agent.ua]));
const locked = await message({ type: "setLocked", tabId: 1, locked: true });
assert.equal(locked.current.locked, true, "Current identity should be locked");
const rotated = await message({ type: "rotateAll", tabId: 1 });
assert.equal(rotated.coverage.protected, 2);
assert.equal(updates.length, 2, "Rotate-all should use one additional batch update");
assert.equal(rules.length, 2);
for (const [id, agent] of Object.entries(session.tabAgents)) {
  if (id === "1") assert.equal(agent.ua, before[id], "Locked tab identity changed during rotate-all");
  else assert.notEqual(agent.ua, before[id], `Tab ${id} did not receive a new identity`);
}
rules.forEach(validateRule);

const excluded = await message({ type: "toggleSiteExclusion", tabId: 1 });
assert.equal(excluded.tab.excluded, true, "Current hostname should be excluded");
assert.deepEqual(excluded.coverage, { eligible: 1, protected: 1, excluded: 2 });
assert.equal(rules.length, 1, "Excluded site's tab rule should be removed");

const included = await message({ type: "toggleSiteExclusion", tabId: 1 });
assert.equal(included.tab.excluded, false, "Current hostname should be included again");
assert.deepEqual(included.coverage, { eligible: 2, protected: 2, excluded: 1 });
assert.equal(rules.length, 2, "Included site's tab rule should be restored");

const imported = await message({
  type: "importSettings",
  tabId: 1,
  value: {
    settings: {
      enabled: true,
      mode: "navigation",
      browsers: ["Safari"],
      platforms: ["macOS"],
      excludedDomains: ["localhost"]
    }
  }
});
assert.equal(imported.settings.mode, "navigation", "Imported rotation mode was not preserved");
assert.deepEqual(imported.settings.browsers, ["Safari"]);
assert.deepEqual(imported.settings.platforms, ["macOS"]);
assert.ok(Object.values(session.tabAgents).every((agent) => agent.browser === "Safari" && agent.platform === "macOS"));
await assert.rejects(
  message({
    type: "importSettings",
    tabId: 1,
    value: { settings: { browsers: ["Unknown"], platforms: ["Unknown"] } }
  }),
  /at least one browser and platform/
);

const disabled = await message({ type: "setEnabled", tabId: 1, enabled: false });
assert.equal(disabled.settings.enabled, false);
assert.equal(rules.length, 0, "Disabling must remove every extension session rule");
assert.deepEqual(session.tabAgents, {});

console.log("PASS");
console.log(" - All eligible HTTP(S) tabs received isolated rules");
console.log(" - Rules were installed and rotated in one batch per operation");
console.log(" - Locked tab identities survived rotate-all");
console.log(" - Current-site exclusion toggles removed and restored rules");
console.log(" - Settings import validation applied supported filters only");
console.log(" - Healthy rules were not rewritten during maintenance");
console.log(" - Coverage excludes internal pages and configured domains correctly");
console.log(" - User-Agent and Client Hint rule operations are structurally valid");
console.log(" - Disabling removed all session rules and tab state");
