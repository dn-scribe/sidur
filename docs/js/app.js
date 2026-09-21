window.SD = window.SD || {};

SD.App = (function () {
  const UI = SD.UI;
  const Api = SD.Api;
  const Storage = SD.Storage;

  let state = Storage.load();
  let viewMode = localStorage.getItem('sd.viewMode') || 'normal';

  // Current context
  let currentSiddur = null;
  let currentSection = null;   // { ref, heRef, he, text, next, prev }
  let currentTocItems = [];
  let currentBookIndex = null;

  // ── Init ──

  function init() {
    wireEvents();
    renderBooksScreen();
  }

  // ── Navigation ──

  function renderBooksScreen() {
    UI.showScreen('books');
    UI.setHeader({ title: '📖 סידור', showBack: false, showViewToggle: false, showToc: false });
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

      // Add to my siddurs if not already there
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
      // Remove the top-level root if it's just a container
      const items = currentTocItems.filter((_, i) => i > 0 || currentTocItems[0].isLeaf);

      UI.showScreen('toc');
      UI.setHeader({ title: siddur.heTitle || siddur.title, showBack: true, showViewToggle: false, showToc: false });
      UI.$('toc-book-title').textContent = siddur.heTitle || siddur.title;
      UI.$('toc-book-hetitle').textContent = siddur.title;
      UI.renderToc(items, siddur.currentRef, (ref) => openSection(ref));
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

  function shortSectionTitle(heRef) {
    if (!heRef) return '';
    // "Siddur Ashkenaz, Weekday, Shacharit, ..." → take last 2 parts
    const parts = heRef.split(',').map(p => p.trim());
    return parts.slice(-2).join(' · ');
  }

  function renderReader() {
    if (!currentSection) return;

    const siddurId = currentSiddur?.id || '__default__';
    const ref = currentSection.ref;
    const annByRef = state.annotations[siddurId] || {};
    const ann = annByRef[ref] || { customTitle: null, insertions: [] };

    UI.showScreen('reader');
    const shortTitle = shortSectionTitle(currentSection.heRef || ref);
    UI.setHeader({ title: shortTitle, showBack: true, showViewToggle: true, showToc: true });
    UI.$('reader-section-title').textContent = ann.customTitle || shortTitle;
    UI.updateSectionNav(currentSection.prev, currentSection.next);

    UI.renderReader({
      sectionData: currentSection,
      annotations: ann,
      viewMode,
      handlers: {
        onAddInsertion: (pos) => openInsertionEditor(pos, null),
        onEditInsertion: (ins) => openInsertionEditor(ins.beforeParagraph, ins),
        onDeleteInsertion: (id) => deleteInsertion(id),
      },
    });
  }

  // ── Annotations ──

  function getOrCreateAnnotation(siddurId, ref) {
    state.annotations[siddurId] = state.annotations[siddurId] || {};
    state.annotations[siddurId][ref] = state.annotations[siddurId][ref] || { customTitle: null, insertions: [] };
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
      if (ins) {
        ins.title = data.title;
        ins.text = data.text;
        ins.images = data.images;
      }
    } else {
      ann.insertions.push({
        id: Storage.genId(),
        beforeParagraph,
        title: data.title,
        text: data.text,
        images: data.images,
      });
      // Sort by position
      ann.insertions.sort((a, b) => a.beforeParagraph - b.beforeParagraph);
    }

    try {
      Storage.save(state);
    } catch (e) {
      UI.toast(e.message, 'error');
      return;
    }

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

  function onDeleteSiddur(siddur) {
    if (!confirm(`למחוק את "${siddur.heTitle || siddur.title}" מהרשימה?`)) return;
    state.siddurs = state.siddurs.filter(s => s.id !== siddur.id);
    // Keep annotations (user might re-add)
    Storage.save(state);
    UI.renderMySiddurs(state.siddurs, {
      onOpen: (s) => { currentSiddur = s; openToc(s); },
      onDelete: onDeleteSiddur,
    });
    UI.toast('הסידור הוסר מהרשימה', '');
  }

  // ── Image editor integration ──

  let _pendingImageTarget = null;  // 'editor' = insertion editor

  function triggerPasteImage() {
    _pendingImageTarget = 'editor';
    UI.toast('הדבקה: לחצו Ctrl+V / Cmd+V', '');
  }

  document.addEventListener('paste', (e) => {
    if ($('modal-insertion').hidden && $('modal-image').hidden) return;
    const items = Array.from(e.clipboardData?.items || []);
    const imgItem = items.find(i => i.type.startsWith('image/'));
    if (!imgItem) return;
    e.preventDefault();
    const blob = imgItem.getAsFile();
    UI.openImageEditor(blob, (imgData) => {
      imgData.id = Storage.genId();
      UI.addImageToEditor(imgData);
    }, () => {});
  });

  function $$(id) { return document.getElementById(id); }

  // ── Event wiring ──

  function wireEvents() {
    // Book search
    $$('input-book-search').addEventListener('input', (e) => filterBooks(e.target.value));

    // Back button
    $$('btn-back').addEventListener('click', () => {
      const active = document.querySelector('.screen.active');
      if (active?.id === 'screen-reader') {
        if (currentBookIndex) openToc(currentSiddur, currentBookIndex);
        else renderBooksScreen();
      } else {
        renderBooksScreen();
      }
    });

    // View toggle
    $$('btn-view-toggle').addEventListener('click', () => {
      viewMode = viewMode === 'wide' ? 'normal' : 'wide';
      localStorage.setItem('sd.viewMode', viewMode);
      renderReader();
    });

    // TOC from reader
    $$('btn-toc').addEventListener('click', () => {
      if (currentSiddur && currentBookIndex) openToc(currentSiddur, currentBookIndex);
    });

    // Navigation
    $$('btn-prev-section').addEventListener('click', () => currentSection?.prev && openSection(currentSection.prev));
    $$('btn-next-section').addEventListener('click', () => currentSection?.next && openSection(currentSection.next));
    $$('btn-prev-section-bottom').addEventListener('click', () => currentSection?.prev && openSection(currentSection.prev));
    $$('btn-next-section-bottom').addEventListener('click', () => currentSection?.next && openSection(currentSection.next));

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if ($('modal-insertion').hidden === false || $('modal-image').hidden === false) return;
      if (e.key === 'ArrowLeft') $$('btn-next-section').click();
      if (e.key === 'ArrowRight') $$('btn-prev-section').click();
    });

    // Edit section title
    $$('btn-edit-section-title').addEventListener('click', () => {
      if (!currentSection) return;
      const siddurId = currentSiddur?.id || '__default__';
      const ref = currentSection.ref;
      const ann = getOrCreateAnnotation(siddurId, ref);
      const current = ann.customTitle || '';
      const val = prompt('כותרת מותאמת אישית לפרק (השאר ריק לכותרת ברירת מחדל):', current);
      if (val === null) return;
      ann.customTitle = val.trim() || null;
      Storage.save(state);
      renderReader();
    });

    // Export/Import modal
    $$('btn-export').addEventListener('click', () => {
      $$('modal-export').hidden = false;
      $$('export-status').textContent = '';
    });
    $$('btn-close-export').addEventListener('click', () => { $$('modal-export').hidden = true; });
    $$('btn-do-export').addEventListener('click', () => {
      Storage.exportBackup(state);
      $$('export-status').textContent = 'הקובץ הורד';
    });
    $$('input-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        state = await Storage.importBackup(file);
        Storage.save(state);
        $$('modal-export').hidden = true;
        renderBooksScreen();
        UI.toast('ייבוא הצליח', 'success');
      } catch (err) {
        $$('export-status').textContent = 'שגיאה: ' + err.message;
      }
    });

    // Insertion editor modal
    $$('btn-insertion-save').addEventListener('click', () => {
      const { onSave } = UI.getInsertionEditorCallbacks();
      if (onSave) onSave(UI.getInsertionEditorData());
    });
    $$('btn-insertion-cancel').addEventListener('click', () => UI.closeInsertionEditor());
    $$('btn-paste-image').addEventListener('click', triggerPasteImage);

    // Image editor modal
    $$('btn-rotate-ccw').addEventListener('click', () => UI.rotateImageEditor('ccw'));
    $$('btn-rotate-cw').addEventListener('click', () => UI.rotateImageEditor('cw'));
    $$('btn-image-confirm').addEventListener('click', () => UI.confirmImageEditor());
    $$('btn-image-cancel').addEventListener('click', () => UI.closeImageEditor());

    // Canvas crop interaction
    const canvas = $$('image-canvas');
    let dragging = false;
    canvas.addEventListener('mousedown', (e) => {
      const r = canvas.getBoundingClientRect();
      dragging = true;
      UI.getImageEditorState().cropStart = { x: e.clientX - r.left, y: e.clientY - r.top };
      UI.getImageEditorState().cropEnd = null;
    });
    canvas.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const r = canvas.getBoundingClientRect();
      UI.getImageEditorState().cropEnd = { x: e.clientX - r.left, y: e.clientY - r.top };
      // Redraw
      const st = UI.getImageEditorState();
      if (st.sourceImg) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((st.rotation * Math.PI) / 180);
        const swapped = st.rotation === 90 || st.rotation === 270;
        const scale = canvas.width / (swapped ? st.sourceImg.naturalHeight : st.sourceImg.naturalWidth);
        const sw = st.sourceImg.naturalWidth * scale;
        const sh = st.sourceImg.naturalHeight * scale;
        ctx.drawImage(st.sourceImg, -sw / 2, -sh / 2, sw, sh);
        ctx.restore();
        // Draw crop overlay
        const { cropStart, cropEnd } = st;
        if (cropStart && cropEnd) {
          const cx = Math.min(cropStart.x, cropEnd.x);
          const cy = Math.min(cropStart.y, cropEnd.y);
          const cw = Math.abs(cropEnd.x - cropStart.x);
          const ch = Math.abs(cropEnd.y - cropStart.y);
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.clearRect(cx, cy, cw, ch);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.strokeRect(cx, cy, cw, ch);
        }
      }
    });
    canvas.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('mouseleave', () => { dragging = false; });

    // Touch support for crop
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      const r = canvas.getBoundingClientRect();
      dragging = true;
      UI.getImageEditorState().cropStart = { x: t.clientX - r.left, y: t.clientY - r.top };
    });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!dragging) return;
      const t = e.touches[0];
      const r = canvas.getBoundingClientRect();
      UI.getImageEditorState().cropEnd = { x: t.clientX - r.left, y: t.clientY - r.top };
    });
    canvas.addEventListener('touchend', () => { dragging = false; });

    // Close modals on overlay click
    $$('modal-export').addEventListener('click', (e) => {
      if (e.target === $$('modal-export')) $$('modal-export').hidden = true;
    });
    $$('modal-insertion').addEventListener('click', (e) => {
      if (e.target === $$('modal-insertion')) UI.closeInsertionEditor();
    });
    $$('modal-image').addEventListener('click', (e) => {
      if (e.target === $$('modal-image')) UI.closeImageEditor();
    });
  }

  function $(id) { return document.getElementById(id); }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => SD.App.init());
