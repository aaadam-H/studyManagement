import assert from 'node:assert/strict';
import { filterCalendar } from '../supabase/functions/calendar-feed/filter.js';

const feed = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:StudyHub timetable',
  'BEGIN:VEVENT', 'SUMMARY:IMJ10001 Intro (Lecture)', 'DTSTART;TZID=Asia/Kuala_Lumpur:20261005T090000', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:IMJ10002 Lab work (Lab)', 'DTSTART;TZID=Asia/Kuala_Lumpur:20261005T110000', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:IMJ10003 Seminar (Tutorial)', 'DTSTART;TZID=Asia/Kuala_Lumpur:20261005T130000', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:IMJ10004 Extra (Workshop)', 'DTSTART;TZID=Asia/Kuala_Lumpur:20261005T150000', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Mid-semester break', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261108', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

for (const [category, expected, courseCode] of [['lecture', 'Intro', 'IMJ10001'], ['lab', 'Lab work', 'IMJ10002'], ['tutorial', 'Seminar', 'IMJ10003'], ['other', 'Extra', 'IMJ10004'], ['holiday', 'Mid-semester break', null]]) {
  const result = filterCalendar(feed, category);
  assert.ok(result.includes(expected), `${category} feed contains the matching event`);
  assert.deepEqual([...result.matchAll(/SUMMARY:(IMJ\d+)/g)].map((match) => match[1]), courseCode ? [courseCode] : [], `${category} feed excludes unrelated class events`);
  assert.ok(result.includes(`X-WR-CALNAME:StudyHub timetable -`), `${category} feed has a distinct calendar name`);
  assert.ok(result.endsWith('END:VCALENDAR\r\n'));
}
assert.equal((filterCalendar(feed, 'lecture').match(/BEGIN:VEVENT/g) || []).length, 1);
assert.throws(() => filterCalendar(feed, 'all'), /specific calendar category/);

const namedFeed = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:StudyHub timetable',
  'BEGIN:VEVENT', 'SUMMARY:Communication Systems', 'DESCRIPTION:Course code: IMJ31103\\nClass type: Lecture', 'DTSTART;TZID=Asia/Kuala_Lumpur:20261005T090000', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Digital Signal Processing', 'DESCRIPTION:Course code: IMJ31303\\nClass type: Lab', 'DTSTART;TZID=Asia/Kuala_Lumpur:20261005T110000', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');
assert.match(filterCalendar(namedFeed, 'lecture'), /SUMMARY:Communication Systems/);
assert.doesNotMatch(filterCalendar(namedFeed, 'lecture'), /SUMMARY:Digital Signal Processing/);
assert.match(filterCalendar(namedFeed, 'lab'), /SUMMARY:Digital Signal Processing/);
console.log('ALL CALENDAR FEED TESTS PASSED');
