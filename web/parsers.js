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
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\d+\s+([A-Z]{3}\d{5})\s+(.+)$/);
    if (m) starts.push({ index: i, code: m[1], row: m[2] });
  }
  for (let i = 0; i < starts.length; i++) {
    const current = starts[i];
    const end = starts[i + 1]?.index ?? lines.length;
    const continuation = lines.slice(current.index + 1, end);
    const totalAt = continuation.findIndex((line) => /^TOTAL\s+(?:CREDIT|UNIT)/i.test(line));
    const tail = continuation.slice(0, totalAt < 0 ? continuation.length : totalAt)
      .map((line) => line.trim()).filter(Boolean).join(' ');
    // PDF text extraction can wrap a bracketed English title beneath the course row,
    // while credit, type, and group stay on the first visual line.
    const row = current.row.match(/^(.*?)\s+(\d+)\s+([A-Z]{1,3})\s+(.+?)\s*$/);
    if (!row) continue;
    const title = `${row[1]} ${tail}`.trim();
    const bracket = title.match(/^(.*?)\[([^\]]+)\](.*)$/);
    const nameLocal = (bracket ? bracket[1] : row[1]).trim();
    const name = (bracket ? bracket[2] : row[1]).trim();
    const groupTail = (bracket ? bracket[3] : tail).trim();
    courses.push({
      code: current.code,
      name,
      name_local: nameLocal,
      credit: +row[2],
      status: row[3],
      grp: [row[4], groupTail].filter(Boolean).join(' ').replace(/\s+/g, ' '),
    });
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
      cells.push({ el: td, text: cellText(td), colStart: col, colEnd: col + cs - 1 });
      if (rs > 1) for (let k = 0; k < cs; k++) carry[col + k] = { left: rs - 1 };
      col += cs;
    }
    rows.push(cells);
  }
  return rows;
}
/* ---------- examination slip (UniMAP) ---------- */
// Reads the session, matric (to catch a wrong upload), index number, the exam table and the exam hall rules.
// The slip also shows the IC/passport number: it is deliberately never read.
const MONTHS = { jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mac: 3, mar: 3, march: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, june: 6, jul: 7, julai: 7, july: 7, ogos: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dis: 12, dec: 12, disember: 12, december: 12 };
export function parseExamSlipLines(lines) {
  const text = lines.join('\n');
  const sess = text.match(/SEMESTER\s*(\d+)\s+ACADEMIC SESSION\s+([\d/]+)/i);
  const exams = [], notices = [];
  let mode = '';
  for (const line of lines) {
    if (/^NO\.?\s+COURSE CODE/i.test(line)) { mode = 'table'; continue; }
    if (/^TOTAL UNIT/i.test(line)) { mode = ''; continue; }
    if (/NOTICE/i.test(line) && /EXAMINATION/i.test(line)) { mode = 'rules'; continue; }
    if (mode === 'table') {
      // "2. IMJ32102 Jurutera Profesional [Professional Engineers] 2 17 July ,2026 9.00 AM DTC" (no date/time/venue = not scheduled on the slip)
      const m = line.match(/^\d+\.?\s+([A-Z]{3}\d{5})\s+(.+?)\s+(\d{1,2})(?:\s+(\d{1,2})\s+([A-Za-z]+)\s*,?\s*(\d{4})(?:\s+(\d{1,2})[.:](\d{2})\s*([AP]M))?\s*(.*))?$/i);
      if (m) {
        const mon = MONTHS[(m[5] || '').toLowerCase()];
        const h = m[7] ? (+m[7] % 12) + (/p/i.test(m[9]) ? 12 : 0) : null;
        exams.push({
          code: m[1], raw: m[2], credit: +m[3],
          date: mon && +m[4] >= 1 && +m[4] <= 31 ? `${m[6]}-${String(mon).padStart(2, '0')}-${m[4].padStart(2, '0')}` : null,
          time: h != null ? pad(h, +m[8]) : null,
          venue: clean(m[10]) || null,
        });
      } else if (exams.length && !CODE_RE.test(line)) exams[exams.length - 1].raw += ' ' + line; // course name wrapped onto the next line
    } else if (mode === 'rules') {
      const n = line.match(/^\d+\.\s+(.*)$/);
      if (n) notices.push(clean(n[1])); else if (notices.length && clean(line)) notices[notices.length - 1] += ' ' + clean(line);
    }
  }
  for (const e of exams) {
    // "Jurutera Profesional [Professional Engineers]" -> English name, Malay name kept too
    const b = e.raw.match(/^(.*?)\s*\[(.*)\]\s*$/);
    e.name = clean(b ? b[2] : e.raw); e.name_local = b ? clean(b[1]) : null;
    delete e.raw;
  }
  return {
    session: sess ? `Sem ${sess[1]} ${sess[2]}` : null,
    matric: (text.match(/MATRI[CK](?:\s*(?:NUMBER|NO\.?))?\s*:\s*([A-Za-z0-9]+)/i) || [])[1] || null,
    index_no: (text.match(/INDEX\s*NUMBER\s*:\s*([A-Za-z0-9-]+)/i) || [])[1] || null,
    exams, notices,
  };
}

