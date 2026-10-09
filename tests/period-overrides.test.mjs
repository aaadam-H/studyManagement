import assert from 'node:assert/strict';
import { applyPeriodOverrides, markAdjustedTimetableRows } from '../web/period-overrides.js';

const slots = { IMJ47203: { Y4G1: [
  { day: 2, start_time: '13:00:00', end_time: '13:50:00', section: 'Y4G1' },
  { day: 4, start_time: '12:00', end_time: '12:50', section: 'Y4G1' },
], Y4G2: [{ day: 2, start_time: '10:00', end_time: '10:50', section: 'Y4G2' }] } };
const overrides = [{ course_code: 'IMJ47203', section: 'Y4G1', original_day: 2, original_start_time: '13:00', original_end_time: '13:50', override_day: 3, override_start_time: '14:00', override_end_time: '14:50' }];
const changed = applyPeriodOverrides(slots, overrides);
assert.equal(changed.IMJ47203.Y4G1[0].day, 3);
assert.equal(changed.IMJ47203.Y4G1[0].start_time, '14:00');
assert.equal(changed.IMJ47203.Y4G1[0].source_day, 2);
assert.equal(changed.IMJ47203.Y4G1[0].periodAdjusted, true);
assert.equal(changed.IMJ47203.Y4G1[1].day, 4);
assert.equal(changed.IMJ47203.Y4G2[0].day, 2);
const rows = markAdjustedTimetableRows([{ course_code: 'IMJ47203', section: 'Y4G1', day: 3, start_time: '14:00', end_time: '14:50' }], overrides);
assert.equal(rows[0].periodAdjusted, true);
assert.equal(rows[0].original_day, 2);
console.log('  ok - class period overrides: isolated by subject/group/source period and reflected in timetable rows');
