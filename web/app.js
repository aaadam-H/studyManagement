import { parseSlipLines, parseTimetableDoc, prettyGroup, parseAcademicCalendarLines, academicStatus, parseExamSlipLines } from './parsers.js?v=1.1.1';

const CFG = window.STUDYHUB_CONFIG || {};
const $app = document.getElementById('app');
const DAYN = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// form -> object, empty strings become null (dates/numbers in Postgres reject '')
const fd = (form) => Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, v === '' ? null : v]));
const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const flash = (el, msg, ok) => { el.innerHTML = `<div class="${ok ? 'ok' : 'err'}">${esc(msg)}</div>`; };
const APP_VERSION = '1.1.3';
const FOOTER = `<footer>For further assistance / inquiry, WhatsApp me <a href="https://wa.me/60194145201" target="_blank" rel="noopener">@aaadam_h / 019-4145201</a>
  <div class="ver">StudyHub <span class="ver-tag">v${APP_VERSION}</span> · by aaadam_H · © ${Math.max(2026, new Date().getFullYear())}</div></footer>`;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const loginEmail = (sid) => `${sid.trim().toLowerCase()}@${CFG.LOGIN_EMAIL_DOMAIN || 'students.studyhub.app'}`;

if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('YOUR-PROJECT') || !window.supabase) {
  $app.innerHTML = `<div class="auth"><h1>StudyHub</h1><div class="card"><b>Not connected yet.</b>
  <p>Put your Supabase project URL and anon key in <code>web/config.js</code> (see SETUP.md), then reload.</p></div></div>`;
  throw new Error('StudyHub: missing Supabase config');
}
// "Remember me": the login is kept in localStorage (survives closing the browser) or, if unticked, in sessionStorage (ends with the browser session).
const remembered = () => store.get('remember') !== '0';
const tryStore = (fn) => { try { return fn(); } catch { return null; } };
const authStorage = {
  getItem: (k) => tryStore(() => localStorage.getItem(k)) ?? tryStore(() => sessionStorage.getItem(k)),
  setItem: (k, v) => { const [keep, drop] = remembered() ? [localStorage, sessionStorage] : [sessionStorage, localStorage]; tryStore(() => keep.setItem(k, v)); tryStore(() => drop.removeItem(k)); },
  removeItem: (k) => { tryStore(() => localStorage.removeItem(k)); tryStore(() => sessionStorage.removeItem(k)); },
};
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { storage: authStorage, persistSession: true, autoRefreshToken: true } });
let me = null;

// Run a Supabase query, throw a readable error on failure
async function q(promise) {
  const { data, error } = await promise;
  if (error) {
    if (error.code === '42501' || /row-level security|permission denied/i.test(error.message)) throw new Error("You don't have permission to do that.");
    throw new Error(error.message);
  }
  return data;
}
function courseOptions(courses, sel = '', blank = 'No subject') {
  return `<option value="">${blank}</option>` + courses.map((c) => `<option value="${esc(c.code)}" ${c.code === sel ? 'selected' : ''}>${esc(c.code)} - ${esc(c.name || '')}</option>`).join('');
}

/* ---------------- data helpers ---------------- */
async function myCourses(uid = me.id) {
  const rows = await q(sb.from('enrollments').select('course_code,status,grp,section,courses(name,credit)').eq('user_id', uid).order('course_code'));
  return rows.map((r) => ({ code: r.course_code, name: r.courses?.name, credit: r.courses?.credit, status: r.status, grp: r.grp, section: r.section }));
}
async function getSettings() {
  const rows = await q(sb.from('settings').select('*'));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
// Build a student's week:
//  - each subject uses the group chosen for it (mix-and-match), else the student's main group,
//    else the only group that teaches it; 'none' hides it
//  - plus classes the student added by hand
async function getTimetable(uid = me.id, prof = me) {
  const [courses, settings, custom, total] = await Promise.all([
    myCourses(uid), getSettings(),
    q(sb.from('my_classes').select('*').eq('user_id', uid)),
    sb.from('classes').select('id', { count: 'exact', head: true }).then((r) => r.count || 0),
  ]);
  // one call per subject keeps each result small (a common subject can be taught in hundreds of groups)
  const lists = await Promise.all(courses.map((c) => q(sb.rpc('class_sections', { codes: [c.code] }))));
  const groupsOf = {};
  courses.forEach((c, i) => (groupsOf[c.code] = lists[i].map((r) => r.section).sort()));
  const main = prof.subgroup || null;
  for (const c of courses) {
    const gs = groupsOf[c.code];
    c.groups = gs;
    c.chosen = c.section === 'none' ? null
      : c.section && gs.includes(c.section) ? c.section
      : main && gs.includes(main) ? main
      : gs.length === 1 ? gs[0] : null;
  }
  // the week itself comes from the database (same rules as above), so the calendar export always matches
  const rows = await q(sb.rpc('my_timetable', { target: uid === me.id ? null : uid }));
  const classes = rows.map((r) => ({ ...r, start: r.start_time, end: r.end_time }));
  // suggest main groups: most of the student's subjects first, own programme code first
  const progs = new Set(courses.map((c) => c.grp).filter(Boolean));
  const count = {};
  for (const c of courses) for (const g of c.groups) count[g] = (count[g] || 0) + 1;
  const groupOptions = Object.keys(count)
    .sort((a, b) => (progs.has(b.split(' - ')[0]) - progs.has(a.split(' - ')[0])) || count[b] - count[a] || a.localeCompare(b))
    .slice(0, 40).map((g) => ({ group: g, n: count[g] }));
  return { url: settings.timetable_url, synced_at: settings.timetable_synced_at, semester_start: settings.semester_start, semester_end: settings.semester_end,
    break_start: settings.break_start, break_end: settings.break_end, classes, courses, custom, main, groupOptions,
    myCourseCount: courses.length, totalClassesInDb: total };
}
// Academic calendar (periods + holidays) and the semester used for timetable exports
async function getAcademic() {
  const [periods, events, win] = await Promise.all([
    q(sb.from('academic_periods').select('*').order('start_date')),
    q(sb.from('academic_events').select('*').order('start_date')),
    q(sb.rpc('teaching_window')),
  ]);
  const w = win[0] || {};
  // what happens on a given date: holiday names, the period label, and whether classes run
  const day = (iso) => {
    const hol = events.filter((e) => e.start_date <= iso && iso <= e.end_date);
    const st = periods.length ? academicStatus(periods, iso) : null;
    const inTeaching = w.first_day ? w.first_day <= iso && iso <= w.last_day : true;
    const classes = periods.length
      ? !!st && st.kind === 'lecture' && !hol.some((e) => e.no_class)
      : inTeaching && !hol.some((e) => e.no_class);
    return { hol, st, classes };
  };
  return { periods, events, window: w, day };
}
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
function statusText(st) {
  if (!st) return '';
  return st.kind === 'lecture' ? `${st.semester} · Lecture week ${st.week} of ${st.totalWeeks}` : `${st.semester} · ${st.label}`;
}

async function getBulletin() {
  const [posts, all, mine] = await Promise.all([
    q(sb.from('posts').select('*').order('created_at', { ascending: false }).limit(500)),
    q(sb.from('courses').select('code,name').order('code')),
    myCourses(),
  ]);
  const names = Object.fromEntries(all.map((c) => [c.code, c.name]));
  // updates show "ADMIN" to students; admins also see the real poster
  const who = {};
  const updIds = [...new Set(posts.filter((p) => p.kind === 'update').map((p) => p.user_id))];
  if (me.role === 'admin' && updIds.length) for (const u of await q(sb.from('profiles').select('id,name,student_id').in('id', updIds))) who[u.id] = `${u.name} (${u.student_id})`;
  return { posts: posts.map((p) => ({ ...p, course_name: names[p.course_code], real_author: who[p.user_id] })), allCourses: all, mine: mine.map((c) => c.code) };
}

/* ---------------- profile fields (register, profile, admin edit) ---------------- */
// Required: name, email, phone, programme. Optional: faculty, year, semester.
// Email is typed as "name" @ "domain"; the domain box starts as the student mail domain but can be changed.
// A hidden field holds the joined address, so the forms still submit a single email value.
const STUDENT_MAIL = CFG.STUDENT_EMAIL_DOMAIN || 'studentmail.unimap.edu.my';
function profileFields(u, emailName = 'contact_email') {
  const R = '<span class="req">*</span>', O = '<span class="mute">(optional)</span>';
  const at = (u.email || '').indexOf('@');
  const [local, domain] = at > 0 ? [u.email.slice(0, at), u.email.slice(at + 1)] : ['', STUDENT_MAIL];
  return `<label>Full name ${R}</label><input name="name" value="${esc(u.name)}" required maxlength="120">
  <label>Email ${R}</label><div class="email-in">
    <input class="em-local" value="${esc(local)}" required maxlength="64" pattern="[A-Za-z0-9._%+\\-]+" title="The part before @" placeholder="your email name" aria-label="Email, part before @" autocomplete="off"><span>@</span>
    <input class="em-domain" value="${esc(domain)}" required maxlength="60" pattern="[A-Za-z0-9\\-]+(\\.[A-Za-z0-9\\-]+)+" title="e.g. ${esc(STUDENT_MAIL)}" aria-label="Email, part after @"></div>
  <input type="hidden" name="${emailName}" value="${esc(u.email || '')}">
  <div class="row"><div><label>Phone ${R}</label><input name="phone" type="tel" value="${esc(u.phone)}" required pattern="[0-9+ \\-]{9,15}" title="e.g. 012-3456789" maxlength="20"></div>
  <div><label>Programme ${R}</label><input name="program" value="${esc(u.program)}" required placeholder="e.g. Kejuruteraan Komputer" maxlength="120"></div></div>
  <div class="row"><div><label>Faculty / school ${O}</label><input name="faculty" value="${esc(u.faculty)}" maxlength="120"></div>
  <div><label>Year ${O}</label><input name="year" type="number" min="1" max="6" value="${esc(u.year)}"></div>
  <div><label>Semester ${O}</label><input name="semester" value="${esc(u.semester)}" placeholder="e.g. Sem 1 2026/2027" maxlength="40"></div></div>`;
}

document.addEventListener('input', (e) => {
  const box = e.target.closest?.('.email-in');
  if (!box) return;
  const loc = box.querySelector('.em-local'), dom = box.querySelector('.em-domain');
  // a full address pasted into the first box is split across both
  if (loc.value.includes('@')) { const [a, ...b] = loc.value.split('@'); loc.value = a.trim(); if (b.join('@').trim()) dom.value = b.join('@').trim(); }
  if (dom.value.startsWith('@')) dom.value = dom.value.slice(1);
  const l = loc.value.trim(), d = dom.value.trim();
  box.nextElementSibling.value = l && d ? `${l}@${d}` : '';
});

/* ---------------- auth screens ---------------- */
function authScreen(mode = 'login', opts = {}) {
  const reg = mode === 'register';
  const reason = !reg && opts.reason ? `<div class="card auth-reason"><b>Login required</b><p>${esc(opts.reason)}</p></div>` : '';
  $app.innerHTML = `<div class="auth"><h1>StudyHub</h1><p class="sub">${reg ? 'Create your student account' : 'Log in to your study planner'}</p>
  ${reason}
  <form class="card" id="f">
    <label>Student ID (matric no.) <span class="req">*</span></label><input name="student_id" required pattern="[A-Za-z0-9._-]{3,30}" autocomplete="username" value="${reg ? '' : esc(store.get('last_sid') || '')}">
    ${reg ? profileFields({}) : ''}
    <label>Password ${reg ? '<span class="req">*</span> (min 8 characters)' : ''}</label><input name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}">
    <label class="remember"><input type="checkbox" name="remember" ${remembered() ? 'checked' : ''}> Remember me <span class="mute">(untick on a shared computer)</span></label>
    <div id="msg"></div><p><button>${reg ? 'Register' : 'Log in'}</button></p>
    <p class="mute">${reg ? 'Have an account? <a href="#" id="sw">Log in</a>' : 'New here? <a href="#" id="sw">Register</a>'}</p>
  </form>
  ${reg ? '' : installHintHtml()}
  ${reg ? '' : `<section class="card auth-video" aria-labelledby="demo-title"><div class="video-head"><div><h3 id="demo-title">See StudyHub in action</h3><p class="mute">Upload your registration slip once, then StudyHub builds your weekly timetable automatically.</p></div><span class="tag">Demo</span></div>
    <video controls muted autoplay loop playsinline preload="metadata" poster="demo/studyhub-demo-poster.png" aria-label="StudyHub feature demo">
      <source src="demo/studyhub-demo.mp4" type="video/mp4">
      Your browser does not support video. <a href="demo/studyhub-demo.mp4">Open the demo video</a>.
    </video>
    <div class="video-points"><span>1. Upload registration slip</span><span>2. Courses extracted</span><span>3. Timetable generated</span></div></section>`}
  ${reg ? '' : `<div class="card intro"><b>What you can do with StudyHub</b><ul>
    <li>Upload your course registration slip and get your weekly timetable automatically</li>
    <li>Mix and match groups, and add your own classes</li>
    <li>Put your timetable in Google Calendar or Apple Calendar, skipping breaks and public holidays</li>
    <li>Follow a shared bulletin for assignments and notices, grouped by subject</li>
    <li>Track your assignments, grades and notes; see the academic calendar and current lecture week</li></ul>
    <p class="mute">New here? <a href="#" id="sw2">Create an account</a>; a short setup guide walks you through the rest.</p></div>`}
  ${reg ? '' : `<div class="auth-guest"><a class="btn ghost-link" href="#/">Continue as guest (view only)</a><span class="mute">Browse the timetable, bulletin and academic calendar without an account.</span></div>`}
  ${FOOTER}</div>`;
  const f = document.getElementById('f');
  if (!reg && f.student_id.value) f.password.focus();
  wireInstallHint($app);
  const sw2 = document.getElementById('sw2');
  if (sw2) sw2.onclick = (e) => { e.preventDefault(); authScreen('register'); };
  document.getElementById('sw').onclick = (e) => { e.preventDefault(); authScreen(reg ? 'login' : 'register'); };
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('msg');
    const { student_id, password, remember, ...info } = fd(e.target);
    // decide where the session is saved before Supabase writes it
    store.set('remember', remember ? '1' : '0');
    if (remember) store.set('last_sid', student_id.trim()); else tryStore(() => localStorage.removeItem('last_sid'));
    try {
      if (reg) {
        const { data, error } = await sb.auth.signUp({ email: loginEmail(student_id), password, options: { data: { student_id: student_id.trim(), ...info } } });
        if (error) throw new Error(/already registered/i.test(error.message) ? 'That student ID is already registered' : error.message);
        if (!data.session) return flash(msg, 'Account created, but Supabase is asking for email confirmation. The admin must turn off "Confirm email" (see SETUP.md).');
        location.hash = '#/welcome';
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: loginEmail(student_id), password });
        if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong student ID or password' : error.message);
      }
      await boot();
    } catch (err) { flash(msg, err.message); }
  };
}