const titleCase = (t) => t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(And|Of|In|For|The|To|With)\b/g, (w) => w.toLowerCase()).replace(/\b(Ii|Iii|Iv)\b/g, (w) => w.toUpperCase());

// "EMK32503 - A / EMK32803 - B" -> ["EMK32503 - A", "EMK32803 - B"]; code-only pieces stay with the next name
function subjectParts(text) {
  const out = [];
  let carry = '';
  for (const p of text.split(/\s+\/\s+(?=[A-Z]{3}\d{3,5}\s*-)/)) {
    if (/-/.test(p)) { out.push(carry ? `${carry} / ${p}` : p); carry = ''; } else carry = carry ? `${carry} / ${p}` : p;
  }
  if (carry) out.push(carry);
  return out;
}

// Cells from FET-generated pages (UniMAP) have labelled parts: .subject, .activitytag, .teacher, .room
function parseStructuredCell(td) {
  const out = [];
  for (const subj of td.querySelectorAll('.subject')) for (const part of subjectParts(clean(subj.textContent))) {
    // "IMJ32102 - NAME", "SMU32202-NAME", "IMJ41002/IMJ42004 - NAME", "AMJ10803 / EAT153 - NAME"
    const m = part.match(/^((?:[A-Z]{3}\d{3,5})(?:\s*\/\s*[A-Z]{3}\d{3,5})*)\s*-?\s*(.*)$/);
    if (!m) continue;
    const codes = m[1].match(/[A-Z]{3}\d{5}/g) || [];
    const tag = clean(subj.parentElement?.querySelector('.activitytag')?.textContent);
    for (const code of codes) out.push({
      course_code: code,
      course_name: m[2] ? titleCase(m[2]) : null,
      kind: (tag.match(/^(LECTURE|TUTORIAL|LAB|PRACTICAL|KULIAH|MAKMAL)\b/i) || [])[1] || null,
      venue: clean(td.querySelector('.room')?.textContent).replace(/\s*\(\d+\)$/, '') || null,
      lecturer: clean(td.querySelector('.teacher')?.textContent).replace(/\b[A-Z]{2,5} - /g, '') || null,
      details: tag || null,
    });
  }
  return out;
}
// Fallback for plain-text cells
function parseTextCell(text) {
  const code = (text.match(CODE_RE) || [])[0];
  if (!code) return [];
  const rest = text.split('|').map(clean).filter((p) => p && !p.includes(code));
  const flat = text.replace(code, ' ');
  const kindM = flat.match(/\b(LECTURE|TUTORIAL|LAB(?:ORATORY)?|PRACTICAL|KULIAH|MAKMAL)\b/i) || flat.match(/\(\s*([LTP])\s*\)/);
  const venueM = flat.match(/\b((?:[A-Z]{1,4}\s?-?\s?\d{1,3}[A-Z]?(?:\s?-\s?\d+)?)|DK\s?\d+|BK\s?\d+|MP\s?\d+)\b/);
  return [{
    course_code: code,
    course_name: null,
    kind: kindM ? kindM[1] : null,
    venue: venueM ? clean(venueM[1]) : null,
    lecturer: rest.find((p) => /^(dr|prof|ts|ir|en|pn|cik|mr|ms)\b/i.test(p)) || null,
    details: clean(rest.join(' | ') || flat).slice(0, 300),
  }];
}
const parseCell = (c) => (c.el.querySelector('.subject') ? parseStructuredCell(c.el) : parseTextCell(c.text));

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
        const own = times(c.text);
        const start = slot[c.colStart]?.[0] || own[0];
        const end = (slot[c.colEnd] && (slot[c.colEnd][1] || slot[c.colEnd][0])) || own[1];
        if (start && end) for (const info of parseCell(c)) out.push({ ...info, section, day, start, end });
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
        if (dayByCol[c.colStart]) for (const info of parseCell(c)) out.push({ ...info, section, day: dayByCol[c.colStart], start: t[0], end: t[1] || t[0] });
      }
    }
  }
  return out;
}
function sectionLabel(table, i) {
  // UniMAP: <caption>...<span class="name">UR6523002 - Y3G1 (25) Automatic Subgroup</span></caption>
  const named = clean(table.querySelector('caption .name')?.textContent);
  if (named) return named.replace(/\s*\(\d+\).*$/, '');
  const cap = clean(table.querySelector('caption')?.textContent);
  let prev = table.previousElementSibling;
  while (prev && !/^(H\d|P|B|STRONG|DIV)$/i.test(prev.tagName)) prev = prev.previousElementSibling;
  const p = clean(prev?.textContent);
  return cap || (p && p.length <= 80 ? p : '') || table.id || `Table ${i + 1}`;
}
// "UR6523002 - Y3G1" -> "Year 3, Group 1"
export function prettyGroup(section) {
  const m = (section || '').match(/Y(\d+)\s*G(\d+)/i);
  return m ? `Year ${m[1]}, Group ${m[2]}` : section || '';
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

/* ---------- UniMAP academic calendar (Kalendar Akademik) ---------- */
// `lines` = text lines of the PDF. Returns the session, each semester's periods (lectures, breaks, exams...)
// built by giving each activity its "(N MINGGU/WEEKS)" worth of week rows, and the dated notes (holidays, events).
const ACTIVITY_RE = /Pendaftaran Pelajar Baharu\s*\/?|Registration for New Students|KULIAH\s*\/\s*LECTURES|CUTI PERT\.?\s*SEMESTER\s*\/?|MID\.?\s*SEMESTER BREAK|MINGGU ULANG KAJI\s*\/?|REVISION WEEKS?|PEPERIKSAAN(?:\s+AKHIR)?\s*\/?|(?:FINAL\s+)?EXAMINATION|CUTI ANTARA (?:SEMESTER|SIDANG)\s*\/?|SEMESTER BREAK|TUTORIAL/gi;
const COUNT_RE = /\((\d+)\s*MINGGU\s*\/\s*WEEKS?\)/gi;
const RANGE_RE = /(\d{2})\.(\d{2})\.(\d{4})\s*(?:to|-|hingga)\s*(\d{2})\.(\d{2})\.(\d{4})/;
const PERIOD_LABEL = { registration: 'Registration & orientation', lecture: 'Lectures', mid_break: 'Mid-semester break',
  revision: 'Revision week', exam: 'Final examination', semester_break: 'Semester break' };
function activityKind(t) {
  if (/pendaftaran|registration/i.test(t)) return 'registration';
  if (/kuliah|lectures/i.test(t)) return 'lecture';
  if (/cuti pert|mid\.?\s*semester/i.test(t)) return 'mid_break';
  if (/ulang kaji|revision/i.test(t)) return 'revision';
  if (/peperiksaan|examination/i.test(t)) return 'exam';
  if (/cuti antara|semester break/i.test(t)) return 'semester_break';
  return 'other';
}
const isoDate = (d, m, y) => `${y}-${m}-${d}`;
const addDays = (iso, n) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export function parseAcademicCalendarLines(lines) {
  const text = lines.join('\n');
  const session = (text.match(/(\d{4}\/\d{4})/) || [])[1] || '';
  const warnings = [];
  // split into semesters; the short/additional semester uses a two-column layout and is left out
  const sems = [];
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^\s*SEMESTER\s+(\d)\b/i);
    if (h) { cur = { name: `Semester ${h[1]}${session ? ' ' + session : ''}`, lines: [] }; sems.push(cur); continue; }
    if (/SEM\.\s*TAMBAHAN|SHORT\s*SEM|SEM\.\s*PENDEK/i.test(line)) { cur = null; continue; }
    if (cur) cur.lines.push(line);
  }
  // the first week row can sit above the "SEMESTER 1" line; fold any leading ranges into semester 1
  const firstSem = lines.findIndex((l) => /^\s*SEMESTER\s+\d/i.test(l));
  if (sems[0]) sems[0].lines.unshift(...lines.slice(0, Math.max(firstSem, 0)).filter((l) => RANGE_RE.test(l.trim().slice(0, 30))));
  const periods = [];
  for (const s of sems) {
    const weeks = s.lines.map((l) => l.trim().match(new RegExp('^' + RANGE_RE.source))).filter(Boolean)
      .map((m) => ({ start: isoDate(m[1], m[2], m[3]), end: isoDate(m[4], m[5], m[6]) }))
      .sort((a, b) => a.start.localeCompare(b.start));
    // activities in reading order, bilingual halves merged, each with its week count
    const body = s.lines.join(' ').replace(new RegExp(RANGE_RE.source, 'g'), ' ');
    const acts = [];
    const tokens = [...body.matchAll(new RegExp(`${ACTIVITY_RE.source}|${COUNT_RE.source}`, 'gi'))];
    for (const t of tokens) {
      if (t[1]) { const last = acts[acts.length - 1]; if (last && last.weeks == null) last.weeks = +t[1]; continue; }
      const kind = activityKind(t[0]);
      const last = acts[acts.length - 1];
      if (last && last.kind === kind && last.weeks == null) continue; // Malay + English halves of one label
      acts.push({ kind, weeks: null });
    }
    let i = 0;
    for (const a of acts) {
      const n = a.weeks ?? 1;
      const span = weeks.slice(i, i + n);
      i += n;
      if (!span.length) break;
      periods.push({ session, semester: s.name, kind: a.kind, label: PERIOD_LABEL[a.kind] || 'Other', start: span[0].start, end: span[span.length - 1].end, weeks: span.length });
    }
    if (i !== weeks.length) warnings.push(`${s.name}: the activities add up to ${i} weeks but the calendar lists ${weeks.length} week rows. Check the periods below.`);
  }
  // dated notes: "Hari Deepavali/Deepavali 08.11.2026 (Ahad/Sunday)", "X 06.02.2027 [Sabtu] & 07.02.2027 [Ahad]", "X: 14.11.2026 [..] hingga/to 17.11.2026 [..]"
  const notes = text.replace(/\n/g, ' ').replace(new RegExp(RANGE_RE.source, 'g'), ' ').replace(COUNT_RE, ' ')
    .replace(ACTIVITY_RE, ' ').replace(/\bSEMESTER\s+\d\b/gi, ' ');
  const events = [];
  const EV = /((?:(?!\d{2}\.\d{2}\.\d{4})[^\[\]])*?)(\d{2})\.(\d{2})\.(\d{4})\s*(?:[\[(][^\])]*[\])])?(?:\s*(?:&|hingga\s*\/\s*to|to)\s*(\d{2})\.(\d{2})\.(\d{4})\s*(?:[\[(][^\])]*[\])])?)?/g;
  for (const m of notes.matchAll(EV)) {
    let name = m[1];
    if (name.includes('*')) name = name.slice(name.lastIndexOf('*') + 1);
    const words = name.trim().split(/\s+/);
    while (words.length && (/^[^a-z]*$/.test(words[0]) && !/^[A-Z][a-z]/.test(words[0]))) words.shift(); // drop leftover ALL-CAPS headings
    name = words.join(' ').replace(/[\s:,-]+$/, '').replace(/\s*\/\s*/g, ' / ').trim();
    if (!name || name.length > 160) continue;
    const start = isoDate(m[2], m[3], m[4]);
    const end = m[5] ? isoDate(m[5], m[6], m[7]) : start;
    events.push({ title: name, start, end: end < start ? start : end,
      no_class: !/cadangan|konvokesyen|convocation|online|dalam talian|orientation|suai kenal|pendaftaran|registration|subject to change only/i.test(name) });
  }
  return { session, periods, events, warnings };
}

// Where a date falls in the academic calendar: { semester, kind, label, week (lecture week number), totalWeeks }
export function academicStatus(periods, iso) {
  const p = periods.find((x) => x.start_date <= iso && iso <= x.end_date);
  if (!p) return null;
  const lectures = periods.filter((x) => x.semester === p.semester && x.kind === 'lecture').sort((a, b) => a.start_date.localeCompare(b.start_date));
  const totalWeeks = lectures.reduce((n, x) => n + Math.round((Date.parse(x.end_date) - Date.parse(x.start_date)) / 864e5 + 1) / 7, 0);
  let week = null;
  if (p.kind === 'lecture') {
    week = 0;
    for (const x of lectures) {
      if (x.end_date < iso) week += Math.round((Date.parse(x.end_date) - Date.parse(x.start_date)) / 864e5 + 1) / 7;
      else if (x.start_date <= iso) week += Math.floor((Date.parse(iso) - Date.parse(x.start_date)) / (7 * 864e5)) + 1;
    }
  }
  return { semester: p.semester, kind: p.kind, label: p.label, week, totalWeeks };
}
export { addDays };
