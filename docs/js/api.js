window.SD = window.SD || {};

SD.Api = (function () {
  const BASE = 'https://www.sefaria.org';

  // Curated liturgy books, grouped by category
  const LITURGY_BOOKS = [
    {
      categoryHe: 'סידור', categoryEn: 'Siddur',
      books: [
        { title: 'Siddur Ashkenaz', heTitle: 'סידור אשכנז' },
        { title: 'Siddur Sefard', heTitle: 'סידור ספרד' },
        { title: 'Siddur Edot HaMizrach', heTitle: 'סידור נוסח עדות המזרח' },
        { title: 'Weekday Siddur Chabad', heTitle: 'סידור חב"ד לימות החול' },
        { title: 'The Koren Shalem Siddur; Ashkenaz', heTitle: 'סידור קורן השלם; אשכנז' },
      ]
    },
    {
      categoryHe: 'הגדה', categoryEn: 'Haggadah',
      books: [
        { title: 'Pesach Haggadah', heTitle: 'הגדה של פסח' },
        { title: 'Pesach Haggadah Edot Hamizrah', heTitle: 'הגדה של פסח עדות המזרח' },
      ]
    },
    {
      categoryHe: 'תפילות מיוחדות', categoryEn: 'Special Prayers',
      books: [
        { title: 'Tikkun Chatzot', heTitle: 'תיקון חצות' },
      ]
    }
  ];

  function getLiturgyBooks() {
    return LITURGY_BOOKS;
  }

  // Flatten the schema tree to a list for the TOC
  // Returns [{he, en, ref, depth, isLeaf}]
  function flattenSchema(node, prefix, depth) {
    depth = depth || 0;
    const items = [];
    const title = node.title || '';
    const heTitle = node.heTitle || title;
    const currentRef = prefix ? prefix + ', ' + title : title;

    if (node.nodes) {
      // Internal node (section group)
      items.push({ he: heTitle, en: title, ref: null, depth, isLeaf: false });
      for (const child of node.nodes) {
        items.push(...flattenSchema(child, currentRef, depth + 1));
      }
    } else {
      // Leaf node (actual text)
      items.push({ he: heTitle, en: title, ref: currentRef, depth, isLeaf: true });
    }
    return items;
  }

  async function fetchBookIndex(bookTitle) {
    const res = await fetch(`${BASE}/api/index/${encodeURIComponent(bookTitle)}`);
    if (!res.ok) throw new Error('ספר לא נמצא');
    const json = await res.json();
    return json;
  }

  async function fetchSection(ref) {
    const url = `${BASE}/api/texts/${encodeURIComponent(ref)}?context=0&pad=0&commentary=0&sheets=0`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('שגיאה בטעינת הטקסט');
    const json = await res.json();
    return {
      ref: json.ref,
      heRef: json.heRef || json.ref,
      next: json.next || null,
      prev: json.prev || null,
      he: normalizeLines(json.he),
      text: normalizeLines(json.text),
    };
  }

  function normalizeLines(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map(v => Array.isArray(v) ? v.join(' ') : (v || '')).filter(Boolean);
    }
    return value ? [value] : [];
  }

  function sefariaUrl(ref) {
    return `${BASE}/${ref.replace(/ /g, '_')}`;
  }

  return { getLiturgyBooks, fetchBookIndex, fetchSection, flattenSchema, sefariaUrl };
})();
