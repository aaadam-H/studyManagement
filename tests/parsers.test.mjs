// npm test   (set SLIP_PDF=/path/to/slip.pdf to also test a real registration slip)
import assert from 'node:assert';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';
import { parseSlipLines, parseTimetableDoc, prettyGroup } from '../web/parsers.js';

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

const s = parseSlipLines(['NAME : TEST USER', 'MATRIC NUMBER : 111', 'COURSE REGISTRATION SLIP SEMESTER 1 ACADEMIC SESSION 2026/2027',
  '1 IMJ41002 Projek Tahun Akhir 1[Final Year Project 1] 2 FT UR6523002']);
assert.deepEqual([s.name, s.matric, s.semester, s.courses[0].code, s.courses[0].name, s.courses[0].credit], ['TEST USER', '111', 'Sem 1 2026/2027', 'IMJ41002', 'Final Year Project 1', 2]);
ok('slip: text lines');

if (process.env.SLIP_PDF) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(process.env.SLIP_PDF)), verbosity: 0 }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const rows = [];
    for (const it of (await (await doc.getPage(p)).getTextContent()).items) {
      if (!it.str) continue;
      let row = rows.find((r) => Math.abs(r.y - it.transform[5]) <= 2);
      if (!row) rows.push((row = { y: it.transform[5], items: [] }));
      row.items.push(it);
    }
    for (const r of rows.sort((a, b) => b.y - a.y)) lines.push(r.items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim());
  }
  const r = parseSlipLines(lines);
  console.log('   ', r.matric, r.program, r.semester, r.courses.map((c) => c.code).join(','));
  assert.ok(r.courses.length > 0 && r.matric);
  ok('slip: real PDF (same line-building as the browser)');
}
console.log('ALL PARSER TESTS PASSED');
