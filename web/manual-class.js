export function readManualClassForm(form) {
  const value = (name) => form.querySelector(`[name="${name}"]`)?.value?.trim() || '';
  const courseCode = value('course_code');
  const title = value('title');
  const start = value('start_time');
  const end = value('end_time');
  if (!courseCode && !title) throw new Error('Choose a subject or enter a class title.');
  if (!start || !end) throw new Error('Enter both a start and end time.');
  if (end <= start) throw new Error('End time must be after start time.');
  return {
    course_code: courseCode || null,
    title: title || null,
    day: Number(value('day')),
    start_time: start,
    end_time: end,
    kind: value('kind') || null,
    venue: value('venue') || null,
  };
}

export function wireManualClassButton(doc, getSaveHandler, onFailure) {
  doc.addEventListener('click', (event) => {
    const button = event.target.closest?.('#manual-class-submit');
    if (!button || !button.isConnected) return;
    const save = getSaveHandler();
    if (!save) return;
    event.preventDefault();
    Promise.resolve().then(() => save(event)).catch(onFailure);
  });
}
