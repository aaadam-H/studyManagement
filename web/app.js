import { parseSlipLines, parseTimetableDoc, prettyGroup, parseAcademicCalendarLines, academicStatus } from './parsers.js';

const CFG = window.STUDYHUB_CONFIG || {};
const $app = document.getElementById('app');
const DAYN = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// form -> object, empty strings become null (dates/numbers in Postgres reject '')
const fd = (form) => Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, v === '' ? null : v]));
const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const flash = (el, msg, ok) => { el.innerHTML = `<div class="${ok ? 'ok' : 'err'}">${esc(msg)}</div>`; };
const FOOTER = `<footer>For further assistance / inquiry, WhatsApp me <a href="https://wa.me/60194145201" target="_blank" rel="noopener">@aaadam_h / 019-4145201</a><br><span class="mute">StudyHub © ${new Date().getFullYear()}</span></footer>`;
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
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
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
  return { posts: posts.map((p) => ({ ...p, course_name: names[p.course_code] })), allCourses: all, mine: mine.map((c) => c.code) };
}

/* ---------------- profile fields (register, profile, admin edit) ---------------- */
// Required: name, email, phone, programme. Optional: faculty, year, semester.
function profileFields(u, emailName = 'contact_email') {
  const R = '<span class="req">*</span>', O = '<span class="mute">(optional)</span>';
  return `<label>Full name ${R}</label><input name="name" value="${esc(u.name)}" required maxlength="120">
  <div class="row"><div><label>Email ${R}</label><input name="${emailName}" type="email" value="${esc(u.email)}" required maxlength="120"></div>
  <div><label>Phone ${R}</label><input name="phone" type="tel" value="${esc(u.phone)}" required pattern="[0-9+ \\-]{9,15}" title="e.g. 012-3456789" maxlength="20"></div></div>
  <label>Programme ${R}</label><input name="program" value="${esc(u.program)}" required placeholder="e.g. Kejuruteraan Komputer" maxlength="120">
  <div class="row"><div><label>Faculty / school ${O}</label><input name="faculty" value="${esc(u.faculty)}" maxlength="120"></div>
  <div><label>Year ${O}</label><input name="year" type="number" min="1" max="6" value="${esc(u.year)}"></div>
  <div><label>Semester ${O}</label><input name="semester" value="${esc(u.semester)}" placeholder="e.g. Sem 1 2026/2027" maxlength="40"></div></div>`;
}

