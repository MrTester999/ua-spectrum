# UA Spectrum v1.3.0 — Documentation

## What UA Spectrum does

UA Spectrum is a Chromium Manifest V3 extension that changes the network
`User-Agent` header for eligible HTTP(S) tabs. Each tab receives a session-scoped
`declarativeNetRequest` rule and an independently selected identity.

The extension also aligns common low-entropy User-Agent Client Hints for Chrome
and Edge identities. For Firefox and Safari identities, contradictory Chromium
hints are removed where the API permits it.

## Installation

1. Extract `dist/ua-spectrum-1.3.0.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Select the extracted folder.
6. Pin UA Spectrum from Chrome's extension menu.

After replacing extension files, press **Reload** on its
`chrome://extensions` card.

## Dashboard

The popup shows:

- Whether UA Spectrum is enabled.
- Whether the active page currently has a DNR rule.
- The assigned browser and platform.
- The effective network User-Agent string.
- The selected rotation policy.
- When the active identity was last changed.
- Protected versus eligible tab coverage.
- The active hostname and whether it is excluded.

Toolbar badge abbreviations are `CH` (Chrome), `ED` (Edge), `FF` (Firefox),
and `SF` (Safari).

## Enabling and disabling

Use the switch in the popup header.

- Enabling assigns identities and installs rules for every eligible tab.
- Disabling removes every UA Spectrum session rule, clears tab assignments, and
  removes its toolbar badges.

Internal Chromium pages are never eligible. Incognito tabs are left untouched
unless the browser has explicitly granted the extension incognito access.

## Rotation

### Manual actions

- **Rotate this tab:** replaces the active tab's identity.
- **Rotate all tabs:** rotates all eligible, unlocked identities in one batched
  rule update.

### Automatic policies

| Policy | Trigger |
|---|---|
| Every navigation | Top-level navigation begins |
| When tab gains focus | Tab activation |
| Stable per tab | Manual or explicit configuration changes only |
| Every 30 seconds | Chromium alarm every 0.5 minutes |
| Every 5 minutes | Chromium alarm every 5 minutes |

A fifteen-minute health alarm restores only missing or stale rules. It does not
rotate healthy stable identities.

## Identity locking

Press **Lock identity** to preserve the active tab's current identity.

A locked identity survives:

- Navigation rotation.
- Focus rotation.
- Timed rotation.
- **Rotate all tabs**.
- Health reconciliation.

Unlock the identity before using **Rotate this tab**. Locks live in session
storage and do not claim to survive a complete browser session reset.

## Website exclusions

Press **Exclude this site** to add the exact active hostname to the exclusion
list. UA Spectrum removes matching rules and state from affected tabs.

Press **Include this site** to remove that hostname from the exclusion list.
Subdomains also match a configured parent domain.

You can edit multiple domains under **Rotation & targeting**. Enter one domain
per line or separate them with commas. Schemes, paths, and ports are normalized.

## Browser and platform targeting

Choose at least one browser and platform. The catalog is filtered to identities
that match both selections. Supported values are:

- Browsers: Chrome, Edge, Firefox, Safari.
- Platforms: Windows, Linux, macOS, Android, iOS.

Some browser/platform pairs do not exist in the catalog. If the combined filter
has no entries, the engine safely falls back to the complete catalog.

## Export and import

### Export

1. Expand **Rotation & targeting**.
2. Select **Export settings**.
3. Save the generated JSON file.

The export contains the extension version, export timestamp, enabled state,
rotation policy, browser/platform filters, and exclusion list. It does not
contain browsing history or tab assignments.

### Import

1. Expand **Rotation & targeting**.
2. Select **Import settings**.
3. Choose a UA Spectrum JSON file.

The importer accepts either a direct settings object or an export containing a
`settings` object. It validates modes, browser names, platform names, and domain
lists before applying them.

## Privacy and storage

- No telemetry or analytics.
- No remote runtime code.
- Persistent preferences use `chrome.storage.local`.
- Active tab assignments and locks use `chrome.storage.session`.
- Network rules are dynamic session rules removed when the extension is disabled.

## Technical limits

UA Spectrum changes selected request headers. It does not create a native cookie
container per tab and does not change JavaScript-visible fingerprint surfaces
such as canvas, WebGL, fonts, screen metrics, IP address, TLS behavior, cookies,
or local storage.

Chromium also controls `navigator.userAgent`, so page JavaScript may observe the
browser's native value even when network requests use the assigned identity.

Use separate browser profiles for a stronger isolation boundary.

## Troubleshooting

### The popup says “Waiting for eligible page”

Open a normal `http://` or `https://` page. Browser-internal pages cannot receive
rules.

### The site still sees the old identity

Reload the page after rotating. A request already in flight cannot be rewritten
retroactively.

### Rotate is disabled

The extension may be disabled, the site may be excluded, the page may be
ineligible, or the identity may be locked.

### A configuration change is missing

Press **Save configuration**, then reload the target page. When developing from
source, also press **Reload** on `chrome://extensions`.

## Verification

Run:

```bash
npm run check
npm run smoke
```

These checks cover manifest consistency, syntax, catalog uniqueness, DNR rule
shape, batched tab coverage, health repair, locked identities, site exclusions,
settings validation, and full cleanup when disabled.

## Responsible use

Only use UA Spectrum on systems where you are authorized to change or test
request identity. It is not an anonymity guarantee.