/* ---------------- shell ---------------- */
const ROUTES = {
  '': ['Dashboard', pgDashboard], timetable: ['Timetable', pgTimetable], exams: ['Exams', pgExams], bulletin: ['Bulletin', pgBulletin], courses: ['My Courses', pgCourses],
  assignments: ['Assignments', pgAssignments], calendar: ['Calendar', pgCalendar], academic: ['Academic Calendar', pgAcademic], grades: ['Grades', pgGrades], notes: ['Notes', pgNotes], profile: ['Profile', pgProfile], feedback: ['Feedback', pgFeedback], help: ['Help', pgHelp],
};
const PUBLIC_ROUTES = {
  '': ['Home', pgPublicHome], timetable: ['Timetable', pgPublicTimetable], bulletin: ['Bulletin', pgPublicBulletin], academic: ['Academic Calendar', pgAcademic], help: ['Help', pgHelp],
};
const PROTECTED_LABELS = Object.fromEntries(Object.entries(ROUTES).map(([key, value]) => [key, value[0]]));
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  me = session ? await q(sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle()) : null;
  if (!me) return authScreen();
  render();
}
async function render() {
  let key = location.hash.replace(/^#\/?/, '').split('/')[0] || '';
  if (!me) {
    if (!PUBLIC_ROUTES[key]) {
      return authScreen('login', { reason: `Please log in to open ${PROTECTED_LABELS[key] || 'this page'}.` });
    }
    const [pageTitle, fn] = PUBLIC_ROUTES[key];
    $app.innerHTML = `<div class="shell guest-shell"><nav id="nav">
      <div class="nav-top"><a class="brand" href="#/"><h1>StudyHub</h1><small>Personal Management</small></a>
        <span class="nav-page">${esc(pageTitle)}</span>
        <button type="button" class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="nav-links" aria-label="Open menu"><span class="burger" aria-hidden="true"></span>Menu</button></div>
      <div class="nav-links" id="nav-links">
        ${Object.entries(PUBLIC_ROUTES).map(([route, [title]]) => `<a href="#/${route}" class="${route === key ? 'on' : ''}">${title}</a>`).join('')}
        <div class="who guest-who"><b>Guest mode</b><br><span>View only</span><br><a class="login-link" href="#/courses">Log in</a></div>
      </div></nav>
      <div class="content"><main id="main">Loading...</main>${FOOTER}</div></div>`;
    const nav = document.getElementById('nav');
    const menuBtn = document.getElementById('menu-btn');
    const setMenu = (open) => { nav.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); };
    menuBtn.onclick = () => setMenu(!nav.classList.contains('open'));
    document.getElementById('nav-links').addEventListener('click', (e) => { if (e.target.closest?.('a[href^="#/"]')) setMenu(false); });
    try { await fn(document.getElementById('main')); }
    catch (e) { document.getElementById('main').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    return;
  }
  // first visit: send new students through the setup guide (they can still open Help)
  if (needsOnboarding() && !['welcome', 'help', 'feedback'].includes(key)) { history.replaceState(null, '', '#/welcome'); key = 'welcome'; }
  const routes = { ...ROUTES, ...(me.role === 'admin' ? { admin: ['Admin', pgAdmin] } : {}) };
  const [, fn] = key === 'welcome' ? [null, pgWelcome] : routes[key] || routes[''];
  const pageTitle = key === 'welcome' ? 'Getting started' : (routes[key] || routes[''])[0];
  // On phones the menu collapses behind a Menu button in a top bar (always closed after navigating)
  $app.innerHTML = `<div class="shell"><nav id="nav">
    <div class="nav-top"><a class="brand" href="#/"><h1>StudyHub</h1><small>Personal Management</small></a>
      <span class="nav-page">${esc(pageTitle)}</span>
      <button type="button" class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="nav-links" aria-label="Open menu"><span class="burger" aria-hidden="true"></span>Menu<span class="menu-dot" id="menu-dot" hidden></span></button></div>
    <div class="nav-links" id="nav-links">
    ${Object.entries(routes).map(([k, [t]]) => `<a href="#/${k}" class="${k === key ? 'on' : ''}">${t}${k === 'feedback' ? ' <span class="badge" id="fb-badge" hidden></span>' : k === 'bulletin' ? ' <span class="badge" id="bl-badge" hidden></span>' : ''}</a>`).join('')}
    <div class="who"><span class="who-name">${esc(me.name)}</span><br>${esc(me.student_id)}${me.role === 'admin' ? ' (admin)' : ''}<br><a href="#" id="lo" class="logout">Log out</a></div></div></nav>
    <div class="content"><main id="main">Loading...</main>${FOOTER}</div></div>`;
  document.getElementById('lo').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); me = null; authScreen(); };
  const nav = document.getElementById('nav'), menuBtn = document.getElementById('menu-btn');
  const setMenu = (open) => { nav.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); };
  menuBtn.onclick = () => setMenu(!nav.classList.contains('open'));
  document.getElementById('nav-links').addEventListener('click', (e) => { if (e.target.closest('a[href^="#/"]')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });
  if (key !== 'bulletin') bulletinNewSince = null;
  updateBadges();
  try { await fn(document.getElementById('main')); }
  catch (e) { document.getElementById('main').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', render);
sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { me = null; authScreen(); } });

/* ---------------- "add to home screen" hint ---------------- */
// Android Chrome/Edge offer a one-tap install (beforeinstallprompt); iPhone and other browsers get written steps.
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; document.querySelectorAll('.install-btn').forEach((b) => (b.hidden = false)); });
window.addEventListener('appinstalled', () => { store.set('install_hint', 'done'); document.querySelectorAll('.install-hint').forEach((x) => x.remove()); });
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const INSTALL_STEPS = isIOS
  ? 'In <b>Safari</b>, tap the <b>Share</b> button (the square with an arrow), then <b>Add to Home Screen</b>.'
  : 'Open your browser menu (<b>⋮</b>) and tap <b>Install app</b> or <b>Add to Home screen</b>.';
function installHintHtml() {
  if (isInstalled() || store.get('install_hint') || !matchMedia('(pointer: coarse)').matches) return '';
  return `<div class="card install-hint"><div class="upd-head"><b>📱 Add StudyHub to your home screen</b><button type="button" class="sm ghost" data-hide-install>Hide</button></div>
    <p class="mute">It opens like an app, full screen and one tap away. ${INSTALL_STEPS}</p><button type="button" class="install-btn" ${installEvt ? '' : 'hidden'}>Install StudyHub</button></div>`;
}
function wireInstallHint(root) {
  const box = root.querySelector('.install-hint');
  if (!box) return;
  box.querySelector('[data-hide-install]').onclick = () => { store.set('install_hint', 'hidden'); box.remove(); };
  box.querySelector('.install-btn').onclick = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    installEvt = null;
    if (outcome === 'accepted') { store.set('install_hint', 'done'); box.remove(); }
  };
}

/* ---------------- search & filter ---------------- */
const matches = (text, query) => { const t = text.toLowerCase(); return query.toLowerCase().split(/\s+/).every((w) => t.includes(w)); };
// Long dropdowns become type-to-search. The real <select> stays in the form (hidden), so FormData and change handlers still work.
function comboize(sel) {
  if (sel.dataset.combo || sel.multiple || sel.hasAttribute('data-plain') || sel.options.length < 8) return;
  sel.dataset.combo = '1';
  const box = document.createElement('div'), inp = document.createElement('input'), list = document.createElement('div');
  box.className = 'combo'; list.className = 'combo-list'; list.hidden = true; list.setAttribute('role', 'listbox');
  Object.assign(inp, { type: 'text', className: 'combo-in', autocomplete: 'off', placeholder: 'Type to search...', required: sel.required });
  inp.setAttribute('role', 'combobox'); inp.setAttribute('aria-expanded', 'false');
  sel.required = false; sel.hidden = true;
  if (sel.style.width) box.style.width = sel.style.width;
  sel.after(box); box.append(inp, list);
  const label = () => { const o = sel.options[sel.selectedIndex]; return o && !o.disabled ? o.text : ''; };
  let items = [], act = -1;
  const draw = (typed) => {
    items = [...sel.options].filter((o) => !o.disabled && (!typed || matches(o.text, inp.value)));
    act = typed ? 0 : Math.max(0, items.findIndex((o) => o.selected));
    list.innerHTML = items.map((o, i) => `<div class="opt${i === act ? ' act' : ''}${o.selected ? ' on' : ''}" data-i="${i}" role="option">${esc(o.text)}</div>`).join('') || '<div class="none">No matches</div>';
    list.hidden = false; inp.setAttribute('aria-expanded', 'true');
    list.querySelector('.act')?.scrollIntoView({ block: 'nearest' });
  };
  const move = (d) => { if (!items.length) return; act = (act + d + items.length) % items.length; list.querySelectorAll('.opt').forEach((x, i) => x.classList.toggle('act', i === act)); list.querySelector('.act').scrollIntoView({ block: 'nearest' }); };
  const close = () => { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); inp.value = label(); inp.placeholder = 'Type to search...'; };
  // opening clears the box (current choice shows as the placeholder) so typing starts a fresh search
  const open = () => { inp.placeholder = label() || 'Type to search...'; inp.value = ''; draw(false); };
  const pick = (o) => { const changed = !o.selected; o.selected = true; close(); if (changed) sel.dispatchEvent(new Event('change', { bubbles: true })); };
  inp.value = label();
  inp.onfocus = open;
  inp.onclick = () => { if (list.hidden) open(); };
  inp.oninput = () => draw(true);
  inp.onblur = close;
  inp.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (list.hidden) open(); else move(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' && !list.hidden) { e.preventDefault(); if (items[act]) pick(items[act]); }
    else if (e.key === 'Escape') close();
  };
  list.onmousedown = (e) => e.preventDefault(); // keep focus in the input
  list.onclick = (e) => { const o = e.target.closest('.opt'); if (o) { pick(items[+o.dataset.i]); inp.blur(); } };
  sel.form?.addEventListener('reset', () => setTimeout(() => (inp.value = label())));
}
new MutationObserver((ms) => { for (const mu of ms) for (const n of mu.addedNodes) if (n.nodeType === 1) (n.tagName === 'SELECT' ? [n] : n.querySelectorAll('select')).forEach(comboize); })
  .observe(document.body, { childList: true, subtree: true });

// Search box (+ optional dropdown filters) for a list. Items are .qi; dropdown filter "k" matches an item's data-k; a .qg group hides when it has no visible items.
const qSelect = (key, opts) => `<select data-qf="${key}" data-plain>${opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select>`;
const filterBar = (placeholder, extra = '') => `<div class="qbar"><input type="search" data-qf="" placeholder="${esc(placeholder)}">${extra}<span class="mute qn"></span></div>`;
function applyFilter(root) {
  const ctl = [...root.querySelectorAll('[data-qf]')];
  const text = ctl.filter((c) => !c.dataset.qf).map((c) => c.value).join(' ').trim();
  const sels = ctl.filter((c) => c.dataset.qf && c.value);
  const ok = (el, headHit) => (!text || headHit || matches(el.textContent, text)) && sels.every((c) => (el.dataset[c.dataset.qf] || '') === c.value);
  const all = [...root.querySelectorAll('.qi')];
  for (const i of all) if (!i.closest('.qg')) i.hidden = !ok(i, false);
  root.querySelectorAll('.qg').forEach((g) => {
    const headHit = !!text && matches(g.querySelector('h3')?.textContent || '', text);
    let any = false;
    g.querySelectorAll('.qi').forEach((i) => { i.hidden = !ok(i, headHit); any ||= !i.hidden; });
    g.hidden = !any;
  });
  const n = root.querySelector('.qn');
  if (n) n.textContent = text || sels.length ? `${all.filter((i) => !i.hidden).length} of ${all.length}` : '';
}
for (const ev of ['input', 'change']) document.addEventListener(ev, (e) => { if (e.target.closest?.('[data-qf]')) applyFilter(e.target.closest('main') || document); });

