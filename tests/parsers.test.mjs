// npm test   (set SLIP_PDF=/path/to/slip.pdf and/or EXAM_SLIP_PDF=/path/to/exam-slip.pdf to also test real PDFs)
import assert from 'node:assert';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';
import { parseSlipLines, registrationTableLines, parseTimetableDoc, prettyGroup, parseAcademicCalendarLines, academicStatus, parseExamSlipLines } from '../web/parsers.js';

const ok = (m) => console.log('  ok -', m);
const { document } = parseHTML(fs.readFileSync(new URL('./fixtures/timetable-sample.html', import.meta.url), 'utf8'));

const one = parseTimetableDoc(document, 'table_1103');
assert.equal(one.classes.length, 4);
const mon = one.classes.find((c) => c.course_code === 'IMJ41203');
assert.deepEqual([mon.day, mon.start, mon.end, mon.venue, mon.kind], [1, '08:00', '10:00', 'DK 5', 'Lecture']);
assert.equal(mon.section, 'Group 1103 - Computer Engineering Year 4');
ok('timetable: one table selected by #hash, colspan -> 08:00-10:00');
assert.equal(parseTimetableDoc(document).classes.length, 5);
assert.equal(parseTimetableDoc(document, 'table_nope').classes.length, 5);
ok('timetable: all tables when hash missing/unknown');

const { document: d2 } = parseHTML(`<table><tr><th>Time</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th></tr>
<tr><td>08:00-10:00</td><td>IMJ41103 (L) DK 1</td><td></td><td></td></tr><tr><td>10:00-11:00</td><td></td><td></td><td>IMJ47503 LAB MK 2</td></tr></table>`);
const b = parseTimetableDoc(d2).classes;
assert.deepEqual(b.map((c) => [c.course_code, c.day, c.start, c.end]), [['IMJ41103', 1, '08:00', '10:00'], ['IMJ47503', 3, '10:00', '11:00']]);
ok('timetable: transposed layout (days across)');

const { document: mergedRows } = parseHTML(`<table><tr><th>Time</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th></tr>
<tr><th>15:00-15:50</th><td rowspan="2">IMJ41002 LAB</td><td rowspan="2">IMJ41103 LAB</td><td>IMQ22103 LECTURE DK 5</td></tr>
<tr><th>16:00-16:50</th></tr>
<tr><th>17:00-17:50</th><td>IMJ41002 LECTURE</td><td>IMJ41103 LECTURE</td><td>IMQ22103 LECTURE ONLINE</td></tr></table>`);
const mergedClasses = parseTimetableDoc(mergedRows).classes;
assert.ok(mergedClasses.some((c) => c.course_code === 'IMQ22103' && c.day === 3 && c.start === '15:00'));
assert.ok(mergedClasses.some((c) => c.course_code === 'IMQ22103' && c.day === 3 && c.start === '17:00'), 'merged cells in earlier rows must not shift the day columns');
ok('timetable: transposed layout keeps day columns aligned after rowspans');

const { document: timedRows } = parseHTML(`<table><tr><th>Time</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th></tr>
<tr><th>12:00-12:50</th><td></td><td></td><td></td><td rowspan="2">IMJ47203 - SOFTWARE ENGINEERING LECTURE PAUH PUTRA DK 3</td></tr>
<tr><th>13:00-13:50</th><td></td><td>IMJ47503 LECTURE ONLINE</td><td></td></tr></table>`);
const timedClasses = parseTimetableDoc(timedRows).classes;
assert.ok(timedClasses.some((c) => c.course_code === 'IMJ47203' && c.day === 4 && c.start === '12:00' && c.end === '13:50'), 'rowspan class duration must cover both time slots');
assert.ok(timedClasses.some((c) => c.course_code === 'IMJ47503' && c.day === 2 && c.start === '13:00' && c.end === '13:50'), 'single-slot rows following a rowspan must keep their correct day and time');
ok('timetable: transposed rowspan extends class duration across every covered slot');

