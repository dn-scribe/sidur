window.SD = window.SD || {};

SD.Storage = (function () {
  const KEY = 'sd.data';

  function defaultState() {
    return {
      siddurs: [],
      // annotations[siddurId][ref] = {
      //   customTitle: string|null,
      //   insertions: [{id, beforeParagraph, title, text, images:[{id,dataUrl}]}]
      // }
      annotations: {},
      // textEdits[siddurId][ref][paragraphIndex] = "edited text"
      textEdits: {},
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    } catch (e) {
      console.error('Failed to load state', e);
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      if (e.name === 'QuotaExceededError') throw new Error('אחסון מלא — ייצאו גיבוי ומחקו תמונות ישנות');
      throw e;
    }
  }

  function exportBackup(state) {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sidur-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importBackup(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (!data.siddurs || !data.annotations) throw new Error('פורמט קובץ שגוי');
          resolve(Object.assign(defaultState(), data));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
      reader.readAsText(file);
    });
  }

  function genId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  return { load, save, exportBackup, importBackup, genId, defaultState };
})();
