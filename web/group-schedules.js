const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// A group can have several lectures/labs across different days. Show every slot.
export function groupScheduleText(rows = []) {
  const slots = new Map();
  for (const row of rows) {
    if (!DAYS[row.day] || !row.start_time || !row.end_time) continue;
    const start = row.start_time.slice(0, 5), end = row.end_time.slice(0, 5);
    const key = `${row.day}|${start}|${end}`;
    slots.set(key, { day: row.day, start, end });
  }
  return [...slots.values()].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
    .map((slot) => `${DAYS[slot.day]} ${slot.start}–${slot.end}`).join('; ') || 'Schedule unavailable';
}

// Fetch per subject so large timetables cannot truncate the group choices.
export async function loadGroupSchedules(client, codes) {
  const courses = await Promise.all([...new Set(codes)].map(async (code) => {
    const groups = {};
    for (let from = 0; ; from += 500) {
      const { data, error } = await client.from('classes').select('section,day,start_time,end_time')
        .eq('course_code', code).order('id').range(from, from + 499);
      if (error) throw new Error(error.message);
      for (const row of data) if (row.section) (groups[row.section] ||= []).push(row);
      if (data.length < 500) break;
    }
    return [code, groups];
  }));
  return Object.fromEntries(courses);
}
