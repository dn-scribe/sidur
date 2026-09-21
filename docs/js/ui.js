window.SD = window.SD || {};

SD.UI = (function () {
  function $(id) { return document.getElementById(id); }

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    $(`screen-${name}`).classList.add('active');
  }

  let _toastTimer = null;
  function toast(msg, type) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (type ? ' toast-' + type : '');
    el.hidden = false;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => (el.hidden = true), 3000);
  }

  function setHeader({ title, showBack, showViewToggle, showToc }) {
    $('header-title').textContent = title || '📖 סידור';
    $('btn-back').hidden = !showBack;
    $('btn-view-toggle').hidden = !showViewToggle;
    $('btn-toc').hidden = !showToc;
  }

  // ── Book list ──

  function renderBookCategories(categories, onSelectBook) {
    const container = $('book-categories');
    container.innerHTML = '';
    categories.forEach(cat => {
      const sec = document.createElement('div');
      sec.className = 'book-category';
      sec.innerHTML = `<div class="book-category-title">${esc(cat.categoryHe)} / ${esc(cat.categoryEn)}</div>`;
      const grid = document.createElement('div');
      grid.className = 'book-grid';
      cat.books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'book-card';
        card.innerHTML = `<span class="book-he">${esc(book.heTitle)}</span><span class="book-en">${esc(book.title)}</span>`;
        card.addEventListener('click', () => onSelectBook(book));
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      container.appendChild(sec);
    });
  }

  function renderMySiddurs(siddurs, handlers) {
    const section = $('my-siddurs-section');
    section.hidden = siddurs.length === 0;
    const list = $('my-siddurs-list');
    list.innerHTML = '';
    siddurs.forEach(s => {
      const li = document.createElement('li');
      li.className = 'siddur-item';
      li.innerHTML = `
        <div class="siddur-item-info">
          <span class="siddur-title">${esc(s.heTitle)}</span>
          <span class="siddur-ref">${esc(s.title)}${s.currentRef ? ' · ' + esc(s.currentRef) : ''}</span>
        </div>
        <button class="secondary" data-id="${s.id}" data-action="open" style="font-size:0.82rem;padding:0.3rem 0.7rem">פתיחה</button>
        <button class="danger" data-id="${s.id}" data-action="delete" style="font-size:0.82rem;padding:0.3rem 0.5rem">✕</button>
      `;
      li.querySelector('[data-action="open"]').addEventListener('click', () => handlers.onOpen(s));
      li.querySelector('[data-action="delete"]').addEventListener('click', () => handlers.onDelete(s));
      list.appendChild(li);
    });
  }

  // ── TOC ──

  function renderToc(items, currentRef, onSelect) {
    const tree = $('toc-tree');
    tree.innerHTML = '';
    let activeEl = null;
    items.forEach(item => {
      if (!item.isLeaf) {
        const el = document.createElement('div');
        el.className = item.depth === 0 ? 'toc-group' : 'toc-subgroup';
        el.textContent = item.he;
        tree.appendChild(el);
      } else {
        const isActive = item.ref === currentRef;
        const el = document.createElement('div');
        el.className = 'toc-item' + (isActive ? ' active' : '');
        el.innerHTML = `<span class="toc-he">${esc(item.he)}</span>`;
        el.addEventListener('click', () => onSelect(item.ref));
        tree.appendChild(el);
        if (isActive) activeEl = el;
      }
    });
    if (activeEl) setTimeout(() => activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100);
  }

  // ── Reader ──

  function renderReader({ sectionData, annotations, viewMode, handlers }) {
    const content = $('reader-content');
    content.innerHTML = '';
    document.body.classList.toggle('wide-view', viewMode === 'wide');
    $('btn-view-toggle').title = viewMode === 'wide' ? 'תצוגה רגילה' : 'תצוגה רחבה';
    $('btn-view-toggle').textContent = viewMode === 'wide' ? '◻' : '⇔';

    const ann = annotations || { customTitle: null, insertions: [] };
    const paragraphs = sectionData.he;

    // Custom section title
    if (ann.customTitle) {
      const titleEl = document.createElement('div');
      titleEl.className = 'section-title-block';
      titleEl.textContent = ann.customTitle;
      content.appendChild(titleEl);
    }

    const isWide = viewMode === 'wide';
    const maxPos = paragraphs.length;

    for (let pos = 0; pos <= maxPos; pos++) {
      const insertions = (ann.insertions || []).filter(ins => ins.beforeParagraph === pos);

      if (isWide && pos < paragraphs.length) {
        // Wide mode: wrap paragraph + its preceding insertions in a row
        const row = document.createElement('div');
        row.className = 'wide-row';

        const annCol = document.createElement('div');
        annCol.className = 'wide-annotations';

        // Add insertion button for this slot
        const addBtn = document.createElement('button');
        addBtn.className = 'add-insertion-btn';
        addBtn.textContent = '+ הוספת הערה';
        addBtn.addEventListener('click', () => handlers.onAddInsertion(pos));
        annCol.appendChild(addBtn);

        insertions.forEach(ins => annCol.appendChild(renderInsertionBlock(ins, handlers)));

        const en = sectionData.text && sectionData.text[pos] ? sectionData.text[pos] : '';
        row.appendChild(annCol);
        row.appendChild(renderParagraph(pos, paragraphs[pos], en, handlers));
        content.appendChild(row);
      } else {
        // Normal mode: insertions then add-button then paragraph
        insertions.forEach(ins => content.appendChild(renderInsertionBlock(ins, handlers)));

        const addBtn = document.createElement('button');
        addBtn.className = 'add-insertion-btn';
        addBtn.textContent = '+ הוספת הערה';
        addBtn.addEventListener('click', () => handlers.onAddInsertion(pos));
        content.appendChild(addBtn);

        if (pos < paragraphs.length) {
          const en = sectionData.text && sectionData.text[pos] ? sectionData.text[pos] : '';
          content.appendChild(renderParagraph(pos, paragraphs[pos], en, handlers));
        }
      }
    }

    // In wide mode, handle the "after last paragraph" insertions
    if (isWide) {
      const afterInsertions = (ann.insertions || []).filter(ins => ins.beforeParagraph === maxPos);
      if (afterInsertions.length > 0) {
        const row = document.createElement('div');
        row.className = 'wide-row';
        const annCol = document.createElement('div');
        annCol.className = 'wide-annotations';
        afterInsertions.forEach(ins => annCol.appendChild(renderInsertionBlock(ins, handlers)));
        row.appendChild(annCol);
        content.appendChild(row);
      }
    }
  }

  function renderInsertionBlock(ins, handlers) {
    const div = document.createElement('div');
    div.className = 'insertion-block';
    div.dataset.id = ins.id;

    let html = '';
    if (ins.title) html += `<div class="insertion-custom-title">${esc(ins.title)}</div>`;
    if (ins.text) html += `<div class="insertion-text">${esc(ins.text)}</div>`;

    div.innerHTML = html;

    // Images
    if (ins.images && ins.images.length > 0) {
      const imgContainer = document.createElement('div');
      imgContainer.className = 'insertion-images';
      ins.images.forEach(img => {
        imgContainer.appendChild(renderImageThumb(img, null));
      });
      div.appendChild(imgContainer);
    }

    // Actions
    const actions = document.createElement('div');
    actions.className = 'insertion-block-actions';
    actions.innerHTML = `
      <button class="secondary">✏ עריכה</button>
      <button class="danger">✕ מחיקה</button>
    `;
    actions.querySelector('.secondary').addEventListener('click', () => handlers.onEditInsertion(ins));
    actions.querySelector('.danger').addEventListener('click', () => handlers.onDeleteInsertion(ins.id));
    div.appendChild(actions);

    return div;
  }

  function renderImageThumb(img, onDelete) {
    const wrap = document.createElement('div');
    wrap.className = 'insertion-img-wrap';
    const imgEl = document.createElement('img');
    imgEl.src = img.dataUrl;
    if (img.rotation) imgEl.style.transform = `rotate(${img.rotation}deg)`;
    imgEl.title = 'לחצו להגדלה';
    imgEl.addEventListener('click', () => openImageFullscreen(img.dataUrl, img.rotation));
    wrap.appendChild(imgEl);
    if (onDelete) {
      const del = document.createElement('button');
      del.className = 'insertion-img-delete';
      del.innerHTML = '✕';
      del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(img.id); });
      wrap.appendChild(del);
    }
    return wrap;
  }

  function openImageFullscreen(dataUrl, rotation) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:500;display:flex;align-items:center;justify-content:center;cursor:pointer';
    const img = document.createElement('img');
    img.src = dataUrl;
    if (rotation) img.style.transform = `rotate(${rotation}deg)`;
    img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px;';
    overlay.appendChild(img);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  function renderParagraph(index, heText, enText, handlers) {
    const div = document.createElement('div');
    div.className = 'para-row';
    div.dataset.index = index;

    // Sefaria returns HTML-formatted text; render it directly
    let html = `<div class="para-index">${index + 1}</div>`;
    html += `<div class="para-he">${heText || ''}</div>`;
    if (enText) html += `<div class="para-en">${enText}</div>`;
    div.innerHTML = html;

    const actions = document.createElement('div');
    actions.className = 'para-actions';
    actions.innerHTML = `<button class="secondary">+ הערה אחרי</button>`;
    actions.querySelector('button').addEventListener('click', () => handlers.onAddInsertion(index + 1));
    div.appendChild(actions);

    return div;
  }

  function updateSectionNav(prev, next) {
    [$('btn-prev-section'), $('btn-prev-section-bottom')].forEach(btn => {
      btn.disabled = !prev;
    });
    [$('btn-next-section'), $('btn-next-section-bottom')].forEach(btn => {
      btn.disabled = !next;
    });
  }

  // ── Insertion editor modal ──

  let _insertionEditorState = {};

  function openInsertionEditor({ existing, onSave, onCancel }) {
    _insertionEditorState = { images: existing ? [...(existing.images || [])] : [], onSave, onCancel };
    $('insertion-modal-title').textContent = existing ? 'עריכת הערה' : 'הוספת הערה';
    $('insertion-title-input').value = existing ? (existing.title || '') : '';
    $('insertion-text-input').value = existing ? (existing.text || '') : '';
    $('insertion-status').textContent = '';
    renderInsertionEditorImages();
    $('modal-insertion').hidden = false;
    $('insertion-text-input').focus();
  }

  function renderInsertionEditorImages() {
    const container = $('insertion-images');
    container.innerHTML = '';
    _insertionEditorState.images.forEach(img => {
      container.appendChild(renderImageThumb(img, (id) => {
        _insertionEditorState.images = _insertionEditorState.images.filter(i => i.id !== id);
        renderInsertionEditorImages();
      }));
    });
  }

  function addImageToEditor(imgData) {
    _insertionEditorState.images.push(imgData);
    renderInsertionEditorImages();
  }

  function closeInsertionEditor() {
    $('modal-insertion').hidden = true;
    _insertionEditorState = {};
  }

  function getInsertionEditorData() {
    return {
      title: $('insertion-title-input').value.trim(),
      text: $('insertion-text-input').value.trim(),
      images: _insertionEditorState.images || [],
    };
  }

  function getInsertionEditorCallbacks() {
    return _insertionEditorState;
  }

  // ── Image editor modal ──

  let _imageEditorState = {};

  function openImageEditor(imageBlob, onConfirm, onCancel) {
    _imageEditorState = { rotation: 0, cropStart: null, cropEnd: null, onConfirm, onCancel };
    $('modal-image').hidden = false;

    const img = new Image();
    img.onload = () => {
      _imageEditorState.sourceImg = img;
      _imageEditorState.sourceUrl = img.src;
      drawImageOnCanvas();
    };
    img.src = URL.createObjectURL(imageBlob);
  }

  function drawImageOnCanvas() {
    const canvas = $('image-canvas');
    const img = _imageEditorState.sourceImg;
    if (!img) return;
    const rot = _imageEditorState.rotation;
    const swapped = rot === 90 || rot === 270;
    const maxW = Math.min(650, window.innerWidth - 60);
    const maxH = Math.min(window.innerHeight * 0.45, 400);
    let w = swapped ? img.naturalHeight : img.naturalWidth;
    let h = swapped ? img.naturalWidth : img.naturalHeight;
    const scale = Math.min(maxW / w, maxH / h, 1);
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    const sw = img.naturalWidth * scale;
    const sh = img.naturalHeight * scale;
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
    drawCropOverlay(ctx, canvas);
    _imageEditorState.canvas = canvas;
  }

  function drawCropOverlay(ctx, canvas) {
    const { cropStart, cropEnd } = _imageEditorState;
    if (!cropStart || !cropEnd) return;
    const x = Math.min(cropStart.x, cropEnd.x);
    const y = Math.min(cropStart.y, cropEnd.y);
    const w = Math.abs(cropEnd.x - cropStart.x);
    const h = Math.abs(cropEnd.y - cropStart.y);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(x, y, w, h);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  function rotateImageEditor(dir) {
    _imageEditorState.rotation = ((_imageEditorState.rotation || 0) + (dir === 'cw' ? 90 : -90) + 360) % 360;
    _imageEditorState.cropStart = null;
    _imageEditorState.cropEnd = null;
    drawImageOnCanvas();
  }

  function confirmImageEditor() {
    const canvas = _imageEditorState.canvas;
    const { cropStart, cropEnd } = _imageEditorState;
    let finalCanvas = canvas;

    if (cropStart && cropEnd) {
      const x = Math.round(Math.min(cropStart.x, cropEnd.x));
      const y = Math.round(Math.min(cropStart.y, cropEnd.y));
      const w = Math.round(Math.abs(cropEnd.x - cropStart.x));
      const h = Math.round(Math.abs(cropEnd.y - cropStart.y));
      if (w > 5 && h > 5) {
        finalCanvas = document.createElement('canvas');
        finalCanvas.width = w;
        finalCanvas.height = h;
        finalCanvas.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
      }
    }

    const dataUrl = finalCanvas.toDataURL('image/jpeg', 0.85);
    const cb = _imageEditorState.onConfirm;
    closeImageEditor();
    if (cb) cb({ dataUrl, rotation: 0 });
  }

  function closeImageEditor() {
    $('modal-image').hidden = true;
    _imageEditorState = {};
  }

  function getImageEditorState() { return _imageEditorState; }

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    $,
    showScreen,
    toast,
    setHeader,
    renderBookCategories,
    renderMySiddurs,
    renderToc,
    renderReader,
    updateSectionNav,
    openInsertionEditor,
    closeInsertionEditor,
    getInsertionEditorData,
    addImageToEditor,
    getInsertionEditorCallbacks,
    openImageEditor,
    rotateImageEditor,
    confirmImageEditor,
    closeImageEditor,
    getImageEditorState,
  };
})();