// real UniMAP page structure (FET): labelled spans, one table per group
const { document: u } = parseHTML(fs.readFileSync(new URL('./fixtures/unimap-sample.html', import.meta.url), 'utf8'));
const all = parseTimetableDoc(u);
assert.equal(all.tablesScanned, 2);
assert.deepEqual([...new Set(all.classes.map((c) => c.section))], ['UR6523002 - Y3G1', 'UR6523002 - Y3G2']);
const g1 = all.classes.filter((c) => c.section === 'UR6523002 - Y3G1');
assert.equal(g1.length, 10);
assert.deepEqual(g1[0], { course_code: 'IMJ32102', course_name: 'Professional Engineers', kind: 'LECTURE', venue: 'PAUH PUTRA - DK 5',
  lecturer: 'ROSDISHAM BIN ENDUT, R BADLISHAH BIN AHMAD', details: 'LECTURE FKC (CE)', section: 'UR6523002 - Y3G1', day: 1, start: '10:00', end: '11:50' });
assert.ok(g1.some((c) => c.course_code === 'IMJ32104' && c.day === 2 && c.start === '16:00' && c.end === '16:50'), 'single-slot class after colspans');
assert.equal(prettyGroup('UR6523002 - Y3G1'), 'Year 3, Group 1');
ok('timetable: real UniMAP layout (groups, names, lecturers, venues, 11.00 header)');

const cell = (subj) => `<td><div class="line1"><span class="subject">${subj}</span><span class="activitytag"> LECTURE X</span></div><div class="teacher line2">FKC - DR A</div><div class="room line3">DK 1 (300)</div></td>`;
const { document: m } = parseHTML(`<table><caption><span class="name">UR1 - Y4G1 (25) Automatic Subgroup</span></caption>
<tr><td></td><th>08:00-08:50</th><th>09:00-09:50</th><th>10:00-10:50</th></tr>
<tr><th>MONDAY</th>${cell('IMJ41002/IMJ42004 - FINAL YEAR PROJECT 1/2')}${cell('SMU32202-THINKING SKILLS')}${cell('EMK32503 - SUBSTATION ENGINEERING / EMK32803 - ELECTRICAL SUBSTATION TECHNOLOGY')}</tr>
<tr><th>TUESDAY</th>${cell('AMJ10803 / EAT153 - FUNDAMENTAL OF CHEMICAL PROCESSES')}<td></td><td></td></tr></table>`);
const mc = parseTimetableDoc(m).classes.map((c) => `${c.course_code}=${c.course_name}`);
assert.deepEqual(mc, ['IMJ41002=Final Year Project 1/2', 'IMJ42004=Final Year Project 1/2', 'SMU32202=Thinking Skills',
  'EMK32503=Substation Engineering', 'EMK32803=Electrical Substation Technology', 'AMJ10803=Fundamental of Chemical Processes']);
ok('timetable: shared codes (A/B - name), "CODE-NAME", two code-name pairs in one cell');

// academic calendar: text lines of the UniMAP 2026/2027 Kalendar Akademik PDF (same line-building as the browser)
const ac = parseAcademicCalendarLines(fs.readFileSync(new URL('./fixtures/academic-calendar-2026-2027.txt', import.meta.url), 'utf8').split('\n'));
assert.equal(ac.session, '2026/2027');
assert.deepEqual(ac.warnings, []);
assert.deepEqual(ac.periods.map((p) => `${p.semester.slice(0, 10)} ${p.kind} ${p.start} ${p.end}`), [
  'Semester 1 registration 2026-09-28 2026-10-04', 'Semester 1 lecture 2026-10-05 2026-11-29', 'Semester 1 mid_break 2026-11-30 2026-12-06',
  'Semester 1 lecture 2026-12-07 2027-01-17', 'Semester 1 revision 2027-01-18 2027-01-24', 'Semester 1 exam 2027-01-25 2027-02-07',
  'Semester 1 semester_break 2027-02-08 2027-03-07', 'Semester 2 lecture 2027-03-08 2027-05-16', 'Semester 2 mid_break 2027-05-17 2027-05-23',
  'Semester 2 lecture 2027-05-24 2027-06-20', 'Semester 2 revision 2027-06-21 2027-06-27', 'Semester 2 exam 2027-06-28 2027-07-11']);