/* ---------------- dashboard ---------------- */
// lecture / lab / tutorial, for colour-coding (the university page and the manual form use several spellings)
const kindKey = (k) => { k = (k || '').trim(); return /^(LAB|LABORATORY|MAKMAL|PRACTICAL|P)$/i.test(k) ? 'lab' : /^(TUTORIAL|T)$/i.test(k) ? 'tut' : /^(LECTURE|KULIAH|L)$/i.test(k) ? 'lec' : 'oth'; };
const KIND_LEGEND = '<div class="legend"><span class="k-lec">Lecture</span><span class="k-lab">Lab</span><span class="k-tut">Tutorial</span></div>';
const clsHtml = (c) => `<div class="cls k-${kindKey(c.kind)}${c.custom ? ' own' : ''}"><div class="t">${esc(c.start)} - ${esc(c.end)}</div><div><b>${esc(c.course_code)}</b> ${esc(c.course_name || '')}<br><span class="mute">${[c.kind, c.venue, c.lecturer, c.custom ? c.section : prettyGroup(c.section)].filter(Boolean).map(esc).join(' · ')}</span></div></div>`;
async function pgDashboard(m) {
  const [tt, asg, bul, ac] = await Promise.all([getTimetable(), q(sb.from('assignments').select('*').order('due_date')), getBulletin(), getAcademic()]);
  const dow = new Date().getDay() || 7, t = localISO();
  const today = ac.day(t);
  const todays = today.classes ? tt.classes.filter((c) => c.day === dow) : [];
  const nextHol = ac.events.find((e) => e.end_date >= t && e.no_class);
  const pending = asg.filter((a) => !a.done);
  const overdue = pending.filter((a) => a.due_date && a.due_date < t);
  const upcoming = bul.posts.filter((p) => (!p.course_code || bul.mine.includes(p.course_code)) && p.due_date && p.due_date >= t).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5);
  const checklist = await gettingStartedHtml(tt, ac);
  const slip = await getExamSlip();
  const nextExams = upcomingExams(slip).slice(0, 4);
  const dismissed = new Set(((await sb.from('update_dismissals').select('post_id')).data || []).map((r) => r.post_id));
  const updates = bul.posts.filter((p) => p.kind === 'update' && !dismissed.has(p.id));
  m.innerHTML = `<h2>Dashboard</h2><p class="sub">${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}${today.st ? ` · <a href="#/academic">${esc(statusText(today.st))}</a>` : ''}</p>
  ${updates.map((p) => `<div class="card upd" role="status"><div class="upd-head"><span class="tag update">UPDATE</span> <b>${esc(p.title)}</b><button class="sm ghost" data-dismiss="${p.id}" title="Hide this update">Dismiss</button></div>
    ${p.body ? `<p class="fb-msg">${esc(p.body)}</p>` : ''}<span class="mute">ADMIN · ${esc(new Date(p.created_at).toLocaleString())}${p.real_author ? ` · posted by ${esc(p.real_author)}` : ''}</span></div>`).join('')}
  ${installHintHtml()}
  ${today.hol.length ? `<div class="card hol">${today.hol.map((e) => esc(e.title)).join(', ')}${today.classes ? '' : ' · no classes today'}</div>` : ''}
  ${checklist}
  ${nextExams.length ? `<div class="card exams-card"><h3>Upcoming exams</h3>${nextExams.map((e) => `<div class="post"><span class="tag exam">${esc(countdown(e.date))}</span> <b>${esc(e.code)}</b> ${esc(e.name || '')}<br><span class="mute">${esc(fmtExamDate(e.date))}${e.time ? ', ' + esc(fmtTime(e.time)) : ''}${e.venue ? ' · ' + esc(e.venue) : ''}</span></div>`).join('')}<p><a href="#/exams">All exams</a></p></div>` : ''}
  <div class="grid"><div class="card stat"><b>${pending.length}</b><span>Pending assignments</span></div><div class="card stat"><b style="color:var(--bad)">${overdue.length}</b><span>Overdue</span></div><div class="card stat"><b>${todays.length}</b><span>Classes today</span></div></div>
  <div class="card"><h3>Today's classes</h3>${todays.length ? todays.map(clsHtml).join('') : `<p class="mute">No classes today${today.st && today.st.kind !== 'lecture' ? ` (${esc(today.st.label.toLowerCase())})` : ''}.</p>`}
  ${nextHol ? `<p class="mute">Next holiday: ${esc(nextHol.title)}, ${esc(fmtDate(nextHol.start_date))}</p>` : ''}</div>
  <div class="card"><h3>Upcoming deadlines from the bulletin</h3>${upcoming.length ? upcoming.map((p) => `<div class="post"><b>${esc(p.due_date)}</b> <span class="tag ${esc(p.kind)}">${esc(p.course_code || 'General')}</span> ${esc(p.title)}</div>`).join('') : '<p class="mute">Nothing due. <a href="#/bulletin">Open bulletin</a></p>'}</div>
  <div class="card"><h3>My pending assignments</h3>${pending.slice(0, 6).map((a) => `<div class="post"><b>${esc(a.title)}</b> <span class="mute">${esc(a.course_code || '')} ${esc(a.due_date || '')}</span></div>`).join('') || '<p class="mute">All clear.</p>'}</div>
`;
  wireInstallHint(m);
  m.querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    const { error } = await sb.from('update_dismissals').insert({ post_id: +b.dataset.dismiss });
    if (error && error.code !== '23505') { b.disabled = false; return alert(error.message); } // 23505: already dismissed on another device
    b.closest('.upd').remove();
  }));
  const gsx = document.getElementById('gsx');
  if (gsx) gsx.onclick = (e) => { e.preventDefault(); store.set('sh_gs_hide_' + me.id, '1'); render(); };
}

/* ---------------- feedback & reports ---------------- */
const FB_KIND = { feedback: 'Feedback / suggestion', bug: 'Bug / something not working', report: 'Report a post or user', other: 'Other' };
const FB_STATUS = { new: 'New', open: 'Open', resolved: 'Resolved' };
// Admins: number of new items. Students: replies they haven't read yet.
async function updateFeedbackBadge() {
  const el = document.getElementById('fb-badge');
  if (!el || !me) return;
  try {
    const qy = sb.from('feedback').select('id', { count: 'exact', head: true });
    const { count, error } = me.role === 'admin' ? await qy.eq('status', 'new')
      : await qy.eq('user_id', me.id).not('admin_reply', 'is', null).is('reply_seen_at', null);
    if (error) throw error;
    el.hidden = !count;
    el.textContent = count > 99 ? '99+' : String(count || '');
    el.title = me.role === 'admin' ? `${count} new feedback / reports` : `${count} new repl${count === 1 ? 'y' : 'ies'}`;
    document.title = count && me.role === 'admin' ? `(${count}) StudyHub` : 'StudyHub';
  } catch { el.hidden = true; }
  syncMenuDot();
}
// New bulletin posts since the student last opened the Bulletin: their subjects + general notices, minus muted subjects and their own posts
async function updateBulletinBadge() {
  const el = document.getElementById('bl-badge');
  if (!el || !me) return;
  try {
    const muted = me.muted_subjects || [];
    const codes = (await q(sb.from('enrollments').select('course_code').eq('user_id', me.id))).map((r) => r.course_code).filter((c) => !muted.includes(c));
    let qy = sb.from('posts').select('id', { count: 'exact', head: true }).gt('created_at', me.bulletin_seen_at).neq('user_id', me.id);
    qy = codes.length ? qy.or(`course_code.is.null,course_code.in.(${codes.join(',')})`) : qy.is('course_code', null);
    const { count, error } = await qy;
    if (error) throw error;
    el.hidden = !count;
    el.textContent = count > 99 ? '99+' : String(count || '');
    el.title = `${count} new post${count === 1 ? '' : 's'}`;
  } catch { el.hidden = true; }
  syncMenuDot();
}
function syncMenuDot() {
  const dot = document.getElementById('menu-dot');
  if (dot) dot.hidden = ![...document.querySelectorAll('.nav-links .badge')].some((b) => !b.hidden);
}
const updateBadges = () => Promise.allSettled([updateFeedbackBadge(), updateBulletinBadge()]).then(syncMenuDot);
setInterval(() => { if (document.visibilityState === 'visible') updateBadges(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateBadges(); });

let fbFilter = 'active';
async function pgFeedback(m) {
  const parts = location.hash.split('/');
  const reportId = parts[2] === 'report' && /^\d+$/.test(parts[3] || '') ? +parts[3] : null;
  const [mine, reported] = await Promise.all([
    q(sb.from('feedback').select('*').eq('user_id', me.id).order('created_at', { ascending: false })),
    reportId ? q(sb.from('posts').select('id,title,course_code,author_name').eq('id', reportId).maybeSingle()) : null,
  ]);
  let html = '';
  if (me.role === 'admin') {
    const all = await q(sb.from('feedback').select('*, profiles(name, student_id)').order('created_at', { ascending: false }).limit(300));
    const newIds = all.filter((f) => f.status === 'new').map((f) => f.id);
    const shown = all.filter((f) => fbFilter === 'all' || (fbFilter === 'active' ? f.status !== 'resolved' : f.status === fbFilter));
    const counts = { new: newIds.length, open: all.filter((f) => f.status === 'open').length, resolved: all.filter((f) => f.status === 'resolved').length };
    html += `<h2>Feedback &amp; reports</h2><p class="sub">${counts.new} new · ${counts.open} open · ${counts.resolved} resolved</p>
    <div class="btns fb-filter">${[['active', 'New & open'], ['resolved', 'Resolved'], ['all', 'All']].map(([k, t]) => `<button type="button" class="${fbFilter === k ? '' : 'ghost'}" data-f="${k}">${t}</button>`).join('')}</div>
    ${filterBar('Search feedback')}
    ${shown.map((f) => `<div class="card qi fb ${f.status === 'new' ? 'fb-new' : ''}">
      <div class="fb-head"><span class="tag ${f.kind === 'report' ? 'urgent' : f.kind === 'bug' ? 'exam' : ''}">${esc(FB_KIND[f.kind] || f.kind)}</span>
        ${f.status === 'new' ? '<span class="tag new">NEW</span>' : ''} <b>${esc(f.subject)}</b></div>
      <p class="mute">From ${esc(f.profiles?.name || 'deleted user')} (${esc(f.profiles?.student_id || '-')}) · ${esc(new Date(f.created_at).toLocaleString())}${f.page ? ' · page: ' + esc(f.page) : ''}</p>
      <p class="fb-msg">${esc(f.message)}</p>
      ${f.post_id ? `<p class="fb-post">Reported post: <b>${esc(f.post_title || '')}</b> <a href="#/bulletin">Open bulletin</a> <button type="button" class="sm danger" data-delpost="${f.post_id}">Delete post</button></p>`
        : f.post_title ? `<p class="fb-post mute">Reported post (already deleted): ${esc(f.post_title)}</p>` : ''}
      <form class="fb-reply" data-id="${f.id}"><label>Reply to the student <span class="mute">(they see it on their Feedback page)</span></label>
        <textarea name="reply" rows="2" maxlength="4000">${esc(f.admin_reply || '')}</textarea>
        <div class="row"><div><label>Status</label><select name="status">${Object.entries(FB_STATUS).map(([k, t]) => `<option value="${k}" ${(f.status === 'new' ? 'open' : f.status) === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <button>Save</button><button type="button" class="ghost" data-delfb="${f.id}">Delete</button></div>
        ${f.admin_reply ? `<p class="mute">Replied ${esc(new Date(f.replied_at).toLocaleString())}${f.reply_seen_at ? ' · seen by the student' : ' · not seen yet'}</p>` : ''}<div class="fbm"></div></form></div>`).join('') || '<div class="card mute">Nothing here.</div>'}
    <h3 style="margin-top:28px">Send feedback yourself</h3>`;
    // viewing the inbox marks new items as read (they stay open until resolved)
    if (newIds.length) q(sb.rpc('admin_mark_feedback_read', { ids: newIds })).then(updateFeedbackBadge).catch(() => {});
  } else {
    html += `<h2>Feedback &amp; reports</h2><p class="sub">Tell us what to improve, report a problem, or report a post. Only the admins can read what you send.</p>`;
  }
  const unseen = mine.filter((f) => f.admin_reply && !f.reply_seen_at).map((f) => f.id);
  html += `<form class="card" id="fbf">
    ${reported ? `<p class="fb-post">Reporting the post <b>${esc(reported.title)}</b> by ${esc(reported.author_name || '')} ${reported.course_code ? '(' + esc(reported.course_code) + ')' : ''}</p>` : ''}
    <div class="row"><div><label>Type</label><select name="kind">${Object.entries(FB_KIND).map(([k, t]) => `<option value="${k}" ${(reported ? 'report' : 'feedback') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <label>Subject</label><input name="subject" required maxlength="200" value="${reported ? esc('Report: ' + reported.title).slice(0, 200) : ''}">
    <label>Details</label><textarea name="message" rows="4" required maxlength="4000" placeholder="${reported ? 'What is wrong with this post?' : 'What happened, or what would you like?'}"></textarea>
    <div id="fbm"></div><p><button>Send</button></p></form>
  ${me.role === 'admin' ? '' : `<h3>Your messages</h3>${mine.map((f) => `<div class="card fb ${unseen.includes(f.id) ? 'fb-new' : ''}">
    <div class="fb-head"><span class="tag">${esc(FB_KIND[f.kind] || f.kind)}</span> <b>${esc(f.subject)}</b>
      <span class="tag ${f.status === 'resolved' ? 'done' : ''}">${f.status === 'resolved' ? 'Resolved' : 'Received'}</span></div>
    <p class="mute">${esc(new Date(f.created_at).toLocaleString())}</p><p class="fb-msg">${esc(f.message)}</p>
    ${f.admin_reply ? `<div class="fb-answer">${unseen.includes(f.id) ? '<span class="tag new">NEW REPLY</span> ' : ''}<b>Reply from admin:</b><p class="fb-msg">${esc(f.admin_reply)}</p></div>` : ''}</div>`).join('') || '<p class="mute">You haven\'t sent anything yet.</p>'}`}
  <p class="mute">Urgent? WhatsApp <a href="https://wa.me/60194145201" target="_blank" rel="noopener">@aaadam_h / 019-4145201</a>.</p>`;
  m.innerHTML = html;
  if (unseen.length) q(sb.from('feedback').update({ reply_seen_at: new Date().toISOString() }).in('id', unseen)).then(updateFeedbackBadge).catch(() => {});
  document.getElementById('fbf').onsubmit = async (e) => {
    e.preventDefault();
    const d = fd(e.target);
    try {
      await q(sb.from('feedback').insert({ ...d, post_id: reported ? reported.id : null, page: reportId ? 'bulletin' : null }));
      e.target.reset();
      flash(document.getElementById('fbm'), 'Thank you! Your message was sent to the admins.', 1);
      if (reportId) history.replaceState(null, '', '#/feedback');
      setTimeout(render, 1200);
    } catch (er) { flash(document.getElementById('fbm'), er.message); }
  };
  m.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { fbFilter = b.dataset.f; render(); }));
  m.querySelectorAll('.fb-reply').forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    try { await q(sb.rpc('admin_update_feedback', { fid: +f.dataset.id, new_status: d.status, reply: d.reply })); flash(f.querySelector('.fbm'), 'Saved', 1); updateFeedbackBadge(); }
    catch (er) { flash(f.querySelector('.fbm'), er.message); }
  }));
  m.querySelectorAll('[data-delfb]').forEach((b) => (b.onclick = async () => { if (confirm('Delete this feedback item?')) { await q(sb.from('feedback').delete().eq('id', b.dataset.delfb)); render(); } }));
  m.querySelectorAll('[data-delpost]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete the reported bulletin post for everyone?')) return;
    await q(sb.from('posts').delete().eq('id', b.dataset.delpost));
    b.closest('.fb-post').innerHTML = '<span class="ok">Post deleted.</span>';
  }));
}

