# Changelog

## 1.3.0

- Added per-tab identity locking so automatic and all-tab rotations preserve selected identities.
- Added a one-click current-site exclusion/inclusion control.
- Added portable JSON export and validated import for settings.
- Reworked all-tab reconciliation to separate rotation from rule rebuilding.
- Preserved the user's selected navigation policy during extension upgrades.
- Added smoke coverage for locked identities, site toggles, and settings validation.
- Added full Markdown and plain-text documentation.

## 1.2.1

- Added a performance-first stable-per-tab default to preserve browser and CDN cache efficiency.
- Reworked health reconciliation to update only missing or stale tab rules.
- Stopped creating rules or state for excluded tabs.
- Cached filtered identity pools to avoid rescanning the 9,137-entry catalog on every rotation.
- Reduced popup polling and background health checks while preserving instant tab event handling.

## 1.2.0

- Rebuilt all-tab reconciliation as a single batched DNR/storage update.
- Added all-tabs coverage status and one-click rotation across every eligible tab.
- Added Client Hint synchronization and contradiction removal for spoofed browser families.
- Added restored/replaced-tab handling and a periodic health repair pass.
- Added browser-specific toolbar badges and colors.
- Stopped live popup refreshes from rebuilding form controls or overwriting unsaved edits.

## 1.1.1

- Fixed Chrome popup width collapsing to a narrow vertical strip.
- Use Chrome's reliable fixed 440px extension-popup viewport while keeping internal cards flexible.

## 1.1.0

- Redesigned the popup as a responsive professional dashboard.
- Added the effective User-Agent header for the active tab.
- Added browser, platform, rotation policy, hostname, exclusion state, and last-change details.
- Added one-click User-Agent copying and live refresh every three seconds.
- Added responsive 440px, 420px, and 340px layouts.
- Corrected exclusions so they cover both request destinations and page initiators.
- Display the native browser User-Agent whenever spoofing is disabled or the site is excluded.

## 1.0.0

- Initial release with 9,137 generated User-Agents and five rotation policies.
