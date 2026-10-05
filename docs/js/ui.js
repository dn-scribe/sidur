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

      const info = document.createElement('div');
      info.className = 'siddur-item-info';
      info.innerHTML = `<span class="siddur-title">${esc(s.heTitle || s.title)}</span>${shortRef ? `<span class="siddur-ref">${esc(shortRef)}</span>` : ''}`;
      info.addEventListener('click', () => handlers.onOpen(s));

      const openBtn = document.createElement('button');
      openBtn.className = 'secondary';
      openBtn.style.cssText = 'font-size:0.82rem;padding:0.3rem 0.7rem;white-space:nowrap';
      openBtn.textContent = 'פתיחה';
      openBtn.addEventListener('click', () => handlers.onOpen(s));

      const delBtn = document.createElement('button');
      delBtn.className = 'danger';
      delBtn.style.cssText = 'font-size:0.82rem;padding:0.3rem 0.5rem';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => handlers.onDelete(s));

      li.appendChild(info);
      li.appendChild(openBtn);
      li.appendChild(delBtn);

      const shortcuts = s.shortcuts || [];
      if (shortcuts.length > 0) {
        const scRow = document.createElement('div');
        scRow.className = 'siddur-shortcuts';
        shortcuts.forEach(sc => {
          const chip = document.createElement('span');
          chip.className = 'shortcut-chip';
          const label = document.createElement('span');
          label.className = 'shortcut-chip-label';
          label.textContent = '★ ' + sc.label;
          label.addEventListener('click', () => handlers.onShortcutClick && handlers.onShortcutClick(s.id, sc.ref));
          const editLabel = document.createElement('button');
          editLabel.className = 'shortcut-chip-edit';
          editLabel.textContent = '✎';
          editLabel.title = 'עריכת שם';
          editLabel.addEventListener('click', e => {
            e.stopPropagation();
            const newLabel = prompt('שם הקיצור:', sc.label);
            if (newLabel !== null && newLabel.trim()) handlers.onShortcutRename && handlers.onShortcutRename(s.id, sc.id, newLabel.trim());
          });
          const del = document.createElement('button');
          del.className = 'shortcut-chip-del';
          del.textContent = '×';
          del.title = 'מחיקת קיצור';
          del.addEventListener('click', e => { e.stopPropagation(); handlers.onShortcutDelete && handlers.onShortcutDelete(s.id, sc.id); });
          chip.appendChild(label);
          chip.appendChild(editLabel);
          chip.appendChild(del);
          scRow.appendChild(chip);
        });
        li.appendChild(scRow);
      }

      list.appendChild(li);
    });
  }

  // ── TOC ──

  function renderToc(items, currentRef, annotatedRefs, removedRefs, handlers, opts) {
    const { filterToAnnotated = false, removedGroups } = opts || {};
    const removed = removedRefs instanceof Set ? removedRefs : new Set();
    const removedGrp = removedGroups instanceof Set ? removedGroups : new Set();
    const tree = $('toc-tree');
    tree.innerHTML = '';
    let activeEl = null;
    let pendingGroups = []; // group headers held until a visible leaf is encountered
    let skipDepth = null;   // skip this group's depth and all children when set

    items.forEach(item => {
      if (!item.isLeaf) {
        // Exit skip mode when we reach the same or shallower depth
        if (skipDepth !== null && item.depth <= skipDepth) skipDepth = null;
        if (skipDepth !== null) return;
        // Enter skip mode for removed groups
        if (removedGrp.has(item.he)) { skipDepth = item.depth; return; }

        const depth = item.depth;
        const el = document.createElement('div');
        el.className = depth === 0 ? 'toc-group' : depth === 1 ? 'toc-subgroup' : 'toc-subsubgroup';

        const labelEl = document.createElement('span');
        labelEl.textContent = item.he;
        el.appendChild(labelEl);

        if (depth <= 1 && (handlers.onRemoveGroup || handlers.onExportGroup)) {
          const btnGroup = document.createElement('div');
          btnGroup.className = 'toc-group-btns';
          if (handlers.onExportGroup) {
            const exportBtn = document.createElement('button');
            exportBtn.className = 'toc-group-export-btn';
            exportBtn.textContent = '⬇';
            exportBtn.title = 'ייצוא DOCX';
            exportBtn.addEventListener('click', (e) => { e.stopPropagation(); handlers.onExportGroup(item.he); });
            btnGroup.appendChild(exportBtn);
          }
          if (handlers.onRemoveGroup) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'toc-group-remove-btn';
            removeBtn.textContent = '🚫';
            removeBtn.title = 'הסרת חלק זה מהסידור';
            removeBtn.addEventListener('click', (e) => { e.stopPropagation(); handlers.onRemoveGroup(item.he); });
            btnGroup.appendChild(removeBtn);
          }
          el.appendChild(btnGroup);
        }

        pendingGroups.push(el);
      } else {
        if (skipDepth !== null) return;
        if (removed.has(item.ref)) return;
        if (filterToAnnotated && !(annotatedRefs && annotatedRefs.has(item.ref))) return;
        pendingGroups.forEach(el => tree.appendChild(el));
        pendingGroups = [];
        const isActive = item.ref === currentRef;
        const hasAnn = annotatedRefs && annotatedRefs.has(item.ref);
        const el = document.createElement('div');
        el.className = 'toc-item' + (isActive ? ' active' : '');
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

  function computeDisplayUnits(count, merges, removed) {
    const removedSet = removed instanceof Set ? removed : new Set(removed || []);
    const mergeGroups = new Map();
    const inMerge = new Set();
    (merges || []).forEach(group => {
      const sorted = [...group].sort((a, b) => a - b);
      mergeGroups.set(sorted[0], sorted);
      sorted.forEach(i => inMerge.add(i));
    });
    const items = [];
    let visIdx = 0;
    let i = 0;
    while (i < count) {
      if (removedSet.has(i)) {
        let j = i;
        while (j + 1 < count && removedSet.has(j + 1)) j++;
        const indices = [];
        for (let k = i; k <= j; k++) indices.push(k);
        items.push({ type: 'removed', indices });
        i = j + 1;
      } else if (mergeGroups.has(i)) {
        const group = mergeGroups.get(i);
        items.push({ type: 'unit', indices: group, unitIdx: visIdx++ });
        i = group[group.length - 1] + 1;
      } else if (inMerge.has(i)) {
        i++;
      } else {
        items.push({ type: 'unit', indices: [i], unitIdx: visIdx++ });
        i++;
      }
    }
    return items;
  }

  function renderReader({ sectionData, annotations, textEdits, viewMode, showEn, title, handlers }) {
    const content = $('reader-content');
    content.innerHTML = '';

    setViewMode(viewMode);
    setEnVisible(showEn);

    const ann = annotations || { customTitle: null, insertions: [], removedParagraphs: [], merges: [] };
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

    const displayItems = computeDisplayUnits(maxPos, ann.merges || [], removed);
    const totalVisibleUnits = displayItems.filter(it => it.type === 'unit').length;

    displayItems.forEach(item => {
      if (item.type === 'removed') {
        const placeholder = renderRemovedGroup(item.indices, handlers);
        if (isWide) {
          const row = document.createElement('div');
          row.className = 'wide-row';
          row.appendChild(placeholder);
          content.appendChild(row);
        } else {
          content.appendChild(placeholder);
        }
        return;
      }

      const firstIdx = item.indices[0];
      const allIns = (ann.insertions || []).filter(ins => ins.beforeParagraph === firstIdx);
      const betweenIns = allIns.filter(ins => ins.type === 'between');
      const inlineIns = allIns.filter(ins => ins.type !== 'between');

      if (isWide) {
        content.appendChild(renderBetweenArea(firstIdx, betweenIns, handlers));
        const row = document.createElement('div');
        row.className = 'wide-row';
        const annCol = document.createElement('div');
        annCol.className = 'ann-col';
        inlineIns.forEach(ins => annCol.appendChild(renderInsertionBlock(ins, handlers)));
        annCol.appendChild(makeAddBtn(firstIdx, handlers, 'inline'));
        row.appendChild(annCol);
        row.appendChild(renderParagraph(item.indices, paragraphs, sectionData.text, edits, handlers, {
          unitIdx: item.unitIdx, totalUnits: totalVisibleUnits,
        }));
        content.appendChild(row);
      } else {
        content.appendChild(renderParagraph(item.indices, paragraphs, sectionData.text, edits, handlers, {
          betweenIns, inlineIns, unitIdx: item.unitIdx, totalUnits: totalVisibleUnits,
        }));
      }
    });

    // After-last: between insertions for pos === maxPos
    const lastIns = (ann.insertions || []).filter(ins => ins.beforeParagraph === maxPos && ins.type === 'between');
    if (isWide) {
      content.appendChild(renderBetweenArea(maxPos, lastIns, handlers));
    } else {
      const afterArea = document.createElement('div');
      afterArea.className = 'para-after-last';
      lastIns.forEach(ins => afterArea.appendChild(renderInsertionBlock(ins, handlers)));
      afterArea.appendChild(makeAddBtn(maxPos, handlers, 'between'));
      content.appendChild(afterArea);
    }
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

  function renderParagraph(unitIndices, allParagraphs, allTexts, allEdits, handlers, opts) {
    const { betweenIns = [], inlineIns = [], unitIdx = 0, totalUnits = 1 } = opts || {};
    const firstIndex = unitIndices[0];
    const isMerged = unitIndices.length > 1;
    const editedText = (allEdits || {})[firstIndex] ?? null;

    const div = document.createElement('div');
    div.className = 'para-row' + (editedText !== null ? ' edited' : '') + (isMerged ? ' para-merged' : '');
    div.dataset.index = firstIndex;

    // Top area: between insertions always at top; inline stuff moves to bottom for merged cards
    const topArea = document.createElement('div');
    topArea.className = 'para-top-area';
    betweenIns.forEach(ins => topArea.appendChild(renderInsertionBlock(ins, handlers)));
    topArea.appendChild(makeAddBtn(firstIndex, handlers, 'between'));
    if (!isMerged) {
      inlineIns.forEach(ins => topArea.appendChild(renderInsertionBlock(ins, handlers)));
      topArea.appendChild(makeAddBtn(firstIndex, handlers, 'inline'));
    }
    div.appendChild(topArea);

    if (!isMerged) {
      const idxEl = document.createElement('div');
      idxEl.className = 'para-index';
      idxEl.textContent = firstIndex + 1;
      div.appendChild(idxEl);
    }

    const heEl = document.createElement('div');
    heEl.className = 'para-he';
    if (editedText !== null) {
      heEl.innerHTML = esc(editedText).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    } else if (isMerged) {
      heEl.innerHTML = unitIndices.map(i => allParagraphs[i] || '').join('<hr class="merge-sep">');
    } else {
      heEl.innerHTML = allParagraphs[firstIndex] || '';
    }
    div.appendChild(heEl);

    const enText = (allTexts || [])[firstIndex] || '';
    if (enText) {
      const enEl = document.createElement('div');
      enEl.className = 'para-en';
      enEl.innerHTML = enText;
      div.appendChild(enEl);
    }

    const acts = document.createElement('div');
    acts.className = 'para-actions';

    if (!isMerged) {
      const editBtn = document.createElement('button');
      editBtn.className = 'secondary';
      editBtn.textContent = '✏ עריכת טקסט';
      editBtn.addEventListener('click', () => enterParaEditMode(div, firstIndex, editedText !== null ? editedText : stripHtml(allParagraphs[firstIndex] || ''), handlers));
      acts.appendChild(editBtn);

      if (editedText !== null) {
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'link-btn';
        restoreBtn.textContent = '↩ מקורי';
        restoreBtn.addEventListener('click', () => handlers.onRestoreParagraph(firstIndex));
        acts.appendChild(restoreBtn);
      }
    } else {
      inlineIns.forEach(ins => acts.appendChild(renderInsertionBlock(ins, handlers)));
      acts.appendChild(makeAddBtn(firstIndex, handlers, 'inline'));

      const mergedCurrentText = editedText !== null
        ? editedText
        : unitIndices.map(i => stripHtml(allParagraphs[i] || '')).join('\n\n');
      const editBtn = document.createElement('button');
      editBtn.className = 'secondary';
      editBtn.textContent = '✏ עריכת טקסט';
      editBtn.addEventListener('click', () => enterParaEditMode(div, firstIndex, mergedCurrentText, handlers));
      acts.appendChild(editBtn);

      if (editedText !== null) {
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'link-btn';
        restoreBtn.textContent = '↩ מקורי';
        restoreBtn.addEventListener('click', () => handlers.onRestoreParagraph(firstIndex));
        acts.appendChild(restoreBtn);
      }
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'secondary';
    removeBtn.textContent = '🚫 הסרה';
    removeBtn.addEventListener('click', () => {
      if (isMerged && handlers.onRemoveParagraphs) {
        handlers.onRemoveParagraphs(unitIndices);
      } else {
        handlers.onRemoveParagraph(firstIndex);
      }
    });
    acts.appendChild(removeBtn);

    if (unitIdx > 0) {
      const mergeBtn = document.createElement('button');
      mergeBtn.className = 'secondary';
      mergeBtn.textContent = '⊞ מיזוג';
      mergeBtn.addEventListener('click', () => handlers.onMerge && handlers.onMerge(unitIdx));
      acts.appendChild(mergeBtn);
    }

    if (isMerged) {
      const demergeBtn = document.createElement('button');
      demergeBtn.className = 'secondary';
      demergeBtn.textContent = '⊟ ביטול מיזוג';
      demergeBtn.addEventListener('click', () => handlers.onDemerge && handlers.onDemerge(unitIndices));
      acts.appendChild(demergeBtn);
    }

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

    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    const boldBtn = document.createElement('button');
    boldBtn.type = 'button';
    boldBtn.className = 'toolbar-btn';
    boldBtn.innerHTML = '<strong>B</strong>';
    boldBtn.addEventListener('click', () => applyBold(ta));
    toolbar.appendChild(boldBtn);
    editArea.appendChild(toolbar);

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
    ta.addEventListener('click', () => {
      const pos = ta.selectionStart;
      const text = ta.value;
      if (pos === 0 || /[\s\n]/.test(text[pos - 1])) return;
      let start = pos;
      while (start > 0 && !/[\s\n]/.test(text[start - 1])) start--;
      ta.setSelectionRange(start, start);
    });

    paraDiv.insertBefore(editArea, heEl.nextSibling);
    ta.focus();
    ta.select();
  }

  function applyBold(textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;
    const selected = val.slice(start, end);
    const replacement = selected ? `**${selected}**` : '****';
    textarea.value = val.slice(0, start) + replacement + val.slice(end);
    const cursor = selected ? start + 2 + selected.length + 2 : start + 2;
    textarea.setSelectionRange(cursor, cursor);
    textarea.focus();
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
      b.innerHTML = esc(ins.text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
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
    _ins = { images: existing ? JSON.parse(JSON.stringify(existing.images || [])) : [], aiPrompt: existing?.aiPrompt || '', onSave, onCancel };
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
    return { title: $('insertion-title-input').value.trim(), text: $('insertion-text-input').value.trim(), images: _ins.images || [], aiPrompt: _ins.aiPrompt || '' };
  }

  function getInsertionEditorCallbacks() { return _ins; }

  function getInsertionAiPrompt() { return _ins.aiPrompt || ''; }
  function setInsertionAiPrompt(p) { _ins.aiPrompt = p || ''; }

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

  function renderSettings(container, { current, changelog }, opts = {}) {
    const { siddurs = [], currentSiddurId, removedItems = [], removedGroupItems = [], onRestoreSection, onRestoreGroup, onSwitchSiddur, onGoToBookshelf, onAiSettingsSave } = opts;
    container.innerHTML = '';

    // My Siddurs
    const siddurLabel = document.createElement('div');
    siddurLabel.className = 'settings-section-title';
    siddurLabel.textContent = 'הסידורים שלי';
    container.appendChild(siddurLabel);

    if (siddurs.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'אין סידורים שמורים.';
      container.appendChild(empty);
    } else {
      const siddurList = document.createElement('div');
      siddurList.className = 'settings-siddur-list';
      siddurs.forEach(s => {
        const row = document.createElement('div');
        row.className = 'settings-siddur-row' + (s.id === currentSiddurId ? ' active' : '');
        const name = document.createElement('span');
        name.textContent = s.heTitle || s.title;
        row.appendChild(name);
        if (s.id !== currentSiddurId && onSwitchSiddur) {
          const btn = document.createElement('button');
          btn.className = 'link-btn';
          btn.textContent = 'פתיחה';
          btn.addEventListener('click', () => onSwitchSiddur(s));
          row.appendChild(btn);
        }
        siddurList.appendChild(row);
      });
      container.appendChild(siddurList);
    }
    if (onGoToBookshelf) {
      const addBtn = document.createElement('button');
      addBtn.className = 'secondary settings-add-siddur-btn';
      addBtn.textContent = '+ הוספת סידור';
      addBtn.addEventListener('click', onGoToBookshelf);
      container.appendChild(addBtn);
    }

    // Removed groups (top-level TOC sections)
    if (removedGroupItems.length > 0) {
      const grpLabel = document.createElement('div');
      grpLabel.className = 'settings-section-title';
      grpLabel.textContent = 'חלקים שהוסרו';
      container.appendChild(grpLabel);
      const grpList = document.createElement('div');
      grpList.className = 'settings-removed-list';
      removedGroupItems.forEach(({ he }) => {
        const row = document.createElement('div');
        row.className = 'settings-removed-row';
        const name = document.createElement('span');
        name.textContent = he;
        row.appendChild(name);
        if (onRestoreGroup) {
          const btn = document.createElement('button');
          btn.className = 'link-btn';
          btn.textContent = '↩ שחזור';
          btn.addEventListener('click', () => onRestoreGroup(he));
          row.appendChild(btn);
        }
        grpList.appendChild(row);
      });
      container.appendChild(grpList);
    }

    // Removed sections
    if (removedItems.length > 0) {
      const removedLabel = document.createElement('div');
      removedLabel.className = 'settings-section-title';
      removedLabel.textContent = 'פרקים שהוסרו';
      container.appendChild(removedLabel);
      const removedList = document.createElement('div');
      removedList.className = 'settings-removed-list';
      removedItems.forEach(({ ref, label }) => {
        const row = document.createElement('div');
        row.className = 'settings-removed-row';
        const name = document.createElement('span');
        name.textContent = label;
        row.appendChild(name);
        if (onRestoreSection) {
          const btn = document.createElement('button');
          btn.className = 'link-btn';
          btn.textContent = '↩ שחזור';
          btn.addEventListener('click', () => onRestoreSection(ref));
          row.appendChild(btn);
        }
        removedList.appendChild(row);
      });
      container.appendChild(removedList);
    }

    // AI Settings
    const aiLabel = document.createElement('div');
    aiLabel.className = 'settings-section-title';
    aiLabel.textContent = 'יצירת תמונות AI';
    container.appendChild(aiLabel);

    const aiKeyLabel = document.createElement('label');
    aiKeyLabel.className = 'field-label';
    aiKeyLabel.textContent = 'מפתח OpenAI (API Key)';
    const aiKeyInput = document.createElement('input');
    aiKeyInput.type = 'password';
    aiKeyInput.className = 'settings-ai-input';
    aiKeyInput.placeholder = 'sk-...';
    aiKeyInput.value = localStorage.getItem('sd.aiKey') || '';
    aiKeyLabel.appendChild(aiKeyInput);
    container.appendChild(aiKeyLabel);

    const aiBaseLabel = document.createElement('label');
    aiBaseLabel.className = 'field-label';
    aiBaseLabel.textContent = 'פרומפט בסיס (יתווסף לכל בקשה)';
    const aiBaseInput = document.createElement('textarea');
    aiBaseInput.rows = 3;
    aiBaseInput.className = 'settings-ai-input';
    aiBaseInput.placeholder = 'לדוגמה: סגנון ציור מסורתי, צבעים חמים...';
    aiBaseInput.value = localStorage.getItem('sd.aiBasePrompt') || '';
    aiBaseLabel.appendChild(aiBaseInput);
    container.appendChild(aiBaseLabel);

    const aiModelLabel = document.createElement('label');
    aiModelLabel.className = 'field-label';
    aiModelLabel.textContent = 'מודל תמונה';
    const aiModelSelect = document.createElement('select');
    aiModelSelect.className = 'settings-ai-input';
    [
      { value: 'gpt-image-1', label: 'gpt-image-1 (חדש)' },
      { value: 'dall-e-3',    label: 'dall-e-3' },
      { value: 'dall-e-2',    label: 'dall-e-2 (בסיסי)' },
    ].forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === (localStorage.getItem('sd.aiModel') || 'gpt-image-1')) opt.selected = true;
      aiModelSelect.appendChild(opt);
    });
    aiModelLabel.appendChild(aiModelSelect);
    container.appendChild(aiModelLabel);

    const aiSaveBtn = document.createElement('button');
    aiSaveBtn.className = 'primary settings-ai-save';
    aiSaveBtn.textContent = 'שמירת הגדרות AI';
    aiSaveBtn.addEventListener('click', () => onAiSettingsSave && onAiSettingsSave(aiKeyInput.value.trim(), aiBaseInput.value.trim(), aiModelSelect.value));
    container.appendChild(aiSaveBtn);

    const aiCostRow = document.createElement('div');
    aiCostRow.className = 'settings-ai-cost';
    const costAmt = parseFloat(localStorage.getItem('sd.aiCost') || '0');
    const costSpan = document.createElement('strong');
    costSpan.textContent = `$${costAmt.toFixed(4)}`;
    aiCostRow.appendChild(document.createTextNode('עלות כוללת: '));
    aiCostRow.appendChild(costSpan);
    const resetCostBtn = document.createElement('button');
    resetCostBtn.className = 'link-btn';
    resetCostBtn.textContent = 'איפוס';
    resetCostBtn.addEventListener('click', () => {
      localStorage.setItem('sd.aiCost', '0');
      costSpan.textContent = '$0.0000';
    });
    aiCostRow.appendChild(resetCostBtn);
    container.appendChild(aiCostRow);

    // Version
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
    applyBold,
    computeDisplayUnits,
    openInsertionEditor, closeInsertionEditor, getInsertionEditorData, addImageToEditor, getInsertionEditorCallbacks,
    getInsertionAiPrompt, setInsertionAiPrompt,
    openImageEditor, rotateImageEditor, resetCrop, confirmImageEditor, closeImageEditor, getImageEditorState,
    wireCropCanvas,
  };
})();