/* ---------------- onboarding: setup guide, checklists, help ---------------- */
function needsOnboarding() {
  if (!me) return false;
  if ('onboarded_at' in me) return !me.onboarded_at && !store.get('sh_onboarded_' + me.id);
  return false; // database not updated yet: don't force the guide
}
async function finishOnboarding() {
  store.set('sh_onboarded_' + me.id, '1');
  if ('onboarded_at' in me) {
    try { me = await q(sb.from('profiles').update({ onboarded_at: new Date().toISOString() }).eq('id', me.id).select().single()); } catch {}
  }
  location.hash = '#/';
  render();
}
const FEATURES = [
  ['Timetable', 'Your weekly classes, built from your registration slip and the university timetable. Mix-and-match groups and your own classes are supported.'],
  ['Calendar apps', 'Add your timetable to Google Calendar or Apple Calendar. It updates by itself and skips breaks and public holidays.'],
  ['Bulletin', 'A shared board for each subject: classmates and admins post assignments, tests and notices with due dates.'],
  ['Academic calendar', 'Semester dates, the current lecture week, breaks, exams and public holidays.'],
  ['Assignments, grades, notes', 'Your own to-do list with due dates, marks per subject with weighted totals, and private study notes.'],
  ['Dashboard', "Today's classes, upcoming deadlines and the next holiday at a glance."],
];
let wStep = 0;
async function pgWelcome(m) {
  const steps = ['Welcome', 'Your subjects', 'Your group', 'Calendar app', 'Finding your way'];
  const nav = (extra = '') => `<div class="wiz-nav">${wStep > 0 ? '<button type="button" class="ghost" id="wb">Back</button>' : ''}
    <span class="grow"></span>${extra}${wStep < steps.length - 1 ? '<button type="button" class="ghost" id="ws">Skip this step</button><button type="button" id="wn">Next</button>' : '<button type="button" id="wf">Start using StudyHub</button>'}</div>`;
  const head = `<h2>Getting started</h2><div class="steps">${steps.map((t, i) => `<span class="${i === wStep ? 'on' : i < wStep ? 'done' : ''}">${i + 1}. ${t}</span>`).join('')}</div>`;
  let body = '';
  if (wStep === 0) {
    body = `<div class="card"><h3>Welcome to StudyHub, ${esc(me.name.split(' ')[0])}</h3>
      <p>StudyHub keeps your university life in one place. This short guide sets up your timetable and shows you around. It takes about two minutes, and you can skip any step.</p>
      <div class="feat">${FEATURES.map(([t, d]) => `<div><b>${t}</b><p class="mute">${d}</p></div>`).join('')}</div></div>`;
  } else if (wStep === 1) {
    const cs = await myCourses();
    body = `<div class="card"><h3>Add your subjects</h3>
      <p>Upload your <b>course registration slip</b> (the PDF from the student portal). StudyHub reads it in your browser and saves only the course list.</p>
      ${cs.length ? `<p class="ok">You have ${cs.length} subject(s): ${cs.map((c) => esc(c.code)).join(', ')}. Upload again only if they changed.</p>` : ''}
      ${SLIP_FORM}
      <p class="mute">No slip? Add subjects by code later in <b>My Courses</b>.</p></div>`;
  } else if (wStep === 2) {
    const tt = await getTimetable();
    body = `<div class="card"><h3>Choose your timetable group</h3>
      ${!tt.myCourseCount ? '<p>Add your subjects first (previous step); then your group can be chosen here or later on the <b>Timetable</b> page.</p>'
        : !tt.totalClassesInDb ? '<p>The university timetable has not been loaded yet. When it is, pick your group on the <b>Timetable</b> page. You can add classes by hand there meanwhile.</p>'
        : !tt.groupOptions.length ? '<p>Your subjects are not in the loaded timetable (it may be for another semester). You can add your classes by hand on the <b>Timetable</b> page.</p>'
        : `<p>Pick the group you mostly attend classes with. The best matches for your subjects are listed first.</p>
          <select id="wg"><option value="">- choose your group -</option>${tt.groupOptions.map((o) => `<option value="${esc(o.group)}" ${o.group === tt.main ? 'selected' : ''}>${esc(groupLabel(o.group))} - teaches ${o.n} of your ${tt.myCourseCount} subjects</option>`).join('')}</select>
          <p class="mute">Take some subjects with another group? Change them one by one on the <b>Timetable</b> page. You can also add your own classes there.</p><div id="wgm"></div>`}</div>`;
  } else if (wStep === 3) {
    const [tt, ac] = await Promise.all([getTimetable(), getAcademic()]);
    body = `<p>Optional: see your classes in the calendar app on your phone. You can do this later from the <b>Timetable</b> page.</p>${calendarCard(tt, ac)}`;
  } else {
    body = `<div class="card"><h3>Where things are</h3><table class="tour">
      <tr><td><b>Dashboard</b></td><td>Today's classes, the current lecture week, deadlines and the next holiday.</td></tr>
      <tr><td><b>Timetable</b></td><td>Your week. Change groups per subject, add your own classes, connect Google / Apple Calendar.</td></tr>
      <tr><td><b>Bulletin</b></td><td>Notices per subject. Post assignments and tests for your classmates; add a due date so it shows on everyone's dashboard.</td></tr>
      <tr><td><b>My Courses</b></td><td>Your registered subjects. Upload a new slip after add/drop.</td></tr>
      <tr><td><b>Assignments</b></td><td>Your own to-do list with due dates (private).</td></tr>
      <tr><td><b>Calendar</b></td><td>Month view of classes, deadlines, holidays and breaks.</td></tr>
      <tr><td><b>Academic Calendar</b></td><td>Semester dates, lecture weeks, exams and public holidays.</td></tr>
      <tr><td><b>Grades / Notes</b></td><td>Your marks with weighted totals, and private notes.</td></tr>
      <tr><td><b>Profile</b></td><td>Your details and password.</td></tr>
      <tr><td><b>Feedback</b></td><td>Send suggestions, report a problem or a bulletin post. Admin replies show up there.</td></tr>
      <tr><td><b>Help</b></td><td>How-tos and answers to common questions. You can run this guide again from there.</td></tr>
      ${me.role === 'admin' ? '<tr><td><b>Admin</b></td><td>Load the timetable and academic calendar, manage users. The Dashboard shows an admin setup checklist.</td></tr>' : ''}</table>
      <p>Need help? WhatsApp <a href="https://wa.me/60194145201" target="_blank" rel="noopener">@aaadam_h / 019-4145201</a>.</p></div>`;
  }
  m.innerHTML = head + body + nav();
  const go = (d) => () => { wStep = Math.max(0, Math.min(steps.length - 1, wStep + d)); pgWelcome(m); window.scrollTo(0, 0); };
  if (document.getElementById('wb')) document.getElementById('wb').onclick = go(-1);
  if (document.getElementById('wn')) document.getElementById('wn').onclick = go(1);
  if (document.getElementById('ws')) document.getElementById('ws').onclick = go(1);
  if (document.getElementById('wf')) document.getElementById('wf').onclick = () => { wStep = 0; finishOnboarding(); };
  if (wStep === 1) mountSlipUpload(m, () => { wStep = 2; pgWelcome(m); });
  const wg = document.getElementById('wg');
  if (wg) wg.onchange = async () => {
    try { me = await q(sb.from('profiles').update({ subgroup: wg.value || null }).eq('id', me.id).select().single()); flash(document.getElementById('wgm'), 'Saved', 1); }
    catch (er) { flash(document.getElementById('wgm'), er.message); }
  };
  if (wStep === 3) wireCalendarCard(m);
}

async function gettingStartedHtml(tt, ac) {
  let html = '';
  if (!store.get('sh_gs_hide_' + me.id)) {
    const items = [
      [!!(me.email && me.phone && me.program), 'Complete your profile', '#/profile'],
      [tt.myCourseCount > 0, 'Add your subjects (upload your registration slip)', '#/courses'],
      ...(tt.totalClassesInDb && tt.myCourseCount ? [[!!tt.main || tt.courses.every((c) => c.chosen || c.section === 'none'), 'Choose your timetable group', '#/timetable']] : []),
      [!!store.get('sh_cal_' + me.id), 'Add your timetable to Google / Apple Calendar (optional)', '#/timetable'],
    ];
    const done = items.filter((i) => i[0]).length;
    if (done < items.length) html += `<div class="card gs"><div class="gs-head"><h3>Getting started (${done} of ${items.length})</h3><a href="#" id="gsx" class="mute">Hide</a></div>
      <ul class="check">${items.map(([ok, t, h]) => `<li class="${ok ? 'ok' : ''}">${ok ? '&#10003;' : '&#9675;'} ${ok ? t : `<a href="${h}">${t}</a>`}</li>`).join('')}</ul>
      <p class="mute">New to StudyHub? See <a href="#/help">Help</a> or <a href="#/welcome">run the setup guide</a>.</p></div>`;
  }
  if (me.role === 'admin') {
    const s = await getSettings();
    const items = [
      [!!ac.periods.length, 'Upload the academic calendar PDF'],
      [!!tt.totalClassesInDb, 'Load the university timetable (link + sync, or upload the saved page)'],
      [!!(s.timetable_synced_at), 'Timetable loaded at least once'],
    ];
    if (items.some((i) => !i[0])) html += `<div class="card gs"><h3>Admin setup</h3><ul class="check">${items.map(([ok, t]) => `<li class="${ok ? 'ok' : ''}">${ok ? '&#10003;' : '&#9675;'} ${ok ? t : `<a href="#/admin">${t}</a>`}</li>`).join('')}</ul></div>`;
  }
  return html;
}

async function pgHelp(m) {
  const qa = [
    ['How do I get my timetable?', 'Upload your registration slip in <b>My Courses</b>, then open <b>Timetable</b> and pick your main group. Your classes appear under "Your week".'],
    ['I take a subject with a different group', 'On <b>Timetable</b>, step 2, change the group for that subject only. Everything else stays with your main group.'],
    ['A subject says "not in the loaded timetable"', 'The university timetable loaded in StudyHub may be for a different semester, or the subject may not be scheduled. Use <b>Add a class manually</b> on the Timetable page, or ask the admin to load the new timetable.'],
    ['How do I add my timetable to Google Calendar on my phone?', 'The Google Calendar app cannot add calendars from a link. On the <b>Timetable</b> page tap <b>Copy link</b>, open Google\'s "Add by URL" page in Chrome with <b>Desktop site</b> ticked, paste and add, then turn on <b>Sync</b> for "StudyHub timetable" in the app. On a computer, just click <b>Connect Google Calendar</b>.'],
    ['iPhone?', 'Tap <b>Subscribe in Apple Calendar</b> on the Timetable page.'],
    ['My calendar did not update', 'Google refreshes subscribed calendars every few hours (Apple about every 6 hours). Changes in StudyHub appear on the next refresh. The downloaded .ics file is a one-time copy and never updates.'],
    ['I added/dropped a subject', 'Upload your new slip in <b>My Courses</b> (it replaces the list), or add/remove subjects there by hand.'],
    ['How does the bulletin work?', 'Each subject has its own board. You can post to subjects you are registered for; add a due date for assignments and tests so they show on everyone\'s Dashboard and Calendar. Admins can post general notices.'],
    ['Who can see my information?', 'Your assignments, grades, notes, own classes and contact details are private (admins can see your profile and timetable to help you). Bulletin posts show your name and student ID to other students.'],
    ['How do I report a problem or a post?', 'Use the <b>Feedback</b> page, or the <b>Report</b> link under any bulletin post. Only admins can read it, and their reply appears on your Feedback page (the menu shows a badge when there is a new reply).'],
    ['Can I put StudyHub on my phone like an app?', `Yes. ${INSTALL_STEPS} StudyHub then gets its own icon and opens full screen.`],
    ['Where do I see my exam dates?', 'Upload your <b>examination slip</b> PDF on the <b>Exams</b> page. Your exams then show there with a countdown, on the Dashboard and in the Calendar. Subjects without a date on the slip are listed too: check the final exam schedule for those.'],
    ['I forgot my password', 'Ask an admin to reset it (WhatsApp below), then change it in <b>Profile</b>.'],
    ['What do "Lecture week" and the holidays come from?', 'The university\'s academic calendar, uploaded by the admin. See <b>Academic Calendar</b>.'],
  ];
  m.innerHTML = `<h2>Help</h2><p class="sub">How to use StudyHub.</p>
  <div class="card"><h3>What StudyHub does</h3><div class="feat">${FEATURES.map(([t, d]) => `<div><b>${t}</b><p class="mute">${d}</p></div>`).join('')}</div>
    <p><button type="button" id="rg">Run the setup guide again</button></p></div>
  <div class="card"><h3>Questions</h3>${qa.map(([qq, a]) => `<details class="qa"><summary>${qq}</summary><p>${a}</p></details>`).join('')}</div>
  ${me?.role === 'admin' ? `<div class="card"><h3>For admins</h3><ul>
    <li><b>Each academic year:</b> Admin, Academic calendar, upload the new Kalendar Akademik PDF.</li>
    <li><b>Each semester:</b> Admin, paste the new timetable link, Save &amp; sync now (or upload the saved page).</li>
    <li><b>Users:</b> Admin, View, to see a student's subjects and timetable, edit details, reset a password or delete an account.</li>
    <li><b>Feedback:</b> the red number next to Feedback shows new items. Reply, set the status, and delete reported posts from there.</li>
    <li>The full setup guide is SETUP.md in the GitHub repository.</li></ul></div>` : ''}
  <div class="card"><h3>Still stuck?</h3><p>WhatsApp <a href="https://wa.me/60194145201" target="_blank" rel="noopener">@aaadam_h / 019-4145201</a>.</p></div>`;
  document.getElementById('rg').onclick = () => { wStep = 0; location.hash = '#/welcome'; };
}

