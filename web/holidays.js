// Calendar dates use UTC arithmetic so daylight-saving changes cannot shift a day.
const DAY = 86400000;
const stamp = (iso) => Date.parse(iso + 'T00:00:00Z');
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekend = (ms) => [0, 6].includes(new Date(ms).getUTCDay());

// Only declared no-class holidays and actual academic breaks count as days off.
// Revision, exams, registration and ordinary events are not holidays.
export function longHolidays(periods = [], events = []) {
  const sources = [
    ...events.filter((e) => e.no_class).map((e) => ({ ...e, name: e.title })),
    ...periods.filter((p) => ['mid_break', 'semester_break'].includes(p.kind)).map((p) => ({ ...p, name: p.label })),
  ].filter((s) => Number.isFinite(stamp(s.start_date)) && Number.isFinite(stamp(s.end_date)) && s.start_date <= s.end_date);
  if (!sources.length) return [];
  const from = Math.min(...sources.map((s) => stamp(s.start_date))) - 7 * DAY;
  const to = Math.max(...sources.map((s) => stamp(s.end_date))) + 7 * DAY;
  const runs = [];
  let run = null;
  for (let d = from; d <= to; d += DAY) {
    const date = iso(d);
    const names = sources.filter((s) => s.start_date <= date && date <= s.end_date).map((s) => s.name);
    if (weekend(d) || names.length) {
      if (!run) { run = { start: d, end: d, names: new Set() }; runs.push(run); }
      run.end = d;
      names.forEach((name) => run.names.add(name));
    } else run = null;
  }
  const results = [];
  const add = (a, b, leaveDates) => results.push({
    start_date: iso(a.start), end_date: iso(b.end), days: (b.end - a.start) / DAY + 1,
    leave_dates: leaveDates, names: [...new Set([...a.names, ...b.names])],
  });
  runs.forEach((r, i) => {
    if (r.names.size && r.end - r.start >= 2 * DAY) add(r, r, []);
    const next = runs[i + 1];
    // Join two days-off runs only when exactly one working day separates them.
    if (next && next.start - r.end === 2 * DAY && (r.names.size || next.names.size)) {
      add(r, next, [iso(r.end + DAY)]);
    }
  });
  return results.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.leave_dates.length - b.leave_dates.length);
}
