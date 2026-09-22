window.SD = window.SD || {};

SD.App = (function () {
  const UI = SD.UI;
  const Api = SD.Api;
  const Storage = SD.Storage;

  let state = Storage.load();
  let viewMode = localStorage.getItem('sd.viewMode') || 'normal';
  let showEn = localStorage.getItem('sd.showEn') !== 'false';

  let currentSiddur = null;
  let currentSection = null;   // { ref, heRef, he, text, next, prev }
  let currentTocItems = [];
  let currentBookIndex = null;

  function $(id) { return document.getElementById(id); }

  // ── Init ──

  function init() {
    UI.wireCropCanvas();
    wireEvents();
    renderBooksScreen();
  }

  // ── Navigation ──

  function renderBooksScreen() {
    UI.showScreen('books');
    UI.setHeader({ title: '📖 סידור', showBack: false, showViewToggle: false, showToc: false, showEnToggle: false });
    UI.renderBookCategories(Api.getLiturgyBooks(), onSelectBook);
    UI.renderMySiddurs(state.siddurs, {
      onOpen: (s) => { currentSiddur = s; openToc(s); },
      onDelete: onDeleteSiddur,
    });
    filterBooks('');
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

      if (!state.siddurs.find(s => s.title === book.title)) {
        const newSiddur = {
          id: Storage.genId(),
          title: book.title,
          heTitle: book.heTitle || index.heTitle || book.title,
          currentRef: null,
        };
        state.siddurs.unshift(newSiddur);
        Storage.save(state);
        currentSiddur = newSiddur;
      } else {
        currentSiddur = state.siddurs.find(s => s.title === book.title);
      }

      openToc(currentSiddur, index);
    } catch (e) {
      UI.toast('שגיאה: ' + e.message, 'error');
    }
  }

  async function openToc(siddur, index) {
    try {
      if (!index) {
        UI.toast('טוען תוכן עניינים...', '');
        index = await Api.fetchBookIndex(siddur.title);
        currentBookIndex = index;
      }
      currentTocItems = Api.flattenSchema(index.schema, '');
      const items = currentTocItems.filter((_, i) => i > 0 || currentTocItems[0]?.isLeaf);

      const siddurId = siddur.id;
      const annByRef = state.annotations[siddurId] || {};
      const annotatedRefs = new Set(
        Object.entries(annByRef)
          .filter(([, ann]) => ann.customTitle || ann.insertions?.length > 0)
          .map(([ref]) => ref)
      );
      const textEditsByRef = state.textEdits?.[siddurId] || {};
      Object.keys(textEditsByRef).forEach(ref => annotatedRefs.add(ref));

      UI.showScreen('toc');
      UI.setHeader({ title: siddur.heTitle || siddur.title, showBack: true, showViewToggle: false, showToc: false, showEnToggle: false });
      UI.$('toc-book-title').textContent = siddur.heTitle || siddur.title;
      UI.$('toc-book-hetitle').textContent = siddur.title;
      UI.renderToc(items, siddur.currentRef, annotatedRefs, (ref) => openSection(ref));
    } catch (e) {
      UI.toast('שגיאה: ' + e.message, 'error');
    }
  }

  async function openSection(ref) {
    try {
      UI.toast('טוען...', '');
      const section = await Api.fetchSection(ref);
      currentSection = section;

      if (currentSiddur) {
        currentSiddur.currentRef = ref;
        Storage.save(state);
      }

      renderReader();
    } catch (e) {
      UI.toast('שגיאה: ' + e.message, 'error');
    }
  }

  function renderReader() {
    if (!currentSection) return;

    const siddurId = currentSiddur?.id || '__default__';
    const ref = currentSection.ref;
    const annByRef = state.annotations[siddurId] || {};
    const ann = annByRef[ref] || { customTitle: null, insertions: [], removedParagraphs: [] };
    const textEdits = (state.textEdits?.[siddurId]?.[ref]) || {};

    const shortTitle = shortSectionTitle(currentSection.heRef || ref);

    UI.showScreen('reader');
    UI.setHeader({ title: shortTitle, showBack: true, showViewToggle: true, showToc: true, showEnToggle: true });
    UI.setEnVisible(showEn);
    UI.$('reader-section-title').textContent = ann.customTitle || shortTitle;
    UI.updateSectionNav(currentSection.prev, currentSection.next);

    UI.renderReader({
      sectionData: currentSection,
      annotations: ann,
      textEdits,
      viewMode,
      showEn,
      title: ann.customTitle || shortTitle,
      handlers: {
        onAddInsertion: (pos) => openInsertionEditor(pos, null),
        onEditInsertion: (ins) => openInsertionEditor(ins.beforeParagraph, ins),
        onDeleteInsertion: (id) => deleteInsertion(id),
        onEditParagraph: (index, text) => saveParagraphEdit(index, text),
        onRestoreParagraph: (index) => restoreParagraph(index),
        onRemoveParagraph: (index) => removeParagraph(index),
        onRestoreRemovedGroup: (indices) => restoreRemovedGroup(indices),
      },
    });
  }

  function shortSectionTitle(heRef) {
    if (!heRef) return '';
    const parts = heRef.split(',').map(p => p.trim());
    return parts.slice(-2).join(' · ');
  }

  // ── Annotations ──

  function getOrCreateAnnotation(siddurId, ref) {
    state.annotations[siddurId] = state.annotations[siddurId] || {};
    state.annotations[siddurId][ref] = state.annotations[siddurId][ref] || { customTitle: null, insertions: [], removedParagraphs: [] };
    return state.annotations[siddurId][ref];
  }

  function openInsertionEditor(beforeParagraph, existing) {
    UI.openInsertionEditor({
      existing,
      onSave: (data) => saveInsertion(beforeParagraph, existing?.id, data),
      onCancel: () => UI.closeInsertionEditor(),
    });
  }

  function saveInsertion(beforeParagraph, existingId, data) {
    if (!data.title && !data.text && data.images.length === 0) {
      UI.closeInsertionEditor();
      return;
    }
    const siddurId = currentSiddur?.id || '__default__';
    const ref = currentSection.ref;
    const ann = getOrCreateAnnotation(siddurId, ref);

    if (existingId) {
      const ins = ann.insertions.find(i => i.id === existingId);
      if (ins) { ins.title = data.title; ins.text = data.text; ins.images = data.images; }
    } else {
      ann.insertions.push({ id: Storage.genId(), beforeParagraph, title: data.title, text: data.text, images: data.images });
      ann.insertions.sort((a, b) => a.beforeParagraph - b.beforeParagraph);
    }

    try { Storage.save(state); } catch (e) { UI.toast(e.message, 'error'); return; }
    UI.closeInsertionEditor();
    renderReader();
    UI.toast('נשמר', 'success');
  }

  function deleteInsertion(id) {
    const siddurId = currentSiddur?.id || '__default__';
    const ref = currentSection.ref;
    const ann = getOrCreateAnnotation(siddurId, ref);
    ann.insertions = ann.insertions.filter(i => i.id !== id);
    Storage.save(state);
    renderReader();
    UI.toast('נמחק', '');
  }

  function saveParagraphEdit(index, text) {
    const siddurId = currentSiddur?.id || '__default__';
    const ref = currentSection.ref;
    state.textEdits = state.textEdits || {};
    state.textEdits[siddurId] = state.textEdits[siddurId] || {};
    state.textEdits[siddurId][ref] = state.textEdits[siddurId][ref] || {};
    state.textEdits[siddurId][ref][index] = text;
    try { Storage.save(state); } catch (e) { UI.toast(e.message, 'error'); return; }
    renderReader();
    UI.toast('נשמר', 'success');
  }

  function restoreParagraph(index) {
    const siddurId = currentSiddur?.id || '__default__';
    const ref = currentSection.ref;
    if (state.textEdits?.[siddurId]?.[ref]) {
      delete state.textEdits[siddurId][ref][index];
      Storage.save(state);
    }
    renderReader();
    UI.toast('הטקסט המקורי שוחזר', '');
  }

  function removeParagraph(index) {
    const siddurId = currentSiddur?.id || '__default__';
    const ref = currentSection.ref;
    const ann = getOrCreateAnnotation(siddurId, ref);
    ann.removedParagraphs = ann.removedParagraphs || [];
    if (!ann.removedParagraphs.includes(index)) {
      ann.removedParagraphs.push(index);
      ann.removedParagraphs.sort((a, b) => a - b);
    }
    Storage.save(state);
    renderReader();
  }

  function restoreRemovedGroup(indices) {
    const siddurId = currentSiddur?.id || '__default__';
    const ref = currentSection.ref;
    const ann = getOrCreateAnnotation(siddurId, ref);
    const set = new Set(indices);
    ann.removedParagraphs = (ann.removedParagraphs || []).filter(i => !set.has(i));
    Storage.save(state);
    renderReader();
  }

  function onDeleteSiddur(siddur) {
    if (!confirm(`למחוק את "${siddur.heTitle || siddur.title}" מהרשימה?`)) return;
    state.siddurs = state.siddurs.filter(s => s.id !== siddur.id);
    Storage.save(state);
    UI.renderMySiddurs(state.siddurs, {
      onOpen: (s) => { currentSiddur = s; openToc(s); },
      onDelete: onDeleteSiddur,
    });
    UI.toast('הסידור הוסר מהרשימה', '');
  }

  // ── Image handling ──

  function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    UI.openImageEditor(file, (imgData) => {
      imgData.id = Storage.genId();
      UI.addImageToEditor(imgData);
    }, () => {});
  }

  // ── Event wiring ──

  function wireEvents() {
    // Book search
    $('input-book-search').addEventListener('input', (e) => filterBooks(e.target.value));

    // Back button
    $('btn-back').addEventListener('click', () => {
      const active = document.querySelector('.screen.active');
      if (active?.id === 'screen-reader') {
        if (currentBookIndex) openToc(currentSiddur, currentBookIndex);
        else renderBooksScreen();
      } else {
        renderBooksScreen();
      }
    });

    // View toggle
    $('btn-view-toggle').addEventListener('click', () => {
      viewMode = viewMode === 'wide' ? 'normal' : 'wide';
      localStorage.setItem('sd.viewMode', viewMode);
      renderReader();
    });

    // EN toggle
    $('btn-en-toggle').addEventListener('click', () => {
      showEn = !showEn;
      localStorage.setItem('sd.showEn', showEn);
      UI.setEnVisible(showEn);
    });

    // TOC from reader
    $('btn-toc').addEventListener('click', () => {
      if (currentSiddur && currentBookIndex) openToc(currentSiddur, currentBookIndex);
    });

    // Navigation
    $('btn-prev-section').addEventListener('click', () => currentSection?.prev && openSection(currentSection.prev));
    $('btn-next-section').addEventListener('click', () => currentSection?.next && openSection(currentSection.next));
    $('btn-prev-section-bottom').addEventListener('click', () => currentSection?.prev && openSection(currentSection.prev));
    $('btn-next-section-bottom').addEventListener('click', () => currentSection?.next && openSection(currentSection.next));

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!$('modal-insertion').hidden || !$('modal-image').hidden) return;
      if (e.key === 'ArrowLeft') $('btn-next-section').click();
      if (e.key === 'ArrowRight') $('btn-prev-section').click();
    });

    // Edit section title
    $('btn-edit-section-title').addEventListener('click', () => {
      if (!currentSection) return;
      const siddurId = currentSiddur?.id || '__default__';
      const ref = currentSection.ref;
      const ann = getOrCreateAnnotation(siddurId, ref);
      const val = prompt('כותרת מותאמת אישית לפרק (ריק = ברירת מחדל):', ann.customTitle || '');
      if (val === null) return;
      ann.customTitle = val.trim() || null;
      Storage.save(state);
      renderReader();
    });

    // Export/Import
    $('btn-export').addEventListener('click', () => { $('modal-export').hidden = false; $('export-status').textContent = ''; });
    $('btn-close-export').addEventListener('click', () => { $('modal-export').hidden = true; });
    $('btn-do-export').addEventListener('click', () => { Storage.exportBackup(state); $('export-status').textContent = 'הקובץ הורד'; });
    $('input-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        state = await Storage.importBackup(file);
        Storage.save(state);
        $('modal-export').hidden = true;
        renderBooksScreen();
        UI.toast('ייבוא הצליח', 'success');
      } catch (err) {
        $('export-status').textContent = 'שגיאה: ' + err.message;
      }
    });

    // Insertion editor modal
    $('btn-insertion-save').addEventListener('click', () => {
      const { onSave } = UI.getInsertionEditorCallbacks();
      if (onSave) onSave(UI.getInsertionEditorData());
    });
    $('btn-insertion-cancel').addEventListener('click', () => UI.closeInsertionEditor());

    // Image file picker inside insertion editor
    $('input-image-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';   // allow re-picking same file
      if (file) handleImageFile(file);
    });

    // Paste image
    document.addEventListener('paste', (e) => {
      if ($('modal-insertion').hidden && $('modal-image').hidden) return;
      const items = Array.from(e.clipboardData?.items || []);
      const imgItem = items.find(i => i.type.startsWith('image/'));
      if (!imgItem) return;
      e.preventDefault();
      handleImageFile(imgItem.getAsFile());
    });

    // Image editor modal
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
