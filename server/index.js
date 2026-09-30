const express = require('express');
const multer = require('multer');
const path = require('path');
const { db, getSetting, setSetting } = require('./db');
const A = require('./auth');
const { parseSlipPdf } = require('./slip');
const { fetchTimetable, parseTimetableHtml } = require('./timetable');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(A.loadUser);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => { console.error(e); res.status(500).json({ error: e.message || 'Server error' }); });
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const str = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);

/* ---------- auth ---------- */
const publicUser = (u) => db.prepare('SELECT id,username,name,email,phone,program,faculty,year,semester,role FROM users WHERE id=?').get(u.id);

app.post('/api/register', (req, res) => {
  const b = req.body || {};
  const username = str(b.student_id, 30), name = str(b.name, 120), password = String(b.password || '');
  if (!username || !name) return bad(res, 'Student ID and name are required');
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) return bad(res, 'Student ID may only contain letters, digits . _ -');
  if (password.length < 8) return bad(res, 'Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return bad(res, 'That student ID is already registered', 409);
  const r = db.prepare('INSERT INTO users(username,password_hash,name,email,phone,program,faculty,year,semester) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(username, A.hashPassword(password), name, str(b.email, 120), str(b.phone, 30), str(b.program, 120), str(b.faculty, 120), b.year ? +b.year : null, str(b.semester, 40));
  const token = A.createSession(Number(r.lastInsertRowid));
  res.setHeader('Set-Cookie', A.cookieHeader(token, A.SESSION_MS));
  res.json(publicUser({ id: Number(r.lastInsertRowid) }));
});
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
  if (!u || !A.verifyPassword(String(password || ''), u.password_hash)) return bad(res, 'Wrong student ID or password', 401);
  res.setHeader('Set-Cookie', A.cookieHeader(A.createSession(u.id), A.SESSION_MS));
  res.json(publicUser(u));
});
app.post('/api/logout', (req, res) => {
  if (req.token) db.prepare('DELETE FROM sessions WHERE token=?').run(req.token);
  res.setHeader('Set-Cookie', A.cookieHeader('', 0));
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json(req.user ? publicUser(req.user) : null));

const api = express.Router();
api.use(A.requireAuth);
app.use('/api', api);

api.put('/me', (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE users SET name=COALESCE(?,name), email=?, phone=?, program=?, faculty=?, year=?, semester=? WHERE id=?')
    .run(str(b.name, 120), str(b.email, 120), str(b.phone, 30), str(b.program, 120), str(b.faculty, 120), b.year ? +b.year : null, str(b.semester, 40), req.user.id);
  res.json(publicUser(req.user));
});
api.put('/me/password', (req, res) => {
  const { current, next } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!A.verifyPassword(String(current || ''), u.password_hash)) return bad(res, 'Current password is wrong', 403);
  if (String(next || '').length < 8) return bad(res, 'New password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(A.hashPassword(next), u.id);
  res.json({ ok: true });
});

/* ---------- courses / registration slip ---------- */
const myCourses = (uid) => db.prepare(`SELECT c.code,c.name,c.credit,e.status,e.grp,e.section FROM enrollments e JOIN courses c ON c.code=e.course_code WHERE e.user_id=? ORDER BY c.code`).all(uid);

api.get('/courses', (req, res) => res.json(myCourses(req.user.id)));
api.get('/courses/all', (_req, res) => res.json(db.prepare('SELECT * FROM courses ORDER BY code').all()));

// Step 1: upload PDF -> returns what was found (nothing is saved yet so the user can check it)
api.post('/slip/parse', upload.single('slip'), wrap(async (req, res) => {
  if (!req.file) return bad(res, 'Attach the PDF as "slip"');
  let parsed;
  try { parsed = await parseSlipPdf(req.file.buffer); } catch { return bad(res, 'Could not read that PDF'); }
  if (!parsed.courses.length) return bad(res, 'No courses found - is this the UniMAP course registration slip?');
  res.json(parsed);
}));
// Step 2: confirm -> replaces the user's registered courses and (optionally) fills the profile
api.post('/slip/confirm', (req, res) => {
  const { courses, profile } = req.body || {};
  if (!Array.isArray(courses) || !courses.length) return bad(res, 'No courses to save');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM enrollments WHERE user_id=?').run(req.user.id);
    for (const c of courses) {
      const code = str(c.code, 12);
      if (!code || !/^[A-Z]{3}\d{5}$/.test(code)) continue;
      db.prepare('INSERT INTO courses(code,name,credit) VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET name=COALESCE(excluded.name,name), credit=COALESCE(excluded.credit,credit)')
        .run(code, str(c.name, 200), c.credit ? +c.credit : null);
      db.prepare('INSERT INTO enrollments(user_id,course_code,status,grp) VALUES(?,?,?,?)').run(req.user.id, code, str(c.status, 5), str(c.grp, 30));
    }
    if (profile) db.prepare('UPDATE users SET program=COALESCE(?,program), semester=COALESCE(?,semester) WHERE id=?').run(str(profile.program, 120), str(profile.semester, 40), req.user.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json(myCourses(req.user.id));
});
api.post('/courses', (req, res) => {
  const code = str(req.body.code, 12)?.toUpperCase();
  if (!code || !/^[A-Z]{3}\d{5}$/.test(code)) return bad(res, 'Course code looks like IMJ41103');
  db.prepare('INSERT INTO courses(code,name,credit) VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET name=COALESCE(excluded.name,name)').run(code, str(req.body.name, 200), req.body.credit ? +req.body.credit : null);
  db.prepare('INSERT OR IGNORE INTO enrollments(user_id,course_code) VALUES(?,?)').run(req.user.id, code);
  res.json(myCourses(req.user.id));
});
api.delete('/courses/:code', (req, res) => { db.prepare('DELETE FROM enrollments WHERE user_id=? AND course_code=?').run(req.user.id, req.params.code); res.json(myCourses(req.user.id)); });
api.put('/courses/:code/section', (req, res) => {
  db.prepare('UPDATE enrollments SET section=? WHERE user_id=? AND course_code=?').run(str(req.body.section, 120), req.user.id, req.params.code);
  res.json(myCourses(req.user.id));
});

/* ---------- timetable ---------- */
api.get('/timetable', (req, res) => {
  const rows = db.prepare(`SELECT cl.*, c.name AS course_name, e.section AS chosen
    FROM enrollments e JOIN classes cl ON cl.course_code=e.course_code JOIN courses c ON c.code=e.course_code
    WHERE e.user_id=? ORDER BY cl.day, cl.start`).all(req.user.id);
  // sections available per course; if only one section exists it applies automatically
  const sections = {};
  for (const r of rows) (sections[r.course_code] ||= new Set()).add(r.section);
  const classes = rows.filter((r) => sections[r.course_code].size === 1 || !r.chosen || r.chosen === r.section);
  const needChoice = Object.entries(sections).filter(([code, s]) => s.size > 1 && !rows.find((r) => r.course_code === code && r.chosen)).map(([code, s]) => ({ code, sections: [...s] }));
  res.json({
    url: getSetting('timetable_url'), synced_at: getSetting('timetable_synced_at'),
    classes, needChoice, myCourseCount: myCourses(req.user.id).length,
    totalClassesInDb: db.prepare('SELECT COUNT(*) n FROM classes').get().n,
  });
});

function storeClasses(result, url) {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM classes');
    const ins = db.prepare('INSERT INTO classes(course_code,section,day,start,end,kind,venue,lecturer,details) VALUES(?,?,?,?,?,?,?,?,?)');
    for (const c of result.classes) ins.run(c.course_code, c.section, c.day, c.start, c.end, c.kind, c.venue, c.lecturer, c.details);
    setSetting('timetable_synced_at', new Date().toISOString());
    if (url) setSetting('timetable_synced_url', url);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ---------- bulletin ---------- */
api.get('/bulletin', (req, res) => {
  const posts = db.prepare(`SELECT p.*, u.name AS author, u.username AS author_id, c.name AS course_name FROM posts p
    JOIN users u ON u.id=p.user_id LEFT JOIN courses c ON c.code=p.course_code ORDER BY p.created_at DESC, p.id DESC LIMIT 500`).all();
  res.json({ posts, mine: myCourses(req.user.id).map((c) => c.code), allCourses: db.prepare('SELECT code,name FROM courses ORDER BY code').all() });
});
api.post('/bulletin', (req, res) => {
  const b = req.body || {};
  const title = str(b.title, 200);
  if (!title) return bad(res, 'Title is required');
  const kind = ['info', 'assignment', 'exam', 'urgent'].includes(b.kind) ? b.kind : 'info';
  const code = str(b.course_code, 12);
  if (code && !db.prepare('SELECT 1 FROM courses WHERE code=?').get(code)) return bad(res, 'Unknown subject');
  if (!code && req.user.role !== 'admin') return bad(res, 'Pick a subject (general posts are admin-only)');
  if (code && req.user.role !== 'admin' && !db.prepare('SELECT 1 FROM enrollments WHERE user_id=? AND course_code=?').get(req.user.id, code)) return bad(res, 'You can only post to subjects you are registered for', 403);
  const r = db.prepare('INSERT INTO posts(course_code,user_id,kind,title,body,due_date) VALUES(?,?,?,?,?,?)').run(code, req.user.id, kind, title, str(b.body, 4000), str(b.due_date, 20));
  res.json({ id: Number(r.lastInsertRowid) });
});
api.delete('/bulletin/:id', (req, res) => {
  const p = db.prepare('SELECT user_id FROM posts WHERE id=?').get(req.params.id);
  if (!p) return bad(res, 'Not found', 404);
  if (p.user_id !== req.user.id && req.user.role !== 'admin') return bad(res, 'Not yours', 403);
  db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- personal: assignments, grades, notes ---------- */
function crud(name, table, cols, order) {
  api.get(`/${name}`, (req, res) => res.json(db.prepare(`SELECT * FROM ${table} WHERE user_id=? ORDER BY ${order}`).all(req.user.id)));
  api.post(`/${name}`, (req, res) => {
    const b = req.body || {};
    const vals = cols.map((c) => (c.num ? (b[c.k] === '' || b[c.k] == null ? null : +b[c.k]) : str(b[c.k], c.max || 4000)));
    if (cols.filter((c) => c.req).some((c) => vals[cols.indexOf(c)] == null)) return bad(res, 'Missing required field');
    const r = db.prepare(`INSERT INTO ${table}(user_id,${cols.map((c) => c.k).join(',')}) VALUES(?,${cols.map(() => '?').join(',')})`).run(req.user.id, ...vals);
    res.json({ id: Number(r.lastInsertRowid) });
  });
  api.put(`/${name}/:id`, (req, res) => {
    const b = req.body || {};
    const sets = cols.filter((c) => c.k in b);
    if (!sets.length) return bad(res, 'Nothing to update');
    db.prepare(`UPDATE ${table} SET ${sets.map((c) => c.k + '=?').join(',')} WHERE id=? AND user_id=?`)
      .run(...sets.map((c) => (c.num ? (b[c.k] === '' || b[c.k] == null ? null : +b[c.k]) : str(b[c.k], c.max || 4000))), req.params.id, req.user.id);
    res.json({ ok: true });
  });
  api.delete(`/${name}/:id`, (req, res) => { db.prepare(`DELETE FROM ${table} WHERE id=? AND user_id=?`).run(req.params.id, req.user.id); res.json({ ok: true }); });
}
crud('assignments', 'assignments', [{ k: 'course_code', max: 12 }, { k: 'title', req: 1, max: 200 }, { k: 'description' }, { k: 'due_date', max: 20 }, { k: 'done', num: 1 }], 'done, due_date IS NULL, due_date');
crud('grades', 'grades', [{ k: 'course_code', max: 12 }, { k: 'item', req: 1, max: 200 }, { k: 'score', num: 1 }, { k: 'max_score', num: 1 }, { k: 'weight', num: 1 }], 'course_code, id');
crud('notes', 'notes', [{ k: 'course_code', max: 12 }, { k: 'title', req: 1, max: 200 }, { k: 'body', max: 20000 }], 'id DESC');

/* ---------- admin ---------- */
const admin = express.Router();
admin.use(A.requireAdmin);
api.use('/admin', admin);

admin.get('/users', (_req, res) => res.json(db.prepare(`SELECT u.id,u.username,u.name,u.email,u.phone,u.program,u.role,u.created_at,
  (SELECT COUNT(*) FROM enrollments e WHERE e.user_id=u.id) AS courses FROM users u ORDER BY u.created_at DESC`).all()));
admin.put('/users/:id/role', (req, res) => {
  if (+req.params.id === req.user.id) return bad(res, 'You cannot change your own role');
  if (!['student', 'admin'].includes(req.body.role)) return bad(res, 'Bad role');
  db.prepare('UPDATE users SET role=? WHERE id=?').run(req.body.role, req.params.id); res.json({ ok: true });
});
admin.post('/users/:id/reset-password', (req, res) => {
  const pw = String(req.body.password || '');
  if (pw.length < 8) return bad(res, 'Password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(A.hashPassword(pw), req.params.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id); res.json({ ok: true });
});
admin.delete('/users/:id', (req, res) => {
  if (+req.params.id === req.user.id) return bad(res, 'You cannot delete yourself');
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id); res.json({ ok: true });
});
admin.get('/settings', (_req, res) => res.json({ timetable_url: getSetting('timetable_url'), synced_at: getSetting('timetable_synced_at'), classes: db.prepare('SELECT COUNT(*) n FROM classes').get().n }));
admin.put('/settings', (req, res) => {
  const url = str(req.body.timetable_url, 1000);
  try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { return bad(res, 'Enter a full http(s) link'); }
  setSetting('timetable_url', url); res.json({ ok: true });
});
admin.post('/timetable/sync', wrap(async (_req, res) => {
  const url = getSetting('timetable_url');
  let result;
  try { result = await fetchTimetable(url); } catch (e) { return bad(res, `Could not fetch the timetable page: ${e.cause?.code || e.message}. You can upload the saved HTML instead.`, 502); }
  if (!result.classes.length) return bad(res, `Fetched the page (${result.tablesScanned} table(s) scanned) but found no classes. Upload the saved HTML or ask for the parser to be adjusted.`, 422);
  storeClasses(result, url);
  res.json({ classes: result.classes.length, tables: result.tablesScanned, selectedTable: result.selectedTable });
}));
admin.post('/timetable/upload', upload.single('html'), wrap(async (req, res) => {
  if (!req.file) return bad(res, 'Attach the file as "html"');
  const hash = getSetting('timetable_url', '').split('#')[1] || null;
  const result = parseTimetableHtml(req.file.buffer.toString('utf8'), hash);
  if (!result.classes.length) return bad(res, `No classes found in that file (${result.tablesScanned} table(s) scanned)`, 422);
  storeClasses(result, 'uploaded file');
  res.json({ classes: result.classes.length, tables: result.tablesScanned, selectedTable: result.selectedTable });
}));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', (_req, res) => bad(res, 'Not found', 404));

if (require.main === module) {
  A.ensureAdmin();
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`StudyHub running on http://localhost:${port}`));
}
module.exports = app;
