import assert from 'node:assert/strict';
import { loadPlannedTimetable, combinePlannedTimetable } from '../web/planned-timetable.js';

const registered = [{ course_code: 'IMJ41103', section: 'G1', day: 1, start_time: '09:00', end_time: '11:00' }];
const planned = [
  { ...registered[0], planned: true },
  { course_code: 'IMJ41203', section: 'G2', day: 1, start_time: '10:00', end_time: '12:00', planned: true },
];
const combined = combinePlannedTimetable(registered, planned);
assert.equal(combined.length, 2, 'identical registered/planned periods appear once');
assert.equal(combined[0].alsoRegistered, true);
assert.ok(combined.every((row) => row.planned && row.planClash));
assert.equal(registered[0].planned, undefined, 'registered data remains unchanged for exports');
assert.equal(combinePlannedTimetable(registered, [{ ...planned[1], start_time: '11:00' }])[1].planClash, false);
assert.equal(combinePlannedTimetable([], planned).length, 2, 'plans work without any registered subjects');

const calls = [];
const storage = { getItem: () => JSON.stringify([{ code: 'IMJ41103', section: 'G1' }, { code: 'IMJ41203', section: 'removed' }]) };
const client = { from(table) {
  const filters = {};
  return { async maybeSingle() { return { data: { subjects: JSON.parse(storage.getItem()) }, error: null }; }, select() { return this; }, eq(key, value) { filters[key] = value; return this; }, order() { return this; }, async range(from, to) {
    calls.push({ table, filters: { ...filters }, from });
    const rows = table === 'courses' ? [{ name: 'Operating System' }] : filters.section === 'G1' ? Array.from({ length: 501 }, (_, id) => ({ ...registered[0], id })) : [];
    return { data: rows.slice(from, to + 1), error: null };
  } };
} };
const result = await loadPlannedTimetable(client, storage, 'alice');
assert.equal(result.count, 2);
assert.equal(result.classes.length, 501);
assert.deepEqual(result.missing, ['IMJ41203']);
assert.equal(result.classes[0].start, '09:00');
assert.equal(result.classes[0].course_name, 'Operating System');
assert.ok(result.classes.every((row) => row.planned));
assert.ok(calls.some((call) => call.table === 'classes' && call.from === 500));
assert.ok(calls.filter((call) => call.table === 'classes').every((call) => call.filters.course_code && call.filters.section));
console.log('ALL PLANNED TIMETABLE TESTS PASSED');
