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

  function setHeader({ title, showBack, showViewToggle, showToc, showEnToggle }) {
    $('header-title').textContent = title || '📖 סידור';
    $('btn-back').hidden = !showBack;
    $('btn-view-toggle').hidden = !showViewToggle;
    $('btn-toc').hidden = !showToc;
    $('btn-en-toggle').hidden = !showEnToggle;
  }

  function setViewMode(mode) {
    document.body.classList.toggle('wide-view', mode === 'wide');
    $('btn-view-toggle').textContent = mode === 'wide' ? '◻' : '⇔';
    $('btn-view-toggle').title = mode === 'wide' ? 'תצוגה רגילה' : 'תצוגה רחבה';
  }

  function setEnVisible(visible) {
    document.body.classList.toggle('hide-en', !visible);
    $('btn-en-toggle').classList.toggle('active', visible);
  }

  // ── Book list ──

  function renderBookCategories(categories, onSelectBook) {
    const container = $('book-categories');
    container.innerHTML = '';
    categories.forEach(cat => {
      const sec = document.createElement('div');
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
      const shortRef = s.currentRef ? s.currentRef.split(',').slice(-2).map(p => p.trim()).join(' · ') : '';
      li.innerHTML = `
        <div class="siddur-item-info">
          <span class="siddur-title">${esc(s.heTitle || s.title)}</span>
          ${shortRef ? `<span class="siddur-ref">${esc(shortRef)}</span>` : ''}
        </div>
        <button class="secondary" style="font-size:0.82rem;padding:0.3rem 0.7rem;white-space:nowrap">פתיחה</button>
        <button class="danger" style="font-size:0.82rem;padding:0.3rem 0.5rem">✕</button>
      `;
      li.querySelectorAll('button')[0].addEventListener('click', () => handlers.onOpen(s));
      li.querySelectorAll('button')[1].addEventListener('click', () => handlers.onDelete(s));
      li.querySelector('.siddur-item-info').addEventListener('click', () => handlers.onOpen(s));
      list.appendChild(li);
    });
  }

  // ── TOC ──

  function renderToc(items, currentRef, annotatedRefs, removedRefs, handlers) {
    const removed = removedRefs instanceof Set ? removedRefs : new Set();
    const tree = $('toc-tree');
    tree.innerHTML = '';
    let activeEl = null;

    items.forEach(item => {
      if (!item.isLeaf) {
        const depth = item.depth;
        const el = document.createElement('div');
        el.className = depth === 0 ? 'toc-group' : depth === 1 ? 'toc-subgroup' : 'toc-subsubgroup';
        el.textContent = item.he;
        tree.appendChild(el);
      } else {
        const isActive = item.ref === currentRef;
        const hasAnn = annotatedRefs && annotatedRefs.has(item.ref);
        const isRemoved = removed.has(item.ref);
        const el = document.createElement('div');
        el.className = 'toc-item' + (isActive ? ' active' : '') + (isRemoved ? ' removed' : '');
        el.addEventListener('click', () => handlers.onSelect(item.ref));

        const textEl = document.createElement('span');
        textEl.className = 'toc-he';
        textEl.textContent = item.he;
        el.appendChild(textEl);

        if (hasAnn) {
          const dot = document.createElement('span');
          dot.className = 'toc-ann-dot';
          el.appendChild(dot);
        }

        const acts = document.createElement('div');
        acts.className = 'toc-item-actions';
        if (isRemoved) {
          const btn = document.createElement('button');
          btn.className = 'link-btn';
          btn.textContent = 'שחזור';
          btn.title = 'שחזור הפרק';
          btn.addEventListener('click', e => { e.stopPropagation(); handlers.onRestore(item.ref); });
          acts.appendChild(btn);
        } else {
          const btn = document.createElement('button');
          btn.className = 'toc-remove-btn';
          btn.textContent = '🚫';
          btn.title = 'הסרת הפרק';
          btn.addEventListener('click', e => { e.stopPropagation(); handlers.onRemove(item.ref); });
          acts.appendChild(btn);
        }
        el.appendChild(acts);

        tree.appendChild(el);
        if (isActive) activeEl = el;
      }
    });
    if (activeEl) setTimeout(() => activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
  }

  function renderRemovedSection({ title, onRestore }) {
    const content = $('reader-content');
    content.innerHTML = '';
    const placeholder = document.createElement('div');
    placeholder.className = 'removed-section-placeholder';
    const label = document.createElement('p');
    label.textContent = `"${title}" — פרק זה הוסר מהסידור`;
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = '↩ שחזור הפרק';
    btn.addEventListener('click', onRestore);
    placeholder.appendChild(label);
    placeholder.appendChild(btn);
    content.appendChild(placeholder);
  }

  // ── Reader ──

  function renderReader({ sectionData, annotations, textEdits, viewMode, showEn, title, handlers }) {
    const content = $('reader-content');
    content.innerHTML = '';

    setViewMode(viewMode);
    setEnVisible(showEn);

    const ann = annotations || { customTitle: null, insertions: [], removedParagraphs: [] };
    const edits = textEdits || {};
    const paragraphs = sectionData.he;
    const isWide = viewMode === 'wide';
    const maxPos = paragraphs.length;
    const removed = new Set(ann.removedParagraphs || []);

    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'section-title-block';
      titleEl.textContent = title;
      content.appendChild(titleEl);
    }

    let pos = 0;
    while (pos <= maxPos) {
      // Removed paragraph group
      if (pos < paragraphs.length && removed.has(pos)) {
        let groupEnd = pos;
        while (groupEnd + 1 < paragraphs.length && removed.has(groupEnd + 1)) groupEnd++;
        const indices = [];
        for (let i = pos; i <= groupEnd; i++) indices.push(i);
        const placeholder = renderRemovedGroup(indices, handlers);
        if (isWide) {
          const row = document.createElement('div');
          row.className = 'wide-row';
          row.appendChild(placeholder);
          content.appendChild(row);
        } else {
          content.appendChild(placeholder);
        }
        pos = groupEnd + 1;
        continue;
      }

      const allIns = (ann.insertions || []).filter(ins => ins.beforeParagraph === pos);
      const betweenIns = allIns.filter(ins => ins.type === 'between');
      // existing insertions without a type field are treated as inline
      const inlineIns = allIns.filter(ins => ins.type !== 'between');

      if (isWide) {
        // Full-width between-area always sits between wide-rows
        content.appendChild(renderBetweenArea(pos, betweenIns, handlers));
        if (pos < paragraphs.length) {
          const row = document.createElement('div');
          row.className = 'wide-row';
          const annCol = document.createElement('div');
          annCol.className = 'ann-col';
          inlineIns.forEach(ins => annCol.appendChild(renderInsertionBlock(ins, handlers)));
          annCol.appendChild(makeAddBtn(pos, handlers, 'inline'));
          const enText = sectionData.text?.[pos] || '';
          const editedText = edits[pos] ?? null;
          row.appendChild(annCol);
          row.appendChild(renderParagraph(pos, paragraphs[pos], enText, editedText, handlers));
          content.appendChild(row);
        }
      } else {
        // Normal view: between insertions first (they sit in the gap), then inline
        betweenIns.forEach(ins => content.appendChild(renderInsertionBlock(ins, handlers)));
        content.appendChild(makeAddBtn(pos, handlers, 'between'));
        inlineIns.forEach(ins => content.appendChild(renderInsertionBlock(ins, handlers)));
        if (pos < paragraphs.length) {
          const enText = sectionData.text?.[pos] || '';
          const editedText = edits[pos] ?? null;
          content.appendChild(renderParagraph(pos, paragraphs[pos], enText, editedText, handlers));
        }
      }
      pos++;
    }
    // No post-loop needed: the between-area for pos===maxPos is rendered above
  }

  function renderRemovedGroup(indices, handlers) {
    const div = document.createElement('div');
    div.className = 'removed-group';
    const count = indices.length;
    const label = document.createElement('span');
    label.textContent = count === 1 ? 'פסקה אחת הוסרה' : `${count} פסקאות הוסרו`;
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'link-btn';
    restoreBtn.textContent = 'שחזור';
    restoreBtn.addEventListener('click', () => handlers.onRestoreRemovedGroup(indices));
    div.appendChild(label);
    div.appendChild(restoreBtn);
    return div;
  }

  function makeAddBtn(pos, handlers, type = 'inline') {
    const btn = document.createElement('button');
    btn.className = type === 'between' ? 'add-insertion-btn add-between' : 'add-insertion-btn';
    btn.textContent = type === 'between' ? '+ הוסף הערה בין קטעים' : '+ הוספת הערה';
    btn.addEventListener('click', () => type === 'between' ? handlers.onAddBetweenInsertion(pos) : handlers.onAddInsertion(pos));
    return btn;
  }

  function renderBetweenArea(pos, betweenInsertions, handlers) {
    const div = document.createElement('div');
    div.className = 'between-area';
    betweenInsertions.forEach(ins => div.appendChild(renderInsertionBlock(ins, handlers)));
    div.appendChild(makeAddBtn(pos, handlers, 'between'));
    return div;
  }

  function renderParagraph(index, heText, enText, editedText, handlers) {
    const div = document.createElement('div');
    div.className = 'para-row' + (editedText !== null ? ' edited' : '');
    div.dataset.index = index;

    const idxEl = document.createElement('div');
    idxEl.className = 'para-index';
    idxEl.textContent = index + 1;
    div.appendChild(idxEl);

    const heEl = document.createElement('div');
    heEl.className = 'para-he';
    if (editedText !== null) {
      heEl.textContent = editedText;
    } else {
      heEl.innerHTML = heText || '';
    }
    div.appendChild(heEl);

    if (enText) {
      const enEl = document.createElement('div');
      enEl.className = 'para-en';
      enEl.innerHTML = enText;
      div.appendChild(enEl);
    }

    // Paragraph actions
    const acts = document.createElement('div');
    acts.className = 'para-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'secondary';
    editBtn.textContent = '✏ עריכת טקסט';
    editBtn.addEventListener('click', () => enterParaEditMode(div, index, editedText !== null ? editedText : stripHtml(heText), handlers));
    acts.appendChild(editBtn);

    if (editedText !== null) {
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'link-btn';
      restoreBtn.textContent = '↩ מקורי';
      restoreBtn.addEventListener('click', () => handlers.onRestoreParagraph(index));
      acts.appendChild(restoreBtn);
    }

    const addAfterBtn = document.createElement('button');
    addAfterBtn.className = 'secondary';
    addAfterBtn.textContent = '+ הערה';
    addAfterBtn.addEventListener('click', () => handlers.onAddInsertion(index));
    acts.appendChild(addAfterBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'secondary';
    removeBtn.textContent = '🚫 הסרה';
    removeBtn.addEventListener('click', () => handlers.onRemoveParagraph(index));
    acts.appendChild(removeBtn);

    div.appendChild(acts);
    return div;
  }

  function enterParaEditMode(paraDiv, index, currentText, handlers) {
    const heEl = paraDiv.querySelector('.para-he');
    const acts = paraDiv.querySelector('.para-actions');
    heEl.style.display = 'none';
    acts.style.display = 'none';

    const editArea = document.createElement('div');
    editArea.className = 'para-edit-area';

    const ta = document.createElement('textarea');
    ta.value = currentText;
    ta.rows = 5;
    editArea.appendChild(ta);

    const editActs = document.createElement('div');
    editActs.className = 'para-edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'primary';
    saveBtn.textContent = 'שמירה';
    saveBtn.addEventListener('click', () => {
      handlers.onEditParagraph(index, ta.value.trim());
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'secondary';
    cancelBtn.textContent = 'ביטול';
    cancelBtn.addEventListener('click', () => {
      editArea.remove();
      heEl.style.display = '';
      acts.style.display = '';
    });

    editActs.appendChild(saveBtn);
    editActs.appendChild(cancelBtn);
    editArea.appendChild(editActs);
    paraDiv.insertBefore(editArea, heEl.nextSibling);
    ta.focus();
    ta.select();
  }

  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return tmp.textContent || '';
  }

  function renderInsertionBlock(ins, handlers) {
    const div = document.createElement('div');
    div.className = 'insertion-block' + (ins.type === 'between' ? ' between' : '');
    div.dataset.id = ins.id;

    if (ins.title) {
      const t = document.createElement('div');
      t.className = 'insertion-title';
      t.textContent = ins.title;
      div.appendChild(t);
    }
    if (ins.text) {
      const b = document.createElement('div');
      b.className = 'insertion-text';
      b.textContent = ins.text;
      div.appendChild(b);
    }
    if (ins.images?.length) {
      const imgRow = document.createElement('div');
      imgRow.className = 'insertion-images-display';
      ins.images.forEach(img => imgRow.appendChild(makeImgThumb(img, null)));
      div.appendChild(imgRow);
    }

    const acts = document.createElement('div');
    acts.className = 'insertion-block-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'secondary';
    editBtn.textContent = '✏ עריכה';
    editBtn.addEventListener('click', () => handlers.onEditInsertion(ins));
    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = '✕ מחיקה';
    delBtn.addEventListener('click', () => handlers.onDeleteInsertion(ins.id));
    acts.appendChild(editBtn);
    acts.appendChild(delBtn);
    div.appendChild(acts);
    return div;
  }

  function makeImgThumb(img, onDelete) {
    const wrap = document.createElement('div');
    wrap.className = 'ins-img-wrap';
    const el = document.createElement('img');
    el.src = img.dataUrl;
    el.title = 'לחצו להגדלה';
    el.addEventListener('click', () => openFullscreen(img.dataUrl));
    wrap.appendChild(el);
    if (onDelete) {
      const del = document.createElement('button');
      del.className = 'ins-img-del';
      del.textContent = '✕';
      del.addEventListener('click', e => { e.stopPropagation(); onDelete(img.id); });
      wrap.appendChild(del);
    }
    return wrap;
  }

  function openFullscreen(dataUrl) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:500;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.cssText = 'max-width:94vw;max-height:94vh;border-radius:8px;box-shadow:0 4px 32px rgba(0,0,0,0.5)';
    overlay.appendChild(img);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  function updateSectionNav(prev, next) {
    [$('btn-prev-section'), $('btn-prev-section-bottom')].forEach(b => b.disabled = !prev);
    [$('btn-next-section'), $('btn-next-section-bottom')].forEach(b => b.disabled = !next);
  }

  // ── Insertion editor modal ──
  let _ins = {};

  function openInsertionEditor({ existing, onSave, onCancel }) {
    _ins = { images: existing ? JSON.parse(JSON.stringify(existing.images || [])) : [], onSave, onCancel };
    $('insertion-modal-title').textContent = existing ? 'עריכת הערה' : 'הוספת הערה';
    $('insertion-title-input').value = existing?.title || '';
    $('insertion-text-input').value = existing?.text || '';
    $('insertion-status').textContent = '';
    _renderEditorImages();
    $('modal-insertion').hidden = false;
    $('insertion-text-input').focus();
  }

  function _renderEditorImages() {
    const c = $('insertion-images-editor');
    c.innerHTML = '';
    _ins.images.forEach(img => c.appendChild(makeImgThumb(img, id => {
      _ins.images = _ins.images.filter(i => i.id !== id);
      _renderEditorImages();
    })));
  }

  function addImageToEditor(imgData) {
    _ins.images.push(imgData);
    _renderEditorImages();
  }

  function closeInsertionEditor() {
    $('modal-insertion').hidden = true;
    _ins = {};
  }

  function getInsertionEditorData() {
    return { title: $('insertion-title-input').value.trim(), text: $('insertion-text-input').value.trim(), images: _ins.images || [] };
  }

  function getInsertionEditorCallbacks() { return _ins; }

  // ── Image editor modal ──
  let _img = {};

  function openImageEditor(blob, onConfirm, onCancel) {
    _img = { rotation: 0, cropStart: null, cropEnd: null, onConfirm, onCancel };
    $('modal-insertion').hidden = true;   // hide insertion modal while editing image
    $('modal-image').hidden = false;

    const src = new Image();
    src.onload = () => {
      _img.sourceImg = src;
      _drawCanvas();
    };
    src.src = URL.createObjectURL(blob);
  }

  function _drawCanvas() {
    const canvas = $('image-canvas');
    const img = _img.sourceImg;
    if (!img) return;
    const rot = _img.rotation;
    const swapped = rot === 90 || rot === 270;
    const maxW = Math.min(680, window.innerWidth - 50);
    const maxH = Math.min(window.innerHeight * 0.48, 420);
    const W = swapped ? img.naturalHeight : img.naturalWidth;
    const H = swapped ? img.naturalWidth : img.naturalHeight;
    const scale = Math.min(maxW / W, maxH / H, 1);
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(img, -img.naturalWidth * scale / 2, -img.naturalHeight * scale / 2, img.naturalWidth * scale, img.naturalHeight * scale);
    ctx.restore();
    _drawCrop(ctx, canvas);
    _img.canvas = canvas;
    _img.scale = scale;
  }

  function _drawCrop(ctx, canvas) {
    const { cropStart: cs, cropEnd: ce } = _img;
    if (!cs || !ce) return;
    const x = Math.min(cs.x, ce.x), y = Math.min(cs.y, ce.y);
    const w = Math.abs(ce.x - cs.x), h = Math.abs(ce.y - cs.y);
    // Darken outside the selection
    ctx.fillStyle = 'rgba(0,0,0,0.48)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Re-draw the image inside the selection so it shows through (not black)
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((_img.rotation || 0) * Math.PI / 180);
    const img = _img.sourceImg, s = _img.scale || 1;
    ctx.drawImage(img, -img.naturalWidth * s / 2, -img.naturalHeight * s / 2, img.naturalWidth * s, img.naturalHeight * s);
    ctx.restore();
    // Selection border
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
  }

  function _redraw(cx, cy) {
    if (!_img.sourceImg) return;
    const canvas = $('image-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(_img.rotation * Math.PI / 180);
    const img = _img.sourceImg, s = _img.scale || 1;
    ctx.drawImage(img, -img.naturalWidth * s / 2, -img.naturalHeight * s / 2, img.naturalWidth * s, img.naturalHeight * s);
    ctx.restore();
    if (cx !== undefined) { _img.cropEnd = cx; _drawCrop(ctx, canvas); }
    else _drawCrop(ctx, canvas);
  }

  function rotateImageEditor(dir) {
    _img.rotation = ((_img.rotation || 0) + (dir === 'cw' ? 90 : -90) + 360) % 360;
    _img.cropStart = _img.cropEnd = null;
    _drawCanvas();
  }

  function resetCrop() { _img.cropStart = _img.cropEnd = null; _drawCanvas(); }

  function confirmImageEditor() {
    const canvas = _img.canvas;
    let final = canvas;
    const { cropStart: cs, cropEnd: ce } = _img;
    if (cs && ce) {
      const x = Math.round(Math.min(cs.x, ce.x)), y = Math.round(Math.min(cs.y, ce.y));
      const w = Math.round(Math.abs(ce.x - cs.x)), h = Math.round(Math.abs(ce.y - cs.y));
      if (w > 8 && h > 8) {
        final = document.createElement('canvas');
        final.width = w; final.height = h;
        final.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
      }
    }
    const dataUrl = final.toDataURL('image/jpeg', 0.88);
    const cb = _img.onConfirm;
    closeImageEditor();
    $('modal-insertion').hidden = false;
    if (cb) cb({ dataUrl, rotation: 0 });
  }

  function closeImageEditor() { $('modal-image').hidden = true; _img = {}; }

  function getImageEditorState() { return _img; }

  function canvasMousePos(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX || e.touches?.[0]?.clientX) - r.left, y: (e.clientY || e.touches?.[0]?.clientY) - r.top };
  }

  // Wire canvas crop events (called once from app.js init)
  function wireCropCanvas() {
    const canvas = $('image-canvas');
    let drag = false;
    const down = e => { e.preventDefault(); drag = true; _img.cropStart = canvasMousePos(canvas, e); _img.cropEnd = null; };
    const move = e => { if (!drag) return; e.preventDefault(); _redraw(canvasMousePos(canvas, e)); };
    const up   = () => { drag = false; };
    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', up);
    canvas.addEventListener('mouseleave', up);
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', up);
  }

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Settings modal ──

  function renderSettings(container, { current, changelog }) {
    container.innerHTML = '';

    const verRow = document.createElement('div');
    verRow.className = 'settings-version';
    verRow.innerHTML = `<span class="settings-version-label">גרסה</span><span class="settings-version-badge">${esc(current)}</span>`;
    container.appendChild(verRow);

    const histLabel = document.createElement('div');
    histLabel.className = 'settings-section-title';
    histLabel.textContent = 'היסטוריית גרסאות';
    container.appendChild(histLabel);

    const list = document.createElement('div');
    list.className = 'changelog-list';
    changelog.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'changelog-entry';
      const header = document.createElement('div');
      header.className = 'changelog-header';
      header.innerHTML = `<span class="changelog-version">${esc(entry.version)}</span><span class="changelog-date">${esc(entry.date)}</span>`;
      item.appendChild(header);
      const ul = document.createElement('ul');
      ul.className = 'changelog-items';
      (entry.items || []).forEach(txt => {
        const li = document.createElement('li');
        li.textContent = txt;
        ul.appendChild(li);
      });
      item.appendChild(ul);
      list.appendChild(item);
    });
    container.appendChild(list);
  }

  return {
    $, showScreen, toast, setHeader, setViewMode, setEnVisible,
    renderBookCategories, renderMySiddurs,
    renderToc,
    renderReader, renderRemovedSection, updateSectionNav,
    renderSettings,
    openInsertionEditor, closeInsertionEditor, getInsertionEditorData, addImageToEditor, getInsertionEditorCallbacks,
    openImageEditor, rotateImageEditor, resetCrop, confirmImageEditor, closeImageEditor, getImageEditorState,
    wireCropCanvas,
  };
})();