/* ---------------- public read-only views ---------------- */
async function getPublicData() {
  const [settingRows, courses, classes] = await Promise.all([
    q(sb.rpc('public_settings')),
    q(sb.from('courses').select('code,name,credit').order('code')),
    q(sb.from('classes').select('*').order('day').order('start_time').limit(1500)),
  ]);
  const settings = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
  const names = Object.fromEntries(courses.map((course) => [course.code, course.name]));
  return { settings, courses, classes: classes.map((item) => ({ ...item, course_name: names[item.course_code] || '' })) };
}
// The guest view is a read-only example student timetable; the signed-in app has no code restriction.
async function getGuestExampleTimetable() {
  const [courses, classes] = await Promise.all([
    q(sb.from('courses').select('code,name,credit').like('code', 'IMJ%').order('code')),
    q(sb.from('classes').select('*').like('course_code', 'IMJ%').order('day').order('start_time')),
  ]);
  const names = Object.fromEntries(courses.map((course) => [course.code, course.name]));
  return { courses, classes: classes.map((item) => ({ ...item, course_name: names[item.course_code] || '' })) };
}
async function getPublicBulletin() {
  const [posts, courses] = await Promise.all([
    q(sb.rpc('public_bulletin')),
    q(sb.from('courses').select('code,name').order('code')),
  ]);
  const names = Object.fromEntries(courses.map((course) => [course.code, course.name]));
  return { posts: posts.map((post) => ({ ...post, course_name: names[post.course_code] || '' })) };
}
async function pgPublicHome(m) {
  const [data, bulletin, academic] = await Promise.all([getPublicData(), getPublicBulletin(), getAcademic()]);
  m.innerHTML = `<div class="public-hero card"><div><span class="eyebrow">UniMAP study planner</span><h2>StudyHub keeps your timetable and study life in one place.</h2><p class="lead">Upload your course registration slip, let StudyHub match your subjects to the university timetable, then manage your week from one dashboard.</p>
    <div class="btns"><a class="btn" href="#/courses">Build my timetable</a><a class="btn ghost-link" href="#/timetable">View timetable</a></div></div>
    <div class="hero-note"><b>Guest mode</b><span>Read-only access is available without an account.</span><span>Login is requested only for personal or editing actions.</span></div></div>
  <div class="grid public-stats"><div class="card stat"><b>${data.courses.length}</b><span>Subjects in catalogue</span></div><div class="card stat"><b>${data.classes.length}</b><span>Timetable entries loaded</span></div><div class="card stat"><b>${bulletin.posts.length}</b><span>Bulletin posts</span></div><div class="card stat"><b>${academic.periods.length}</b><span>Academic periods</span></div></div>
  <div class="card"><h3>Explore before you log in</h3><p class="sub">The public pages are view-only.</p><div class="feat"><div><b>Timetable</b><p class="mute">Browse the currently loaded university classes and groups.</p><a href="#/timetable">Open timetable</a></div><div><b>Bulletin</b><p class="mute">Read shared subject announcements, assignments and notices.</p><a href="#/bulletin">Open bulletin</a></div><div><b>Academic calendar</b><p class="mute">See semester periods, breaks and no-class dates.</p><a href="#/academic">Open calendar</a></div></div></div>`;
}
function publicClassHtml(item) {
  return `<div class="cls public-cls k-${kindKey(item.kind)}" data-course="${esc(item.course_code)}" data-group="${esc(item.section || '')}" data-text="${esc([item.course_code, item.course_name, item.section, item.kind, item.venue, item.lecturer].filter(Boolean).join(' '))}"><div class="t">${esc(item.start_time)} - ${esc(item.end_time)}</div><div><b>${esc(item.course_code)}</b> ${esc(item.course_name || '')}<br><span class="mute">${[item.kind, item.venue, item.lecturer, item.section ? prettyGroup(item.section) : ''].filter(Boolean).map(esc).join(' · ')}</span></div></div>`;
}
async function pgPublicTimetable(m) {
  const data = await getGuestExampleTimetable();
  const courses = data.courses;
  const seen = new Set();
  const classes = data.classes.filter((item) => item.section).filter((item) => {
    const key = [item.course_code, item.section, item.day, item.start_time, item.end_time, item.kind].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const groupCounts = classes.reduce((counts, item) => ({ ...counts, [item.section]: (counts[item.section] || 0) + 1 }), {});
  const groups = Object.keys(groupCounts).sort((a, b) => groupCounts[b] - groupCounts[a] || a.localeCompare(b));
  const selectedGroup = groups[0] || '';
  const byDay = {}; for (const item of classes) (byDay[item.day] ||= []).push(item);
  m.innerHTML = `<h2>Timetable</h2><p class="sub">Read-only example weekly schedule for a student registered in one IMJ programme group. It does not combine classes from different groups.</p>
  <div class="card public-cta"><div><b>Want your own timetable?</b><p class="mute">Log in and upload your registration slip. StudyHub will use your registered subjects to build your personal week.</p></div><a class="btn" href="#/courses">Log in to build mine</a></div>
  <div class="card"><div class="row public-filters"><div><label>Example registered subject</label><select id="pt-course" data-plain><option value="">All example subjects</option>${courses.map((course) => `<option value="${esc(course.code)}">${esc(course.code)} - ${esc(course.name || '')}</option>`).join('')}</select></div><div><label>Example programme group</label><select id="pt-group" data-plain>${groups.map((group) => `<option value="${esc(group)}" ${group === selectedGroup ? 'selected' : ''}>${esc(groupLabel(group))} - ${groupCounts[group]} classes</option>`).join('')}</select></div><div><label>Search</label><input id="pt-search" type="search" placeholder="Course, lecturer, venue..."></div></div></div>
  ${classes.length ? `${KIND_LEGEND}${[1, 2, 3, 4, 5, 6, 7].map((day) => `<div class="card public-day" data-day-card="${day}"><h3>${DAYN[day]}</h3>${(byDay[day] || []).sort((a, b) => a.start_time.localeCompare(b.start_time)).map(publicClassHtml).join('') || '<p class="mute">No classes.</p>'}</div>`).join('')}` : '<div class="card">No IMJ timetable entries have been loaded yet.</div>'}`;
  const apply = () => {
    const course = document.getElementById('pt-course').value, group = document.getElementById('pt-group').value, term = document.getElementById('pt-search').value.trim().toLowerCase();
    m.querySelectorAll('.public-cls').forEach((element) => { element.hidden = (!!course && element.dataset.course !== course) || (!!group && element.dataset.group !== group) || (!!term && !element.dataset.text.toLowerCase().includes(term)); });
    m.querySelectorAll('[data-day-card]').forEach((card) => { card.hidden = ![...card.querySelectorAll('.public-cls')].some((element) => !element.hidden); });
  };
  ['pt-course', 'pt-group', 'pt-search'].forEach((id) => document.getElementById(id).addEventListener(id === 'pt-search' ? 'input' : 'change', apply));
  apply();
}
async function pgPublicBulletin(m) {
  const bulletin = await getPublicBulletin();
  const groups = {}; for (const post of bulletin.posts) (groups[post.course_code || '~general'] ||= []).push(post);
  const postHtml = (post) => `<div class="post public-post qi" data-kind="${esc(post.kind)}"><h4><span class="tag ${esc(post.kind)}">${esc(post.kind)}</span> ${esc(post.title)} ${post.due_date ? `<span class="tag">due ${esc(post.due_date)}</span>` : ''}</h4>${post.body ? `<p>${esc(post.body)}</p>` : ''}<span class="mute">${esc(post.author_name || 'StudyHub student')} · ${esc(new Date(post.created_at).toLocaleString())}</span></div>`;
  m.innerHTML = `<h2>Bulletin</h2><p class="sub">Shared, read-only board for assignments, exams and notices.</p>
  <div class="card public-cta"><div><b>Need to post or report something?</b><p class="mute">Log in is required for bulletin actions.</p></div><a class="btn" href="#/feedback">Log in for bulletin actions</a></div>
  ${filterBar('Search posts, subjects and notices...', qSelect('kind', [['', 'All types'], ['info', 'Info'], ['assignment', 'Assignments'], ['exam', 'Exams / tests'], ['urgent', 'Urgent'], ['update', 'Updates']]))}
  ${Object.keys(groups).sort((a, b) => (a === '~general') - (b === '~general') || a.localeCompare(b)).map((code) => `<div class="card public-bgroup qg"><h3>${code === '~general' ? 'General' : `${esc(code)} <span class="mute">${esc(groups[code][0].course_name || '')}</span>`}</h3>${groups[code].map(postHtml).join('')}</div>`).join('') || '<div class="card mute">No bulletin posts yet.</div>'}`;
}

/* ---------------- timetable ---------------- */
const groupLabel = (g) => `${prettyGroup(g)} (${g})`;
function weekHtml(tt) {
  let html = '';
  for (let d = 1; d <= 7; d++) {
    const cs = tt.classes.filter((c) => c.day === d);
    if (cs.length) html += `<div class="card day"><h3>${DAYN[d]}</h3>${cs.map(clsHtml).join('')}</div>`;
  }
  return html ? KIND_LEGEND + html : '<div class="card mute">No classes to show yet.</div>';
}
// read-only view (admin looking at a student)
function timetableHtml(tt) {
  if (!tt.myCourseCount && !tt.custom.length) return '<div class="card">No registered courses.</div>';
  return `<div class="card"><p>Main group: <b>${tt.main ? esc(groupLabel(tt.main)) : 'not chosen'}</b></p>
  <table><tr><th>Subject</th><th>Group used</th></tr>${tt.courses.map((c) => `<tr><td>${esc(c.code)} ${esc(c.name || '')}</td><td>${c.chosen ? esc(groupLabel(c.chosen)) : c.section === 'none' ? 'hidden' : '<span class="mute">not set</span>'}</td></tr>`).join('')}</table></div>
  ${weekHtml(tt)}`;
}
async function pgTimetable(m) {
  const [tt, ac] = await Promise.all([getTimetable(), getAcademic()]);
  const noData = !tt.totalClassesInDb;
  const courseOpts = tt.courses.map((c) => `<option value="${esc(c.code)}">${esc(c.code)} - ${esc(c.name || '')}</option>`).join('');
  m.innerHTML = `<h2>Timetable</h2><p class="sub">Built from your registered subjects and the university timetable. Mix-and-match groups are fine.</p>
  ${!tt.myCourseCount ? '<div class="card">You have no subjects yet. <a href="#/courses">Upload your registration slip</a>.</div>' : ''}
  ${noData ? `<div class="card">The university timetable has not been loaded yet. ${me.role === 'admin' ? '<a href="#/admin">Load it in Admin</a>.' : 'Ask an admin to load it.'} You can still add classes yourself below.</div>` : ''}
  ${tt.myCourseCount && !noData ? `<div class="card"><h3>1. Your main group</h3>
    <p class="mute">Pick the group you mostly attend with. Groups teaching the most of your subjects are listed first.</p>
    ${tt.groupOptions.length ? `<div class="row"><div><select id="mg"><option value="">- choose your group -</option>${tt.groupOptions.map((o) => `<option value="${esc(o.group)}" ${o.group === tt.main ? 'selected' : ''}>${esc(groupLabel(o.group))} - teaches ${o.n} of your ${tt.myCourseCount} subjects</option>`).join('')}</select></div></div>`
      : '<p>None of your subjects appear in the loaded timetable. Add your classes manually below.</p>'}</div>
  <div class="card"><h3>2. Group for each subject</h3>
    <p class="mute">Took a subject with a different group? Change it here. Choose "Hide" for subjects without scheduled classes.</p>
    <table><tr><th>Subject</th><th>Group</th></tr>${tt.courses.map((c) => `<tr><td><b>${esc(c.code)}</b> ${esc(c.name || '')}</td><td>
      ${c.groups.length ? `<select class="cg" data-code="${esc(c.code)}">
        <option value="" ${!c.section ? 'selected' : ''}>${tt.main && c.groups.includes(tt.main) ? 'Same as main group' : c.groups.length === 1 ? 'Only group: ' + esc(prettyGroup(c.groups[0])) : '- choose -'}</option>
        ${c.groups.map((g) => `<option value="${esc(g)}" ${c.section === g ? 'selected' : ''}>${esc(groupLabel(g))}</option>`).join('')}
        <option value="none" ${c.section === 'none' ? 'selected' : ''}>Hide this subject</option></select>`
      : '<span class="mute">Not in the loaded timetable (it may be for a different semester). Add it manually below.</span>'}</td></tr>`).join('')}</table></div>` : ''}
  <div class="card"><h3>${tt.myCourseCount && !noData ? '3. ' : ''}Add a class manually</h3>
    <p class="mute">For classes that are missing or different from the university timetable.</p>
    <form id="mc"><div class="row">
      <div><label>Subject</label><select name="course_code">${courseOpts}<option value="">Other (type a title)</option></select></div>
      <div><label>Title <span class="mute">(optional)</span></label><input name="title" maxlength="200" placeholder="e.g. Replacement class"></div></div>
    <div class="row"><div><label>Day</label><select name="day" required>${DAYN.slice(1).map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}</select></div>
      <div><label>Start</label><input type="time" name="start_time" required></div><div><label>End</label><input type="time" name="end_time" required></div></div>
    <div class="row"><div><label>Type <span class="mute">(optional)</span></label><select name="kind"><option value="">-</option><option>LECTURE</option><option>TUTORIAL</option><option>LAB</option></select></div>
      <div><label>Venue <span class="mute">(optional)</span></label><input name="venue" maxlength="200"></div><button>Add class</button></div></form><div id="mcm"></div>
    ${tt.custom.length ? `<h4>Your added classes</h4><table>${tt.custom.map((c) => `<tr><td>${DAYN[c.day]} ${esc(c.start_time)}-${esc(c.end_time)}</td><td>${esc(c.course_code || '')} ${esc(c.title || '')}</td><td>${esc(c.venue || '')}</td><td><button class="sm ghost" data-rmc="${c.id}">Remove</button></td></tr>`).join('')}</table>` : ''}</div>
  ${calendarCard(tt, ac)}
  <h3>Your week</h3>${weekHtml(tt)}
  <p class="mute">Source: ${esc(tt.url || '-')}${tt.synced_at ? ' · loaded ' + esc(new Date(tt.synced_at).toLocaleString()) : ''}</p>`;
  const mg = document.getElementById('mg');
  if (mg) mg.onchange = async () => { me = await q(sb.from('profiles').update({ subgroup: mg.value || null }).eq('id', me.id).select().single()); render(); };
  m.querySelectorAll('.cg').forEach((s) => (s.onchange = async () => {
    await q(sb.from('enrollments').update({ section: s.value || null }).eq('user_id', me.id).eq('course_code', s.dataset.code));
    render();
  }));
  document.getElementById('mc').onsubmit = async (e) => {
    e.preventDefault();
    const d = fd(e.target);
    if (!d.course_code && !d.title) return flash(document.getElementById('mcm'), 'Choose a subject or type a title');
    if (d.end_time <= d.start_time) return flash(document.getElementById('mcm'), 'End time must be after start time');
    try { await q(sb.from('my_classes').insert({ ...d, day: +d.day })); render(); } catch (er) { flash(document.getElementById('mcm'), er.message); }
  };
  m.querySelectorAll('[data-rmc]').forEach((b) => (b.onclick = async () => { await q(sb.from('my_classes').delete().eq('id', b.dataset.rmc)); render(); }));
  wireCalendarCard(m);
}

/* ---------------- calendar apps (.ics download + Google / Apple subscription) ---------------- */
const feedUrl = () => `${CFG.SUPABASE_URL}/functions/v1/calendar-feed?token=${me.calendar_token}`;
function calendarCard(tt, ac) {
  const https = feedUrl(), webcal = https.replace(/^https:/, 'webcal:');
  const w = ac.window;
  const range = w.from_calendar ? `${w.sem_label}: ${fmtDate(w.first_day)} to ${fmtDate(w.last_day)}, skipping breaks and public holidays from the academic calendar (which is also added)`
    : tt.semester_start ? `${fmtDate(w.first_day)} to ${fmtDate(w.last_day)}${tt.break_start ? `, skipping the break ${tt.break_start} to ${tt.break_end}` : ''}`
    : 'this week plus 14 weeks (the admin has not uploaded the academic calendar yet)';
  // Google's phone app can't add a calendar from a link, only the website (in desktop mode) can
  const ua = navigator.userAgent;
  const android = /Android/i.test(ua), ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  const phoneHelp = android || ios ? `<div class="phone-help">
    <b>${ios ? 'On iPhone' : 'On Android'}:</b> ${ios ? 'tap <b>Subscribe in Apple Calendar</b> to add it to the iPhone Calendar app. For Google Calendar instead, follow the steps below.' : 'the Google Calendar app can\'t add a calendar from a link, so add it once through the Google Calendar website:'}
    <ol><li>Tap <b>Copy link</b>.</li>
      <li>Tap <b>Open "Add by URL"</b>. In Chrome, open the <b>&#8942;</b> menu and tick <b>Desktop site</b>.</li>
      <li>Paste the link into <b>URL of calendar</b> and tap <b>Add calendar</b>.</li>
      <li>In the Google Calendar app: <b>&#9776;</b> &rsaquo; <b>Settings</b> &rsaquo; <b>StudyHub timetable</b> &rsaquo; turn <b>Sync</b> on.</li></ol>
    <div class="btns"><button type="button" class="ghost cpy">Copy link</button>
      <a class="btn ghost-link" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/r/settings/addbyurl">Open "Add by URL"</a></div></div>` : '';
  return `<div class="card"><h3>Add to your calendar app</h3>
  <p class="mute">Your classes repeat weekly: ${esc(range)}. Times are Malaysia time.</p>
  <div class="btns">
    ${ios ? `<a class="btn" href="${esc(webcal)}">Subscribe in Apple Calendar</a>` : ''}
    ${android || ios ? '' : `<a class="btn" target="_blank" rel="noopener" href="${esc(google)}">Connect Google Calendar</a>`}
    <button id="ics" type="button" class="${android || ios ? 'ghost' : ''}">Download .ics${android ? '' : ' (Apple / Outlook)'}</button>
    ${ios || android ? '' : `<a class="btn ghost-link" href="${esc(webcal)}">Subscribe in Apple Calendar</a>`}
  </div><div id="icm"></div>${phoneHelp}
  <details><summary>Live link and help</summary>
    <p class="mute">Subscribing keeps your calendar updated when your timetable changes (Google refreshes every few hours, Apple about every 6 hours). The download is a one-time copy.</p>
    <p class="mute"><b>Google on a computer:</b> "Connect Google Calendar", or Google Calendar, "Other calendars" <b>+</b>, "From URL", paste the link below. It then also shows on your phone (turn on Sync for it in the phone app).<br>
    <b>Google on a phone:</b> the app can't add links; use the website in desktop mode as described above.<br>
    <b>iPhone:</b> "Subscribe in Apple Calendar", or Settings, Calendar, Accounts, Add Account, Other, Add Subscribed Calendar, paste the link.</p>
    <div class="row"><input id="feed" readonly value="${esc(https)}"><button type="button" class="ghost cpy" id="cpy">Copy link</button></div>
    <p class="mute">Keep this link private: anyone with it can see your timetable. <a href="#" id="rst">Make a new link</a> (the old one stops working).</p>
  </details></div>`;
}
function wireCalendarCard(m) {
  const msg = document.getElementById('icm');
  m.querySelectorAll('#ics, .card:has(#ics) a.btn, .cpy').forEach((el) => el.addEventListener('click', () => store.set('sh_cal_' + me.id, '1')));
  document.getElementById('ics').onclick = async () => {
    try {
      const text = await q(sb.rpc('my_calendar_ics'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
      a.download = 'studyhub-timetable.ics';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (er) { flash(msg, er.message); }
  };
  m.querySelectorAll('.cpy').forEach((b) => (b.onclick = async () => {
    try { await navigator.clipboard.writeText(feedUrl()); flash(msg, 'Link copied', 1); }
    catch { const f = document.getElementById('feed'); f.closest('details').open = true; f.select(); flash(msg, 'Select the link below and copy it'); }
  }));
  document.getElementById('rst').onclick = async (e) => {
    e.preventDefault();
    if (!confirm('Make a new calendar link? Calendars using the old link stop updating and must be re-connected.')) return;
    me.calendar_token = await q(sb.rpc('reset_calendar_token'));
    render();
  };
}

/* ---------------- courses + slip ---------------- */
let pdfjs = null;
async function pdfToLines(file) {
  if (!pdfjs) {
    // bundled in web/vendor (no third-party CDN at runtime)
    pdfjs = await import('./vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  }
  if (!file || file.size > 10 * 1024 * 1024) throw new Error('Choose a PDF under 10 MB');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const rows = [];
    for (const it of (await (await doc.getPage(p)).getTextContent()).items) {
      if (!it.str) continue;
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (!row) rows.push((row = { y, items: [] }));
      row.items.push(it);
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) lines.push(r.items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim());
  }
  return lines;
}
const SLIP_FORM = `<form id="up"><label>Registration slip PDF</label><div class="row"><input type="file" name="slip" accept="application/pdf" required><button>Read slip</button></div></form><div id="upmsg"></div><div id="preview"></div>`;
// Reads the slip PDF in the browser, shows what was found, and saves the courses when confirmed
function mountSlipUpload(root, onSaved) {
  root.querySelector('#up').onsubmit = async (e) => {
    e.preventDefault();
    const msg = root.querySelector('#upmsg');
    msg.innerHTML = '<span class="mute">Reading...</span>';
    try {
      const p = parseSlipLines(await pdfToLines(e.target.slip.files[0]));
      if (!p.courses.length) throw new Error('No courses found. Is this the UniMAP course registration slip?');
      msg.innerHTML = '';
      root.querySelector('#preview').innerHTML = `<h4>Found on the slip</h4><p>${esc(p.name || '')} · ${esc(p.matric || '')} · ${esc(p.program || '')} · ${esc(p.semester || '')}</p>
      ${p.matric && p.matric !== me.student_id ? `<div class="err">The matric number on this slip (${esc(p.matric)}) differs from your student ID (${esc(me.student_id)}).</div>` : ''}
      <table>${p.courses.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${c.credit}</td><td>${esc(c.grp)}</td></tr>`).join('')}</table>
      <p><button id="ok" type="button">Save these ${p.courses.length} courses (replaces current list)</button></p>`;
      root.querySelector('#ok').onclick = async () => {
        await q(sb.rpc('save_courses', { items: p.courses, replace: true }));
        const patch = {};
        if (p.program && !me.program) patch.program = p.program;
        if (p.semester) patch.semester = p.semester;
        if (Object.keys(patch).length) me = (await q(sb.from('profiles').update(patch).eq('id', me.id).select().single()));
        onSaved(p);
      };
    } catch (err) { flash(msg, err.message.startsWith('No courses') || err.message.startsWith('Choose a PDF') ? err.message : 'Could not read that PDF: ' + err.message); }
  };
}

async function pgCourses(m) {
  const cs = await myCourses();
  m.innerHTML = `<h2>My Courses</h2><p class="sub">Upload your course registration slip (PDF). It is read in your browser; only the course list is saved.</p>
  <div class="card">${SLIP_FORM}</div>
  <div class="card"><h3>Registered courses (${cs.reduce((a, c) => a + (c.credit || 0), 0)} credits)</h3>
  ${cs.length ? `<table><tr><th>Code</th><th>Name</th><th>Credit</th><th>Group</th><th></th></tr>${cs.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${c.credit ?? ''}</td><td>${esc(c.grp || '')}</td><td><button class="sm ghost" data-rm="${esc(c.code)}">Remove</button></td></tr>`).join('')}</table>` : '<p class="mute">None yet.</p>'}
  <h4>Add a course manually</h4><form id="add" class="row"><div><label>Code</label><input name="code" placeholder="IMJ41103" required pattern="[A-Za-z]{3}[0-9]{5}"></div><div><label>Name</label><input name="name"></div><button>Add</button></form><div id="addmsg"></div></div>`;
  m.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { await q(sb.from('enrollments').delete().eq('user_id', me.id).eq('course_code', b.dataset.rm)); render(); }));
  document.getElementById('add').onsubmit = async (e) => {
    e.preventDefault();
    const { code, name } = fd(e.target);
    try { await q(sb.rpc('save_courses', { items: [{ code: code.toUpperCase(), name }], replace: false })); render(); }
    catch (err) { flash(document.getElementById('addmsg'), err.message); }
  };
  mountSlipUpload(m, render);
}

/* ---------------- bulletin ---------------- */
// the seen-time from before this visit to the Bulletin, so NEW tags stay while the student is on the page
let bulletinNewSince = null;
async function saveMuted(list) {
  await q(sb.from('profiles').update({ muted_subjects: list }).eq('id', me.id));
  me.muted_subjects = list;
}
async function pgBulletin(m) {
  const b = await getBulletin();
  bulletinNewSince ||= me.bulletin_seen_at;
  const muted = me.muted_subjects || [];
  const isNew = (p) => p.user_id !== me.id && p.created_at > bulletinNewSince;
  let filter = 'mine';
  try { filter = sessionStorage.getItem('bfilter') || 'mine'; } catch {}
  const list = b.posts.filter((p) => filter === 'all' || !p.course_code || b.mine.includes(p.course_code));
  const groups = {};
  const UPD = '~updates'; // admin updates get their own section at the top
  for (const p of list) (groups[p.kind === 'update' ? UPD : p.course_code || ''] ||= []).push(p);
  const postable = me.role === 'admin' ? b.allCourses : b.allCourses.filter((c) => b.mine.includes(c.code));
  m.innerHTML = `<h2>Bulletin</h2><p class="sub">Shared board for assignments and important notices, grouped by subject.</p>
  <div class="card"><form id="np"><div class="row"><div><label>Subject</label><select name="course_code" ${me.role === 'admin' ? '' : 'required'}>${me.role === 'admin' ? '<option value="">General (all students)</option>' : '<option value="" disabled selected>Choose subject</option>'}${postable.map((c) => `<option value="${esc(c.code)}">${esc(c.code)} - ${esc(c.name || '')}</option>`).join('')}</select></div>
  <div><label>Type</label><select name="kind"><option value="info">Info</option><option value="assignment">Assignment</option><option value="exam">Exam / test</option><option value="urgent">Urgent</option>${me.role === 'admin' ? '<option value="update">Update (Dashboard, everyone)</option>' : ''}</select></div>
  <div><label>Due date (optional)</label><input type="date" name="due_date"></div></div>
  <label>Title</label><input name="title" required maxlength="200"><label>Details</label><textarea name="body" rows="3" maxlength="4000"></textarea><div id="pmsg"></div><p><button>Post</button></p></form>
  ${postable.length || me.role === 'admin' ? '' : '<p class="mute">Register your courses to post to their boards.</p>'}</div>
  ${filterBar('Search posts, subjects, authors...', `<select id="bf" data-plain><option value="mine" ${filter === 'mine' ? 'selected' : ''}>My subjects</option><option value="all" ${filter === 'all' ? 'selected' : ''}>All subjects</option></select>${qSelect('kind', [['', 'All types'], ['info', 'Info'], ['assignment', 'Assignments'], ['exam', 'Exams / tests'], ['urgent', 'Urgent'], ['update', 'Updates']])}`)}
  ${muted.length ? `<p class="mute muted-list">Muted (not counted in the menu badge): ${muted.map((c) => `<span class="tag">${esc(c)} <a href="#" data-unmute="${esc(c)}" title="Unmute">×</a></span>`).join(' ')}</p>` : ''}
  ${Object.keys(groups).sort((a, b) => (b === UPD) - (a === UPD) || muted.includes(a) - muted.includes(b) || a.localeCompare(b)).map((code) => {
    const off = muted.includes(code), fresh = groups[code].filter(isNew).length;
    const posts = groups[code].map((p) => `<div class="post qi" data-kind="${esc(p.kind)}"><h4>${isNew(p) ? '<span class="tag new">NEW</span> ' : ''}<span class="tag ${esc(p.kind)}">${esc(p.kind)}</span> ${esc(p.title)} ${p.due_date ? `<span class="tag">due ${esc(p.due_date)}</span>` : ''}</h4>${p.body ? `<p>${esc(p.body)}</p>` : ''}
  <span class="mute">${esc(p.author_name)}${p.author_sid ? ` (${esc(p.author_sid)})` : ''}${p.real_author ? ` · posted by ${esc(p.real_author)}` : ''} · ${esc(new Date(p.created_at).toLocaleString())}</span> ${p.user_id === me.id || me.role === 'admin' ? `<button class="sm ghost" data-del="${p.id}">Delete</button>` : ''} ${p.user_id !== me.id ? `<a class="report" href="#/feedback/report/${p.id}">Report</a>` : ''}</div>`).join('');
    return `<div class="card qg${off ? ' muted' : ''}"><div class="gh"><h3>${code === UPD ? 'Updates' : code ? esc(code) + ' <span class="mute">' + esc(groups[code][0].course_name || '') + '</span>' : 'General'}${fresh && !off ? ` <span class="tag new">${fresh} new</span>` : ''}</h3>
      ${code && code !== UPD ? `<button class="sm ghost" data-${off ? 'unmute' : 'mute'}="${esc(code)}" title="${off ? 'Count new posts again' : 'Stop counting new posts from this subject'}">${off ? 'Unmute' : 'Mute'}</button>` : ''}</div>
      ${off ? `<details><summary>Muted · show ${groups[code].length} post${groups[code].length === 1 ? '' : 's'}</summary>${posts}</details>` : posts}</div>`;
  }).join('') || '<div class="card mute">No posts yet.</div>'}`;
  m.querySelectorAll('[data-mute]').forEach((x) => (x.onclick = async () => { await saveMuted([...new Set([...muted, x.dataset.mute])]); render(); }));
  m.querySelectorAll('[data-unmute]').forEach((x) => (x.onclick = async (e) => { e.preventDefault(); await saveMuted(muted.filter((c) => c !== x.dataset.unmute)); render(); }));
  // opened: everything up to now is seen (the NEW tags stay until the student leaves the page)
  q(sb.rpc('mark_bulletin_seen')).then((t) => { me.bulletin_seen_at = t; updateBulletinBadge(); }).catch(() => {});
  document.getElementById('bf').onchange = (e) => { try { sessionStorage.setItem('bfilter', e.target.value); } catch {} render(); };
  m.querySelectorAll('[data-del]').forEach((x) => (x.onclick = async () => { if (confirm('Delete this post?')) { await q(sb.from('posts').delete().eq('id', x.dataset.del)); render(); } }));
  const np = document.getElementById('np');
  np.kind.onchange = () => { const upd = np.kind.value === 'update'; np.querySelector('.combo, [name=course_code]').closest('div').style.opacity = upd ? '.4' : ''; np.querySelector('[name=title]').placeholder = upd ? 'Shown on everyone\'s Dashboard as ADMIN' : ''; };
  document.getElementById('np').onsubmit = async (e) => {
    e.preventDefault();
    try { await q(sb.from('posts').insert(fd(e.target))); render(); }
    catch (err) { flash(document.getElementById('pmsg'), err.message); }
  };
}

/* ---------------- personal lists ---------------- */
async function pgAssignments(m) {
  const [list, cs] = await Promise.all([q(sb.from('assignments').select('*').order('done').order('due_date', { nullsFirst: false })), myCourses()]);
  m.innerHTML = `<h2>Assignments</h2><p class="sub">${list.filter((a) => !a.done).length} pending, ${list.filter((a) => a.done).length} completed</p>
  <div class="card"><form id="f" class="row"><div><label>Title</label><input name="title" required></div><div><label>Subject</label><select name="course_code">${courseOptions(cs)}</select></div><div><label>Due</label><input type="date" name="due_date"></div><button>Add</button></form></div>
  ${list.length ? filterBar('Search assignments', qSelect('st', [['', 'All'], ['pending', 'Pending'], ['done', 'Completed']])) : ''}
  <div class="card">${list.map((a) => `<div class="post qi" data-st="${a.done ? 'done' : 'pending'}"><label style="display:flex;gap:8px;align-items:center;margin:0;color:var(--ink)"><input type="checkbox" style="width:auto" data-done="${a.id}" ${a.done ? 'checked' : ''}> <span style="${a.done ? 'text-decoration:line-through;opacity:.6' : ''}"><b>${esc(a.title)}</b> <span class="mute">${esc(a.course_code || '')} ${a.due_date ? 'due ' + esc(a.due_date) : ''}</span></span></label> <button class="sm ghost" data-del="${a.id}">Delete</button></div>`).join('') || '<p class="mute">No assignments yet.</p>'}</div>`;
  document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); await q(sb.from('assignments').insert(fd(e.target))); render(); };
  m.querySelectorAll('[data-done]').forEach((c) => (c.onchange = async () => { await q(sb.from('assignments').update({ done: c.checked }).eq('id', c.dataset.done)); render(); }));
  m.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await q(sb.from('assignments').delete().eq('id', b.dataset.del)); render(); }));
}
async function pgGrades(m) {
  const [list, cs] = await Promise.all([q(sb.from('grades').select('*').order('course_code').order('id')), myCourses()]);
  const pct = (g) => (g.max_score ? (100 * g.score) / g.max_score : null);
  const byCourse = {};
  for (const g of list) (byCourse[g.course_code || 'Other'] ||= []).push(g);
  m.innerHTML = `<h2>Grades</h2><p class="sub">Track your academic performance. Weight is % of the final mark.</p>
  <div class="card"><form id="f" class="row"><div><label>Subject</label><select name="course_code">${courseOptions(cs)}</select></div><div><label>Item</label><input name="item" required placeholder="Quiz 1"></div><div><label>Score</label><input type="number" step="any" name="score"></div><div><label>Out of</label><input type="number" step="any" name="max_score"></div><div><label>Weight %</label><input type="number" step="any" name="weight"></div><button>Add</button></form></div>
  ${list.length ? filterBar('Search grades') : ''}
  ${Object.entries(byCourse).map(([code, gs]) => {
    const w = gs.filter((g) => g.weight && pct(g) != null);
    const tot = w.reduce((a, g) => a + (pct(g) * g.weight) / 100, 0), tw = w.reduce((a, g) => a + Number(g.weight), 0);
    return `<div class="card qg"><h3>${esc(code)} ${tw ? `<span class="tag">${tot.toFixed(1)} / ${tw} weighted marks</span>` : ''}</h3><table><tr><th>Item</th><th>Score</th><th>%</th><th>Weight</th><th></th></tr>${gs.map((g) => `<tr class="qi"><td>${esc(g.item)}</td><td>${g.score ?? ''}${g.max_score ? ' / ' + g.max_score : ''}</td><td>${pct(g) == null ? '' : pct(g).toFixed(1)}</td><td>${g.weight ?? ''}</td><td><button class="sm ghost" data-del="${g.id}">Delete</button></td></tr>`).join('')}</table></div>`;
  }).join('') || '<div class="card mute">No grades recorded yet.</div>'}`;
  document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); await q(sb.from('grades').insert(fd(e.target))); render(); };
  m.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await q(sb.from('grades').delete().eq('id', b.dataset.del)); render(); }));
}
async function pgNotes(m) {
  const [list, cs] = await Promise.all([q(sb.from('notes').select('*').order('id', { ascending: false })), myCourses()]);
  m.innerHTML = `<h2>Notes</h2><p class="sub">Your private study notes.</p>
  <div class="card"><form id="f"><div class="row"><div><label>Title</label><input name="title" required></div><div><label>Subject</label><select name="course_code">${courseOptions(cs)}</select></div></div><label>Note</label><textarea name="body" rows="4"></textarea><p><button>Save note</button></p></form></div>
  ${list.length ? filterBar('Search notes') : ''}
  ${list.map((n) => `<div class="card qi"><h3>${esc(n.title)} <span class="tag">${esc(n.course_code || '')}</span></h3><p style="white-space:pre-wrap">${esc(n.body)}</p><button class="sm ghost" data-del="${n.id}">Delete</button></div>`).join('') || '<div class="card mute">No notes yet.</div>'}`;
  document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); await q(sb.from('notes').insert(fd(e.target))); render(); };
  m.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await q(sb.from('notes').delete().eq('id', b.dataset.del)); render(); }));
}

