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
    UI.setHeader({ title: '📖 סידור', showBack: false, showViewToggle: false, showToc: false, showEnToggle: false });
    UI.renderBookCategories(Api.getLiturgyBooks(), onSelectBook);
    UI.renderMySiddurs(siddurs, {
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
        await Storage.saveSiddur(currentSiddur);
      }

      const [ann, edits] = await Promise.all([
        Storage.loadAnnotation(currentSiddur.id, ref),
        Storage.loadTextEdits(currentSiddur.id, ref),
      ]);
      currentAnnotation = ann;
      currentTextEdits = edits;

      renderReader();
    } catch (e) {
      UI.toast('שגיאה: ' + e.message, 'error');
    }
  }

  function renderReader() {
    if (!currentSection) return;

    const shortTitle = shortSectionTitle(currentSection.heRef || currentSection.ref);
    const ann = currentAnnotation || { customTitle: null, insertions: [], removedParagraphs: [] };

    UI.showScreen('reader');
    UI.setHeader({ title: shortTitle, showBack: true, showViewToggle: true, showToc: true, showEnToggle: true });
    UI.setEnVisible(showEn);
    UI.$('reader-section-title').textContent = ann.customTitle || shortTitle;
    UI.updateSectionNav(currentSection.prev, currentSection.next);

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
      if (ins) { ins.title = data.title; ins.text = data.text; ins.images = data.images; }
    } else {
      ann.insertions.push({ id: Storage.genId(), beforeParagraph, type, title: data.title, text: data.text, images: data.images });
      ann.insertions.sort((a, b) => a.beforeParagraph - b.beforeParagraph);
    }

    try { await persistAnnotation(); } catch (e) { UI.toast(e.message, 'error'); return; }
    UI.closeInsertionEditor();
    renderReader();
    UI.toast('נשמר', 'success');
  }

  async function deleteInsertion(id) {
    const ann = ensureAnnotation();
    ann.insertions = ann.insertions.filter(i => i.id !== id);
    await persistAnnotation();
    renderReader();
    UI.toast('נמחק', '');
  }

  async function saveParagraphEdit(index, text) {
    currentTextEdits = currentTextEdits || {};
    currentTextEdits[index] = text;
    try { await persistTextEdits(); } catch (e) { UI.toast(e.message, 'error'); return; }
    renderReader();
    UI.toast('נשמר', 'success');
  }

  async function restoreParagraph(index) {
    currentTextEdits = currentTextEdits || {};
    delete currentTextEdits[index];
    await persistTextEdits();
    renderReader();
    UI.toast('הטקסט המקורי שוחזר', '');
  }

  async function removeParagraph(index) {
    const ann = ensureAnnotation();
    ann.removedParagraphs = ann.removedParagraphs || [];
    if (!ann.removedParagraphs.includes(index)) {
      ann.removedParagraphs.push(index);
      ann.removedParagraphs.sort((a, b) => a - b);
    }
    await persistAnnotation();
    renderReader();
  }

  async function restoreRemovedGroup(indices) {
    const ann = ensureAnnotation();
    const set = new Set(indices);
    ann.removedParagraphs = (ann.removedParagraphs || []).filter(i => !set.has(i));
    await persistAnnotation();
    renderReader();
  }

  async function onDeleteSiddur(siddur) {
    if (!confirm(`למחוק את "${siddur.heTitle || siddur.title}" מהרשימה?`)) return;
    siddurs = siddurs.filter(s => s.id !== siddur.id);
    await Storage.deleteSiddur(siddur.id);
    UI.renderMySiddurs(siddurs, {
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

  // ── Edit section title ──

  async function editSectionTitle() {
    if (!currentSection) return;
    const ann = ensureAnnotation();
    const val = prompt('כותרת מותאמת אישית לפרק (ריק = ברירת מחדל):', ann.customTitle || '');
    if (val === null) return;
    ann.customTitle = val.trim() || null;
    await persistAnnotation();
    renderReader();
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

    $('btn-prev-section').addEventListener('click', () => currentSection?.prev && openSection(currentSection.prev));
    $('btn-next-section').addEventListener('click', () => currentSection?.next && openSection(currentSection.next));
    $('btn-prev-section-bottom').addEventListener('click', () => currentSection?.prev && openSection(currentSection.prev));
    $('btn-next-section-bottom').addEventListener('click', () => currentSection?.next && openSection(currentSection.next));

    document.addEventListener('keydown', (e) => {
      if (!$('modal-insertion').hidden || !$('modal-image').hidden) return;
      if (e.key === 'ArrowLeft') $('btn-next-section').click();
      if (e.key === 'ArrowRight') $('btn-prev-section').click();
    });

    $('btn-edit-section-title').addEventListener('click', editSectionTitle);

    // Settings
    $('btn-settings').addEventListener('click', () => {
      UI.renderSettings($('settings-content'), SD.Version);
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
