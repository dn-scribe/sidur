window.SD = window.SD || {};

SD.Storage = (function () {
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