/* ---------------- exams ---------------- */
const getExamSlip = async () => (await sb.from('exam_slips').select('*').eq('user_id', me.id).maybeSingle()).data || null;
const daysUntil = (iso) => Math.round((new Date(iso + 'T00:00:00') - new Date(localISO() + 'T00:00:00')) / 864e5);
const countdown = (iso) => { const n = daysUntil(iso); return n < 0 ? 'done' : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`; };
const fmtTime = (t) => { if (!t) return ''; const [h, mi] = t.split(':').map(Number); return `${h % 12 || 12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const fmtExamDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const sortExams = (list) => [...list].sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
const upcomingExams = (slip) => sortExams((slip?.exams || []).filter((e) => e.date && daysUntil(e.date) >= 0));
function examTable(list) {
  return `<table><tr><th>Date</th><th>Time</th><th>Subject</th><th>Venue</th><th></th></tr>${sortExams(list).map((e) => {
    const past = e.date && daysUntil(e.date) < 0;
    return `<tr class="${past ? 'past' : ''}"><td>${e.date ? esc(fmtExamDate(e.date)) : '<span class="mute">Not on slip</span>'}</td><td>${esc(fmtTime(e.time))}</td>
      <td><b>${esc(e.code)}</b> ${esc(e.name || '')}</td><td>${esc(e.venue || '')}</td><td>${e.date ? `<span class="tag ${past ? '' : 'exam'}">${esc(countdown(e.date))}</span>` : ''}</td></tr>`;
  }).join('')}</table>${list.some((e) => !e.date) ? '<p class="mute">No date on the slip: check the final exam schedule for those subjects.</p>' : ''}`;
}
async function pgExams(m) {
  const slip = await getExamSlip();
  m.innerHTML = `<h2>Exams</h2><p class="sub">Upload your examination slip to see your exam dates, times and venues here, on the Dashboard and in the Calendar.</p>
  ${slip ? `<div class="card"><h3>${esc(slip.session || 'Examination slip')}</h3>
    <p class="mute">Index number: <b>${esc(slip.index_no || '-')}</b> · uploaded ${esc(new Date(slip.uploaded_at).toLocaleDateString())}</p>${examTable(slip.exams)}</div>
    ${slip.notices.length ? `<div class="card"><details><summary>Exam hall rules (${slip.notices.length})</summary><ol>${slip.notices.map((n) => `<li>${esc(n)}</li>`).join('')}</ol></details></div>` : ''}` : ''}
  <div class="card"><h3>${slip ? 'Upload a new slip' : 'Upload your examination slip'}</h3>
    <p class="mute">The PDF is read on your device. Only the exam details, index number and hall rules are saved; your IC number is not.</p>
    <form id="ex"><div class="row"><input type="file" name="pdf" accept="application/pdf" required><button>Read slip</button></div></form>
    <div id="exmsg"></div><div id="expv"></div>
    ${slip ? '<p><button type="button" class="sm ghost" id="exdel">Remove my exam slip</button></p>' : ''}</div>`;
  document.getElementById('ex').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('exmsg');
    msg.innerHTML = '<span class="mute">Reading...</span>';
    try {
      const r = parseExamSlipLines(await pdfToLines(e.target.pdf.files[0]));
      if (!r.exams.length) throw new Error('No exams found. Is this the UniMAP examination slip?');
      msg.innerHTML = '';
      document.getElementById('expv').innerHTML = `<h4>Found on the slip: ${esc(r.session || '')}${r.index_no ? ' · index number ' + esc(r.index_no) : ''}</h4>
      ${r.matric && r.matric !== me.student_id ? `<div class="err">The matric number on this slip (${esc(r.matric)}) differs from your student ID (${esc(me.student_id)}).</div>` : ''}
      ${examTable(r.exams)}<p><button id="exok" type="button">Save ${r.exams.length} subjects${slip ? ' (replaces the current slip)' : ''}</button></p>`;
      document.getElementById('exok').onclick = async () => {
        await q(sb.from('exam_slips').upsert({ user_id: me.id, session: r.session, index_no: r.index_no, exams: r.exams, notices: r.notices, uploaded_at: new Date().toISOString() }));
        render();
      };
    } catch (err) { flash(msg, /^(No exams|Choose a PDF)/.test(err.message) ? err.message : 'Could not read that PDF: ' + err.message); }
  };
  const del = document.getElementById('exdel');
  if (del) del.onclick = async () => { if (confirm('Remove your exam slip?')) { await q(sb.from('exam_slips').delete().eq('user_id', me.id)); render(); } };
}

/* ---------------- calendar ---------------- */
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
async function pgCalendar(m) {
  const [tt, asg, bul, ac, slip] = await Promise.all([getTimetable(), q(sb.from('assignments').select('*')), getBulletin(), getAcademic(), getExamSlip()]);
  const examsOn = {};
  for (const e of slip?.exams || []) if (e.date) (examsOn[e.date] ||= []).push(e);
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - first.getDay());
  const due = {};
  for (const a of asg) if (a.due_date && !a.done) (due[a.due_date] ||= []).push('📝 ' + a.title);
  for (const p of bul.posts) if (p.due_date && (!p.course_code || bul.mine.includes(p.course_code))) (due[p.due_date] ||= []).push(`📌 ${p.course_code || ''} ${p.title}`);
  let cells = '', prevLabel = '';
  const days = {};
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const info = ac.day(localISO(d));
    const cls = info.classes ? tt.classes.filter((c) => c.day === (d.getDay() || 7)) : [];
    const iso = localISO(d), label = info.st && info.st.kind !== 'lecture' ? info.st.label : '';
    days[iso] = { d, info, cls, due: due[iso] || [], exams: examsOn[iso] || [] };
    const tag = label && label !== prevLabel ? `<div class="e per" title="${esc(info.st.semester)}">${esc(label)}</div>` : '';
    prevLabel = label;
    cells += `<div class="d ${d.getMonth() !== mo ? 'off' : ''} ${iso === localISO() ? 'today' : ''} ${label ? 'brk' : ''}" data-iso="${iso}"><b>${d.getDate()}</b>${info.hol.map((e) => `<div class="e holi" title="${esc(e.title)}">${esc(e.title)}</div>`).join('')}${tag}${(examsOn[iso] || []).map((e) => `<div class="e exam" title="Exam: ${esc(e.code)} ${esc(e.name || '')} ${esc(fmtTime(e.time))} ${esc(e.venue || '')}"><b>EXAM</b> <span class="nm">${esc(e.name || e.code)}</span></div>`).join('')}${cls.map((c) => `<div class="e c k-${kindKey(c.kind)}" title="${esc(c.start)}-${esc(c.end)} ${esc(c.course_code)} ${esc(c.course_name || '')} ${esc(c.kind || '')} ${esc(c.venue || '')}"><b>${esc(c.start)}</b> <span class="nm">${esc(c.course_name || c.course_code)}</span></div>`).join('')}${(due[iso] || []).map((t) => `<div class="e due" title="${esc(t)}">${esc(t)}</div>`).join('')}</div>`;
  }
  m.innerHTML = `<h2>Calendar</h2><p class="sub">Classes repeat weekly during lecture weeks; holidays and breaks come from the <a href="#/academic">academic calendar</a>; deadlines from your assignments and the bulletin.</p>
  <div class="row" style="align-items:center;margin-bottom:10px"><button class="ghost" id="pv">&lt;</button><b style="flex:2;text-align:center">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button class="ghost" id="nx">&gt;</button><button class="ghost" id="td">Today</button></div>
  ${KIND_LEGEND}
  <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="h">${d}</div>`).join('')}${cells}</div>
  <div class="card" id="calday"></div>`;
  const go = (n) => () => { calMonth = n === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(y, mo + n, 1); render(); };
  // full details for one day under the grid (the cells only show a short line per item)
  const showDay = (iso) => {
    const x = days[iso]; if (!x) return;
    m.querySelectorAll('.cal .d').forEach((el) => el.classList.toggle('sel', el.dataset.iso === iso));
    const st = x.info.st;
    document.getElementById('calday').innerHTML = `<h3>${x.d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
      ${st ? `<p class="mute">${esc(statusText(st))}</p>` : ''}
      ${x.info.hol.map((e) => `<p class="err">${esc(e.title)}</p>`).join('')}
      ${x.exams.map((e) => `<div class="cls exam"><div class="t">${esc(fmtTime(e.time) || 'Exam')}</div><div><b>EXAM · ${esc(e.code)}</b> ${esc(e.name || '')}<br><span class="mute">${esc(e.venue || 'Venue not on slip')}</span></div></div>`).join('')}
      ${x.cls.length ? x.cls.map(clsHtml).join('') : '<p class="mute">No classes.</p>'}
      ${x.due.length ? `<h4>Due</h4>${x.due.map((t) => `<div class="post">${esc(t)}</div>`).join('')}` : ''}`;
  };
  m.querySelector('.cal').onclick = (e) => { const c = e.target.closest('.d[data-iso]'); if (c) showDay(c.dataset.iso); };
  showDay(days[localISO()] ? localISO() : localISO(new Date(y, mo, 1)));
  document.getElementById('pv').onclick = go(-1); document.getElementById('nx').onclick = go(1); document.getElementById('td').onclick = go(0);
}

/* ---------------- academic calendar page ---------------- */
async function pgAcademic(m) {
  const ac = await getAcademic();
  const t = localISO();
  const st = ac.periods.length ? academicStatus(ac.periods, t) : null;
  const sems = [...new Set(ac.periods.map((p) => p.semester))];
  const weeksOf = (p) => Math.round((Date.parse(p.end_date) - Date.parse(p.start_date)) / 864e5 + 1) / 7;
  m.innerHTML = `<h2>Academic Calendar</h2><p class="sub">Semester dates, breaks and public holidays from the university's academic calendar.</p>
  ${!ac.periods.length && !ac.events.length ? `<div class="card">The academic calendar has not been uploaded yet. ${me?.role === 'admin' ? '<a href="#/admin">Upload it in Admin</a>.' : 'Please check back after the admin uploads it.'}</div>` : ''}
  ${st ? `<div class="card now"><b>Now:</b> ${esc(statusText(st))}</div>` : ''}
  ${sems.map((sem) => `<div class="card"><h3>${esc(sem)}</h3><table><tr><th>Period</th><th>From</th><th>To</th><th>Weeks</th></tr>
    ${ac.periods.filter((p) => p.semester === sem).map((p) => `<tr class="${p.start_date <= t && t <= p.end_date ? 'cur' : p.end_date < t ? 'past' : ''}"><td>${esc(p.label)}</td><td>${esc(fmtDate(p.start_date))}</td><td>${esc(fmtDate(p.end_date))}</td><td>${weeksOf(p)}</td></tr>`).join('')}</table></div>`).join('')}
  ${ac.events.length ? `<div class="card"><h3>Holidays and events</h3><table><tr><th>Date</th><th>What</th><th></th></tr>
    ${ac.events.map((e) => `<tr class="${e.end_date < t ? 'past' : ''}"><td>${esc(fmtDate(e.start_date))}${e.end_date !== e.start_date ? ' - ' + esc(fmtDate(e.end_date)) : ''}</td><td>${esc(e.title)}</td><td>${e.no_class ? '<span class="tag urgent">no classes</span>' : ''}</td></tr>`).join('')}</table></div>` : ''}
  <p class="mute">The university's calendar is subject to change.</p>`;
}

