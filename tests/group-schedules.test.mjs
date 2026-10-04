import assert from 'node:assert/strict';
import { groupScheduleText, loadGroupSchedules } from '../web/group-schedules.js';

const row = (day, start_time, end_time, section = 'Y2G1') => ({ day, start_time, end_time, section });
assert.equal(groupScheduleText([
  row(4, '14:00:00', '15:50:00'), row(1, '09:00', '10:50'),
  row(1, '09:00', '10:50'), row(1, '08:00', '08:50'), row(0, '09:00', '10:50'),
]), 'Mon 08:00–08:50; Mon 09:00–10:50; Thu 14:00–15:50');
assert.equal(groupScheduleText([]), 'Schedule unavailable');
assert.equal(groupScheduleText([row(7, '09:00', '10:50')]), 'Sun 09:00–10:50');

const pages = [Array.from({ length: 500 }, () => row(1, '09:00', '10:50')), [row(4, '14:00', '15:50', 'Y2G2')]];
const ranges = [];
let courseQueries = 0;
const client = { from(name) {
  assert.equal(name, 'classes'); courseQueries++;
  return { select(columns) {
    assert.equal(columns, 'section,day,start_time,end_time'); return this;
  }, eq(column, code) {
    assert.equal(column, 'course_code'); assert.equal(code, 'IMJ21303'); return this;
  }, order(column) {
    assert.equal(column, 'id'); return this;
  }, async range(from, to) {
    ranges.push([from, to]); return { data: pages[from / 500], error: null };
  } };
} };
const schedules = await loadGroupSchedules(client, ['IMJ21303', 'IMJ21303']);
assert.equal(courseQueries, 2);
assert.deepEqual(ranges, [[0, 499], [500, 999]]);
assert.equal(schedules.IMJ21303.Y2G1.length, 500);
assert.equal(groupScheduleText(schedules.IMJ21303.Y2G2), 'Thu 14:00–15:50');
assert.deepEqual(await loadGroupSchedules(client, []), {});
console.log('  ok - group schedules: all weekly slots, sorting, deduplication and pagination');