assert.equal(ac.events.length, 18);
const ev = (t) => ac.events.find((e) => e.title.includes(t));
assert.deepEqual(ev('Chinese New Year'), { title: 'Tahun Baru Cina / Chinese New Year', start: '2027-02-06', end: '2027-02-07', no_class: true });
assert.deepEqual(ev('Konvokesyen'), { title: 'Cadangan tarikh Istiadat Konvokesyen 21', start: '2026-11-14', end: '2026-11-17', no_class: false });
assert.equal(ev('Online Teaching').no_class, false);
assert.equal(ev('Orientation').no_class, false);
assert.ok(ev('Malaysia Day') && ev('Deepavali').start === '2026-11-08');
const P = ac.periods.map((p) => ({ ...p, start_date: p.start, end_date: p.end }));
assert.deepEqual(academicStatus(P, '2026-12-08'), { semester: 'Semester 1 2026/2027', kind: 'lecture', label: 'Lectures', week: 9, totalWeeks: 14 });
assert.equal(academicStatus(P, '2026-12-02').kind, 'mid_break');
ok('academic calendar: periods from week counts, holidays, lecture week number');

const s = parseSlipLines(['NAME : TEST USER', 'MATRIC NUMBER : 111', 'COURSE REGISTRATION SLIP SEMESTER 1 ACADEMIC SESSION 2026/2027',
  '1 IMJ41002 Projek Tahun Akhir 1[Final Year Project 1] 2 FT UR6523002']);
assert.deepEqual([s.name, s.matric, s.semester, s.courses[0].code, s.courses[0].name, s.courses[0].credit], ['TEST USER', '111', 'Sem 1 2026/2027', 'IMJ41002', 'Final Year Project 1', 2]);
ok('slip: text lines');

const wrappedSlip = parseSlipLines(fs.readFileSync(new URL('./fixtures/registration-slip-wrapped.txt', import.meta.url), 'utf8').split(/\r?\n/));
assert.deepEqual(wrappedSlip.courses.map((course) => [course.code, course.name, course.credit]), [
  ['IMJ21203', 'Algorithm and Data Structures', 3],
  ['IMJ41103', 'Modern Operating System', 3],
  ['IMJ41203', 'Artificial Intelligence', 3],
  ['IMJ47203', 'Software Engineering', 3],
  ['IMJ47403', 'Computer Network Security', 3],
  ['IMQ22103', 'Discrete Mathematics & Linear Algebra', 3],
]);
assert.match(wrappedSlip.courses[5].grp, /UR6523002 - Y2G3, Y2G4 \(INTAKE 2025 & 2026\)/);
ok('slip: wrapped titles and groups');

// Anonymized table text/positions from the reported PDF. Its multiline cells
// straddle the course-code baseline, including a four-line group in row six.
const positionedItems = JSON.parse(fs.readFileSync(new URL('./fixtures/registration-slip-positioned.json', import.meta.url), 'utf8'));
const positioned = registrationTableLines(positionedItems);
const actualSlip = parseSlipLines([...positioned.lines, 'TOTAL CREDITS REGISTERED: 18']);
assert.deepEqual(actualSlip.courses.map((c) => [c.code, c.name, c.credit]), [
  ['IMJ21203', 'Algorithm and Data Structures', 3],
  ['IMJ41103', 'Modern Operating System', 3],
  ['IMJ41203', 'Artificial Intelligence', 3],
  ['IMJ47203', 'Software Engineering', 3],
  ['IMJ47403', 'Computer Network Security', 3],
  ['IMQ22103', 'Discrete Mathematics & Linear Algebra', 3],
]);
assert.ok(actualSlip.courses.every((c) => c.status === 'FT'));
assert.ok(actualSlip.courses.slice(0, 5).every((c) => c.grp === 'UR6523002'));
assert.equal(actualSlip.courses[5].grp, 'UR6523002 - Y2G3, Y2G4 (INTAKE 2025 & 2026)');
assert.equal(registrationTableLines([]), null);
assert.throws(() => parseSlipLines(['1 IMJ21203 3 FT UR6523002']), /Could not read every course/);
assert.throws(() => parseSlipLines([positioned.lines[1], 'TOTAL CREDITS REGISTERED: 18']), /Could not read every course/);
ok('slip: positioned PDF cells give all six subjects, correct names/groups, 18 credits; partial imports rejected');