/* ---------------- auth screens ---------------- */
function authScreen(mode = 'login') {
  const reg = mode === 'register';
  $app.innerHTML = `<div class="auth"><h1>StudyHub</h1><p class="sub">${reg ? 'Create your student account' : 'Log in to your study planner'}</p>
  <form class="card" id="f">
    <label>Student ID (matric no.) <span class="req">*</span></label><input name="student_id" required pattern="[A-Za-z0-9._-]{3,30}" autocomplete="username">
    ${reg ? profileFields({}) : ''}
    <label>Password ${reg ? '<span class="req">*</span> (min 8 characters)' : ''}</label><input name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}">
    <div id="msg"></div><p><button>${reg ? 'Register' : 'Log in'}</button></p>
    <p class="mute">${reg ? 'Have an account? <a href="#" id="sw">Log in</a>' : 'New here? <a href="#" id="sw">Register</a>'}</p>
  </form>
  ${reg ? '' : `<div class="card intro"><b>What you can do with StudyHub</b><ul>
    <li>Upload your course registration slip and get your weekly timetable automatically</li>
    <li>Mix and match groups, and add your own classes</li>
    <li>Put your timetable in Google Calendar or Apple Calendar, skipping breaks and public holidays</li>
    <li>Follow a shared bulletin for assignments and notices, grouped by subject</li>
    <li>Track your assignments, grades and notes; see the academic calendar and current lecture week</li></ul>
    <p class="mute">New here? <a href="#" id="sw2">Create an account</a>; a short setup guide walks you through the rest.</p></div>`}
  ${FOOTER}</div>`;
  const sw2 = document.getElementById('sw2');
  if (sw2) sw2.onclick = (e) => { e.preventDefault(); authScreen('register'); };
  document.getElementById('sw').onclick = (e) => { e.preventDefault(); authScreen(reg ? 'login' : 'register'); };
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('msg');
    const { student_id, password, ...info } = fd(e.target);
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
  '': ['Dashboard', pgDashboard], timetable: ['Timetable', pgTimetable], bulletin: ['Bulletin', pgBulletin], courses: ['My Courses', pgCourses],
  assignments: ['Assignments', pgAssignments], calendar: ['Calendar', pgCalendar], academic: ['Academic Calendar', pgAcademic], grades: ['Grades', pgGrades], notes: ['Notes', pgNotes], profile: ['Profile', pgProfile], help: ['Help', pgHelp],
};
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  me = session ? await q(sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle()) : null;
  if (!me) return authScreen();
  render();
}
async function render() {
  if (!me) return authScreen();
  let key = location.hash.replace(/^#\/?/, '').split('/')[0] || '';
  // first visit: send new students through the setup guide (they can still open Help)
  if (needsOnboarding() && key !== 'welcome' && key !== 'help') { history.replaceState(null, '', '#/welcome'); key = 'welcome'; }
  const routes = { ...ROUTES, ...(me.role === 'admin' ? { admin: ['Admin', pgAdmin] } : {}) };
  const [, fn] = key === 'welcome' ? [null, pgWelcome] : routes[key] || routes[''];
  $app.innerHTML = `<div class="shell"><nav><h1>StudyHub</h1><small>Personal Management</small>
    ${Object.entries(routes).map(([k, [t]]) => `<a href="#/${k}" class="${k === key ? 'on' : ''}">${t}</a>`).join('')}
    <div class="who">${esc(me.name)}<br>${esc(me.student_id)}${me.role === 'admin' ? ' (admin)' : ''}<br><a href="#" id="lo">Log out</a></div></nav><div class="content"><main id="main">Loading...</main>${FOOTER}</div></div>`;
  document.getElementById('lo').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); me = null; authScreen(); };
  try { await fn(document.getElementById('main')); }
  catch (e) { document.getElementById('main').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', render);
sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { me = null; authScreen(); } });

/* ---------------- dashboard ---------------- */
const clsHtml = (c) => `<div class="cls${c.custom ? ' own' : ''}"><div class="t">${esc(c.start)} - ${esc(c.end)}</div><div><b>${esc(c.course_code)}</b> ${esc(c.course_name || '')}<br><span class="mute">${[c.kind, c.venue, c.lecturer, c.custom ? c.section : prettyGroup(c.section)].filter(Boolean).map(esc).join(' · ')}</span></div></div>`;
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
  m.innerHTML = `<h2>Dashboard</h2><p class="sub">${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}${today.st ? ` · <a href="#/academic">${esc(statusText(today.st))}</a>` : ''}</p>
  ${today.hol.length ? `<div class="card hol">${today.hol.map((e) => esc(e.title)).join(', ')}${today.classes ? '' : ' · no classes today'}</div>` : ''}
  ${checklist}
  <div class="grid"><div class="card stat"><b>${pending.length}</b><span>Pending assignments</span></div><div class="card stat"><b style="color:var(--bad)">${overdue.length}</b><span>Overdue</span></div><div class="card stat"><b>${todays.length}</b><span>Classes today</span></div></div>
  <div class="card"><h3>Today's classes</h3>${todays.length ? todays.map(clsHtml).join('') : `<p class="mute">No classes today${today.st && today.st.kind !== 'lecture' ? ` (${esc(today.st.label.toLowerCase())})` : ''}.</p>`}
  ${nextHol ? `<p class="mute">Next holiday: ${esc(nextHol.title)}, ${esc(fmtDate(nextHol.start_date))}</p>` : ''}</div>
  <div class="card"><h3>Upcoming deadlines from the bulletin</h3>${upcoming.length ? upcoming.map((p) => `<div class="post"><b>${esc(p.due_date)}</b> <span class="tag ${esc(p.kind)}">${esc(p.course_code || 'General')}</span> ${esc(p.title)}</div>`).join('') : '<p class="mute">Nothing due. <a href="#/bulletin">Open bulletin</a></p>'}</div>
  <div class="card"><h3>My pending assignments</h3>${pending.slice(0, 6).map((a) => `<div class="post"><b>${esc(a.title)}</b> <span class="mute">${esc(a.course_code || '')} ${esc(a.due_date || '')}</span></div>`).join('') || '<p class="mute">All clear.</p>'}</div>
`;
  const gsx = document.getElementById('gsx');
  if (gsx) gsx.onclick = (e) => { e.preventDefault(); store.set('sh_gs_hide_' + me.id, '1'); render(); };
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
    ['I forgot my password', 'Ask an admin to reset it (WhatsApp below), then change it in <b>Profile</b>.'],
    ['What do "Lecture week" and the holidays come from?', 'The university\'s academic calendar, uploaded by the admin. See <b>Academic Calendar</b>.'],
  ];
  m.innerHTML = `<h2>Help</h2><p class="sub">How to use StudyHub.</p>
  <div class="card"><h3>What StudyHub does</h3><div class="feat">${FEATURES.map(([t, d]) => `<div><b>${t}</b><p class="mute">${d}</p></div>`).join('')}</div>
    <p><button type="button" id="rg">Run the setup guide again</button></p></div>
  <div class="card"><h3>Questions</h3>${qa.map(([qq, a]) => `<details class="qa"><summary>${qq}</summary><p>${a}</p></details>`).join('')}</div>
  ${me.role === 'admin' ? `<div class="card"><h3>For admins</h3><ul>
    <li><b>Each academic year:</b> Admin, Academic calendar, upload the new Kalendar Akademik PDF.</li>
    <li><b>Each semester:</b> Admin, paste the new timetable link, Save &amp; sync now (or upload the saved page).</li>
    <li><b>Users:</b> Admin, View, to see a student's subjects and timetable, edit details, reset a password or delete an account.</li>
    <li>The full setup guide is SETUP.md in the GitHub repository.</li></ul></div>` : ''}
  <div class="card"><h3>Still stuck?</h3><p>WhatsApp <a href="https://wa.me/60194145201" target="_blank" rel="noopener">@aaadam_h / 019-4145201</a>.</p></div>`;
  document.getElementById('rg').onclick = () => { wStep = 0; location.hash = '#/welcome'; };
}

