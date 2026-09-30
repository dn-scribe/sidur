window.SD = window.SD || {};

SD.Export = (function () {
  let _lib = null;

  async function _ensureLib() {
    if (_lib) return _lib;
    if (window.docx) return (_lib = window.docx);
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
      s.onload = res;
      s.onerror = () => rej(new Error('נכשלה טעינת ספריית DOCX — נדרש חיבור לאינטרנט'));
      document.head.appendChild(s);
    });
    return (_lib = window.docx);
  }

  function _stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return d.textContent || '';
  }

  function _boldRuns(text, lib) {
    const parts = (text || '').split(/(\*\*[^*]*\*\*)/g);
    return parts.filter(Boolean).map(p => {
      if (p.startsWith('**') && p.endsWith('**'))
        return new lib.TextRun({ text: p.slice(2, -2), bold: true });
      return new lib.TextRun({ text: p });
    });
  }

  function _hePara(text, lib, { indent = false, spacing } = {}) {
    const plain = _stripHtml(text);
    return new lib.Paragraph({
      children: _boldRuns(plain, lib),
      bidirectional: true,
      alignment: 'right',
      indent: indent ? { right: 400 } : undefined,
      spacing: spacing || { after: 60 },
    });
  }

  async function _imgDims(dataUrl) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res({ w: 400, h: 300 });
      img.src = dataUrl;
    });
  }

  async function _imageRun(dataUrl, lib, maxW = 600) {
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    const { w, h } = await _imgDims(dataUrl);
    const scale = Math.min(1, maxW / w);
    const type = m[1].includes('png') ? 'png' : 'jpeg';
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new lib.ImageRun({
      data: bytes,
      transformation: { width: Math.round(w * scale), height: Math.round(h * scale) },
      type,
    });
  }

  async function _renderInsertions(insertions, lib, children) {
    for (const ins of insertions) {
      if (ins.title) {
        children.push(new lib.Paragraph({
          children: [new lib.TextRun({ text: ins.title, bold: true, size: 20 })],
          bidirectional: true,
          alignment: 'right',
          indent: { right: 400 },
          spacing: { before: 100, after: 40 },
          border: { bottom: { style: 'single', size: 4, space: 4, color: 'A0896E' } },
        }));
      }
      if (ins.text) {
        children.push(_hePara(ins.text, lib, { indent: true, spacing: { after: 60 } }));
      }
      for (const img of (ins.images || [])) {
        const run = await _imageRun(img.dataUrl, lib);
        if (run) children.push(new lib.Paragraph({ children: [run], alignment: 'right', spacing: { after: 60 } }));
      }
    }
  }

  async function _buildSectionChildren(sectionData, annotation, textEdits, lib) {
    const children = [];
    const ann = annotation || { insertions: [], removedParagraphs: [], merges: [] };
    const edits = textEdits || {};
    const paragraphs = sectionData.he;
    const removed = new Set(ann.removedParagraphs || []);
    const displayItems = SD.UI.computeDisplayUnits(paragraphs.length, ann.merges || [], removed);

    for (const item of displayItems) {
      if (item.type === 'removed') continue;

      const firstIdx = item.indices[0];
      const insHere = (ann.insertions || []).filter(i => i.beforeParagraph === firstIdx);
      const betweenIns = insHere.filter(i => i.type === 'between');
      const inlineIns  = insHere.filter(i => i.type !== 'between');

      // "between" insertions sit between paragraphs — before this one
      await _renderInsertions(betweenIns, lib, children);

      const isMerged = item.indices.length > 1;
      const editedText = edits[firstIdx] ?? null;

      if (isMerged) {
        if (editedText !== null) {
          for (const part of editedText.split(/\n+/).filter(Boolean)) {
            children.push(_hePara(part, lib));
          }
        } else {
          for (const idx of item.indices) {
            const t = _stripHtml(paragraphs[idx] || '').trim();
            if (t) children.push(_hePara(t, lib));
          }
        }
        children.push(new lib.Paragraph({ children: [], spacing: { after: 80 } }));
      } else {
        const rawText = editedText !== null ? editedText : _stripHtml(paragraphs[firstIdx] || '');
        if (rawText.trim()) children.push(_hePara(rawText, lib));
      }

      // "inline" insertions sit alongside / after the paragraph
      await _renderInsertions(inlineIns, lib, children);
    }

    // insertions after last paragraph
    const afterIns = (ann.insertions || []).filter(i => i.beforeParagraph === paragraphs.length && i.type === 'between');
    await _renderInsertions(afterIns, lib, children);

    return children;
  }

  function _makeDoc(lib, allChildren, landscape) {
    const A4_W = 11906;  // 210mm in twips
    const A4_H = 16838;  // 297mm in twips
    const MARGIN = 1134; // ~20mm in twips
    return new lib.Document({
      styles: {
        default: {
          document: {
            run: { rightToLeft: true },
          },
        },
      },
      sections: [{
        properties: {
          bidi: true,
          page: {
            size: {
              orientation: landscape ? 'landscape' : 'portrait',
              width:  landscape ? A4_H : A4_W,
              height: landscape ? A4_W : A4_H,
            },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          },
        },
        children: allChildren,
      }],
    });
  }

  function _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function _safeFilename(he) {
    return (he || 'export').replace(/[^֐-׿a-zA-Z0-9_\s-]/g, '').trim().replace(/\s+/g, '_') || 'export';
  }

  function _headingPara(text, lib, level) {
    return new lib.Paragraph({
      text,
      heading: level,
      bidirectional: true,
      alignment: 'right',
      spacing: { before: 200, after: 100 },
    });
  }

  async function exportSection({ sectionData, annotation, textEdits, title, landscape }) {
    const lib = await _ensureLib();
    const children = [];
    children.push(_headingPara(title || sectionData.heRef || sectionData.ref, lib, lib.HeadingLevel.HEADING_1));
    const body = await _buildSectionChildren(sectionData, annotation, textEdits, lib);
    children.push(...body);
    const doc = _makeDoc(lib, children, landscape);
    const blob = await lib.Packer.toBlob(doc);
    _download(blob, _safeFilename(title) + '.docx');
  }

  async function exportGroup({ groupHe, tocItems, siddurId, removedSections, landscape, onProgress }) {
    const lib = await _ensureLib();
    const removedSet = new Set(removedSections || []);

    // Collect all items belonging to this group
    let inGroup = false;
    let groupDepth = null;
    const groupItems = [];
    for (const item of tocItems) {
      if (!inGroup && !item.isLeaf && item.he === groupHe) {
        inGroup = true;
        groupDepth = item.depth;
        continue;
      }
      if (inGroup) {
        if (!item.isLeaf && item.depth <= groupDepth) break;
        groupItems.push(item);
      }
    }

    const leaves = groupItems.filter(i => i.isLeaf && !removedSet.has(i.ref));

    if (onProgress) onProgress(`טוען ${leaves.length} פרקים...`);

    const [sectionsArr, annsArr, editsArr] = await Promise.all([
      Promise.all(leaves.map(l => SD.Api.fetchSection(l.ref).catch(() => null))),
      Promise.all(leaves.map(l => SD.Storage.loadAnnotation(siddurId, l.ref).catch(() => null))),
      Promise.all(leaves.map(l => SD.Storage.loadTextEdits(siddurId, l.ref).catch(() => ({})))),
    ]);

    const sectionMap = new Map();
    const annMap = new Map();
    const editsMap = new Map();
    leaves.forEach((l, i) => {
      if (sectionsArr[i]) sectionMap.set(l.ref, sectionsArr[i]);
      annMap.set(l.ref, annsArr[i] || null);
      editsMap.set(l.ref, editsArr[i] || {});
    });

    if (onProgress) onProgress('יוצר קובץ...');

    const children = [];
    children.push(_headingPara(groupHe, lib, lib.HeadingLevel.HEADING_1));

    for (const item of groupItems) {
      if (!item.isLeaf) {
        const lvl = item.depth === 1 ? lib.HeadingLevel.HEADING_2 : lib.HeadingLevel.HEADING_3;
        children.push(_headingPara(item.he, lib, lvl));
      } else {
        if (removedSet.has(item.ref)) continue;
        const section = sectionMap.get(item.ref);
        if (!section) continue;
        const ann = annMap.get(item.ref);
        const edits = editsMap.get(item.ref);
        const sectionTitle = ann?.customTitle || item.he;
        const lvl = item.depth <= 1 ? lib.HeadingLevel.HEADING_2
          : item.depth === 2 ? lib.HeadingLevel.HEADING_3
          : lib.HeadingLevel.HEADING_4;
        children.push(_headingPara(sectionTitle, lib, lvl));
        const body = await _buildSectionChildren(section, ann, edits, lib);
        children.push(...body);
      }
    }

    const doc = _makeDoc(lib, children, landscape);
    const blob = await lib.Packer.toBlob(doc);
    _download(blob, _safeFilename(groupHe) + '.docx');
  }

  return { exportSection, exportGroup };
})();
