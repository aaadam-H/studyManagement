export function maintenanceIsActive(settings, at = Date.now()) {
  if (settings.maintenance_enabled !== 'true') return false;
  const start = settings.maintenance_start ? Date.parse(settings.maintenance_start) : null;
  const end = settings.maintenance_end ? Date.parse(settings.maintenance_end) : null;
  if ((settings.maintenance_start && !Number.isFinite(start)) || (settings.maintenance_end && !Number.isFinite(end))) return false;
  return (start === null || at >= start) && (end === null || at < end);
}

export function toLocalDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
