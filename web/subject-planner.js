import DOMPurify from './vendor/purify.es.mjs';
import { groupScheduleText, loadGroupSchedules } from './group-schedules.js';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const days = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const storageKey = (userId) => `studyhub.subject-plan.v1.${userId}`;

export function readSubjectPlan(storage, userId) {
  try {
    const saved = JSON.parse(storage.getItem(storageKey(userId)) || '[]');
    if (!Array.isArray(saved)) return [];
    const unique = new Map();
    for (const item of saved) {
      if (/^[A-Z]{3}\d{5}$/.test(item?.code) && typeof item.section === 'string' && item.section.trim() && item.section.length <= 200) unique.set(item.code, { code: item.code, section: item.section });
    }
    return [...unique.values()];
  } catch { return []; }
}

export function searchSubjects(courses, query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return courses.filter((course) => words.every((word) => `${course.code} ${course.name || ''}`.toLowerCase().includes(word)));
}

export function plannedSlots(plan, schedules) {
  return plan.flatMap((item) => (schedules[item.code]?.[item.section] || []).map((slot) => ({ ...slot, code: item.code, section: item.section })))
    .sort((a, b) => a.day - b.day || a.start_time.localeCompare(b.start_time) || a.code.localeCompare(b.code));
}

export function planClashes(slots) {
  const clashes = new Set();
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = slots[i], b = slots[j];
    if (a.code !== b.code && a.day === b.day && a.start_time < b.end_time && b.start_time < a.end_time) { clashes.add(a.code); clashes.add(b.code); }
  }
  return clashes;
}

async function allRows(client, table, columns, order) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await client.from(table).select(columns).order(order).range(from, from + 499);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

export async function loadPlannerCatalog(client) {
  const [courses, classes] = await Promise.all([allRows(client, 'courses', 'code,name,credit', 'code'), allRows(client, 'classes', 'course_code', 'id')]);
  const names = new Map(courses.map((course) => [course.code, course]));
  return [...new Set(classes.map((row) => row.course_code))].sort().map((code) => names.get(code) || { code, name: 'Subject name unavailable' });
}

