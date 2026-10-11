import assert from 'node:assert/strict';
import { readSubjectPlan, searchSubjects, plannedSlots, planClashes, loadPlannerCatalog } from '../web/subject-planner.js';

const courses = [{ code: 'IMJ41103', name: 'Modern Operating System' }, { code: 'IMJ41203', name: 'Artificial Intelligence' }];
assert.deepEqual(searchSubjects(courses, 'operating imj4'), [courses[0]]);
assert.deepEqual(searchSubjects(courses, '  ARTIFICIAL '), [courses[1]]);
assert.deepEqual(searchSubjects(courses, 'unavailable'), []);
const plans = new Map([['studyhub.subject-plan.v1.alice', JSON.stringify([{ code: 'IMJ41103', section: 'Y4G1' }, { code: 'IMJ41103', section: 'Y4G2' }, { code: 'invalid', section: 'Y4G1' }])]]);
const storage = { getItem: (key) => plans.get(key) };
assert.deepEqual(readSubjectPlan(storage, 'alice'), [{ code: 'IMJ41103', section: 'Y4G2' }]);
assert.deepEqual(readSubjectPlan(storage, 'bob'), []);
assert.deepEqual(readSubjectPlan({ getItem: () => '{broken' }, 'alice'), []);
assert.deepEqual(readSubjectPlan({ getItem: () => { throw new Error('blocked'); } }, 'alice'), []);

const schedules = {
  IMJ41103: { Y4G1: [{ day: 1, start_time: '09:00', end_time: '11:00' }, { day: 3, start_time: '08:00', end_time: '10:00' }] },
  IMJ41203: { Y4G1: [{ day: 1, start_time: '10:00', end_time: '12:00' }], Y4G2: [{ day: 1, start_time: '11:00', end_time: '13:00' }] },
};
const plan = [{ code: 'IMJ41103', section: 'Y4G1' }, { code: 'IMJ41203', section: 'Y4G1' }];
const slots = plannedSlots(plan, schedules);
assert.deepEqual(slots.map((slot) => slot.day), [1, 1, 3]);
assert.deepEqual([...planClashes(slots)].sort(), ['IMJ41103', 'IMJ41203']);
assert.equal(planClashes(plannedSlots([plan[0], { ...plan[1], section: 'Y4G2' }], schedules)).size, 0, 'back-to-back classes do not clash');
assert.deepEqual(plannedSlots([{ code: 'IMJ41103', section: 'removed' }], schedules), []);

const calls = [];
const client = { from(table) {
  return { select() { return this; }, order() { return this; }, async range(from, to) {
    calls.push({ table, from, to });
    const data = table === 'courses' ? courses : [...Array(500).fill({ course_code: 'IMJ41103' }), { course_code: 'IMJ41203' }, { course_code: 'IMJ49903' }];
    return { data: data.slice(from, to + 1), error: null };
  } };
} };
const catalog = await loadPlannerCatalog(client);
assert.equal(catalog.length, 3);
assert.equal(catalog[2].name, 'Subject name unavailable');
assert.ok(calls.some((call) => call.table === 'classes' && call.from === 500), 'subjects after the first page are included');
await assert.rejects(loadPlannerCatalog({ from() { return { select() { return this; }, order() { return this; }, range: async () => ({ error: { message: 'denied' } }) }; } }), /denied/);
console.log('ALL SUBJECT PLANNER TESTS PASSED');
