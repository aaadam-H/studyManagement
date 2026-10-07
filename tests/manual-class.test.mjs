import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { readManualClassForm, wireManualClassButton } from '../web/manual-class.js';

const { document: formDocument } = parseHTML(`<form>
  <select name="course_code"><option value="IMJ47203" selected>Software Engineering</option></select>
  <input name="title" value="Replacement class">
  <select name="day"><option value="4" selected>Thursday</option></select>
  <input name="start_time" type="time" value="12:00">
  <input name="end_time" type="time" value="13:50">
  <select name="kind"><option value="LECTURE" selected>Lecture</option></select>
  <input name="venue" value="DK 3">
</form>`);
assert.deepEqual(readManualClassForm(formDocument.querySelector('form')), {
  course_code: 'IMJ47203', title: 'Replacement class', day: 4,
  start_time: '12:00', end_time: '13:50', kind: 'LECTURE', venue: 'DK 3',
});
const incomplete = formDocument.querySelector('form');
incomplete.querySelector('[name="start_time"]').value = '';
assert.throws(() => readManualClassForm(incomplete), /both a start and end time/);
incomplete.querySelector('[name="start_time"]').value = '14:00';
assert.throws(() => readManualClassForm(incomplete), /End time must be after start time/);

const { document, Event } = parseHTML('<!doctype html><html><body><button id="manual-class-submit">Add class</button><button id="other">Other</button></body></html>');
let saves = 0;
let failures = 0;
wireManualClassButton(document, () => async () => { saves++; }, () => { failures++; });

document.getElementById('other').dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
const tap = new Event('click', { bubbles: true, cancelable: true });
document.getElementById('manual-class-submit').dispatchEvent(tap);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(tap.defaultPrevented, true);
assert.equal(saves, 1);
assert.equal(failures, 0);

wireManualClassButton(document, () => async () => { throw new Error('save failed'); }, () => { failures++; });
document.getElementById('manual-class-submit').dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(failures, 1);
console.log('ALL MANUAL CLASS INTERACTION TESTS PASSED');
