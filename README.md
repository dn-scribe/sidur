# סידור אישי — Personal Prayer Book PWA

A personal Jewish prayer book (siddur) as a Progressive Web App. Browse liturgy from the [Sefaria](https://www.sefaria.org) library, annotate and customise each section, and use it offline — installed on your phone or desktop like a native app.

**Live:** https://dn-scribe.github.io/sidur/

---

## Features

### Liturgy browsing
- Pulls content from the Sefaria API (Hebrew text + English translation)
- Organised into categories (Shacharit, Mincha, Arvit, Shabbat, Holidays, …)
- Full-text search across book titles
- Offline: sections you have opened once are cached by the service worker

### Personal siddurs
- Create multiple named siddurs — each gets its own isolated database
- Switch between siddurs from Settings
- Quick-access shortcuts (★) pinned to the home screen for frequently-visited sections

### Section customisation (per siddur)
- **Remove paragraphs** — hide individual verses; restore at any time
- **Merge paragraphs** — combine adjacent verses into a single card (⊞), unmerge individually (⊟)
- **Edit text** — click any word to place the cursor and retype; bold (B) supported
- **Custom section title** — rename any chapter heading
- **Remove sections** — hide whole chapters from the table of contents; restore via Settings
- **Remove top-level groups** — hide entire groups (e.g. Shacharit) from the TOC; restore via Settings
- **Fold / unfold paragraphs** — collapse a paragraph to a preview line (▼/▶); fold all at once with ⊟/⊞ in the reader toolbar; existing annotations remain visible while folded

### Annotations
Two annotation types per paragraph:
- **Inline note** — appears beside the Hebrew text
- **Between-sections note** — appears between paragraphs

Supports rich text (bold), images uploaded from your device, and AI-generated images (OpenAI DALL-E / gpt-image-1).

### AI images
- Enter your OpenAI API key in Settings
- Choose a base prompt style
- Press ✨ **AI image** inside any annotation to generate an illustration
- Cost tracker in Settings (reset at any time)

### Export
- **DOCX export** — single section (⬇ in section header) or entire group (⬇ in TOC group header)
  - RTL layout, styled headings, inline images, A4 portrait or landscape
- **JSON backup** — full export of all siddurs, annotations, and edits; re-importable

### PWA / offline
- Installable via browser "Add to Home Screen" on iOS, Android, and desktop Chrome
- Service worker caches the app shell on first load; subsequent loads work without network
- Sefaria API responses are cached with stale-while-revalidate

### Book management
- Hide books from the general list (🚫 on each card); restore via Settings → "ספרים שהוסרו"

---

## Tech stack

| File | Role |
|---|---|
| `docs/js/app.js` | Main app logic and state machine |
| `docs/js/ui.js` | DOM rendering helpers |
| `docs/js/storage.js` | IndexedDB storage (one DB per siddur); Android bridge adapter |
| `docs/js/api.js` | Sefaria API calls and liturgy book catalogue |
| `docs/js/export.js` | DOCX generation (docx.js) |
| `docs/js/version.js` | Semver version string and changelog |
| `docs/sw.js` | Service worker — shell caching + Sefaria stale-while-revalidate |
| `docs/css/style.css` | All styles (RTL, dark-mode-ready) |
| `docs/index.html` | Single-page shell |

No build step, no bundler, no framework. Plain JavaScript modules loaded via `<script>` tags, served statically from GitHub Pages.

---

## Storage

The app uses **IndexedDB** in the browser/PWA:

```
sidur-master          (IndexedDB)
  └─ siddurs          object store — one record per siddur

sidur-{id}            (IndexedDB, one per siddur)
  ├─ annotations      keyed by section ref
  └─ textEdits        keyed by section ref
```

Non-critical UI state (hidden books, view mode, TOC filter) uses `localStorage`.

---

## Android shell

`android/` contains a native Android WebView shell that loads the GitHub Pages URL. When running inside the shell, `window.SidurBridge` is injected and `storage.js` automatically routes all storage to native file operations in the app's private `filesDir` instead of IndexedDB.

### Build the APK with Docker (no Android Studio needed)

```bash
cd android
docker build -t sidur-apk .
mkdir -p out
docker run --rm -v "$(pwd)/out:/out" sidur-apk \
    sh -c "cp /build/app/build/outputs/apk/debug/app-debug.apk /out/"
```

The debug APK lands at `android/out/app-debug.apk`. Install with:

```bash
adb install android/out/app-debug.apk
```

Requirements: Docker, and `adb` (Android Platform Tools) to sideload.

---

## Release pipeline

Every change must go through the full pipeline so the service worker delivers it to users automatically:

1. Bump `CACHE_NAME` in `docs/sw.js` (`sidur-vN` → `sidur-v{N+1}`)
2. Bump `SD.Version.current` in `docs/js/version.js` (patch for fixes, minor for features)
3. Add a changelog entry in `docs/js/version.js`
4. Commit and push to the development branch
5. Open a PR into `main` and squash-merge
6. Sync the development branch back to `main`

GitHub Pages rebuilds from `main` in ~1 minute. On the user's next app open the service worker detects the new `CACHE_NAME`, downloads fresh shell files, and activates the new code.

---

## Settings

| Setting | Description |
|---|---|
| OpenAI API key | Used for AI image generation |
| AI model | gpt-image-1 (default), dall-e-3, dall-e-2 |
| Base prompt | Prepended to every AI image request |
| Cost tracker | Cumulative DALL-E spend; resettable |
| Siddur management | Create, rename, switch active siddur |
| Restored sections | Re-add sections removed from the TOC |
| Restored groups | Re-add top-level groups removed from the TOC |
| Restored books | Re-show books hidden from the home screen |

---

## Development

No build step required. Open `docs/index.html` via a local HTTP server (required for service worker and IndexedDB):

```bash
# Python
python3 -m http.server 8080 --directory docs

# Node
npx serve docs
```

Then open http://localhost:8080.

---

## Versioning

Follows [semver](https://semver.org): patch (`x.x.N`) for bug fixes, minor (`x.N.0`) for new features. Both `SD.Version.current` and `CACHE_NAME` are bumped together on every release.

Current version: **1.14.2**
