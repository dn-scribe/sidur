# Sidur — CLAUDE.md

## Project

Vanilla JS PWA prayer book. Source lives in `docs/` (served via GitHub Pages at https://dn-scribe.github.io/sidur/).

## Stack

- `docs/js/app.js` — main app logic and state
- `docs/js/ui.js` — DOM rendering helpers
- `docs/js/storage.js` — IndexedDB (per-siddur databases)
- `docs/js/api.js` — Sefaria API calls
- `docs/js/version.js` — version string and changelog
- `docs/sw.js` — service worker (shell caching)
- `docs/css/style.css` — all styles

## Release checklist — required for every change

Every change, no matter how small, must go through the full release pipeline so the app auto-updates when the user opens it. The service worker is the delivery mechanism: it detects a new `CACHE_NAME`, re-fetches all shell files, and activates the new code on the next page load. Skip any step and the user stays on the old version.

**Before committing:**
1. Bump `CACHE_NAME` in `docs/sw.js` (e.g. `sidur-v10` → `sidur-v11`) — **no exceptions**
2. Bump `SD.Version.current` in `docs/js/version.js` (patch for fixes, minor for features)
3. Add a changelog entry in `docs/js/version.js`

**After committing:**
4. Push to branch `main-yzocwp`
5. Open a PR into `main` and **squash-merge it yourself** using `mcp__github__merge_pull_request` with `merge_method: squash` — do not wait for the user
6. Sync the branch back immediately:

```bash
git fetch origin main
git reset --hard origin/main
git push --force-with-lease origin main-yzocwp
```

GitHub Pages rebuilds from `main` within ~1 minute. On the user's next app open (or refresh), the service worker detects `CACHE_NAME` changed, downloads fresh shell files, and the new code is live.

Skipping the branch sync leaves `main-yzocwp` diverged from `main`.  
Skipping the `CACHE_NAME` bump means the browser never fetches new files — the user keeps seeing the old version.

## Versioning

Use semver: patch (x.x.**N**) for fixes, minor (x.**N**.0) for new features. Both `SD.Version.current` and `CACHE_NAME` must be bumped together — they travel as a pair.