export function mountSubjectPlanner(root, { client, userId, registeredCodes = [], storage }) {
  if (!storage) { try { storage = window.localStorage; } catch {} }
  const setHtml = (node, html) => node.replaceChildren(DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true }));
  setHtml(root, `<h3>Pre-register subjects</h3><p class="mute">Explore subjects from the uploaded timetable and build a planned week before registering. Your draft is saved on this device for your account; it does not change your registered courses or register you with the university.</p><button type="button" data-open-planner>Browse subjects</button><div data-planner-body hidden></div><p data-planner-message role="status"></p>`);
  const message = root.querySelector('[data-planner-message]'), body = root.querySelector('[data-planner-body]'), open = root.querySelector('[data-open-planner]');
  let catalog = [], plan = readSubjectPlan(storage, userId), schedules = {}, selection = null, request = 0, loaded = false;
  const say = (text) => { message.textContent = text; };
  const getSchedules = async (code) => {
    if (!schedules[code]) Object.assign(schedules, await loadGroupSchedules(client, [code]));
    return schedules[code];
  };
  const persist = (next) => {
    try { storage.setItem(storageKey(userId), JSON.stringify(next)); plan = next; return true; }
    catch { say('Your draft could not be saved. Check that browser storage is available.'); return false; }
  };
  const drawPlan = () => {
    const slots = plannedSlots(plan, schedules), clashes = planClashes(slots);
    setHtml(body.querySelector('[data-planned-list]'), `<h4>Planned subjects (${plan.length})</h4>${plan.map((item) => {
      const course = catalog.find((course) => course.code === item.code);
      const groups = schedules[item.code] || {};
      return `<article class="course-item"><div class="course-head"><b>${escape(item.code)}</b><button type="button" class="sm ghost" data-remove-plan="${escape(item.code)}">Remove</button></div><h4>${escape(course?.name || 'Subject name unavailable')}</h4><label>Planned group<select data-plan-group="${escape(item.code)}" data-plain>${!groups[item.section] ? `<option value="${escape(item.section)}">${escape(item.section)} — no longer in timetable</option>` : ''}${Object.keys(groups).sort().map((group) => `<option value="${escape(group)}" ${group === item.section ? 'selected' : ''}>${escape(group)} — ${escape(groupScheduleText(groups[group]))}</option>`).join('')}</select></label><p>${escape(groupScheduleText(groups[item.section]))}</p>${clashes.has(item.code) ? '<p class="clash-note">Clashes with another planned subject. Try a different group.</p>' : ''}</article>`;
    }).join('') || '<p class="mute">Choose a subject and group below to start your plan.</p>'}`);
    setHtml(body.querySelector('[data-planned-week]'), `<h4>Your planned week</h4>${[1, 2, 3, 4, 5, 6, 7].filter((day) => slots.some((slot) => slot.day === day)).map((day) => `<div class="planner-day"><b>${days[day]}</b>${slots.filter((slot) => slot.day === day).map((slot) => `<p>${escape(slot.start_time.slice(0, 5))}–${escape(slot.end_time.slice(0, 5))} · ${escape(slot.code)} <span class="mute">${escape(catalog.find((course) => course.code === slot.code)?.name || '')}</span></p>`).join('')}</div>`).join('') || '<p class="mute">No planned classes yet.</p>'}`);
    body.querySelectorAll('[data-remove-plan]').forEach((button) => { button.onclick = () => { if (persist(plan.filter((item) => item.code !== button.dataset.removePlan))) { drawPlan(); say('Subject removed from your plan.'); } }; });
    body.querySelectorAll('[data-plan-group]').forEach((select) => { select.onchange = () => { if (persist(plan.map((item) => item.code === select.dataset.planGroup ? { ...item, section: select.value } : item))) { drawPlan(); say('Planned group updated.'); } }; });
  };
  const showSubject = async (code) => {
    const token = ++request;
    selection = code;
    const target = body.querySelector('[data-subject-groups]');
    target.textContent = 'Loading groups and class times…';
    try {
      const groups = await getSchedules(code);
      if (token !== request || !root.isConnected) return;
      const course = catalog.find((course) => course.code === code);
      setHtml(target, `<h4>${escape(code)} · ${escape(course?.name)}</h4><label>Choose a group<select data-selected-group data-plain><option value="">Choose a group</option>${Object.keys(groups).sort().map((group) => `<option value="${escape(group)}">${escape(group)} — ${escape(groupScheduleText(groups[group]))}</option>`).join('')}</select></label><p data-selected-schedule></p><button type="button" data-save-plan disabled>Add to plan</button>${!Object.keys(groups).length ? '<p class="mute">No group schedules are available for this subject.</p>' : ''}`);
      const select = target.querySelector('select'), save = target.querySelector('[data-save-plan]');
      select.onchange = () => { target.querySelector('[data-selected-schedule]').textContent = select.value ? groupScheduleText(groups[select.value]) : ''; save.disabled = !select.value; };
      save.onclick = () => {
        if (selection !== code || !groups[select.value]) return;
        if (persist([...plan.filter((item) => item.code !== code), { code, section: select.value }])) { drawPlan(); say(`${code} saved to your plan.`); }
      };
    } catch (error) { if (token === request) target.textContent = `Could not load groups: ${error.message}. Select the subject again to retry.`; }
  };
  const drawSearch = () => {
    const matches = searchSubjects(catalog, body.querySelector('[data-subject-search]').value);
    setHtml(body.querySelector('[data-subject-results]'), `${matches.slice(0, 30).map((course) => `<article class="planner-result"><div><b>${escape(course.code)}</b><p>${escape(course.name || 'Subject name unavailable')}${registeredCodes.includes(course.code) ? ' · Already registered' : ''}</p></div><button type="button" class="sm" data-view-subject="${escape(course.code)}">View groups</button></article>`).join('') || '<p class="mute">No matching subjects in the uploaded timetable.</p>'}${matches.length > 30 ? `<p class="mute">Showing 30 of ${matches.length} subjects. Search to narrow the list.</p>` : ''}`);
    body.querySelectorAll('[data-view-subject]').forEach((button) => { button.onclick = () => showSubject(button.dataset.viewSubject); });
  };
  open.onclick = async () => {
    if (loaded) { body.hidden = !body.hidden; open.textContent = body.hidden ? 'Browse subjects' : 'Hide planner'; return; }
    open.disabled = true; say('Loading subjects from the uploaded timetable…');
    try {
      catalog = await loadPlannerCatalog(client);
      await Promise.all(plan.map((item) => getSchedules(item.code)));
      if (!root.isConnected) return;
      setHtml(body, '<div class="course-list" data-planned-list></div><div data-planned-week></div><label>Search subject code or name<input type="search" data-subject-search placeholder="e.g. IMJ41103 or Operating System"></label><div data-subject-results></div><div class="planner-selection" data-subject-groups aria-live="polite"></div>');
      body.hidden = false; loaded = true; open.textContent = 'Hide planner'; say(catalog.length ? '' : 'No timetable subjects have been uploaded yet.');
      body.querySelector('[data-subject-search]').oninput = drawSearch;
      drawPlan(); drawSearch();
    } catch (error) { say(`Could not load the planner: ${error.message}. Click Browse subjects to retry.`); }
    finally { open.disabled = false; }
  };
}