/* ---------------- timetable ---------------- */
const groupLabel = (g) => `${prettyGroup(g)} (${g})`;
function weekHtml(tt) {
  let html = '';
  for (let d = 1; d <= 7; d++) {
    const cs = tt.classes.filter((c) => c.day === d);
    if (cs.length) html += `<div class="card day"><h3>${DAYN[d]}</h3>${cs.map(clsHtml).join('')}</div>`;
  }
  return html || '<div class="card mute">No classes to show yet.</div>';
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
async function pgBulletin(m) {
  const b = await getBulletin();
  let filter = 'mine';
  try { filter = sessionStorage.getItem('bfilter') || 'mine'; } catch {}
  const list = b.posts.filter((p) => filter === 'all' || !p.course_code || b.mine.includes(p.course_code));
  const groups = {};
  for (const p of list) (groups[p.course_code || ''] ||= []).push(p);
  const postable = me.role === 'admin' ? b.allCourses : b.allCourses.filter((c) => b.mine.includes(c.code));
  m.innerHTML = `<h2>Bulletin</h2><p class="sub">Shared board for assignments and important notices, grouped by subject.</p>
  <div class="card"><form id="np"><div class="row"><div><label>Subject</label><select name="course_code" ${me.role === 'admin' ? '' : 'required'}>${me.role === 'admin' ? '<option value="">General (all students)</option>' : '<option value="" disabled selected>Choose subject</option>'}${postable.map((c) => `<option value="${esc(c.code)}">${esc(c.code)} - ${esc(c.name || '')}</option>`).join('')}</select></div>
  <div><label>Type</label><select name="kind"><option value="info">Info</option><option value="assignment">Assignment</option><option value="exam">Exam / test</option><option value="urgent">Urgent</option></select></div>
  <div><label>Due date (optional)</label><input type="date" name="due_date"></div></div>
  <label>Title</label><input name="title" required maxlength="200"><label>Details</label><textarea name="body" rows="3" maxlength="4000"></textarea><div id="pmsg"></div><p><button>Post</button></p></form>
  ${postable.length || me.role === 'admin' ? '' : '<p class="mute">Register your courses to post to their boards.</p>'}</div>
  <p><label style="display:inline">Show </label><select id="bf" style="width:auto"><option value="mine" ${filter === 'mine' ? 'selected' : ''}>My subjects</option><option value="all" ${filter === 'all' ? 'selected' : ''}>All subjects</option></select></p>
  ${Object.keys(groups).sort().map((code) => `<div class="card"><h3>${code ? esc(code) + ' <span class="mute">' + esc(groups[code][0].course_name || '') + '</span>' : 'General'}</h3>
  ${groups[code].map((p) => `<div class="post"><h4><span class="tag ${esc(p.kind)}">${esc(p.kind)}</span> ${esc(p.title)} ${p.due_date ? `<span class="tag">due ${esc(p.due_date)}</span>` : ''}</h4>${p.body ? `<p>${esc(p.body)}</p>` : ''}
  <span class="mute">${esc(p.author_name)} (${esc(p.author_sid)}) · ${esc(new Date(p.created_at).toLocaleString())}</span> ${p.user_id === me.id || me.role === 'admin' ? `<button class="sm ghost" data-del="${p.id}">Delete</button>` : ''}</div>`).join('')}</div>`).join('') || '<div class="card mute">No posts yet.</div>'}`;
  document.getElementById('bf').onchange = (e) => { try { sessionStorage.setItem('bfilter', e.target.value); } catch {} render(); };
  m.querySelectorAll('[data-del]').forEach((x) => (x.onclick = async () => { if (confirm('Delete this post?')) { await q(sb.from('posts').delete().eq('id', x.dataset.del)); render(); } }));
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
  <div class="card">${list.map((a) => `<div class="post"><label style="display:flex;gap:8px;align-items:center;margin:0;color:var(--ink)"><input type="checkbox" style="width:auto" data-done="${a.id}" ${a.done ? 'checked' : ''}> <span style="${a.done ? 'text-decoration:line-through;opacity:.6' : ''}"><b>${esc(a.title)}</b> <span class="mute">${esc(a.course_code || '')} ${a.due_date ? 'due ' + esc(a.due_date) : ''}</span></span></label> <button class="sm ghost" data-del="${a.id}">Delete</button></div>`).join('') || '<p class="mute">No assignments yet.</p>'}</div>`;
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
  ${Object.entries(byCourse).map(([code, gs]) => {
    const w = gs.filter((g) => g.weight && pct(g) != null);
    const tot = w.reduce((a, g) => a + (pct(g) * g.weight) / 100, 0), tw = w.reduce((a, g) => a + Number(g.weight), 0);
    return `<div class="card"><h3>${esc(code)} ${tw ? `<span class="tag">${tot.toFixed(1)} / ${tw} weighted marks</span>` : ''}</h3><table><tr><th>Item</th><th>Score</th><th>%</th><th>Weight</th><th></th></tr>${gs.map((g) => `<tr><td>${esc(g.item)}</td><td>${g.score ?? ''}${g.max_score ? ' / ' + g.max_score : ''}</td><td>${pct(g) == null ? '' : pct(g).toFixed(1)}</td><td>${g.weight ?? ''}</td><td><button class="sm ghost" data-del="${g.id}">Delete</button></td></tr>`).join('')}</table></div>`;
  }).join('') || '<div class="card mute">No grades recorded yet.</div>'}`;
  document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); await q(sb.from('grades').insert(fd(e.target))); render(); };
  m.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await q(sb.from('grades').delete().eq('id', b.dataset.del)); render(); }));
}
async function pgNotes(m) {
  const [list, cs] = await Promise.all([q(sb.from('notes').select('*').order('id', { ascending: false })), myCourses()]);
  m.innerHTML = `<h2>Notes</h2><p class="sub">Your private study notes.</p>
  <div class="card"><form id="f"><div class="row"><div><label>Title</label><input name="title" required></div><div><label>Subject</label><select name="course_code">${courseOptions(cs)}</select></div></div><label>Note</label><textarea name="body" rows="4"></textarea><p><button>Save note</button></p></form></div>
  ${list.map((n) => `<div class="card"><h3>${esc(n.title)} <span class="tag">${esc(n.course_code || '')}</span></h3><p style="white-space:pre-wrap">${esc(n.body)}</p><button class="sm ghost" data-del="${n.id}">Delete</button></div>`).join('') || '<div class="card mute">No notes yet.</div>'}`;
  document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); await q(sb.from('notes').insert(fd(e.target))); render(); };
  m.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await q(sb.from('notes').delete().eq('id', b.dataset.del)); render(); }));
}

