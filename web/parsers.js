// Pure parsing helpers, shared by the app and tests. No network, no Supabase.

/* ---------- course registration slip (UniMAP) ---------- */
// `lines` = text lines of the PDF (see pdfToLines in app.js)
export function parseSlipLines(lines) {
  const text = lines.join('\n');
  const field = (label) => {
    const m = text.match(new RegExp(label + '\\s*\\n?\\s*:\\s*(.+)', 'i'));
    return m ? m[1].trim() : null;
  };
  const courses = [];
  for (const line of lines) {
    // "1 IMJ41002 Projek Tahun Akhir 1[Final Year Project 1] 2 FT UR6523002"
    const m = line.match(/^\s*\d+\s+([A-Z]{3}\d{5})\s*(.*?)\s*(?:\[(.*?)\])?\s+(\d+)\s+([A-Z]{1,3})\s+(\S+)\s*$/);
    if (m) courses.push({ code: m[1], name: (m[3] || m[2]).trim(), name_local: m[2].trim(), credit: +m[4], status: m[5], grp: m[6] });
  }
  const session = text.match(/SEMESTER\s*(\d+)\s+ACADEMIC SESSION\s+([\d/]+)/i);
  return {
    name: field('NAME'),
    matric: field('MATRIC NUMBER'),
    program: field('PROGRAM'),
    semester: session ? `Sem ${session[1]} ${session[2]}` : null,
    courses,
  };
}

/* ---------- university timetable page ---------- */
const DAYS = {
  mon: 1, monday: 1, isnin: 1, tue: 2, tues: 2, tuesday: 2, selasa: 2, wed: 3, wednesday: 3, rabu: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, khamis: 4, fri: 5, friday: 5, jumaat: 5,
  sat: 6, saturday: 6, sabtu: 6, sun: 7, sunday: 7, ahad: 7,
};
const CODE_RE = /\b[A-Z]{3}\d{5}\b/;
const dayOf = (t) => DAYS[(t || '').trim().toLowerCase().replace(/[^a-z]/g, '')] || 0;
const pad = (h, m) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
function times(text) {
  const out = [];
  for (const m of (text || '').matchAll(/(\d{1,2})[:.](\d{2})/g)) if (+m[1] < 24 && +m[2] < 60) out.push(pad(+m[1], +m[2]));
  return out;
}
function cellText(el) {
  const c = el.cloneNode(true);
  for (const br of c.querySelectorAll('br')) br.replaceWith(' | ');
  return clean(c.textContent);
}
// rows of {text, colStart, colEnd}, honouring colspan/rowspan
function tableToRows(table) {
  const rows = [];
  const carry = [];
  for (const tr of table.querySelectorAll('tr')) {
    const cells = [];
    let col = 0;
    const skip = () => { while (carry[col] && carry[col].left > 0) { carry[col].left--; col++; } };
    for (const td of tr.children) {
      if (!/^T[DH]$/i.test(td.tagName)) continue;
      skip();
      const cs = parseInt(td.getAttribute('colspan') || '1', 10) || 1;
      const rs = parseInt(td.getAttribute('rowspan') || '1', 10) || 1;
      cells.push({ text: cellText(td), colStart: col, colEnd: col + cs - 1 });
      if (rs > 1) for (let k = 0; k < cs; k++) carry[col + k] = { left: rs - 1 };
      col += cs;
    }
    rows.push(cells);
  }
  return rows;
}
function parseCell(text) {
  const code = (text.match(CODE_RE) || [])[0];
  if (!code) return null;
  const rest = text.split('|').map(clean).filter((p) => p && !p.includes(code));
  const flat = text.replace(code, ' ');
  const kindM = flat.match(/\b(LECTURE|TUTORIAL|LAB(?:ORATORY)?|PRACTICAL|KULIAH|MAKMAL)\b/i) || flat.match(/\(\s*([LTP])\s*\)/);
  const venueM = flat.match(/\b((?:[A-Z]{1,4}\s?-?\s?\d{1,3}[A-Z]?(?:\s?-\s?\d+)?)|DK\s?\d+|BK\s?\d+|MP\s?\d+)\b/);
  return {
    course_code: code,
    kind: kindM ? kindM[1] : null,
    venue: venueM ? clean(venueM[1]) : null,
    lecturer: rest.find((p) => /^(dr|prof|ts|ir|en|pn|cik|mr|ms)\b/i.test(p)) || null,
    details: clean(rest.join(' | ') || flat),
  };
}
function parseTable(table, section) {
  const rows = tableToRows(table);
  const out = [];
  // Layout A (days vertical): a header row of time slots, then one row per day.
  const header = rows.find((r) => r.filter((c) => times(c.text).length && !CODE_RE.test(c.text)).length >= 3);
  const dayRows = rows.filter((r) => r[0] && dayOf(r[0].text));
  if (header && dayRows.length) {
    const slot = {};
    for (const c of header) { const t = times(c.text); if (t.length) for (let k = c.colStart; k <= c.colEnd; k++) slot[k] = t; }
    for (const r of dayRows) {
      const day = dayOf(r[0].text);
      for (const c of r.slice(1)) {
        const info = parseCell(c.text);
        if (!info) continue;
        const own = times(c.text);
        const start = slot[c.colStart]?.[0] || own[0];
        const end = (slot[c.colEnd] && (slot[c.colEnd][1] || slot[c.colEnd][0])) || own[1];
        if (start && end) out.push({ ...info, section, day, start, end });
      }
    }
    return out;
  }
  // Layout B (days across the top, times down the side)
  const dayHeader = rows.find((r) => r.filter((c) => dayOf(c.text)).length >= 3);
  if (dayHeader) {
    const dayByCol = {};
    for (const c of dayHeader) if (dayOf(c.text)) for (let k = c.colStart; k <= c.colEnd; k++) dayByCol[k] = dayOf(c.text);
    for (const r of rows.slice(rows.indexOf(dayHeader) + 1)) {
      const t = r[0] ? times(r[0].text) : [];
      if (!t.length) continue;
      for (const c of r.slice(1)) {
        const info = parseCell(c.text);
        if (info && dayByCol[c.colStart]) out.push({ ...info, section, day: dayByCol[c.colStart], start: t[0], end: t[1] || t[0] });
      }
    }
  }
  return out;
}
function sectionLabel(table, i) {
  const cap = clean(table.querySelector('caption')?.textContent);
  let prev = table.previousElementSibling;
  while (prev && !/^(H\d|P|B|STRONG|DIV)$/i.test(prev.tagName)) prev = prev.previousElementSibling;
  const p = clean(prev?.textContent);
  return cap || (p && p.length <= 80 ? p : '') || table.id || `Table ${i + 1}`;
}
// `doc` is a parsed Document; `hash` like "table_1103" selects one table if it exists.
export function parseTimetableDoc(doc, hash) {
  let tables = [...doc.querySelectorAll('table')];
  let wanted = null;
  if (hash) {
    const el = doc.getElementById(hash);
    wanted = el && (el.tagName === 'TABLE' ? el : el.querySelector('table'));
    if (wanted) tables = [wanted];
  }
  const all = tables.flatMap((t, i) => parseTable(t, sectionLabel(t, i)));
  const seen = new Set();
  return {
    tablesScanned: tables.length,
    selectedTable: wanted ? hash : null,
    classes: all.filter((c) => { const k = [c.course_code, c.section, c.day, c.start, c.end, c.venue].join('|'); return !seen.has(k) && seen.add(k); }),
  };
}
