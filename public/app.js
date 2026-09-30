'use strict';
const $app = document.getElementById('app');
let me = null;
const DAYN = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fd = (o) => Object.fromEntries(new FormData(o));
const today = () => new Date().toISOString().slice(0, 10);

async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body instanceof FormData) o.body = opts.body;
  else if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const r = await fetch('/api' + path, o);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; throw e; }
  return j;
}
const flash = (el, msg, ok) => { el.innerHTML = `<div class="${ok ? 'ok' : 'err'}">${esc(msg)}</div>`; };
function courseOptions(courses, sel = '', blank = 'No subject') {
  return `<option value="">${blank}</option>` + courses.map((c) => `<option value="${esc(c.code)}" ${c.code === sel ? 'selected' : ''}>${esc(c.code)} - ${esc(c.name || '')}</option>`).join('');
}

/* ---------------- auth screens ---------------- */
function authScreen(mode = 'login') {
  const reg = mode === 'register';
  $app.innerHTML = `<div class="auth"><h1>StudyHub</h1><p class="sub">${reg ? 'Create your student account' : 'Log in to your study planner'}</p>
  <form class="card" id="f">
    <label>Student ID (matric no.)</label><input name="${reg ? 'student_id' : 'username'}" required autocomplete="username">
    ${reg ? `<label>Full name</label><input name="name" required>
    <div class="row"><div><label>Email</label><input name="email" type="email"></div><div><label>Phone</label><input name="phone"></div></div>
    <label>Programme</label><input name="program" placeholder="e.g. Kejuruteraan Komputer">
    <div class="row"><div><label>Faculty / school</label><input name="faculty"></div><div><label>Year</label><input name="year" type="number" min="1" max="6"></div></div>
    <label>Current semester</label><input name="semester" placeholder="e.g. Sem 1 2026/2027">` : ''}
    <label>Password ${reg ? '(min 8 characters)' : ''}</label><input name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}">
    <div id="msg"></div><p><button>${reg ? 'Register' : 'Log in'}</button></p>
    <p class="mute">${reg ? 'Have an account? <a href="#" id="sw">Log in</a>' : 'New here? <a href="#" id="sw">Register</a>'}</p>
  </form></div>`;
  document.getElementById('sw').onclick = (e) => { e.preventDefault(); authScreen(reg ? 'login' : 'register'); };
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    try { me = await api(reg ? '/register' : '/login', { method: 'POST', body: fd(e.target) }); location.hash = reg ? '#/courses' : '#/'; boot(); }
    catch (err) { flash(document.getElementById('msg'), err.message); }
  };
}

