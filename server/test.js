// End-to-end smoke test on a throwaway database. Run: npm test
process.env.DATA_DIR = require('fs').mkdtempSync(require('os').tmpdir() + '/sh-');
process.env.ADMIN_PASSWORD = 'admin-test-pass';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = require('./index');
const A = require('./auth');
const { parseTimetableHtml } = require('./timetable');
const { parseSlipText } = require('./slip');

A.ensureAdmin();
const srv = app.listen(0);
const base = `http://localhost:${srv.address().port}/api`;
const jar = {};
async function call(who, method, url, body, form) {
  const r = await fetch(base + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie: jar[who] || '' }, body: form || (body ? JSON.stringify(body) : undefined) });
  const c = r.headers.get('set-cookie'); if (c) jar[who] = c.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}
const ok = (n) => console.log('  ok -', n);

(async () => {
  // timetable parser
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/timetable-sample.html'), 'utf8');
  const one = parseTimetableHtml(html, 'table_1103');
  assert.equal(one.classes.length, 4);
  const mon = one.classes.find((c) => c.course_code === 'IMJ41203');
  assert.deepEqual([mon.day, mon.start, mon.end, mon.venue], [1, '08:00', '10:00', 'DK 5']);
  assert.equal(parseTimetableHtml(html).classes.length, 5);
  ok('timetable parser (single table via #hash, and all tables)');

  // slip text parser
  const s = parseSlipText(' NAME\n: TEST USER\n MATRIC NUMBER\n: 111\n COURSE REGISTRATION SLIP SEMESTER1 ACADEMIC SESSION 2026/2027\n 1 IMJ41002 Projek Tahun Akhir 1[Final Year Project 1] 2 FT UR6523002\n');
  assert.equal(s.courses[0].code, 'IMJ41002'); assert.equal(s.courses[0].name, 'Final Year Project 1'); assert.equal(s.semester, 'Sem 1 2026/2027');
  ok('slip text parser');

  // auth
  assert.equal((await call('a', 'GET', '/courses')).status, 401);
  assert.equal((await call('a', 'POST', '/login', { username: 'admin', password: 'admin-test-pass' })).body.role, 'admin');
  assert.equal((await call('s', 'POST', '/register', { student_id: '231021306', name: 'Adam', password: 'short' })).status, 400);
  assert.equal((await call('s', 'POST', '/register', { student_id: '231021306', name: 'Adam', password: 'password123' })).status, 200);
  assert.equal((await call('s', 'POST', '/register', { student_id: '231021306', name: 'Dup', password: 'password123' })).status, 409);
  assert.equal((await call('s', 'GET', '/admin/users')).status, 403);
  ok('register / login / roles');

  // real slip PDF, if the developer has it locally
  const pdf = process.env.SLIP_PDF;
  if (pdf && fs.existsSync(pdf)) {
    const f = new FormData(); f.append('slip', new Blob([fs.readFileSync(pdf)], { type: 'application/pdf' }), 'slip.pdf');
    const r = await call('s', 'POST', '/slip/parse', null, f);
    assert.equal(r.body.courses.length, 5); assert.equal(r.body.matric, '231021306');
    await call('s', 'POST', '/slip/confirm', { courses: r.body.courses, profile: r.body });
    ok('real PDF slip -> 5 courses');
  } else await call('s', 'POST', '/slip/confirm', { courses: ['IMJ41203', 'IMJ41103', 'IMJ47203', 'IMJ47503'].map((code) => ({ code, name: code, credit: 3 })) });
  assert.equal((await call('s', 'GET', '/courses')).body.length >= 4, true);

  // admin loads timetable from uploaded html; user sees it
  const f2 = new FormData(); f2.append('html', new Blob([html]), 't.html');
  assert.equal((await call('s', 'POST', '/admin/timetable/upload', null, f2)).status, 403);
  await call('a', 'PUT', '/admin/settings', { timetable_url: 'https://example.edu/tt.html#table_1103' });
  assert.equal((await call('a', 'POST', '/admin/timetable/upload', null, f2)).body.classes, 4);
  const tt = (await call('s', 'GET', '/timetable')).body;
  assert.equal(tt.classes.length, 4); assert.equal(tt.needChoice.length, 0);
  ok('timetable upload + per-user schedule');

  // bulletin
  assert.equal((await call('s', 'POST', '/bulletin', { course_code: 'IMJ41203', kind: 'assignment', title: 'Report 1', due_date: '2026-10-20' })).status, 200);
  assert.equal((await call('s', 'POST', '/bulletin', { title: 'general' })).status, 400);
  const n = await call('a', 'POST', '/bulletin', { title: 'Campus notice' });
  assert.equal(n.status, 200);
  const b = (await call('s', 'GET', '/bulletin')).body;
  assert.equal(b.posts.length, 2);
  assert.equal((await call('s', 'DELETE', '/bulletin/' + n.body.id)).status, 403);
  ok('bulletin: post, permissions');

  // personal data isolation
  await call('s', 'POST', '/notes', { title: 'private' });
  await call('o', 'POST', '/register', { student_id: 'other1', name: 'Other', password: 'password123' });
  assert.equal((await call('o', 'GET', '/notes')).body.length, 0);
  ok('per-user data isolation');
  console.log('ALL PASSED'); srv.close(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
