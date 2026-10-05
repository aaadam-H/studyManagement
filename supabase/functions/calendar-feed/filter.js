export const categories = {
  all: 'All classes and holidays',
  lecture: 'Lectures',
  lab: 'Labs',
  tutorial: 'Tutorials',
  other: 'Other classes',
  holiday: 'Holidays and breaks',
};

function classCategory(event) {
  const unfolded = event.replace(/\r?\n[ \t]/g, '');
  const summary = unfolded.match(/^SUMMARY:(.*)$/m)?.[1] ?? '';
  const description = unfolded.match(/^DESCRIPTION:(.*)$/m)?.[1] ?? '';
  const typeLine = description.split(/\\n/i).find((line) => /^Class type:/i.test(line));
  const kind = typeLine?.replace(/^Class type:\s*/i, '').trim().toLowerCase()
    || summary.match(/\(([^()]*)\)\s*$/)?.[1]?.trim().toLowerCase()
    || '';
  if (/^(lab|laboratory|makmal|practical|p)$/.test(kind)) return 'lab';
  if (/^(tutorial|t)$/.test(kind)) return 'tutorial';
  if (/^(lecture|kuliah|l)$/.test(kind)) return 'lecture';
  return 'other';
}

export function filterCalendar(source, category) {
  if (!Object.hasOwn(categories, category) || category === 'all') throw new TypeError('A specific calendar category is required');
  const events = source.match(/BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT/g) ?? [];
  const selected = events.filter((event) => {
    const allDay = /^DTSTART;VALUE=DATE:/m.test(event);
    return category === 'holiday' ? allDay : !allDay && classCategory(event) === category;
  });
  const firstEvent = source.indexOf('BEGIN:VEVENT');
  const endCalendar = source.lastIndexOf('END:VCALENDAR');
  const header = (firstEvent < 0 ? source.slice(0, endCalendar) : source.slice(0, firstEvent))
    .replace(/^X-WR-CALNAME:(.*)$/m, (line) => `${line} - ${categories[category]}`);
  const end = endCalendar < 0 ? 'END:VCALENDAR\r\n' : source.slice(endCalendar);
  return `${header}${selected.join('\r\n')}${selected.length ? '\r\n' : ''}${end}`;
}