/* ---------------- shell ---------------- */
const ROUTES = {
  '': ['Dashboard', pgDashboard], timetable: ['Timetable', pgTimetable], bulletin: ['Bulletin', pgBulletin], courses: ['My Courses', pgCourses],
  assignments: ['Assignments', pgAssignments], calendar: ['Calendar', pgCalendar], grades: ['Grades', pgGrades], notes: ['Notes', pgNotes], profile: ['Profile', pgProfile],
};
async function boot() {
  try { me = await api('/me'); } catch { me = null; }
  if (!me) return authScreen();
  render();
}
async function render() {
  if (!me) return authScreen();
  const key = (location.hash.replace(/^#\/?/, '').split('/')[0]) || '';
  const routes = { ...ROUTES, ...(me.role === 'admin' ? { admin: ['Admin', pgAdmin] } : {}) };
  const [, fn] = routes[key] || routes[''];
  $app.innerHTML = `<div class="shell"><nav><h1>StudyHub</h1><small>Personal Management</small>
    ${Object.entries(routes).map(([k, [t]]) => `<a href="#/${k}" class="${k === key ? 'on' : ''}">${t}</a>`).join('')}
    <div class="who">${esc(me.name)}<br>${esc(me.username)}${me.role === 'admin' ? ' (admin)' : ''}<br><a href="#" id="lo">Log out</a></div></nav><main id="main">Loading...</main></div>`;
  document.getElementById('lo').onclick = async (e) => { e.preventDefault(); await api('/logout', { method: 'POST' }); me = null; authScreen(); };
  try { await fn(document.getElementById('main')); }
  catch (e) { if (e.status === 401) { me = null; authScreen(); } else document.getElementById('main').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', render);

/* ---------------- dashboard ---------------- */
async function pgDashboard(m) {
  const [tt, asg, bul] = await Promise.all([api('/timetable'), api('/assignments'), api('/bulletin')]);
  const dow = new Date().getDay() || 7, t = today();
  const todays = tt.classes.filter((c) => c.day === dow);
  const pending = asg.filter((a) => !a.done);
  const overdue = pending.filter((a) => a.due_date && a.due_date < t);
  const upcomingPosts = bul.posts.filter((p) => bul.mine.includes(p.course_code) && p.due_date && p.due_date >= t).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5);
  m.innerHTML = `<h2>Dashboard</h2><p class="sub">${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
  <div class="grid"><div class="card stat"><b>${pending.length}</b><span>Pending assignments</span></div><div class="card stat"><b style="color:var(--bad)">${overdue.length}</b><span>Overdue</span></div><div class="card stat"><b>${todays.length}</b><span>Classes today</span></div></div>
  <div class="card"><h3>Today's classes</h3>${todays.length ? todays.map(clsHtml).join('') : '<p class="mute">No classes today.</p>'}</div>
  <div class="card"><h3>Upcoming deadlines from the bulletin</h3>${upcomingPosts.length ? upcomingPosts.map((p) => `<div class="post"><b>${esc(p.due_date)}</b> <span class="tag ${p.kind}">${esc(p.course_code)}</span> ${esc(p.title)}</div>`).join('') : '<p class="mute">Nothing due. <a href="#/bulletin">Open bulletin</a></p>'}</div>
  <div class="card"><h3>My pending assignments</h3>${pending.slice(0, 6).map((a) => `<div class="post"><b>${esc(a.title)}</b> <span class="mute">${esc(a.course_code || '')} ${esc(a.due_date || '')}</span></div>`).join('') || '<p class="mute">All clear.</p>'}</div>
  ${tt.myCourseCount ? '' : '<div class="card">Start by uploading your registration slip in <a href="#/courses">My Courses</a>.</div>'}`;
}
const clsHtml = (c) => `<div class="cls"><div class="t">${esc(c.start)} - ${esc(c.end)}</div><div><b>${esc(c.course_code)}</b> ${esc(c.course_name || '')}<br><span class="mute">${[c.kind, c.venue, c.lecturer, c.section].filter(Boolean).map(esc).join(' · ')}</span></div></div>`;

/* ---------------- timetable ---------------- */
async function pgTimetable(m) {
  const tt = await api('/timetable');
  let html = `<h2>Timetable</h2><p class="sub">Built from your registered courses and the university timetable page.</p>`;
  if (!tt.myCourseCount) html += `<div class="card">You have no courses yet. <a href="#/courses">Upload your registration slip</a>.</div>`;
  else if (!tt.totalClassesInDb) html += `<div class="card">The timetable has not been loaded yet. ${me.role === 'admin' ? '<a href="#/admin">Sync it in Admin</a>.' : 'Ask an admin to sync it.'}</div>`;
  if (tt.needChoice.length) html += `<div class="card"><b>Choose your section</b><p class="mute">These courses appear in more than one timetable section.</p>${tt.needChoice.map((n) => `<div class="row"><div><label>${esc(n.code)}</label><select data-code="${esc(n.code)}" class="sec"><option value="">Show all sections</option>${n.sections.map((s) => `<option>${esc(s)}</option>`).join('')}</select></div></div>`).join('')}</div>`;
  for (let d = 1; d <= 7; d++) {
    const cs = tt.classes.filter((c) => c.day === d);
    if (cs.length) html += `<div class="card day"><h3>${DAYN[d]}</h3>${cs.map(clsHtml).join('')}</div>`;
  }
  if (tt.totalClassesInDb && tt.myCourseCount && !tt.classes.length) html += `<div class="card">None of your courses were found in the loaded timetable.</div>`;
  html += `<p class="mute">Source: ${esc(tt.url || '-')}${tt.synced_at ? ' · last synced ' + esc(tt.synced_at.slice(0, 16).replace('T', ' ')) : ''}</p>`;
  m.innerHTML = html;
  m.querySelectorAll('.sec').forEach((s) => (s.onchange = async () => { await api(`/courses/${s.dataset.code}/section`, { method: 'PUT', body: { section: s.value } }); render(); }));
}

/* ---------------- courses + slip ---------------- */
async function pgCourses(m) {
  const cs = await api('/courses');
  m.innerHTML = `<h2>My Courses</h2><p class="sub">Upload your course registration slip (PDF) and I will read the courses from it.</p>
  <div class="card"><form id="up"><label>Registration slip PDF</label><div class="row"><input type="file" name="slip" accept="application/pdf" required><button>Read slip</button></div></form><div id="upmsg"></div><div id="preview"></div></div>
  <div class="card"><h3>Registered courses (${cs.reduce((a, c) => a + (c.credit || 0), 0)} credits)</h3>
  ${cs.length ? `<table><tr><th>Code</th><th>Name</th><th>Credit</th><th>Group</th><th></th></tr>${cs.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${c.credit ?? ''}</td><td>${esc(c.grp || '')}</td><td><button class="sm ghost" data-rm="${esc(c.code)}">Remove</button></td></tr>`).join('')}</table>` : '<p class="mute">None yet.</p>'}
  <h4>Add a course manually</h4><form id="add" class="row"><div><label>Code</label><input name="code" placeholder="IMJ41103" required></div><div><label>Name</label><input name="name"></div><button>Add</button></form><div id="addmsg"></div></div>`;
  m.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { await api('/courses/' + b.dataset.rm, { method: 'DELETE' }); render(); }));
  document.getElementById('add').onsubmit = async (e) => { e.preventDefault(); try { await api('/courses', { method: 'POST', body: fd(e.target) }); render(); } catch (err) { flash(document.getElementById('addmsg'), err.message); } };
  document.getElementById('up').onsubmit = async (e) => {
    e.preventDefault(); const msg = document.getElementById('upmsg'); msg.innerHTML = '<span class="mute">Reading...</span>';
    try {
      const p = await api('/slip/parse', { method: 'POST', body: new FormData(e.target) }); msg.innerHTML = '';
      const pv = document.getElementById('preview');
      pv.innerHTML = `<h4>Found on the slip</h4><p>${esc(p.name || '')} · ${esc(p.matric || '')} · ${esc(p.program || '')} · ${esc(p.semester || '')}</p>
      ${p.matric && p.matric !== me.username ? `<div class="err">The matric number on this slip (${esc(p.matric)}) differs from your account ID (${esc(me.username)}).</div>` : ''}
      <table>${p.courses.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${c.credit}</td><td>${esc(c.grp)}</td></tr>`).join('')}</table>
      <p><button id="ok">Save these ${p.courses.length} courses (replaces current list)</button></p>`;
      document.getElementById('ok').onclick = async () => { await api('/slip/confirm', { method: 'POST', body: { courses: p.courses, profile: { program: p.program, semester: p.semester } } }); render(); };
    } catch (err) { flash(msg, err.message); }
  };
}

/* ---------------- bulletin ---------------- */
async function pgBulletin(m) {
  const b = await api('/bulletin');
  const filter = sessionStorage.getItem('bfilter') || 'mine';
  const list = b.posts.filter((p) => filter === 'all' || !p.course_code || b.mine.includes(p.course_code));
  const groups = {};
  for (const p of list) (groups[p.course_code || ''] ||= []).push(p);
  const postable = me.role === 'admin' ? b.allCourses : b.allCourses.filter((c) => b.mine.includes(c.code));
  m.innerHTML = `<h2>Bulletin</h2><p class="sub">Shared board for assignments and important notices, grouped by subject.</p>
  <div class="card"><form id="np"><div class="row"><div><label>Subject</label><select name="course_code" required>${me.role === 'admin' ? '<option value="">General (all students)</option>' : '<option value="" disabled selected>Choose subject</option>'}${postable.map((c) => `<option value="${esc(c.code)}">${esc(c.code)} - ${esc(c.name || '')}</option>`).join('')}</select></div>
  <div><label>Type</label><select name="kind"><option value="info">Info</option><option value="assignment">Assignment</option><option value="exam">Exam / test</option><option value="urgent">Urgent</option></select></div>
  <div><label>Due date (optional)</label><input type="date" name="due_date"></div></div>
  <label>Title</label><input name="title" required maxlength="200"><label>Details</label><textarea name="body" rows="3"></textarea><div id="pmsg"></div><p><button>Post</button></p></form>
  ${postable.length || me.role === 'admin' ? '' : '<p class="mute">Register your courses to post to their boards.</p>'}</div>
  <p><label style="display:inline">Show </label><select id="bf" style="width:auto"><option value="mine" ${filter === 'mine' ? 'selected' : ''}>My subjects</option><option value="all" ${filter === 'all' ? 'selected' : ''}>All subjects</option></select></p>
  ${Object.keys(groups).sort().map((code) => `<div class="card"><h3>${code ? esc(code) + ' <span class="mute">' + esc(groups[code][0].course_name || '') + '</span>' : 'General'}</h3>
  ${groups[code].map((p) => `<div class="post"><h4><span class="tag ${p.kind}">${esc(p.kind)}</span> ${esc(p.title)} ${p.due_date ? `<span class="tag">due ${esc(p.due_date)}</span>` : ''}</h4>${p.body ? `<p>${esc(p.body)}</p>` : ''}
  <span class="mute">${esc(p.author)} (${esc(p.author_id)}) · ${esc(p.created_at.slice(0, 16))}</span> ${p.author_id === me.username || me.role === 'admin' ? `<button class="sm ghost" data-del="${p.id}">Delete</button>` : ''}</div>`).join('')}</div>`).join('') || '<div class="card mute">No posts yet.</div>'}`;
  document.getElementById('bf').onchange = (e) => { sessionStorage.setItem('bfilter', e.target.value); render(); };
  m.querySelectorAll('[data-del]').forEach((x) => (x.onclick = async () => { if (confirm('Delete this post?')) { await api('/bulletin/' + x.dataset.del, { method: 'DELETE' }); render(); } }));
  document.getElementById('np').onsubmit = async (e) => { e.preventDefault(); try { await api('/bulletin', { method: 'POST', body: fd(e.target) }); render(); } catch (err) { flash(document.getElementById('pmsg'), err.message); } };
}

/* ---------------- generic personal list pages ---------------- */
async function pgAssignments(m) {
  const [list, cs] = await Promise.all([api('/assignments'), api('/courses')]);
  m.innerHTML = `<h2>Assignments</h2><p class="sub">${list.filter((a) => !a.done).length} pending, ${list.filter((a) => a.done).length} completed</p>
  <div class="card"><form id="f" class="row"><div><label>Title</label><input name="title" required></div><div><label>Subject</label><select name="course_code">${courseOptions(cs)}</select></div><div><label>Due</label><input type="date" name="due_date"></div><button>Add</button></form></div>
  <div class="card">${list.map((a) => `<div class="post"><label style="display:flex;gap:8px;align-items:center;margin:0;color:var(--ink)"><input type="checkbox" style="width:auto" data-done="${a.id}" ${a.done ? 'checked' : ''}> <span style="${a.done ? 'text-decoration:line-through;opacity:.6' : ''}"><b>${esc(a.title)}</b> <span class="mute">${esc(a.course_code || '')} ${a.due_date ? 'due ' + esc(a.due_date) : ''}</span></span></label> <button class="sm ghost" data-del="${a.id}">Delete</button></div>`).join('') || '<p class="mute">No assignments yet.</p>'}</div>`;
  document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); await api('/assignments', { method: 'POST', body: fd(e.target) }); render(); };
  m.querySelectorAll('[data-done]').forEach((c) => (c.onchange = async () => { await api('/assignments/' + c.dataset.done, { method: 'PUT', body: { done: c.checked ? 1 : 0 } }); render(); }));
  m.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await api('/assignments/' + b.dataset.del, { method: 'DELETE' }); render(); }));
}
async function pgGrades(m) {
  const [list, cs] = await Promise.all([api('/grades'), api('/courses')]);
  const pct = (g) => (g.max_score ? (100 * g.score) / g.max_score : null);
  const byCourse = {};
  for (const g of list) (byCourse[g.course_code || 'Other'] ||= []).push(g);
  m.innerHTML = `<h2>Grades</h2><p class="sub">Track your academic performance. Weight is % of the final mark.</p>
  <div class="card"><form id="f" class="row"><div><label>Subject</label><select name="course_code">${courseOptions(cs)}</select></div><div><label>Item</label><input name="item" required placeholder="Quiz 1"></div><div><label>Score</label><input type="number" step="any" name="score"></div><div><label>Out of</label><input type="number" step="any" name="max_score"></div><div><label>Weight %</label><input type="number" step="any" name="weight"></div><button>Add</button></form></div>
  ${Object.entries(byCourse).map(([code, gs]) => { const w = gs.filter((g) => g.weight && pct(g) != null); const tot = w.reduce((a, g) => a + (pct(g) * g.weight) / 100, 0), tw = w.reduce((a, g) => a + g.weight, 0);
    return `<div class="card"><h3>${esc(code)} ${tw ? `<span class="tag">${tot.toFixed(1)} / ${tw} weighted marks</span>` : ''}</h3><table><tr><th>Item</th><th>Score</th><th>%</th><th>Weight</th><th></th></tr>${gs.map((g) => `<tr><td>${esc(g.item)}</td><td>${g.score ?? ''}${g.max_score ? ' / ' + g.max_score : ''}</td><td>${pct(g) == null ? '' : pct(g).toFixed(1)}</td><td>${g.weight ?? ''}</td><td><button class="sm ghost" data-del="${g.id}">Delete</button></td></tr>`).join('')}</table></div>`; }).join('') || '<div class="card mute">No grades recorded yet.</div>'}`;
  document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); await api('/grades', { method: 'POST', body: fd(e.target) }); render(); };
  m.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await api('/grades/' + b.dataset.del, { method: 'DELETE' }); render(); }));
}
async function pgNotes(m) {
  const [list, cs] = await Promise.all([api('/notes'), api('/courses')]);
  m.innerHTML = `<h2>Notes</h2><p class="sub">Your private study notes.</p>
  <div class="card"><form id="f"><div class="row"><div><label>Title</label><input name="title" required></div><div><label>Subject</label><select name="course_code">${courseOptions(cs)}</select></div></div><label>Note</label><textarea name="body" rows="4"></textarea><p><button>Save note</button></p></form></div>
  ${list.map((n) => `<div class="card"><h3>${esc(n.title)} <span class="tag">${esc(n.course_code || '')}</span></h3><p style="white-space:pre-wrap">${esc(n.body)}</p><button class="sm ghost" data-del="${n.id}">Delete</button></div>`).join('') || '<div class="card mute">No notes yet.</div>'}`;
  document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); await api('/notes', { method: 'POST', body: fd(e.target) }); render(); };
  m.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await api('/notes/' + b.dataset.del, { method: 'DELETE' }); render(); }));
}

