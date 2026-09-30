// Fetch + parse a university timetable HTML page ("days vertical" layout: one row per day, columns are time slots).
// Tolerant on purpose: also handles the transposed layout (times down the side, days across the top).
const cheerio = require('cheerio');

const DAYS = {
  mon: 1, monday: 1, isnin: 1, tue: 2, tues: 2, tuesday: 2, selasa: 2, wed: 3, wednesday: 3, rabu: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, khamis: 4, fri: 5, friday: 5, jumaat: 5,
  sat: 6, saturday: 6, sabtu: 6, sun: 7, sunday: 7, ahad: 7,
};
const CODE_RE = /\b[A-Z]{3}\d{5}\b/;
const TIME_RE = /(\d{1,2})[:.](\d{2})/g;

const dayOf = (t) => DAYS[(t || '').trim().toLowerCase().replace(/[^a-z]/g, '')] || 0;
const pad = (h, m) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
function times(text) {
  const out = [];
  for (const m of (text || '').matchAll(TIME_RE)) if (+m[1] < 24 && +m[2] < 60) out.push(pad(+m[1], +m[2]));
  return out;
}
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

function cellText($, el) {
  // keep <br> as separators
  const c = $(el).clone();
  c.find('br').replaceWith(' | ');
  return clean(c.text());
}

// Build a grid of {text, colStart, colEnd} per row, honouring colspan/rowspan
function tableToRows($, table) {
  const rows = [];
  const carry = []; // rowspan carry-over: col -> {text, left}
  $(table).find('tr').each((_, tr) => {
    const cells = [];
    let col = 0;
    const place = () => { while (carry[col] && carry[col].left > 0) { carry[col].left--; col++; } };
    $(tr).children('td,th').each((__, td) => {
      place();
      const cs = parseInt($(td).attr('colspan') || '1', 10) || 1;
      const rs = parseInt($(td).attr('rowspan') || '1', 10) || 1;
      const text = cellText($, td);
      cells.push({ text, colStart: col, colEnd: col + cs - 1 });
      if (rs > 1) for (let k = 0; k < cs; k++) carry[col + k] = { text, left: rs - 1 };
      col += cs;
    });
    rows.push(cells);
  });
  return rows;
}

function parseCell(text) {
  const code = (text.match(CODE_RE) || [])[0];
  if (!code) return null;
  const parts = text.split('|').map(clean).filter(Boolean);
  const rest = parts.filter((p) => !p.includes(code));
  const flat = text.replace(code, ' ');
  const kindM = flat.match(/\b(LECTURE|TUTORIAL|LAB(?:ORATORY)?|PRACTICAL|KULIAH|TUTORIAL|MAKMAL)\b/i) ||
                flat.match(/\(\s*([LTP])\s*\)/);
  const venueM = flat.match(/\b((?:[A-Z]{1,4}\s?-?\s?\d{1,3}[A-Z]?(?:\s?-\s?\d+)?)|DK\s?\d+|BK\s?\d+|MP\s?\d+)\b/);
  return {
    course_code: code,
    kind: kindM ? kindM[1] : null,
    venue: venueM ? clean(venueM[1]) : null,
    lecturer: rest.find((p) => /^(dr|prof|ts|ir|en|pn|cik|mr|ms|dr\.|ts\.)\b/i.test(p)) || null,
    details: clean(rest.join(' | ') || flat),
  };
}

function parseTable($, table, sectionLabel) {
  const rows = tableToRows($, table);
  const out = [];
  // Layout A (days vertical): header row has time ranges; each later row starts with a day name.
  const header = rows.find((r) => r.filter((c) => times(c.text).length >= 1 && !CODE_RE.test(c.text)).length >= 3);
  const slotByCol = {};
  if (header) for (const c of header) { const t = times(c.text); if (t.length) for (let k = c.colStart; k <= c.colEnd; k++) slotByCol[k] = t; }
  const dayRows = rows.filter((r) => r[0] && dayOf(r[0].text));
  if (dayRows.length && header) {
    for (const r of dayRows) {
      const day = dayOf(r[0].text);
      for (const c of r.slice(1)) {
        const info = parseCell(c.text);
        if (!info) continue;
        const first = slotByCol[c.colStart], last = slotByCol[c.colEnd];
        let start = first && first[0], end = last && (last[1] || last[0]);
        const own = times(c.text);
        if (!start && own.length) start = own[0];
        if (!end && own.length > 1) end = own[1];
        if (!start || !end) continue;
        out.push({ ...info, section: sectionLabel, day, start, end });
      }
    }
    return out;
  }
  // Layout B (days horizontal): a header row of day names, first column holds the time slot.
  const dayHeader = rows.find((r) => r.filter((c) => dayOf(c.text)).length >= 3);
  if (dayHeader) {
    const dayByCol = {};
    for (const c of dayHeader) if (dayOf(c.text)) for (let k = c.colStart; k <= c.colEnd; k++) dayByCol[k] = dayOf(c.text);
    for (const r of rows.slice(rows.indexOf(dayHeader) + 1)) {
      const t = r[0] && times(r[0].text);
      if (!t || !t.length) continue;
      for (const c of r.slice(1)) {
        const info = parseCell(c.text);
        if (info && dayByCol[c.colStart]) out.push({ ...info, section: sectionLabel, day: dayByCol[c.colStart], start: t[0], end: t[1] || t[0] });
      }
    }
  }
  return out;
}

function sectionLabelFor($, table, idx) {
  const id = $(table).attr('id');
  const cap = clean($(table).find('caption').first().text());
  let prev = clean($(table).prevAll('h1,h2,h3,h4,p,b,strong,div').first().text());
  if (prev.length > 80) prev = '';
  return cap || prev || id || `Table ${idx + 1}`;
}

// Parse the whole page; `hash` (e.g. "table_1103") selects one table if it exists.
function parseTimetableHtml(html, hash) {
  const $ = cheerio.load(html);
  let tables = $('table').toArray();
  const wanted = hash ? tables.find((t) => $(t).attr('id') === hash) || $(`[id="${hash}"]`).find('table').get(0) : null;
  if (wanted) tables = [wanted];
  const classes = [];
  tables.forEach((t, i) => classes.push(...parseTable($, t, sectionLabelFor($, t, i))));
  // de-duplicate identical rows
  const seen = new Set();
  return {
    tablesScanned: tables.length,
    selectedTable: wanted ? hash : null,
    classes: classes.filter((c) => { const k = [c.course_code, c.section, c.day, c.start, c.end, c.venue].join('|'); if (seen.has(k)) return false; seen.add(k); return true; }),
  };
}

async function fetchTimetable(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) links are allowed');
  const res = await fetch(u.origin + u.pathname + u.search, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'StudyHub/1.0' } });
  if (!res.ok) throw new Error(`Timetable page returned HTTP ${res.status}`);
  const html = await res.text();
  return parseTimetableHtml(html, u.hash ? u.hash.slice(1) : null);
}

module.exports = { parseTimetableHtml, fetchTimetable };