/* ---------------- profile ---------------- */
async function pgProfile(m) {
  m.innerHTML = `<h2>Profile</h2><p class="sub">Student ID: <b>${esc(me.student_id)}</b></p>
  <form class="card" id="f">${profileFields(me, 'email')}
  <div id="m1"></div><p><button>Save</button></p></form>
  <form class="card" id="pw"><h3>Change password</h3><label>New password (min 8)</label><input type="password" name="next" minlength="8" required autocomplete="new-password"><div id="m2"></div><p><button>Change</button></p></form>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    try { me = await q(sb.from('profiles').update(fd(e.target)).eq('id', me.id).select().single()); flash(document.getElementById('m1'), 'Saved', 1); }
    catch (er) { flash(document.getElementById('m1'), er.message); }
  };
  document.getElementById('pw').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: fd(e.target).next });
    if (error) flash(document.getElementById('m2'), error.message); else { e.target.reset(); flash(document.getElementById('m2'), 'Password changed', 1); }
  };
}

/* ---------------- admin ---------------- */
// Parse the whole timetable page (every group) and load it in batches.
async function loadTimetableHtml(html, progress = () => {}) {
  progress('Reading the timetable page...');
  await new Promise((r) => setTimeout(r, 30));
  const result = parseTimetableDoc(new DOMParser().parseFromString(html, 'text/html'));
  if (!result.classes.length) throw new Error(`No classes found (${result.tablesScanned} table(s) scanned). The page layout may have changed.`);
  const B = 1500;
  let n = 0;
  for (let i = 0; i < result.classes.length; i += B) {
    progress(`Saving classes ${i + 1}-${Math.min(i + B, result.classes.length)} of ${result.classes.length}...`);
    try { n += await q(sb.rpc('admin_replace_classes', { items: result.classes.slice(i, i + B), replace: i === 0 })); }
    catch (er) { throw new Error(`Saving stopped after ${n} of ${result.classes.length} classes (${er.message}). The timetable is incomplete; please run it again.`); }
  }
  const groups = new Set(result.classes.map((c) => c.section)).size;
  return `Loaded ${n} classes for ${groups} groups. Students now pick their group on the Timetable page.`;
}
async function pgAdmin(m) {
  const sub = location.hash.split('/');
  if (sub[2] === 'user' && sub[3]) return pgAdminUser(m, sub[3]);
  const [s, users, acNow, count] = await Promise.all([getSettings(), q(sb.rpc('admin_users')), getAcademic(), sb.from('classes').select('id', { count: 'exact', head: true }).then((r) => r.count || 0)]);
  m.innerHTML = `<h2>Admin</h2><p class="sub">Manage the timetable source and users.</p>
  <div class="card"><h3>Timetable link</h3><p class="mute">Paste the university timetable page link, then sync. Every group on the page is loaded; each student picks their own group (and can mix and match) on the Timetable page. When a new semester's timetable comes out, paste the new link and sync again.</p>
  <form id="tl"><input name="timetable_url" type="url" value="${esc(s.timetable_url)}" required><div class="row" style="margin-top:8px"><button>Save link</button><button type="button" class="ghost" id="sync">Save &amp; sync now</button></div></form>
  <p class="mute">${count} class entries loaded${s.timetable_synced_at ? ' · last sync ' + esc(new Date(s.timetable_synced_at).toLocaleString()) : ''}</p>
  <form id="upl"><label>Or upload the saved timetable page (.html) if sync fails</label><div class="row"><input type="file" name="html" accept=".html,.htm,text/html" required><button class="ghost">Upload &amp; parse</button></div></form><div id="tm"></div></div>
  <div class="card"><h3>Academic calendar</h3>
  <p class="mute">Upload the university's academic calendar PDF (Kalendar Akademik). It sets the lecture weeks, breaks and public holidays used by
  the Calendar page and by students' Google / Apple Calendar exports. Upload the new one each academic year.</p>
  <p>${acNow.periods.length ? `Loaded: ${[...new Set(acNow.periods.map((p) => p.semester))].map(esc).join(', ')} · ${acNow.events.length} holidays/events` : '<span class="mute">Nothing uploaded yet.</span>'}</p>
  ${acNow.periods.length ? `<div class="row"><div><label>Semester used for timetable exports</label><select id="tsem">
    <option value="">Automatic (the current or next semester${acNow.window.sem_label ? ': ' + esc(acNow.window.sem_label) : ''})</option>
    ${[...new Set(acNow.periods.map((p) => p.semester))].map((x) => `<option ${s.teaching_semester === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div></div>` : ''}
  <form id="acu"><label>Academic calendar PDF</label><div class="row"><input type="file" name="pdf" accept="application/pdf" required><button class="ghost">Read PDF</button></div></form>
  <div id="acm"></div><div id="acp"></div></div>
  <form class="card" id="sem"><h3>Manual semester dates</h3><p class="mute">Only used when no academic calendar is uploaded: classes repeat weekly between these dates and skip the break.</p>
  <div class="row"><div><label>Semester start</label><input type="date" name="semester_start" value="${esc(s.semester_start)}"></div><div><label>Semester end</label><input type="date" name="semester_end" value="${esc(s.semester_end)}"></div></div>
  <div class="row"><div><label>Mid-semester break start <span class="mute">(optional)</span></label><input type="date" name="break_start" value="${esc(s.break_start)}"></div><div><label>Break end <span class="mute">(optional)</span></label><input type="date" name="break_end" value="${esc(s.break_end)}"></div></div>
  <div id="semm"></div><p><button>Save dates</button></p></form>
  <div class="card"><h3>Users (${users.length})</h3>${filterBar('Search ID, name, email, phone, programme', qSelect('rl', [['', 'All roles'], ['student', 'Students'], ['admin', 'Admins']]))}<table class="users-tbl"><tr><th>ID</th><th>Name</th><th>Programme</th><th>Courses</th><th>Role</th><th></th></tr>
  ${users.map((u) => `<tr class="qi" data-rl="${esc(u.role)}"><td class="u-id">${esc(u.student_id)}</td><td class="u-name"><b class="u-nm">${esc(u.name)}</b><br><span class="mute">${esc(u.email || '')} ${esc(u.phone || '')}</span></td><td data-l="Programme">${esc(u.program || '')}</td><td data-l="Courses">${u.courses}</td><td data-l="Role">${esc(u.role)}</td><td class="u-acts"><div class="acts"><a class="btn sm" href="#/admin/user/${u.id}">View</a>${u.id === me.id ? '' : `<button class="sm ghost" data-role="${u.id}" data-r="${u.role === 'admin' ? 'student' : 'admin'}">Make ${u.role === 'admin' ? 'student' : 'admin'}</button><button class="sm ghost" data-pw="${u.id}">Reset password</button><button class="sm danger" data-del="${u.id}">Delete</button>`}</div></td></tr>`).join('')}</table></div>`;
  const tm = document.getElementById('tm');
  const saveLink = async () => {
    const url = document.querySelector('#tl [name=timetable_url]').value.trim();
    await q(sb.from('settings').upsert({ key: 'timetable_url', value: url }));
    return url;
  };
  document.getElementById('tl').onsubmit = async (e) => { e.preventDefault(); try { await saveLink(); flash(tm, 'Link saved', 1); } catch (er) { flash(tm, er.message); } };
  document.getElementById('sync').onclick = async () => {
    try {
      await saveLink();
      tm.innerHTML = '<span class="mute">Fetching timetable page...</span>';
      const { data, error } = await sb.functions.invoke('fetch-timetable');
      if (error) {
        let detail = error.message;
        try { detail = (await error.context.json()).error || detail; } catch {}
        throw new Error(`Could not fetch the page: ${detail}. Use "Upload & parse" instead.`);
      }
      flash(tm, await loadTimetableHtml(data.html, (t) => (tm.innerHTML = `<span class="mute">${esc(t)}</span>`)), 1);
    } catch (er) { flash(tm, er.message); }
  };
  document.getElementById('upl').onsubmit = async (e) => {
    e.preventDefault();
    try { flash(tm, await loadTimetableHtml(await e.target.html.files[0].text(), (t) => (tm.innerHTML = `<span class="mute">${esc(t)}</span>`)), 1); } catch (er) { flash(tm, er.message); }
  };
  const tsem = document.getElementById('tsem');
  if (tsem) tsem.onchange = async () => { await q(sb.from('settings').upsert({ key: 'teaching_semester', value: tsem.value })); render(); };
  document.getElementById('acu').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('acm'), pv = document.getElementById('acp');
    msg.innerHTML = '<span class="mute">Reading...</span>';
    try {
      const r = parseAcademicCalendarLines(await pdfToLines(e.target.pdf.files[0]));
      if (!r.periods.length) throw new Error('No semester weeks found. Is this the UniMAP academic calendar (Kalendar Akademik)?');
      msg.innerHTML = r.warnings.map((w) => `<div class="err">${esc(w)}</div>`).join('');
      pv.innerHTML = `<h4>Found: session ${esc(r.session)}</h4><table><tr><th>Semester</th><th>Period</th><th>From</th><th>To</th><th>Weeks</th></tr>
        ${r.periods.map((p) => `<tr><td>${esc(p.semester)}</td><td>${esc(p.label)}</td><td>${esc(fmtDate(p.start))}</td><td>${esc(fmtDate(p.end))}</td><td>${p.weeks}</td></tr>`).join('')}</table>
        <h4>Holidays and events</h4><p class="mute">Tick "No classes" for days when classes don't run (public holidays). Untick for info-only items.</p>
        <table><tr><th>No classes</th><th>Date</th><th>What</th></tr>${r.events.map((ev, i) => `<tr><td><input type="checkbox" style="width:auto" data-ev="${i}" ${ev.no_class ? 'checked' : ''}></td><td>${esc(fmtDate(ev.start))}${ev.end !== ev.start ? ' - ' + esc(fmtDate(ev.end)) : ''}</td><td>${esc(ev.title)}</td></tr>`).join('')}</table>
        <p class="mute">The short / additional semester is not imported.</p>
        <p><button id="acs">Save academic calendar (replaces the current one)</button></p>`;
      document.getElementById('acs').onclick = async () => {
        pv.querySelectorAll('[data-ev]').forEach((c) => (r.events[c.dataset.ev].no_class = c.checked));
        try { await q(sb.rpc('admin_save_academic_calendar', { periods: r.periods, events: r.events })); render(); }
        catch (er) { flash(msg, er.message); }
      };
    } catch (er) { flash(msg, er.message); }
  };
  document.getElementById('sem').onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (d.semester_start && d.semester_end && d.semester_end < d.semester_start) return flash(document.getElementById('semm'), 'End must be after start');
    if (!!d.break_start !== !!d.break_end || d.break_end < d.break_start) return flash(document.getElementById('semm'), 'Give both break dates, end after start');
    try { await q(sb.from('settings').upsert(Object.entries(d).map(([key, value]) => ({ key, value })))); flash(document.getElementById('semm'), 'Saved', 1); }
    catch (er) { flash(document.getElementById('semm'), er.message); }
  };
  wireUserActions(m);
}
function wireUserActions(m, after = render) {
  m.querySelectorAll('[data-role]').forEach((b) => (b.onclick = async () => { await q(sb.rpc('admin_set_role', { target: b.dataset.role, new_role: b.dataset.r })); after(); }));
  m.querySelectorAll('[data-pw]').forEach((b) => (b.onclick = async () => {
    const p = prompt('New password (min 8 characters):');
    if (p) { try { await q(sb.rpc('admin_reset_password', { target: b.dataset.pw, new_password: p })); alert('Password reset'); } catch (e) { alert(e.message); } }
  }));
  m.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (confirm('Delete this user and all their data? This cannot be undone.')) { await q(sb.rpc('admin_delete_user', { target: b.dataset.del })); location.hash = '#/admin'; render(); }
  }));
}