/* ---------------- calendar ---------------- */
let calMonth = new Date(); calMonth.setDate(1);
async function pgCalendar(m) {
  const [tt, asg, bul] = await Promise.all([api('/timetable'), api('/assignments'), api('/bulletin')]);
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - first.getDay());
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const due = {};
  for (const a of asg) if (a.due_date && !a.done) (due[a.due_date] ||= []).push('📝 ' + a.title);
  for (const p of bul.posts) if (p.due_date && (bul.mine.includes(p.course_code) || !p.course_code)) (due[p.due_date] ||= []).push(`📌 ${p.course_code || ''} ${p.title}`);
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const cls = tt.classes.filter((c) => c.day === (d.getDay() || 7));
    cells += `<div class="d ${d.getMonth() !== mo ? 'off' : ''} ${iso(d) === today() ? 'today' : ''}"><b>${d.getDate()}</b>${cls.map((c) => `<div class="e" title="${esc(c.course_code)} ${esc(c.start)}-${esc(c.end)} ${esc(c.venue || '')}">${esc(c.start)} ${esc(c.course_code)}</div>`).join('')}${(due[iso(d)] || []).map((t) => `<div class="e" style="color:var(--warn)" title="${esc(t)}">${esc(t)}</div>`).join('')}</div>`;
  }
  m.innerHTML = `<h2>Calendar</h2><p class="sub">Classes repeat weekly; deadlines come from your assignments and the bulletin.</p>
  <div class="row" style="align-items:center;margin-bottom:10px"><button class="ghost" id="pv">&lt;</button><b style="flex:2;text-align:center">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button class="ghost" id="nx">&gt;</button><button class="ghost" id="td">Today</button></div>
  <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="h">${d}</div>`).join('')}${cells}</div>`;
  const go = (n) => () => { calMonth = n === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(y, mo + n, 1); render(); };
  document.getElementById('pv').onclick = go(-1); document.getElementById('nx').onclick = go(1); document.getElementById('td').onclick = go(0);
}

/* ---------------- profile ---------------- */
async function pgProfile(m) {
  m.innerHTML = `<h2>Profile</h2><p class="sub">Student ID: <b>${esc(me.username)}</b></p>
  <form class="card" id="f"><label>Full name</label><input name="name" value="${esc(me.name)}" required>
  <div class="row"><div><label>Email</label><input name="email" value="${esc(me.email)}"></div><div><label>Phone</label><input name="phone" value="${esc(me.phone)}"></div></div>
  <label>Programme</label><input name="program" value="${esc(me.program)}"><div class="row"><div><label>Faculty</label><input name="faculty" value="${esc(me.faculty)}"></div><div><label>Year</label><input name="year" type="number" value="${esc(me.year)}"></div><div><label>Semester</label><input name="semester" value="${esc(me.semester)}"></div></div>
  <div id="m1"></div><p><button>Save</button></p></form>
  <form class="card" id="pw"><h3>Change password</h3><label>Current</label><input type="password" name="current" required><label>New (min 8)</label><input type="password" name="next" minlength="8" required><div id="m2"></div><p><button>Change</button></p></form>`;
  document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); try { me = await api('/me', { method: 'PUT', body: fd(e.target) }); flash(document.getElementById('m1'), 'Saved', 1); } catch (er) { flash(document.getElementById('m1'), er.message); } };
  document.getElementById('pw').onsubmit = async (e) => { e.preventDefault(); try { await api('/me/password', { method: 'PUT', body: fd(e.target) }); e.target.reset(); flash(document.getElementById('m2'), 'Password changed', 1); } catch (er) { flash(document.getElementById('m2'), er.message); } };
}

/* ---------------- admin ---------------- */
async function pgAdmin(m) {
  const [s, users] = await Promise.all([api('/admin/settings'), api('/admin/users')]);
  m.innerHTML = `<h2>Admin</h2><p class="sub">Manage the timetable source and users.</p>
  <div class="card"><h3>Timetable link</h3><p class="mute">Paste any timetable page link (include #table_xxxx to pick a single table). Then sync.</p>
  <form id="tl"><input name="timetable_url" value="${esc(s.timetable_url)}" required><div class="row" style="margin-top:8px"><button>Save link</button><button type="button" class="ghost" id="sync">Save &amp; sync now</button></div></form>
  <p class="mute">${s.classes} class entries loaded${s.synced_at ? ' · last sync ' + esc(s.synced_at.slice(0, 16).replace('T', ' ')) : ''}</p>
  <form id="upl"><label>Or upload the saved page (.html) if the server cannot reach the site</label><div class="row"><input type="file" name="html" accept=".html,.htm,text/html" required><button class="ghost">Upload &amp; parse</button></div></form><div id="tm"></div></div>
  <div class="card"><h3>Users (${users.length})</h3><table><tr><th>ID</th><th>Name</th><th>Programme</th><th>Courses</th><th>Role</th><th></th></tr>
  ${users.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.name)}<br><span class="mute">${esc(u.email || '')} ${esc(u.phone || '')}</span></td><td>${esc(u.program || '')}</td><td>${u.courses}</td><td>${u.role}</td><td>${u.id === me.id ? '' : `<button class="sm ghost" data-role="${u.id}" data-r="${u.role === 'admin' ? 'student' : 'admin'}">Make ${u.role === 'admin' ? 'student' : 'admin'}</button> <button class="sm ghost" data-pw="${u.id}">Reset pw</button> <button class="sm danger" data-del="${u.id}">Delete</button>`}</td></tr>`).join('')}</table></div>`;
  const tm = document.getElementById('tm');
  const save = () => api('/admin/settings', { method: 'PUT', body: fd(document.getElementById('tl')) });
  document.getElementById('tl').onsubmit = async (e) => { e.preventDefault(); try { await save(); flash(tm, 'Link saved', 1); } catch (er) { flash(tm, er.message); } };
  document.getElementById('sync').onclick = async () => { try { await save(); tm.innerHTML = '<span class="mute">Syncing...</span>'; const r = await api('/admin/timetable/sync', { method: 'POST' }); flash(tm, `Loaded ${r.classes} classes from ${r.tables} table(s)`, 1); } catch (er) { flash(tm, er.message); } };
  document.getElementById('upl').onsubmit = async (e) => { e.preventDefault(); try { const r = await api('/admin/timetable/upload', { method: 'POST', body: new FormData(e.target) }); flash(tm, `Loaded ${r.classes} classes from ${r.tables} table(s)`, 1); } catch (er) { flash(tm, er.message); } };
  m.querySelectorAll('[data-role]').forEach((b) => (b.onclick = async () => { await api(`/admin/users/${b.dataset.role}/role`, { method: 'PUT', body: { role: b.dataset.r } }); render(); }));
  m.querySelectorAll('[data-pw]').forEach((b) => (b.onclick = async () => { const p = prompt('New password (min 8 characters):'); if (p) { try { await api(`/admin/users/${b.dataset.pw}/reset-password`, { method: 'POST', body: { password: p } }); alert('Password reset'); } catch (e) { alert(e.message); } } }));
  m.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (confirm('Delete this user and all their data?')) { await api('/admin/users/' + b.dataset.del, { method: 'DELETE' }); render(); } }));
}

boot();