const ex = parseExamSlipLines(fs.readFileSync(new URL('./fixtures/exam-slip-sample.txt', import.meta.url), 'utf8').split(/\r?\n/));
assert.deepEqual([ex.session, ex.matric, ex.index_no, ex.exams.length, ex.notices.length], ['Sem 2 2025/2026', '200000001', '12345', 5, 3]);
assert.deepEqual(ex.exams[1], { code: 'IMJ32102', credit: 2, date: '2026-07-17', time: '09:00', venue: 'DTC', name: 'Professional Engineers', name_local: 'Jurutera Profesional' });
assert.deepEqual([ex.exams[2].date, ex.exams[2].time, ex.exams[2].venue], ['2026-07-07', '14:30', 'DEWAN KULIAH 1']);
assert.deepEqual([ex.exams[0].date, ex.exams[0].time, ex.exams[0].venue, ex.exams[0].name], [null, null, null, 'Integrated Design Project']);
assert.ok(ex.notices[2].endsWith('strictly prohibited.'));
assert.ok(!JSON.stringify(ex).includes('000000000000'), 'IC number must never be read');
ok('exam slip: dates, 12h times, venues, unscheduled subjects, rules; IC number ignored');

async function pdfLines(path, registration = false) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path)), verbosity: 0 }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const rows = [];
    const items = (await (await doc.getPage(p)).getTextContent()).items;
    const table = registration ? registrationTableLines(items) : null;
    for (const it of items) {
      if (!it.str) continue;
      let row = rows.find((r) => Math.abs(r.y - it.transform[5]) <= 2);
      if (!row) rows.push((row = { y: it.transform[5], items: [] }));
      row.items.push(it);
    }
    let tableAdded = false;
    for (const r of rows.sort((a, b) => b.y - a.y)) {
      if (table && table.bottom < r.y && r.y < table.top) {
        if (!tableAdded) { lines.push(...table.lines); tableAdded = true; }
        continue;
      }
      lines.push(r.items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim());
    }
  }
  return lines;
}
if (process.env.SLIP_PDF) {
  const r = parseSlipLines(await pdfLines(process.env.SLIP_PDF, true));
  console.log('   ', r.matric, r.program, r.semester, r.courses.map((c) => c.code).join(','));
  assert.ok(r.courses.length > 0 && r.matric);
  if (process.env.SLIP_EXPECTED_COUNT) assert.equal(r.courses.length, +process.env.SLIP_EXPECTED_COUNT);
  if (process.env.SLIP_EXPECTED_CREDITS) assert.equal(r.courses.reduce((sum, c) => sum + c.credit, 0), +process.env.SLIP_EXPECTED_CREDITS);
  ok('slip: real PDF (same line-building as the browser)');
}
if (process.env.EXAM_SLIP_PDF) {
  const r = parseExamSlipLines(await pdfLines(process.env.EXAM_SLIP_PDF));
  console.log('   ', r.session, r.exams.map((e) => `${e.code} ${e.date || '-'} ${e.time || ''} ${e.venue || ''}`).join(' | '));
  assert.ok(r.exams.length > 0 && r.session);
  ok('exam slip: real PDF (same line-building as the browser)');
}
console.log('ALL PARSER TESTS PASSED');