const userButtons = (u) => u.id === me.id ? '<span class="mute">(this is you)</span>' :
  `<button class="ghost" data-role="${u.id}" data-r="${u.role === 'admin' ? 'student' : 'admin'}">Make ${u.role === 'admin' ? 'student' : 'admin'}</button>
   <button class="ghost" data-pw="${u.id}">Reset password</button> <button class="danger" data-del="${u.id}">Delete account</button>`;
async function pgAdminUser(m, uid) {
  const u = await q(sb.from('profiles').select('*').eq('id', uid).maybeSingle());
  if (!u) { m.innerHTML = '<p><a href="#/admin">&larr; Back to users</a></p><div class="card">User not found.</div>'; return; }
  const [cs, tt] = await Promise.all([myCourses(uid), getTimetable(uid, u)]);
  m.innerHTML = `<p><a href="#/admin">&larr; Back to users</a></p><h2>${esc(u.name)}</h2>
  <p class="sub">Student ID <b>${esc(u.student_id)}</b> · ${esc(u.role)} · joined ${esc(new Date(u.created_at).toLocaleDateString())}</p>
  <div class="card"><h3>Account</h3><div class="row" style="gap:8px">${userButtons(u)}</div></div>
  <form class="card" id="ef"><h3>Edit details</h3><p class="mute">The student ID is the login name and can't be changed.</p>${profileFields(u, 'email')}<label>Main timetable group <span class="mute">(optional, e.g. UR6523002 - Y3G1)</span></label><input name="subgroup" value="${esc(u.subgroup)}" maxlength="80"><div id="em"></div><p><button>Save changes</button></p></form>
  <div class="card"><h3>Registered subjects (${cs.reduce((a, c) => a + (c.credit || 0), 0)} credits)</h3>
  ${cs.length ? `<table><tr><th>Code</th><th>Name</th><th>Credit</th><th>Group</th><th>Section</th></tr>${cs.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${c.credit ?? ''}</td><td>${esc(c.grp || '')}</td><td>${esc(c.section || '')}</td></tr>`).join('')}</table>` : '<p class="mute">None.</p>'}</div>
  <h3>Timetable</h3>${timetableHtml(tt)}`;
  wireUserActions(m, () => pgAdminUser(m, uid));
  document.getElementById('ef').onsubmit = async (e) => {
    e.preventDefault();
    try { await q(sb.rpc('admin_update_profile', { target: uid, data: fd(e.target) })); flash(document.getElementById('em'), 'Saved', 1); }
    catch (er) { flash(document.getElementById('em'), er.message); }
  };
}

boot();
