import { loadAccountSubjectPlan } from './account-plans.js?v=1.2.41';

// Load the selected groups only; plans never enter the saved enrolment list.
export async function loadPlannedTimetable(client, storage, userId) {
  const plan = await loadAccountSubjectPlan(client, storage, userId);
  const results = await Promise.all(plan.map(async (item) => {
    const [{ data: courses, error: courseError }, rows] = await Promise.all([
      client.from('courses').select('name').eq('code', item.code).range(0, 0),
      (async () => {
        const rows = [];
        for (let from = 0; ; from += 500) {
          const { data, error } = await client.from('classes').select('*').eq('course_code', item.code).eq('section', item.section).order('id').range(from, from + 499);
          if (error) throw new Error(error.message);
          rows.push(...data);
          if (data.length < 500) return rows;
        }
      })(),
    ]);
    if (courseError) throw new Error(courseError.message);
    return { code: item.code, classes: rows.map((row) => ({ ...row, course_name: courses[0]?.name || item.code, start: row.start_time, end: row.end_time, planned: true })) };
  }));
  return { count: plan.length, classes: results.flatMap((result) => result.classes), missing: results.filter((result) => !result.classes.length).map((result) => result.code) };
}

export function combinePlannedTimetable(registered, planned) {
  const key = (row) => JSON.stringify([row.course_code, row.section, row.day, row.start_time, row.end_time]);
  const combined = new Map(registered.map((row) => [key(row), { ...row }]));
  const registeredKeys = new Set(combined.keys());
  for (const row of planned) {
    const existing = combined.get(key(row));
    if (existing) { existing.planned = true; existing.alsoRegistered = registeredKeys.has(key(row)); }
    else combined.set(key(row), { ...row, planned: true });
  }
  const classes = [...combined.values()].sort((a, b) => a.day - b.day || a.start_time.localeCompare(b.start_time) || (a.course_code || '').localeCompare(b.course_code || ''));
  for (const row of classes) if (row.planned) row.planClash = classes.some((other) => other !== row && other.course_code !== row.course_code && other.day === row.day && row.start_time < other.end_time && other.start_time < row.end_time);
  return classes;
}
