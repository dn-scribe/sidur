window.SD = window.SD || {};

SD.App = (function () {
  const UI = SD.UI;
  const Api = SD.Api;
  const Storage = SD.Storage;

  // ── State ──
  let siddurs = [];
  let viewMode = localStorage.getItem('sd.viewMode') || 'normal';
  let showEn = localStorage.getItem('sd.showEn') !== 'false';

  let currentSiddur = null;
  let currentSection = null;
  let currentTocItems = [];
  let currentBookIndex = null;
  let currentAnnotation = null;   // loaded per section from IndexedDB
  let currentTextEdits = {};      // loaded per section from IndexedDB
  let tocFilter = localStorage.getItem('sd.tocFilter') === 'true';
  let _aiPendingDataUrl = null;
  let _aiPendingPrompt = '';
  let _pendingDocxExport = null; // { mode: 'section'|'group', groupHe: string|null }

  function $(id) { return document.getElementById(id); }

  // ── Init ──

  async function init() {
    UI.wireCropCanvas();
    wireEvents();
    await Storage.migrateFromLocalStorage();
    siddurs = await Storage.loadSiddurs();
    renderBooksScreen();
  }

  // ── Annotation helpers ──

  function ensureAnnotation() {
    if (!currentAnnotation) {
      currentAnnotation = { ref: currentSection.ref, customTitle: null, insertions: [], removedParagraphs: [] };
    }
    return currentAnnotation;
  }

  async function persistAnnotation() {
    if (!currentSiddur || !currentAnnotation) return;
    await Storage.saveAnnotation(currentSiddur.id, currentAnnotation);
  }

  async function persistTextEdits() {
    if (!currentSiddur || !currentSection) return;
    await Storage.saveTextEdits(currentSiddur.id, currentSection.ref, currentTextEdits);
  }

  // ── Navigation ──

  function renderBooksScreen() {
    UI.showScreen('books');
    UI.setHeader({ title: `📖 סידור v${SD.Version.current}`, showBack: false, showViewToggle: false, showToc: false, showEnToggle: false });
    UI.renderBookCategories(Api.getLiturgyBooks(), onSelectBook);
    renderMySiddurstWithShortcuts();
    filterBooks('');
    updateStorageInfo();
  }

  function renderMySiddurstWithShortcuts() {
    UI.renderMySiddurs(siddurs, {
      onOpen: (s) => { currentSiddur = s; openToc(s); },
      onDelete: onDeleteSiddur,
      onShortcutClick: (siddurId, ref) => navigateToShortcut(siddurId, ref),
      onShortcutDelete: (siddurId, shortcutId) => deleteShortcut(siddurId, shortcutId),
      onShortcutRename: (siddurId, shortcutId, newLabel) => renameShortcut(siddurId, shortcutId, newLabel),
    });
  }

  async function updateStorageInfo() {
    const el = $('storage-info');
    if (!el || !navigator.storage?.estimate) return;
    try {
      const { usage, quota } = await navigator.storage.estimate();
      const usageMB = (usage / 1024 / 1024).toFixed(1);
      const quotaMB = Math.round(quota / 1024 / 1024);
      el.textContent = `אחסון: ${usageMB} MB בשימוש מתוך ${quotaMB} MB`;
    } catch { el.textContent = ''; }
  }

  function filterBooks(query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.book-card').forEach(card => {
      const text = (card.querySelector('.book-he')?.textContent + ' ' + card.querySelector('.book-en')?.textContent).toLowerCase();
      card.style.display = q && !text.includes(q) ? 'none' : '';
    });
  }

  async function onSelectBook(book) {
    try {
      UI.toast('טוען...', '');
      const index = await Api.fetchBookIndex(book.title);
      currentBookIndex = index;

      let siddur = siddurs.find(s => s.title === book.title);
      if (!siddur) {
        siddur = {
          id: Storage.genId(),
          title: book.title,
          heTitle: book.heTitle || index.heTitle || book.title,
          currentRef: null,
          createdAt: Date.now(),
        };
        siddurs.unshift(siddur);
        await Storage.saveSiddur(siddur);
      }
      currentSiddur = siddur;
      openToc(siddur, index);
    } catch (e) {
      UI.toast('שגיאה: ' + e.message, 'error');
    }
  }

  async function openToc(siddur, index) {
    localStorage.setItem('sd.lastSiddurId', siddur.id);
    try {
      if (!index) {
        UI.toast('טוען תוכן עניינים...', '');
        index = await Api.fetchBookIndex(siddur.title);
        currentBookIndex = index;
      }
      currentTocItems = Api.flattenSchema(index.schema, '');
      const items = currentTocItems.filter((_, i) => i > 0 || currentTocItems[0]?.isLeaf);
      const annotatedRefs = await Storage.loadAnnotatedRefs(siddur.id);

      UI.showScreen('toc');
      UI.setHeader({ title: siddur.heTitle || siddur.title, showBack: true, showViewToggle: false, showToc: false, showEnToggle: false });
      UI.$('toc-book-title').textContent = siddur.heTitle || siddur.title;
      UI.$('toc-book-hetitle').textContent = siddur.title;
      const removedSet = new Set(siddur.removedSections || []);
      const removedGroupsSet = new Set(siddur.removedGroups || []);
      const foldedGroupsSet = new Set(siddur.foldedGroups || []);
      UI.renderToc(items, siddur.currentRef, annotatedRefs, removedSet, {
        onSelect: (ref) => openSection(ref),
        onRemove: (ref) => removeSection(ref),
        onRestore: (ref) => restoreSection(ref),
        onRemoveGroup: (he) => removeGroup(he),
        onExportGroup: (he) => openDocxModal('group', he),
        onToggleFold: (he) => toggleFoldGroup(he),
      }, { filterToAnnotated: tocFilter, removedGroups: removedGroupsSet, foldedGroups: foldedGroupsSet });
      _updateTocFilterBtn();
    } catch (e) {
      UI.toast('שגיאה: ' + e.message, 'error');
    }
  }

  async function openSection(ref, scrollTo = 'top') {
    try {
      UI.toast('טוען...', '');
      const section = await Api.fetchSection(ref);
      currentSection = section;

      if (currentSiddur) {
        currentSiddur.currentRef = ref;
        await Storage.saveSiddur(currentSiddur);
      }

      const [ann, edits] = await Promise.all([
        Storage.loadAnnotation(currentSiddur.id, ref),
        Storage.loadTextEdits(currentSiddur.id, ref),
      ]);
      currentAnnotation = ann;
      currentTextEdits = edits;

      renderReader(scrollTo);
    } catch (e) {
      const msg = !navigator.onLine ? 'אין חיבור לאינטרנט — הפרק לא נמצא במטמון' : 'שגיאה: ' + e.message;
      UI.toast(msg, 'error');
    }
  }

  function renderReader(scrollTo = 'top') {
    if (!currentSection) return;

    const shortTitle = shortSectionTitle(currentSection.heRef || currentSection.ref);
    const ann = currentAnnotation || { customTitle: null, insertions: [], removedParagraphs: [] };
    const isRemoved = (currentSiddur?.removedSections || []).includes(currentSection.ref);

    UI.showScreen('reader');
    UI.setHeader({ title: shortTitle, showBack: true, showViewToggle: !isRemoved, showToc: true, showEnToggle: !isRemoved });
    UI.$('reader-section-title').textContent = ann.customTitle || shortTitle;
    UI.updateSectionNav(currentSection.prev, currentSection.next);
    $('btn-remove-section').hidden = isRemoved;
    $('btn-add-shortcut').hidden = isRemoved;
    $('btn-export-docx').hidden = isRemoved;
    $('btn-undo-merge').hidden = !(ann.mergeUndoStack?.length > 0);
    $('btn-fold-all').hidden = isRemoved;
    {
      const folded = ann.foldedParagraphs || [];
      const allFolded = !isRemoved && currentSection && folded.length > 0 && (() => {
        const removed2 = new Set(ann.removedParagraphs || []);
        const inMerge2 = new Set();
        (ann.merges || []).forEach(g => { const s=[...g].sort((a,b)=>a-b); s.slice(1).forEach(i=>inMerge2.add(i)); });
        for (let i = 0; i < currentSection.he.length; i++) {
          if (removed2.has(i) || inMerge2.has(i)) continue;
          if (!folded.includes(i)) return false;
        }
        return true;
      })();
      $('btn-fold-all').textContent = allFolded ? '⊞' : '⊟';
      $('btn-fold-all').title = allFolded ? 'הרחבת כל הפסקאות' : 'כיווץ כל הפסקאות';
    }

    if (isRemoved) {
      UI.renderRemovedSection({
        title: ann.customTitle || shortTitle,
        onRestore: () => restoreSection(currentSection.ref),
      });
    } else {
      UI.setEnVisible(showEn);
      UI.renderReader({
        sectionData: currentSection,
        annotations: ann,
        textEdits: currentTextEdits,
        viewMode,
        showEn,
        title: ann.customTitle || shortTitle,
        handlers: {
          onAddInsertion: (pos) => openInsertionEditor(pos, null, 'inline'),
          onAddBetweenInsertion: (pos) => openInsertionEditor(pos, null, 'between'),
          onEditInsertion: (ins) => openInsertionEditor(ins.beforeParagraph, ins),
          onDeleteInsertion: (id) => deleteInsertion(id),
          onEditParagraph: (index, text) => saveParagraphEdit(index, text),
          onRestoreParagraph: (index) => restoreParagraph(index),
          onRemoveParagraph: (index) => removeParagraph(index),
          onRemoveParagraphs: (indices) => removeParagraphs(indices),
          onRestoreRemovedGroup: (indices) => restoreRemovedGroup(indices),
          onMerge: (unitIdx) => doMerge(unitIdx),
          onDemerge: (indices) => doDemerge(indices),
          onToggleFoldParagraph: (index) => toggleFoldParagraph(index),
        },
      });
    }

    requestAnimationFrame(() => {
      if (typeof scrollTo === 'number') {
        window.scrollTo({ top: scrollTo });
      } else if (scrollTo === 'bottom') {
        window.scrollTo({ top: document.body.scrollHeight });
      } else {
        window.scrollTo({ top: 0 });
      }
    });
  }

  function shortSectionTitle(heRef) {
    if (!heRef) return '';
    const parts = heRef.split(',').map(p => p.trim());
    return parts.slice(-2).join(' · ');
  }

  // ── Annotations ──

  function openInsertionEditor(beforeParagraph, existing, type) {
    const insType = type || existing?.type || 'inline';
    UI.openInsertionEditor({
      existing,
      onSave: (data) => saveInsertion(beforeParagraph, existing?.id, data, insType),
      onCancel: () => UI.closeInsertionEditor(),
    });
  }

  async function saveInsertion(beforeParagraph, existingId, data, type = 'inline') {
    if (!data.title && !data.text && data.images.length === 0) {
      UI.closeInsertionEditor();
      return;
    }
    const ann = ensureAnnotation();

    if (existingId) {
      const ins = ann.insertions.find(i => i.id === existingId);
      if (ins) { ins.title = data.title; ins.text = data.text; ins.images = data.images; ins.aiPrompt = data.aiPrompt || ''; }
    } else {
      ann.insertions.push({ id: Storage.genId(), beforeParagraph, type, title: data.title, text: data.text, images: data.images, aiPrompt: data.aiPrompt || '' });
      ann.insertions.sort((a, b) => a.beforeParagraph - b.beforeParagraph);
    }

    const savedY = window.scrollY;
    try { await persistAnnotation(); } catch (e) { UI.toast(e.message, 'error'); return; }
    UI.closeInsertionEditor();
    renderReader(savedY);
    UI.toast('נשמר', 'success');
  }

  async function deleteInsertion(id) {
    const ann = ensureAnnotation();
    ann.insertions = ann.insertions.filter(i => i.id !== id);
    const savedY = window.scrollY;
    await persistAnnotation();
    renderReader(savedY);
    UI.toast('נמחק', '');
  }

  async function saveParagraphEdit(index, text) {
    currentTextEdits = currentTextEdits || {};
    currentTextEdits[index] = text;
    const savedY = window.scrollY;
    try { await persistTextEdits(); } catch (e) { UI.toast(e.message, 'error'); return; }
    renderReader(savedY);
    UI.toast('נשמר', 'success');
  }

  async function restoreParagraph(index) {
    currentTextEdits = currentTextEdits || {};
    delete currentTextEdits[index];
    const savedY = window.scrollY;
    await persistTextEdits();
    renderReader(savedY);
    UI.toast('הטקסט המקורי שוחזר', '');
  }

  async function removeParagraph(index) {
    const ann = ensureAnnotation();
    ann.removedParagraphs = ann.removedParagraphs || [];
    if (!ann.removedParagraphs.includes(index)) {
      ann.removedParagraphs.push(index);
      ann.removedParagraphs.sort((a, b) => a - b);
    }
    const savedY = window.scrollY;
    await persistAnnotation();
    renderReader(savedY);
  }

  async function restoreRemovedGroup(indices) {
    const ann = ensureAnnotation();
    const set = new Set(indices);
    ann.removedParagraphs = (ann.removedParagraphs || []).filter(i => !set.has(i));
    const savedY = window.scrollY;
    await persistAnnotation();
    renderReader(savedY);
  }

  async function removeParagraphs(indices) {
    const ann = ensureAnnotation();
    ann.removedParagraphs = ann.removedParagraphs || [];
    indices.forEach(i => { if (!ann.removedParagraphs.includes(i)) ann.removedParagraphs.push(i); });
    ann.removedParagraphs.sort((a, b) => a - b);
    const savedY = window.scrollY;
    await persistAnnotation();
    renderReader(savedY);
  }

  async function doMerge(unitIdx) {
    const ann = ensureAnnotation();
    ann.merges = ann.merges || [];
    ann.mergeUndoStack = ann.mergeUndoStack || [];
    const allItems = UI.computeDisplayUnits(
      currentSection.he.length,
      ann.merges,
      new Set(ann.removedParagraphs || [])
    );
    const unitItems = allItems.filter(it => it.type === 'unit');
    if (unitIdx <= 0 || unitIdx >= unitItems.length) return;
    const prevUnit = unitItems[unitIdx - 1];
    const currUnit = unitItems[unitIdx];
    ann.mergeUndoStack.push(JSON.parse(JSON.stringify(ann.merges)));
    const allAffected = new Set([...prevUnit.indices, ...currUnit.indices]);
    ann.merges = ann.merges.filter(g => !g.some(i => allAffected.has(i)));
    ann.merges.push([...prevUnit.indices, ...currUnit.indices].sort((a, b) => a - b));
    const savedY = window.scrollY;
    await persistAnnotation();
    renderReader(savedY);
  }

  async function undoMerge() {
    const ann = ensureAnnotation();
    ann.mergeUndoStack = ann.mergeUndoStack || [];
    if (ann.mergeUndoStack.length === 0) return;
    ann.merges = ann.mergeUndoStack.pop();
    const savedY = window.scrollY;
    await persistAnnotation();
    renderReader(savedY);
  }

  async function doDemerge(groupIndices) {
    const ann = ensureAnnotation();
    ann.merges = ann.merges || [];
    ann.mergeUndoStack = ann.mergeUndoStack || [];
    ann.mergeUndoStack.push(JSON.parse(JSON.stringify(ann.merges)));
    const groupSet = new Set(groupIndices);
    ann.merges = ann.merges.filter(g => !g.some(i => groupSet.has(i)));
    const savedY = window.scrollY;
    await persistAnnotation();
    renderReader(savedY);
  }

  async function removeSection(ref) {
    if (!currentSiddur) return;
    currentSiddur.removedSections = currentSiddur.removedSections || [];
    if (!currentSiddur.removedSections.includes(ref)) {
      currentSiddur.removedSections.push(ref);
      await Storage.saveSiddur(currentSiddur);
    }
    UI.toast('הפרק הוסר', '');
    if (currentBookIndex) openToc(currentSiddur, currentBookIndex);
  }

  async function removeGroup(he) {
    if (!currentSiddur) return;
    currentSiddur.removedGroups = currentSiddur.removedGroups || [];
    if (!currentSiddur.removedGroups.includes(he)) {
      currentSiddur.removedGroups.push(he);
      await Storage.saveSiddur(currentSiddur);
    }
    UI.toast('החלק הוסר', '');
    if (currentBookIndex) openToc(currentSiddur, currentBookIndex);
  }

  async function restoreGroup(he) {
    if (!currentSiddur) return;
    currentSiddur.removedGroups = (currentSiddur.removedGroups || []).filter(g => g !== he);
    await Storage.saveSiddur(currentSiddur);
    UI.toast('החלק שוחזר', 'success');
    if (currentBookIndex) openToc(currentSiddur, currentBookIndex);
  }

  async function toggleFoldGroup(he) {
    if (!currentSiddur) return;
    currentSiddur.foldedGroups = currentSiddur.foldedGroups || [];
    const idx = currentSiddur.foldedGroups.indexOf(he);
    if (idx >= 0) {
      currentSiddur.foldedGroups.splice(idx, 1);
    } else {
      currentSiddur.foldedGroups.push(he);
    }
    await Storage.saveSiddur(currentSiddur);
    if (currentBookIndex) openToc(currentSiddur, currentBookIndex);
  }

  async function toggleFoldParagraph(index) {
    const ann = ensureAnnotation();
    ann.foldedParagraphs = ann.foldedParagraphs || [];
    const pos = ann.foldedParagraphs.indexOf(index);
    if (pos >= 0) {
      ann.foldedParagraphs.splice(pos, 1);
    } else {
      ann.foldedParagraphs.push(index);
    }
    const savedY = window.scrollY;
    await persistAnnotation();
    renderReader(savedY);
  }

  async function toggleFoldAll() {
    if (!currentSection) return;
    const ann = ensureAnnotation();
    const removed = new Set(ann.removedParagraphs || []);
    const mergeGroups = new Map();
    (ann.merges || []).forEach(group => {
      const sorted = [...group].sort((a, b) => a - b);
      mergeGroups.set(sorted[0], sorted);
    });
    const inMerge = new Set();
    mergeGroups.forEach((g) => g.forEach(i => inMerge.add(i)));
    const visibleFirstIndices = [];
    for (let i = 0; i < currentSection.he.length; i++) {
      if (removed.has(i)) continue;
      if (inMerge.has(i) && !mergeGroups.has(i)) continue;
      visibleFirstIndices.push(i);
    }
    const folded = ann.foldedParagraphs || [];
    const allFolded = visibleFirstIndices.every(i => folded.includes(i));
    ann.foldedParagraphs = allFolded ? [] : [...visibleFirstIndices];
    const savedY = window.scrollY;
    await persistAnnotation();
    renderReader(savedY);
  }

  async function restoreSection(ref) {
    if (!currentSiddur) return;
    currentSiddur.removedSections = (currentSiddur.removedSections || []).filter(r => r !== ref);
    await Storage.saveSiddur(currentSiddur);
    UI.toast('הפרק שוחזר', 'success');
    if (currentSection?.ref === ref) {
      await openSection(ref, 'top');
    } else if (currentBookIndex) {
      openToc(currentSiddur, currentBookIndex);
    }
  }

  async function onDeleteSiddur(siddur) {
    siddurs = siddurs.filter(s => s.id !== siddur.id);
    if (localStorage.getItem('sd.lastSiddurId') === siddur.id) localStorage.removeItem('sd.lastSiddurId');
    await Storage.deleteSiddur(siddur.id);
    renderMySiddurstWithShortcuts();
    UI.toast('הסידור הוסר מהרשימה', '');
  }

  // ── Shortcuts ──

  async function addShortcut() {
    if (!currentSiddur || !currentSection) return;
    currentSiddur.shortcuts = currentSiddur.shortcuts || [];
    const ref = currentSection.ref;
    if (currentSiddur.shortcuts.some(s => s.ref === ref)) {
      UI.toast('קיצור לפרק זה כבר קיים', '');
      return;
    }
    const label = (currentAnnotation?.customTitle) || shortSectionTitle(currentSection.heRef || ref);
    currentSiddur.shortcuts.push({ id: Storage.genId(), ref, label, createdAt: Date.now() });
    await Storage.saveSiddur(currentSiddur);
    UI.toast('קיצור נוסף', 'success');
  }

  async function deleteShortcut(siddurId, shortcutId) {
    const siddur = siddurs.find(s => s.id === siddurId);
    if (!siddur) return;
    siddur.shortcuts = (siddur.shortcuts || []).filter(s => s.id !== shortcutId);
    await Storage.saveSiddur(siddur);
    renderMySiddurstWithShortcuts();
  }

  async function renameShortcut(siddurId, shortcutId, newLabel) {
    const siddur = siddurs.find(s => s.id === siddurId);
    if (!siddur) return;
    const sc = (siddur.shortcuts || []).find(s => s.id === shortcutId);
    if (!sc) return;
    sc.label = newLabel;
    await Storage.saveSiddur(siddur);
    renderMySiddurstWithShortcuts();
  }

  async function navigateToShortcut(siddurId, ref) {
    const siddur = siddurs.find(s => s.id === siddurId);
    if (!siddur) return;
    currentSiddur = siddur;
    localStorage.setItem('sd.lastSiddurId', siddur.id);
    try {
      const index = await Api.fetchBookIndex(siddur.title);
      currentBookIndex = index;
      currentTocItems = Api.flattenSchema(index.schema, '');
    } catch { /* offline: back will go to books screen */ }
    await openSection(ref, 'top');
  }

  // ── TOC filter ──

  function _updateTocFilterBtn() {
    const btn = $('btn-toc-filter');
    if (!btn) return;
    btn.textContent = tocFilter ? '⊚ הצג הכל' : '⊚ הצג רק פרקים שנגעתי';
    btn.classList.toggle('active', tocFilter);
  }

  async function toggleTocFilter() {
    tocFilter = !tocFilter;
    localStorage.setItem('sd.tocFilter', tocFilter);
    _updateTocFilterBtn();
    if (!currentSiddur || !currentBookIndex) return;
    const items = currentTocItems.filter((_, i) => i > 0 || currentTocItems[0]?.isLeaf);
    const removedSet = new Set(currentSiddur.removedSections || []);
    const removedGroupsSet = new Set(currentSiddur.removedGroups || []);
    const foldedGroupsSet = new Set(currentSiddur.foldedGroups || []);
    const annotatedRefs = await Storage.loadAnnotatedRefs(currentSiddur.id);
    UI.renderToc(items, currentSiddur.currentRef, annotatedRefs, removedSet, {
      onSelect: (ref) => openSection(ref),
      onRemoveGroup: (he) => removeGroup(he),
      onExportGroup: (he) => openDocxModal('group', he),
      onToggleFold: (he) => toggleFoldGroup(he),
    }, { filterToAnnotated: tocFilter, removedGroups: removedGroupsSet, foldedGroups: foldedGroupsSet });
  }

  // ── AI image generation ──

  function openAiImageModal() {
    const basePrompt = localStorage.getItem('sd.aiBasePrompt') || '';
    $('ai-base-prompt-display').textContent = basePrompt ? `פרומפט בסיס: ${basePrompt}` : '';
    $('ai-prompt-input').value = UI.getInsertionAiPrompt();
    $('ai-image-result').hidden = true;
    $('ai-status').textContent = '';
    $('btn-ai-approve').hidden = true;
    _aiPendingDataUrl = null;
    $('modal-insertion').hidden = true;
    $('modal-ai-image').hidden = false;
    $('ai-prompt-input').focus();
  }

  function closeAiImageModal() {
    $('modal-ai-image').hidden = true;
    _aiPendingDataUrl = null;
    _aiPendingPrompt = '';
    $('modal-insertion').hidden = false;
  }

  async function doAiGenerate() {
    const key = localStorage.getItem('sd.aiKey') || '';
    if (!key) { $('ai-status').textContent = 'נדרש מפתח OpenAI — הגדר בהגדרות ⚙'; return; }
    const specific = $('ai-prompt-input').value.trim();
    const base = localStorage.getItem('sd.aiBasePrompt') || '';
    const fullPrompt = [base, specific].filter(Boolean).join('\n').trim();
    if (!fullPrompt) { $('ai-status').textContent = 'יש להזין תיאור לתמונה'; return; }

    const model = localStorage.getItem('sd.aiModel') || 'gpt-image-1';
    // Approximate cost per image per model
    const costMap = { 'gpt-image-1': 0.02, 'dall-e-3': 0.04, 'dall-e-2': 0.02 };
    const imgCost = costMap[model] ?? 0.04;

    const genBtn = $('btn-ai-generate');
    genBtn.disabled = true;
    $('btn-ai-approve').hidden = true;
    $('ai-image-result').hidden = true;
    $('ai-status').textContent = 'יוצר תמונה... (כ-10 שניות)';

    try {
      // dall-e-2 supports response_format:b64_json (avoids secondary URL fetch)
      // gpt-image-1 returns b64_json by default; dall-e-3 rejects the parameter
      const reqBody = { model, prompt: fullPrompt, n: 1, size: '1024x1024' };
      if (model === 'dall-e-2') reqBody.response_format = 'b64_json';

      const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify(reqBody),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || `שגיאת שרת ${resp.status}`);
      }
      const data = await resp.json();
      const item = data.data[0];
      if (item.b64_json) {
        _aiPendingDataUrl = `data:image/png;base64,${item.b64_json}`;
      } else if (item.url) {
        // URL response — try fetch with auth, then without, then canvas
        const toDataUrl = blob => new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = rej;
          r.readAsDataURL(blob);
        });
        let blob = null;
        try {
          const r1 = await fetch(item.url, { headers: { Authorization: `Bearer ${key}` } });
          if (r1.ok) blob = await r1.blob();
        } catch {}
        if (!blob) {
          try {
            const r2 = await fetch(item.url);
            if (r2.ok) blob = await r2.blob();
          } catch {}
        }
        if (blob) {
          _aiPendingDataUrl = await toDataUrl(blob);
        } else {
          // Last resort: canvas (works when CORS headers allow img src)
          _aiPendingDataUrl = await new Promise((res, rej) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              try {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth || 1024;
                c.height = img.naturalHeight || 1024;
                c.getContext('2d').drawImage(img, 0, 0);
                res(c.toDataURL('image/png'));
              } catch (e) { rej(e); }
            };
            img.onerror = () => rej(new Error('לא ניתן לטעון את התמונה מהשרת'));
            img.src = item.url;
          });
        }
      } else {
        throw new Error('תגובה לא צפויה מ-OpenAI');
      }
      _aiPendingPrompt = specific;
      const prev = parseFloat(localStorage.getItem('sd.aiCost') || '0');
      localStorage.setItem('sd.aiCost', (prev + imgCost).toFixed(4));
      $('ai-result-img').src = _aiPendingDataUrl;
      $('ai-image-result').hidden = false;
      $('ai-status').textContent = `עלות: $${imgCost.toFixed(2)} | ניתן לנסות שוב עם פרומפט אחר`;
      $('btn-ai-approve').hidden = false;
    } catch (e) {
      $('ai-status').textContent = 'שגיאה: ' + e.message;
    } finally {
      genBtn.disabled = false;
    }
  }

  function approveAiImage() {
    if (!_aiPendingDataUrl) return;
    UI.setInsertionAiPrompt(_aiPendingPrompt);
    UI.addImageToEditor({ id: Storage.genId(), dataUrl: _aiPendingDataUrl });
    closeAiImageModal();
  }

  // ── Image handling ──

  function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    UI.openImageEditor(file, (imgData) => {
      imgData.id = Storage.genId();
      UI.addImageToEditor(imgData);
    }, () => {});
  }

  // ── Edit section title ──

  async function editSectionTitle() {
    if (!currentSection) return;
    const ann = ensureAnnotation();
    const val = prompt('כותרת מותאמת אישית לפרק (ריק = ברירת מחדל):', ann.customTitle || '');
    if (val === null) return;
    ann.customTitle = val.trim() || null;
    const savedY = window.scrollY;
    await persistAnnotation();
    renderReader(savedY);
  }

  // ── DOCX export ──

  function openDocxModal(mode, groupHe) {
    _pendingDocxExport = { mode, groupHe };
    if (mode === 'group') {
      $('docx-modal-subtitle').textContent = `ייצוא החלק: ${groupHe}`;
    } else {
      const title = currentAnnotation?.customTitle || shortSectionTitle(currentSection?.heRef || currentSection?.ref || '');
      $('docx-modal-subtitle').textContent = `ייצוא הפרק: ${title}`;
    }
    $('docx-status').textContent = '';
    $('btn-do-docx').disabled = false;
    $('modal-docx').hidden = false;
  }

  async function doDocxExport() {
    if (!_pendingDocxExport) return;
    const landscape = document.querySelector('input[name="docx-orient"]:checked')?.value !== 'portrait';
    const btn = $('btn-do-docx');
    btn.disabled = true;
    $('docx-status').textContent = 'מייצא...';
    try {
      if (_pendingDocxExport.mode === 'section') {
        const title = currentAnnotation?.customTitle || shortSectionTitle(currentSection?.heRef || currentSection?.ref || '');
        await SD.Export.exportSection({
          sectionData: currentSection,
          annotation: currentAnnotation,
          textEdits: currentTextEdits,
          title,
          landscape,
        });
      } else {
        const items = currentTocItems.filter((_, i) => i > 0 || currentTocItems[0]?.isLeaf);
        await SD.Export.exportGroup({
          groupHe: _pendingDocxExport.groupHe,
          tocItems: items,
          siddurId: currentSiddur.id,
          removedSections: currentSiddur.removedSections || [],
          landscape,
          onProgress: (msg) => { $('docx-status').textContent = msg; },
        });
      }
      $('docx-status').textContent = 'הקובץ הורד ✓';
      btn.disabled = false;
      setTimeout(() => { $('modal-docx').hidden = true; }, 1800);
    } catch (e) {
      $('docx-status').textContent = 'שגיאה: ' + e.message;
      btn.disabled = false;
    }
  }

  // ── Event wiring ──

  function wireEvents() {
    $('input-book-search').addEventListener('input', (e) => filterBooks(e.target.value));

    $('btn-back').addEventListener('click', () => {
      const active = document.querySelector('.screen.active');
      if (active?.id === 'screen-reader') {
        if (currentBookIndex) openToc(currentSiddur, currentBookIndex);
        else renderBooksScreen();
      } else {
        renderBooksScreen();
      }
    });

    $('btn-view-toggle').addEventListener('click', () => {
      viewMode = viewMode === 'wide' ? 'normal' : 'wide';
      localStorage.setItem('sd.viewMode', viewMode);
      renderReader();
    });

    $('btn-en-toggle').addEventListener('click', () => {
      showEn = !showEn;
      localStorage.setItem('sd.showEn', showEn);
      UI.setEnVisible(showEn);
    });

    $('btn-toc').addEventListener('click', () => {
      if (currentSiddur && currentBookIndex) openToc(currentSiddur, currentBookIndex);
    });

    $('btn-prev-section').addEventListener('click', () => currentSection?.prev && openSection(currentSection.prev, 'bottom'));
    $('btn-next-section').addEventListener('click', () => currentSection?.next && openSection(currentSection.next, 'top'));
    $('btn-prev-section-bottom').addEventListener('click', () => currentSection?.prev && openSection(currentSection.prev, 'bottom'));
    $('btn-next-section-bottom').addEventListener('click', () => currentSection?.next && openSection(currentSection.next, 'top'));

    document.addEventListener('keydown', (e) => {
      if (!$('modal-insertion').hidden || !$('modal-image').hidden) return;
      if (e.key === 'ArrowLeft' && currentSection?.next) openSection(currentSection.next, 'top');
      if (e.key === 'ArrowRight' && currentSection?.prev) openSection(currentSection.prev, 'bottom');
    });

    $('btn-toc-filter').addEventListener('click', () => toggleTocFilter());
    $('btn-edit-section-title').addEventListener('click', editSectionTitle);
    $('btn-add-shortcut').addEventListener('click', () => addShortcut());
    $('btn-undo-merge').addEventListener('click', () => undoMerge());
    $('btn-remove-section').addEventListener('click', () => {
      if (currentSection && currentSiddur) removeSection(currentSection.ref);
    });

    $('btn-fold-all').addEventListener('click', () => toggleFoldAll());

    // DOCX export
    $('btn-export-docx').addEventListener('click', () => { if (currentSection) openDocxModal('section', null); });
    $('btn-do-docx').addEventListener('click', () => doDocxExport());
    $('btn-close-docx').addEventListener('click', () => { $('modal-docx').hidden = true; });
    $('modal-docx').addEventListener('click', (e) => { if (e.target === $('modal-docx')) $('modal-docx').hidden = true; });

    // Settings
    $('btn-settings').addEventListener('click', () => {
      const removedItems = currentSiddur
        ? (currentSiddur.removedSections || []).map(ref => {
            const item = currentTocItems.find(i => i.ref === ref);
            return { ref, label: item?.he || ref };
          })
        : [];
      const removedGroupItems = currentSiddur
        ? (currentSiddur.removedGroups || []).map(he => ({ he }))
        : [];
      UI.renderSettings($('settings-content'), SD.Version, {
        siddurs,
        currentSiddurId: currentSiddur?.id,
        removedItems,
        removedGroupItems,
        onRestoreSection: async (ref) => {
          $('modal-settings').hidden = true;
          await restoreSection(ref);
        },
        onRestoreGroup: async (he) => {
          $('modal-settings').hidden = true;
          await restoreGroup(he);
        },
        onSwitchSiddur: (s) => {
          $('modal-settings').hidden = true;
          currentSiddur = s;
          openToc(s);
        },
        onGoToBookshelf: () => {
          $('modal-settings').hidden = true;
          renderBooksScreen();
        },
        onAiSettingsSave: (key, basePrompt, model) => {
          localStorage.setItem('sd.aiKey', key);
          localStorage.setItem('sd.aiBasePrompt', basePrompt);
          localStorage.setItem('sd.aiModel', model || 'gpt-image-1');
          UI.toast('הגדרות AI נשמרו', 'success');
        },
      });
      $('modal-settings').hidden = false;
    });
    $('btn-close-settings').addEventListener('click', () => { $('modal-settings').hidden = true; });
    $('modal-settings').addEventListener('click', (e) => { if (e.target === $('modal-settings')) $('modal-settings').hidden = true; });

    // Export / Import
    $('btn-export').addEventListener('click', () => { $('modal-export').hidden = false; $('export-status').textContent = ''; });
    $('btn-close-export').addEventListener('click', () => { $('modal-export').hidden = true; });
    $('btn-do-export').addEventListener('click', async () => {
      await Storage.exportBackup();
      $('export-status').textContent = 'הקובץ הורד';
    });
    $('input-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await Storage.importBackup(file);
        siddurs = await Storage.loadSiddurs();
        $('modal-export').hidden = true;
        renderBooksScreen();
        UI.toast('ייבוא הצליח', 'success');
      } catch (err) {
        $('export-status').textContent = 'שגיאה: ' + err.message;
      }
    });

    // Insertion editor
    $('btn-ai-image').addEventListener('click', () => openAiImageModal());
    $('btn-ai-generate').addEventListener('click', () => doAiGenerate());
    $('btn-ai-approve').addEventListener('click', () => approveAiImage());
    $('btn-ai-cancel').addEventListener('click', () => closeAiImageModal());
    $('modal-ai-image').addEventListener('click', (e) => { if (e.target === $('modal-ai-image')) closeAiImageModal(); });

    $('btn-insertion-bold').addEventListener('click', () => UI.applyBold($('insertion-text-input')));
    $('btn-insertion-save').addEventListener('click', () => {
      const { onSave } = UI.getInsertionEditorCallbacks();
      if (onSave) onSave(UI.getInsertionEditorData());
    });
    $('btn-insertion-cancel').addEventListener('click', () => UI.closeInsertionEditor());

    $('input-image-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) handleImageFile(file);
    });

    document.addEventListener('paste', (e) => {
      if ($('modal-insertion').hidden && $('modal-image').hidden) return;
      const items = Array.from(e.clipboardData?.items || []);
      const imgItem = items.find(i => i.type.startsWith('image/'));
      if (!imgItem) return;
      e.preventDefault();
      handleImageFile(imgItem.getAsFile());
    });

    // Image editor
    $('btn-rotate-ccw').addEventListener('click', () => UI.rotateImageEditor('ccw'));
    $('btn-rotate-cw').addEventListener('click', () => UI.rotateImageEditor('cw'));
    $('btn-crop-reset').addEventListener('click', () => UI.resetCrop());
    $('btn-image-confirm').addEventListener('click', () => UI.confirmImageEditor());
    $('btn-image-cancel').addEventListener('click', () => { UI.closeImageEditor(); $('modal-insertion').hidden = false; });

    // Close modals on overlay click
    $('modal-export').addEventListener('click', (e) => { if (e.target === $('modal-export')) $('modal-export').hidden = true; });
    $('modal-insertion').addEventListener('click', (e) => { if (e.target === $('modal-insertion')) UI.closeInsertionEditor(); });
    $('modal-image').addEventListener('click', (e) => { if (e.target === $('modal-image')) { UI.closeImageEditor(); $('modal-insertion').hidden = false; } });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => SD.App.init());
