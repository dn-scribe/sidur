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

## Git workflow

Development branch: **`main-yzocwp`**. After implementing any user-visible change, always: push to the branch, open a PR into `main`, squash-merge, then immediately sync the branch back:

```bash
git fetch origin main
git reset --hard origin/main
git push --force-with-lease origin main-yzocwp
```

Skipping the sync leaves `main-yzocwp` diverged from `main` and triggers the stop-hook warning about unpushed commits.

## Service worker cache

**Every release — no exceptions — must bump `CACHE_NAME` in `docs/sw.js`** (e.g. `sidur-v7` → `sidur-v8`). This applies to every change to any shell file (`app.js`, `ui.js`, `storage.js`, `api.js`, `style.css`, `sw.js`, `index.html`). Without this bump, users' browsers keep serving the old cached files and the new code never loads.

Pre-commit checklist:
1. Bump `CACHE_NAME` in `docs/sw.js`
2. Bump `SD.Version.current` in `docs/js/version.js`
3. Add changelog entry

## Versioning

Bump `SD.Version.current` in `docs/js/version.js` and add a changelog entry for every user-visible change. Use semver: patch for fixes, minor for new features.
