export function parseStudentId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d{9}$/.test(id)) return null;
  return {
    id,
    entryYear: id.slice(0, 2),
    programmeCode: id.slice(2, 5),
    personalNumber: id.slice(5),
  };
}
