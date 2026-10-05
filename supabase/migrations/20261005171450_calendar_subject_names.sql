create or replace function public.build_ics(uid uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  w record;
  who text := (select name from profiles where id = uid);
  lines text[] := array['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StudyHub//Timetable//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' || ics_text('StudyHub timetable' || coalesce(' - ' || who, '')), 'X-WR-TIMEZONE:Asia/Kuala_Lumpur',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Kuala_Lumpur', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0800', 'TZOFFSETTO:+0800', 'TZNAME:MYT', 'END:STANDARD', 'END:VTIMEZONE'];
  r record; first date; d date; ex text; stamp text := to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"');
begin
  select * into w from teaching_window();
  for r in select * from timetable_rows(uid) loop
    first := w.first_day + ((r.day - extract(isodow from w.first_day)::int + 7) % 7);
    if first > w.last_day then continue; end if;
    ex := null;
    d := first;
    while d <= w.last_day loop
      if no_class_day(d, w.sem_label) then ex := coalesce(ex || ',', '') || to_char(d, 'YYYYMMDD') || 'T' || replace(r.start_time, ':', '') || '00'; end if;
      d := d + 7;
    end loop;
    lines := lines || array_remove(array[
      'BEGIN:VEVENT',
      'UID:' || md5(uid::text || r.course_code || coalesce(r.section, '') || r.day || r.start_time || coalesce(r.venue, '')) || '@studyhub',
      'DTSTAMP:' || stamp,
      'DTSTART;TZID=Asia/Kuala_Lumpur:' || to_char(first, 'YYYYMMDD') || 'T' || replace(r.start_time, ':', '') || '00',
      'DTEND;TZID=Asia/Kuala_Lumpur:' || to_char(first, 'YYYYMMDD') || 'T' || replace(r.end_time, ':', '') || '00',
      'RRULE:FREQ=WEEKLY;UNTIL=' || to_char(w.last_day, 'YYYYMMDD') || 'T155959Z',
      ics_fold('SUMMARY:' || ics_text(coalesce(nullif(r.course_name, ''), r.course_code, 'Class'))),
      case when coalesce(r.venue, '') <> '' then ics_fold('LOCATION:' || ics_text(r.venue)) end,
      ics_fold('DESCRIPTION:' || ics_text(concat_ws(E'\n',
        case when coalesce(r.course_code, '') <> '' then 'Course code: ' || r.course_code end,
        case when coalesce(r.kind, '') <> '' then 'Class type: ' || initcap(r.kind) end,
        case when coalesce(r.lecturer, '') <> '' then 'Lecturer: ' || r.lecturer end,
        case when r.custom then 'Added by you in StudyHub' else case when coalesce(r.section, '') <> '' then 'Group: ' || r.section end end)))], null);
    if ex is not null then lines := lines || ics_fold('EXDATE;TZID=Asia/Kuala_Lumpur:' || ex); end if;
    lines := lines || 'END:VEVENT'::text;
  end loop;
  for r in select e.title, e.start_date, e.end_date from academic_events e
           union all
           select p.label || ' (' || p.semester || ')', p.start_date, p.end_date from academic_periods p where p.kind <> 'lecture'
           order by 2 loop
    lines := lines || array['BEGIN:VEVENT', 'UID:' || md5(r.title || r.start_date) || '-cal@studyhub', 'DTSTAMP:' || stamp,
      'DTSTART;VALUE=DATE:' || to_char(r.start_date, 'YYYYMMDD'), 'DTEND;VALUE=DATE:' || to_char(r.end_date + 1, 'YYYYMMDD'),
      ics_fold('SUMMARY:' || ics_text(r.title)), 'TRANSP:TRANSPARENT', 'END:VEVENT'];
  end loop;
  lines := lines || 'END:VCALENDAR'::text;
  return array_to_string(lines, E'\r\n') || E'\r\n';
end $$;
