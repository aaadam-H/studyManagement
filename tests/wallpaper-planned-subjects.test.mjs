import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { combinePlannedTimetable } from '../web/planned-timetable.js';

// Exercise the actual page/controller against a DOM, recording the timetable
// passed to both canvas renderers. This catches the registered-only regression.
const { window, document } = parseHTML('<html><body><main id="main"></main></body></html>');
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
  get() { return [...this.options].find((option) => option.hasAttribute('selected'))?.value || this.options[0]?.value || ''; },
  set(value) { for (const option of this.options) option.toggleAttribute('selected', option.value === String(value)); },
  configurable: true,
});
Object.defineProperty(window.HTMLInputElement.prototype, 'checked', {
  get() { return this.hasAttribute('checked'); }, set(value) { this.toggleAttribute('checked', Boolean(value)); }, configurable: true,
});
const network = { course_code: 'IMJ47403', course_name: 'Computer Network Security', section: 'UR6523002 - Y4G1', day: 2, start_time: '10:00', end_time: '11:50', start: '10:00', end: '11:50' };
const signals = { course_code: 'IMJ21303', course_name: 'Signals and Systems', section: 'UR6523002 - Y2G1', day: 3, start_time: '10:00', end_time: '11:50', start: '10:00', end: '11:50', planned: true };
const timetable = { classes: [network], courses: [], custom: [], groupOptions: [], periodOverrides: [], totalClassesInDb: 1, myCourseCount: 0 };
const draws = [], frames = [];
const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const context = vm.createContext({
  window, document, navigator: { userAgent: 'iPhone' }, localStorage: { getItem: () => null, setItem() {} },
  console, setTimeout, clearTimeout, URL,
  requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; }, cancelAnimationFrame() {},
  getTimetable: async () => timetable, getAcademic: async () => ({}),
  loadPlannedTimetable: async () => ({ count: 2, classes: [{ ...network, planned: true }, signals], missing: [] }),
  combinePlannedTimetable, loadGroupSchedules: async () => ({}), applyPeriodOverrides: (rows) => rows,
  groupScheduleText: () => '', prettyGroup: (group) => group, isAdmin: () => false,
  sb: {}, me: { id: 'student' }, calendarCard: () => '', wireCalendarCard() {},
  manualClassSaveHandler: null, flash() {},
  DOMPurify: { sanitize: (html) => document.createRange().createContextualFragment(html) },
  esc: (value) => String(value ?? ''), DAYN: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  draws,
});
vm.runInContext(source.slice(source.indexOf('const kindKey ='), source.indexOf('async function pgDashboard')) +
  source.slice(source.indexOf('const groupLabel ='), source.indexOf('/* ---------------- calendar apps')) +
  '\ndrawTimetableWallpaper = (canvas, data) => draws.push({ id: canvas.id, codes: data.classes.map(row => row.course_code) });', context);
const render = () => vm.runInContext('pgTimetable(document.getElementById("main"))', context);
const assertBoth = () => {
  for (const id of ['timetable-wallpaper', 'timetable-wallpaper-zoom']) {
    assert.deepEqual(Array.from(draws.filter((draw) => draw.id === id).at(-1).codes).sort(), ['IMJ21303', 'IMJ47403']);
  }
};
await render();
assertBoth();
assert.equal(document.querySelector('#download-wallpaper').disabled, false);
const toggle = document.querySelector('#show-planned-subjects');
toggle.checked = false; toggle.onchange(); frames.splice(0).forEach((frame) => frame());
assert.deepEqual(Array.from(draws.at(-1).codes), ['IMJ47403']);
toggle.checked = true; toggle.onchange(); frames.splice(0).forEach((frame) => frame());
assertBoth();
assert.equal(timetable.classes.length, 1, 'wallpaper preview does not change registration');
timetable.classes = [];
await render();
assertBoth();
assert.equal(document.querySelector('#download-wallpaper').disabled, false, 'plan-only wallpaper can be downloaded');
const planOnlyToggle = document.querySelector('#show-planned-subjects');
planOnlyToggle.checked = false; planOnlyToggle.onchange(); frames.splice(0).forEach((frame) => frame());
assert.equal(document.querySelector('#download-wallpaper').disabled, true, 'no visible classes means no download');
console.log('ALL PLANNED WALLPAPER TESTS PASSED');