/* ---------------- calendar ---------------- */
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
async function pgCalendar(m) {
  const [tt, asg, bul, ac] = await Promise.all([getTimetable(), q(sb.from('assignments').select('*')), getBulletin(), getAcademic()]);
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - first.getDay());
  const due = {};
  for (const a of asg) if (a.due_date && !a.done) (due[a.due_date] ||= []).push('📝 ' + a.title);
  for (const p of bul.posts) if (p.due_date && (!p.course_code || bul.mine.includes(p.course_code))) (due[p.due_date] ||= []).push(`📌 ${p.course_code || ''} ${p.title}`);
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const info = ac.day(localISO(d));
    const cls = info.classes ? tt.classes.filter((c) => c.day === (d.getDay() || 7)) : [];
    const tag = info.st && info.st.kind !== 'lecture' ? `<div class="e per" title="${esc(info.st.semester)}">${esc(info.st.label)}</div>` : '';
    cells += `<div class="d ${d.getMonth() !== mo ? 'off' : ''} ${localISO(d) === localISO() ? 'today' : ''} ${info.st && info.st.kind !== 'lecture' ? 'brk' : ''}"><b>${d.getDate()}</b>${info.hol.map((e) => `<div class="e holi" title="${esc(e.title)}">${esc(e.title)}</div>`).join('')}${tag}${cls.map((c) => `<div class="e" title="${esc(c.start)}-${esc(c.end)} ${esc(c.course_code)} ${esc(c.course_name || '')} ${esc(c.venue || '')}"><b>${esc(c.start)}</b> ${esc(c.course_name || c.course_code)}${c.course_name ? ` <span class="mute">${esc(c.course_code)}</span>` : ''}</div>`).join('')}${(due[localISO(d)] || []).map((t) => `<div class="e" style="color:var(--warn)" title="${esc(t)}">${esc(t)}</div>`).join('')}</div>`;
  }
  m.innerHTML = `<h2>Calendar</h2><p class="sub">Classes repeat weekly during lecture weeks; holidays and breaks come from the <a href="#/academic">academic calendar</a>; deadlines from your assignments and the bulletin.</p>
  <div class="row" style="align-items:center;margin-bottom:10px"><button class="ghost" id="pv">&lt;</button><b style="flex:2;text-align:center">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button class="ghost" id="nx">&gt;</button><button class="ghost" id="td">Today</button></div>
  <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="h">${d}</div>`).join('')}${cells}</div>`;
  const go = (n) => () => { calMonth = n === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(y, mo + n, 1); render(); };
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
  ${!ac.periods.length && !ac.events.length ? `<div class="card">The academic calendar has not been uploaded yet. ${me.role === 'admin' ? '<a href="#/admin">Upload it in Admin</a>.' : 'Ask an admin to upload it.'}</div>` : ''}
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
  <div class="card"><h3>Users (${users.length})</h3><table><tr><th>ID</th><th>Name</th><th>Programme</th><th>Courses</th><th>Role</th><th></th></tr>
  ${users.map((u) => `<tr><td>${esc(u.student_id)}</td><td>${esc(u.name)}<br><span class="mute">${esc(u.email || '')} ${esc(u.phone || '')}</span></td><td>${esc(u.program || '')}</td><td>${u.courses}</td><td>${esc(u.role)}</td><td><a class="btn sm" href="#/admin/user/${u.id}">View</a> ${u.id === me.id ? '' : `<button class="sm ghost" data-role="${u.id}" data-r="${u.role === 'admin' ? 'student' : 'admin'}">Make ${u.role === 'admin' ? 'student' : 'admin'}</button> <button class="sm ghost" data-pw="${u.id}">Reset pw</button> <button class="sm danger" data-del="${u.id}">Delete</button>`}</td></tr>`).join('')}</table></div>`;
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
