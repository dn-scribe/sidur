window.SD = window.SD || {};

SD.Storage = (function () {

  // ── Native bridge storage (Android WebView shell) ──────────────────────────
  // When window.SidurBridge exists the app runs inside the Android shell.
  // All data is stored as files in the app's private filesDir via four
  // synchronous @JavascriptInterface methods.
  // File layout:
  //   siddurs.json              → JSON array of siddur objects
  //   {id}/ann/{safeRef}.json   → annotation object (one per section)
  //   {id}/edits/{safeRef}.json → { ref, edits } (text edits per section)

  const BRIDGE = window.SidurBridge || null;

  function safeRef(ref) {
    // base64url-encode the ref so it is a valid filename on every OS
    return btoa(unescape(encodeURIComponent(ref)))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  function bjson(raw) { try { return raw ? JSON.parse(raw) : null; } catch { return null; } }

  const BridgeStorage = {
    async loadSiddurs() {
      const rows = bjson(BRIDGE.bridgeRead('siddurs.json')) || [];
      return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
    async saveSiddur(siddur) {
      const rows = bjson(BRIDGE.bridgeRead('siddurs.json')) || [];
      const idx = rows.findIndex(s => s.id === siddur.id);
      if (idx >= 0) rows[idx] = siddur; else rows.push(siddur);
      BRIDGE.bridgeWrite('siddurs.json', JSON.stringify(rows));
    },
    async deleteSiddur(id) {
      const rows = (bjson(BRIDGE.bridgeRead('siddurs.json')) || []).filter(s => s.id !== id);
      BRIDGE.bridgeWrite('siddurs.json', JSON.stringify(rows));
      const del = (dir) => {
        (bjson(BRIDGE.bridgeList(dir)) || []).forEach(f => BRIDGE.bridgeDelete(`${dir}/${f}`));
      };
      del(`${id}/ann`); del(`${id}/edits`);
    },
    async loadAnnotation(siddurId, ref) {
      const ANN = { customTitle: null, insertions: [], removedParagraphs: [] };
      const raw = bjson(BRIDGE.bridgeRead(`${siddurId}/ann/${safeRef(ref)}.json`));
      return raw ? { ...ANN, ...raw } : { ...ANN, ref };
    },
    async saveAnnotation(siddurId, ann) {
      BRIDGE.bridgeWrite(`${siddurId}/ann/${safeRef(ann.ref)}.json`, JSON.stringify(ann));
    },
    async loadTextEdits(siddurId, ref) {
      return bjson(BRIDGE.bridgeRead(`${siddurId}/edits/${safeRef(ref)}.json`))?.edits || {};
    },
    async saveTextEdits(siddurId, ref, edits) {
      BRIDGE.bridgeWrite(`${siddurId}/edits/${safeRef(ref)}.json`, JSON.stringify({ ref, edits }));
    },
    async loadAnnotatedRefs(siddurId) {
      const refs = new Set();
      const readAll = (dir) => (bjson(BRIDGE.bridgeList(dir)) || [])
        .map(f => bjson(BRIDGE.bridgeRead(`${dir}/${f}`))).filter(Boolean);
      readAll(`${siddurId}/ann`).forEach(a => {
        if (a.customTitle || a.insertions?.length || a.removedParagraphs?.length) refs.add(a.ref);
      });
      readAll(`${siddurId}/edits`).forEach(e => {
        if (Object.keys(e.edits || {}).length) refs.add(e.ref);
      });
      return refs;
    },
    async exportBackup() {
      const siddurs = await this.loadSiddurs();
      const out = { version: 2, siddurs: [], annotationsBySiddur: {}, textEditsBySiddur: {} };
      const readAll = (dir) => (bjson(BRIDGE.bridgeList(dir)) || [])
        .map(f => bjson(BRIDGE.bridgeRead(`${dir}/${f}`))).filter(Boolean);
      for (const s of siddurs) {
        out.siddurs.push(s);
        out.annotationsBySiddur[s.id] = readAll(`${s.id}/ann`);
        out.textEditsBySiddur[s.id]   = readAll(`${s.id}/edits`);
      }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `sidur-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    async importBackup(file) {
      const data = JSON.parse(await file.text());
      const siddurs = data.siddurs || [];
      if (!siddurs.length) throw new Error('פורמט קובץ שגוי');
      const rows = bjson(BRIDGE.bridgeRead('siddurs.json')) || [];
      for (const s of siddurs) {
        if (!s.createdAt) s.createdAt = Date.now();
        const idx = rows.findIndex(x => x.id === s.id);
        if (idx >= 0) rows[idx] = s; else rows.push(s);
      }
      BRIDGE.bridgeWrite('siddurs.json', JSON.stringify(rows));
      for (const s of siddurs) {
        for (const ann of data.annotationsBySiddur?.[s.id] || []) {
          BRIDGE.bridgeWrite(`${s.id}/ann/${safeRef(ann.ref)}.json`, JSON.stringify(ann));
        }
        for (const te of data.textEditsBySiddur?.[s.id] || []) {
          BRIDGE.bridgeWrite(`${s.id}/edits/${safeRef(te.ref)}.json`, JSON.stringify(te));
        }
      }
    },
    async migrateFromLocalStorage() { /* no-op: bridge doesn't use localStorage */ },
    genId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); },
  };

  // ── IndexedDB storage (browser / PWA) ──────────────────────────────────────
  const MASTER_DB  = 'sidur-master';
  const MASTER_VER = 1;
  const SIDDUR_VER = 1;

  // ── IDB helpers ──

  function openDb(name, version, upgrade) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = e => upgrade(e.target.result);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  function idbGet(db, store, key) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  function idbPut(db, store, value) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).put(value);
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  }

  function idbDelete(db, store, key) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  }

  function idbGetAll(db, store) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  // ── DB openers ──

  function openMasterDb() {
    return openDb(MASTER_DB, MASTER_VER, db => {
      if (!db.objectStoreNames.contains('siddurs'))
        db.createObjectStore('siddurs', { keyPath: 'id' });
    });
  }

  function siddurDbName(id) { return `sidur-${id}`; }

  function openSiddurDb(id) {
    return openDb(siddurDbName(id), SIDDUR_VER, db => {
      if (!db.objectStoreNames.contains('annotations'))
        db.createObjectStore('annotations', { keyPath: 'ref' });
      if (!db.objectStoreNames.contains('textEdits'))
        db.createObjectStore('textEdits', { keyPath: 'ref' });
    });
  }

  // ── Siddur list (master DB) ──

  async function loadSiddurs() {
    const db = await openMasterDb();
    const rows = await idbGetAll(db, 'siddurs');
    db.close();
    return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function saveSiddur(siddur) {
    const db = await openMasterDb();
    await idbPut(db, 'siddurs', siddur);
    db.close();
  }

  async function deleteSiddur(id) {
    const db = await openMasterDb();
    await idbDelete(db, 'siddurs', id);
    db.close();
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(siddurDbName(id));
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  }

  // ── Annotations ──

  const ANN_DEFAULT = () => ({ customTitle: null, insertions: [], removedParagraphs: [] });

  async function loadAnnotation(siddurId, ref) {
    const db = await openSiddurDb(siddurId);
    const row = await idbGet(db, 'annotations', ref);
    db.close();
    return row ? { ...ANN_DEFAULT(), ...row } : { ...ANN_DEFAULT(), ref };
  }

  async function saveAnnotation(siddurId, ann) {
    const db = await openSiddurDb(siddurId);
    await idbPut(db, 'annotations', ann);
    db.close();
  }

  // ── Text edits ──

  async function loadTextEdits(siddurId, ref) {
    const db = await openSiddurDb(siddurId);
    const row = await idbGet(db, 'textEdits', ref);
    db.close();
    return row?.edits || {};
  }

  async function saveTextEdits(siddurId, ref, edits) {
    const db = await openSiddurDb(siddurId);
    await idbPut(db, 'textEdits', { ref, edits });
    db.close();
  }

  // ── Annotated refs (for TOC dots) ──

  async function loadAnnotatedRefs(siddurId) {
    const db = await openSiddurDb(siddurId);
    const [anns, edits] = await Promise.all([
      idbGetAll(db, 'annotations'),
      idbGetAll(db, 'textEdits'),
    ]);
    db.close();
    const refs = new Set();
    anns.forEach(a => {
      if (a.customTitle || a.insertions?.length || a.removedParagraphs?.length) refs.add(a.ref);
    });
    edits.forEach(e => {
      if (Object.keys(e.edits || {}).length > 0) refs.add(e.ref);
    });
    return refs;
  }

  // ── Export / Import ──

  async function exportBackup() {
    const siddurs = await loadSiddurs();
    const out = { version: 2, siddurs: [], annotationsBySiddur: {}, textEditsBySiddur: {} };
    for (const s of siddurs) {
      out.siddurs.push(s);
      const db = await openSiddurDb(s.id);
      out.annotationsBySiddur[s.id] = await idbGetAll(db, 'annotations');
      out.textEditsBySiddur[s.id]   = await idbGetAll(db, 'textEdits');
      db.close();
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sidur-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importBackup(file) {
    const data = JSON.parse(await file.text());
    const siddurs = data.siddurs || [];
    if (!siddurs.length) throw new Error('פורמט קובץ שגוי');

    // Support both v1 (localStorage shape) and v2 (IndexedDB shape)
    const isV1 = !data.version || data.version < 2;

    const masterDb = await openMasterDb();
    for (const s of siddurs) {
      if (!s.createdAt) s.createdAt = Date.now();
      await idbPut(masterDb, 'siddurs', s);
    }
    masterDb.close();

    for (const s of siddurs) {
      const db = await openSiddurDb(s.id);
      if (isV1) {
        // v1: annotations[siddurId] is a map { ref: annObject }
        const annMap = data.annotations?.[s.id] || {};
        for (const [ref, ann] of Object.entries(annMap)) {
          await idbPut(db, 'annotations', { ...ann, ref });
        }
        const editMap = data.textEdits?.[s.id] || {};
        for (const [ref, edits] of Object.entries(editMap)) {
          await idbPut(db, 'textEdits', { ref, edits });
        }
      } else {
        // v2: arrays
        for (const ann of data.annotationsBySiddur?.[s.id] || []) {
          await idbPut(db, 'annotations', ann);
        }
        for (const te of data.textEditsBySiddur?.[s.id] || []) {
          await idbPut(db, 'textEdits', te);
        }
      }
      db.close();
    }
  }

  // ── Migrate from localStorage (one-time) ──

  async function migrateFromLocalStorage() {
    const OLD_KEY = 'sd.data';
    const raw = localStorage.getItem(OLD_KEY);
    if (!raw) return;
    try {
      const old = JSON.parse(raw);
      if (!old?.siddurs?.length) { localStorage.removeItem(OLD_KEY); return; }

      // Skip if already migrated
      const existing = await loadSiddurs();
      if (existing.length > 0) { localStorage.removeItem(OLD_KEY); return; }

      const masterDb = await openMasterDb();
      for (const s of old.siddurs) {
        await idbPut(masterDb, 'siddurs', { ...s, createdAt: Date.now() });
      }
      masterDb.close();

      for (const s of old.siddurs) {
        const db = await openSiddurDb(s.id);
        const annMap = old.annotations?.[s.id] || {};
        for (const [ref, ann] of Object.entries(annMap)) {
          await idbPut(db, 'annotations', { ...ann, ref });
        }
        const editMap = old.textEdits?.[s.id] || {};
        for (const [ref, edits] of Object.entries(editMap)) {
          await idbPut(db, 'textEdits', { ref, edits });
        }
        db.close();
      }
      localStorage.removeItem(OLD_KEY);
      console.log('[SD] Migrated from localStorage to IndexedDB');
    } catch (e) {
      console.error('[SD] Migration failed', e);
    }
  }

  function genId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // Return bridge-backed storage when running in the Android shell,
  // otherwise return the IndexedDB-backed implementation.
  if (BRIDGE) {
    return BridgeStorage;
  }

  return {
    loadSiddurs, saveSiddur, deleteSiddur,
    loadAnnotation, saveAnnotation,
    loadTextEdits, saveTextEdits,
    loadAnnotatedRefs,
    exportBackup, importBackup,
    migrateFromLocalStorage,
    genId,
  };
})();
