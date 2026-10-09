const shortTime = (value) => String(value || '').slice(0, 5);

function matchesOriginal(slot, override) {
  return Number(slot.day) === Number(override.original_day)
    && shortTime(slot.start_time) === shortTime(override.original_start_time)
    && shortTime(slot.end_time) === shortTime(override.original_end_time);
}

export function applyPeriodOverrides(schedules, overrides = []) {
  return Object.fromEntries(Object.entries(schedules).map(([code, groups]) => [code,
    Object.fromEntries(Object.entries(groups).map(([group, slots]) => [group, slots.map((slot) => {
      const override = overrides.find((item) => item.course_code === code && item.section === group && matchesOriginal(slot, item));
      if (!override) return { ...slot, source_day: slot.day, source_start_time: shortTime(slot.start_time), source_end_time: shortTime(slot.end_time) };
      return { ...slot, source_day: slot.day, source_start_time: shortTime(slot.start_time), source_end_time: shortTime(slot.end_time),
        day: override.override_day, start_time: override.override_start_time, end_time: override.override_end_time, periodAdjusted: true };
    })]))
  ]));
}

export function markAdjustedTimetableRows(rows, overrides = []) {
  return rows.map((row) => {
    const override = overrides.find((item) => item.course_code === row.course_code && item.section === row.section
      && Number(item.override_day) === Number(row.day)
      && shortTime(item.override_start_time) === shortTime(row.start_time)
      && shortTime(item.override_end_time) === shortTime(row.end_time));
    return override ? { ...row, periodAdjusted: true, original_day: override.original_day,
      original_start_time: override.original_start_time, original_end_time: override.original_end_time } : row;
  });
}
