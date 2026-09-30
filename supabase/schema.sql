-- StudyHub database for Supabase. Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to re-run: it only creates what is missing and replaces functions/policies.

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  student_id text not null unique,
  name text not null,
  email text, phone text, program text, faculty text,
  year int, semester text,
  role text not null default 'student' check (role in ('student','admin')),
  created_at timestamptz not null default now()
);
create table if not exists public.settings (key text primary key, value text);
create table if not exists public.courses (code text primary key check (code ~ '^[A-Z]{3}[0-9]{5}$'), name text, credit int);
create table if not exists public.enrollments (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_code text not null references public.courses(code),
  status text, grp text, section text,
  primary key (user_id, course_code)
);
create table if not exists public.classes (
  id bigint generated always as identity primary key,
  course_code text not null, section text,
  day int not null check (day between 1 and 7),
  start_time text not null, end_time text not null,
  kind text, venue text, lecturer text, details text
);
create index if not exists classes_course_idx on public.classes(course_code);
create index if not exists classes_section_idx on public.classes(section);
-- the student's timetable group, e.g. 'UR6523002 - Y3G1' (added after first release)
alter table public.profiles add column if not exists subgroup text;
-- secret for the calendar subscription link (Google / Apple Calendar)
alter table public.profiles add column if not exists calendar_token uuid not null default gen_random_uuid();
-- classes a student adds by hand (mix-and-match groups, subjects missing from the university page)
create table if not exists public.my_classes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  course_code text, title text check (length(title) <= 200),
  day int not null check (day between 1 and 7),
  start_time text not null check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time text not null check (end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  kind text check (length(kind) <= 40), venue text check (length(venue) <= 200)
);
create table if not exists public.posts (
  id bigint generated always as identity primary key,
  course_code text references public.courses(code),          -- null = general notice (admins only)
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  author_name text, author_sid text,                          -- filled by trigger
  kind text not null default 'info' check (kind in ('info','assignment','exam','urgent')),
  title text not null check (length(title) between 1 and 200),
  body text check (length(body) <= 4000),
  due_date date,
  created_at timestamptz not null default now()
);
create table if not exists public.assignments (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  course_code text, title text not null, description text, due_date date, done boolean not null default false
);
create table if not exists public.grades (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  course_code text, item text not null, score numeric, max_score numeric, weight numeric
);
create table if not exists public.notes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  course_code text, title text not null, body text, updated_at timestamptz not null default now()
);

insert into public.settings(key, value) values
  ('timetable_url', 'https://timetables2.unimap.edu.my/IjazahSarjanaMuda/SarjanaMudaSem220252026/DEGREE_SEM2_20252026_OFFICIAL_subgroups_days_vertical.html#table_1103')
on conflict (key) do nothing;

-- ---------- helpers ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;

create or replace function public.is_enrolled(c text) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from enrollments where user_id = auth.uid() and course_code = c) $$;

-- create the profile when someone signs up (details come from signUp options.data)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, student_id, name, email, phone, program, faculty, year, semester)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data->>'student_id'), ''), split_part(new.email, '@', 1)),
          coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), 'Student'),
          nullif(new.raw_user_meta_data->>'contact_email', ''), nullif(new.raw_user_meta_data->>'phone', ''),
          nullif(new.raw_user_meta_data->>'program', ''), nullif(new.raw_user_meta_data->>'faculty', ''),
          nullif(new.raw_user_meta_data->>'year', '')::int, nullif(new.raw_user_meta_data->>'semester', ''));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- stamp author on bulletin posts
create or replace function public.stamp_post_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  select name, student_id into new.author_name, new.author_sid from profiles where id = auth.uid();
  new.created_at := now();
  return new;
end $$;
drop trigger if exists stamp_post_author on public.posts;
create trigger stamp_post_author before insert on public.posts for each row execute function public.stamp_post_author();

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.classes enable row level security;
alter table public.posts enable row level security;
alter table public.assignments enable row level security;
alter table public.grades enable row level security;
alter table public.notes enable row level security;
alter table public.my_classes enable row level security;

-- profiles: see yourself (admins see everyone); edit only your own details, never your role or student ID
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (name, email, phone, program, faculty, year, semester, subgroup) on public.profiles to authenticated;

-- settings, courses, classes: everyone logged in can read; only admins write
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (true);
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists courses_read on public.courses;
create policy courses_read on public.courses for select to authenticated using (true);
drop policy if exists classes_read on public.classes;
create policy classes_read on public.classes for select to authenticated using (true);
revoke insert, update, delete on public.courses, public.classes from anon, authenticated;

-- enrollments: your own; adding goes through save_courses(); you may change only the chosen section
drop policy if exists enroll_read on public.enrollments;
create policy enroll_read on public.enrollments for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists enroll_update on public.enrollments;
create policy enroll_update on public.enrollments for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists enroll_delete on public.enrollments;
create policy enroll_delete on public.enrollments for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.enrollments from anon, authenticated;
grant update (section) on public.enrollments to authenticated;

-- bulletin
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select to authenticated using (true);
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated
  with check (public.is_admin() or (course_code is not null and public.is_enrolled(course_code)));
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete to authenticated using (user_id = auth.uid() or public.is_admin());
revoke update on public.posts from anon, authenticated;

-- personal data: owner only
drop policy if exists own_assignments on public.assignments;
create policy own_assignments on public.assignments for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_grades on public.grades;
create policy own_grades on public.grades for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_my_classes on public.my_classes;
create policy own_my_classes on public.my_classes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists admin_read_my_classes on public.my_classes;
create policy admin_read_my_classes on public.my_classes for select to authenticated using (public.is_admin());
drop policy if exists own_notes on public.notes;
create policy own_notes on public.notes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on all tables in schema public from anon;

-- ---------- functions the app calls ----------
-- Save courses (from the slip or added by hand). replace=true swaps the whole list.
create or replace function public.save_courses(items jsonb, replace boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare c jsonb;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if replace then delete from enrollments where user_id = auth.uid(); end if;
  for c in select * from jsonb_array_elements(items) loop
    if upper(c->>'code') !~ '^[A-Z]{3}[0-9]{5}$' then continue; end if;
    insert into courses(code, name, credit) values (upper(c->>'code'), left(nullif(c->>'name', ''), 200), nullif(c->>'credit', '')::int)
      on conflict (code) do update set name = coalesce(courses.name, excluded.name), credit = coalesce(courses.credit, excluded.credit);
    insert into enrollments(user_id, course_code, status, grp) values (auth.uid(), upper(c->>'code'), left(c->>'status', 5), left(c->>'grp', 30))
      on conflict (user_id, course_code) do update set status = excluded.status, grp = excluded.grp;
  end loop;
end $$;

-- Admin: load the class list. The first batch uses replace=true to clear the old list; later batches append.
-- Course names found in the timetable fill in names that are still missing.
drop function if exists public.admin_replace_classes(jsonb);
create or replace function public.admin_replace_classes(items jsonb, replace boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if replace then delete from classes where true; end if;
  insert into classes(course_code, section, day, start_time, end_time, kind, venue, lecturer, details)
  select x->>'course_code', x->>'section', (x->>'day')::int, x->>'start', x->>'end', left(x->>'kind', 40), left(x->>'venue', 200), left(x->>'lecturer', 300), left(x->>'details', 300)
  from jsonb_array_elements(items) x;
  get diagnostics n = row_count;
  insert into courses(code, name)
  select distinct on (x->>'course_code') x->>'course_code', left(x->>'course_name', 200)
  from jsonb_array_elements(items) x
  where x->>'course_code' ~ '^[A-Z]{3}[0-9]{5}$' and coalesce(x->>'course_name', '') <> ''
  on conflict (code) do update set name = coalesce(courses.name, excluded.name);
  insert into settings(key, value) values ('timetable_synced_at', now()::text) on conflict (key) do update set value = excluded.value;
  return n;
end $$;

-- Which timetable groups teach which of the given courses (small list; used to pick a group)
create or replace function public.class_sections(codes text[]) returns table (course_code text, section text)
language sql stable set search_path = public as
$$ select distinct c.course_code, c.section from classes c where c.course_code = any(codes) and c.section is not null $$;

create or replace function public.admin_users() returns table (id uuid, student_id text, name text, email text, phone text, program text, role text, created_at timestamptz, courses bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  return query select p.id, p.student_id, p.name, p.email, p.phone, p.program, p.role, p.created_at,
    (select count(*) from enrollments e where e.user_id = p.id) from profiles p order by p.created_at desc;
end $$;

create or replace function public.admin_set_role(target uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if target = auth.uid() then raise exception 'you cannot change your own role'; end if;
  if new_role not in ('student','admin') then raise exception 'bad role'; end if;
  update profiles set role = new_role where id = target;
end $$;

create or replace function public.admin_reset_password(target uuid, new_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if length(new_password) < 8 then raise exception 'password must be at least 8 characters'; end if;
  update auth.users set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')) where id = target;
end $$;

create or replace function public.admin_delete_user(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if target = auth.uid() then raise exception 'you cannot delete yourself'; end if;
  delete from auth.users where id = target;
end $$;

-- Admin: edit another user's details (student ID and role are not editable here)
create or replace function public.admin_update_profile(target uuid, data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if coalesce(trim(data->>'name'), '') = '' then raise exception 'name is required'; end if;
  update profiles set
    name = left(trim(data->>'name'), 120),
    email = left(nullif(trim(data->>'email'), ''), 120),
    phone = left(nullif(trim(data->>'phone'), ''), 30),
    program = left(nullif(trim(data->>'program'), ''), 120),
    faculty = left(nullif(trim(data->>'faculty'), ''), 120),
    year = nullif(data->>'year', '')::int,
    semester = left(nullif(trim(data->>'semester'), ''), 40),
    subgroup = left(nullif(trim(data->>'subgroup'), ''), 80)
  where id = target;
end $$;

-- ---------- timetable + calendar export ----------
-- A student's week, resolved the same way as the Timetable page:
-- per-subject group, else main group, else the only group teaching it ('none' hides it), plus hand-added classes.
create or replace function public.timetable_rows(uid uuid)
returns table (course_code text, course_name text, section text, day int, start_time text, end_time text,
               kind text, venue text, lecturer text, custom boolean)
language sql stable security definer set search_path = public as $$
  with p as (select subgroup from profiles where id = uid),
  e as (select en.course_code, en.section, c.name from enrollments en join courses c on c.code = en.course_code where en.user_id = uid),
  pick as (
    select e.course_code, e.name,
      case
        when e.section = 'none' then null
        when e.section is not null and exists (select 1 from classes x where x.course_code = e.course_code and x.section = e.section) then e.section
        when exists (select 1 from classes x, p where x.course_code = e.course_code and x.section = p.subgroup) then (select subgroup from p)
        when (select count(distinct x.section) from classes x where x.course_code = e.course_code) = 1
          then (select min(x.section) from classes x where x.course_code = e.course_code)
      end as chosen
    from e)
  select cl.course_code, pick.name, cl.section, cl.day, cl.start_time, cl.end_time, cl.kind, cl.venue, cl.lecturer, false
  from pick join classes cl on cl.course_code = pick.course_code and cl.section = pick.chosen
  union all
  select m.course_code, coalesce(nullif(m.title, ''), c.name), 'added by you', m.day, m.start_time, m.end_time, m.kind, m.venue, null, true
  from my_classes m left join courses c on c.code = m.course_code where m.user_id = uid
$$;

-- For the app: your own week, or any student's week for an admin
create or replace function public.my_timetable(target uuid default null)
returns table (course_code text, course_name text, section text, day int, start_time text, end_time text,
               kind text, venue text, lecturer text, custom boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if target is not null and target <> auth.uid() and not is_admin() then raise exception 'admin only'; end if;
  return query select * from timetable_rows(coalesce(target, auth.uid())) t order by t.day, t.start_time;
end $$;

-- iCalendar text escaping and 75-char line folding
create or replace function public.ics_text(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '\', '\\'), ';', '\;'), ',', '\,'), E'\n', '\n')
$$;
create or replace function public.ics_fold(line text) returns text language plpgsql immutable as $$
declare out text := left(line, 74); rest text := substr(line, 75);
begin
  while length(rest) > 0 loop out := out || E'\r\n ' || left(rest, 73); rest := substr(rest, 74); end loop;
  return out;
end $$;

-- Build the .ics for one student. Weekly repeating events from the semester start to end (Admin > Semester dates),
-- skipping the mid-semester break. Without dates: this week + 14 weeks. Times are Malaysia time.
create or replace function public.build_ics(uid uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  s_start date := coalesce(nullif((select value from settings where key = 'semester_start'), '')::date, date_trunc('week', current_date)::date);
  s_end   date := coalesce(nullif((select value from settings where key = 'semester_end'), '')::date, s_start + 14 * 7 - 1);
  b_start date := nullif((select value from settings where key = 'break_start'), '')::date;
  b_end   date := nullif((select value from settings where key = 'break_end'), '')::date;
  who text := (select name from profiles where id = uid);
  lines text[] := array['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StudyHub//Timetable//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' || ics_text('StudyHub timetable' || coalesce(' - ' || who, '')), 'X-WR-TIMEZONE:Asia/Kuala_Lumpur',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Kuala_Lumpur', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0800', 'TZOFFSETTO:+0800', 'TZNAME:MYT', 'END:STANDARD', 'END:VTIMEZONE'];
  r record; first date; d date; ex text; stamp text := to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"');
begin
  if s_end < s_start then s_end := s_start + 14 * 7 - 1; end if;
  for r in select * from timetable_rows(uid) loop
    first := s_start + ((r.day - extract(isodow from s_start)::int + 7) % 7);
    if first > s_end then continue; end if;
    ex := null;
    if b_start is not null and b_end is not null then
      d := first;
      while d <= least(b_end, s_end) loop
        if d >= b_start then ex := coalesce(ex || ',', '') || to_char(d, 'YYYYMMDD') || 'T' || replace(r.start_time, ':', '') || '00'; end if;
        d := d + 7;
      end loop;
    end if;
    lines := lines || array_remove(array[
      'BEGIN:VEVENT',
      'UID:' || md5(uid::text || r.course_code || coalesce(r.section, '') || r.day || r.start_time || coalesce(r.venue, '')) || '@studyhub',
      'DTSTAMP:' || stamp,
      'DTSTART;TZID=Asia/Kuala_Lumpur:' || to_char(first, 'YYYYMMDD') || 'T' || replace(r.start_time, ':', '') || '00',
      'DTEND;TZID=Asia/Kuala_Lumpur:' || to_char(first, 'YYYYMMDD') || 'T' || replace(r.end_time, ':', '') || '00',
      -- UNTIL is in UTC: 23:59:59 Malaysia time on the last day
      'RRULE:FREQ=WEEKLY;UNTIL=' || to_char(s_end, 'YYYYMMDD') || 'T155959Z',
      ics_fold('SUMMARY:' || ics_text(coalesce(r.course_code || ' ', '') || coalesce(r.course_name, '') || coalesce(' (' || initcap(r.kind) || ')', ''))),
      case when coalesce(r.venue, '') <> '' then ics_fold('LOCATION:' || ics_text(r.venue)) end,
      ics_fold('DESCRIPTION:' || ics_text(concat_ws(E'\n', 'Lecturer: ' || r.lecturer,
        case when r.custom then 'Added by you in StudyHub' else 'Group: ' || r.section end)))], null);
    if ex is not null then lines := lines || ics_fold('EXDATE;TZID=Asia/Kuala_Lumpur:' || ex); end if;
    lines := lines || 'END:VEVENT'::text;
  end loop;
  lines := lines || 'END:VCALENDAR'::text;
  return array_to_string(lines, E'\r\n') || E'\r\n';
end $$;

-- Download for the logged-in student
create or replace function public.my_calendar_ics() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  return build_ics(auth.uid());
end $$;

-- Subscription feed (called by the calendar-feed Edge Function, no login): the secret token picks the student
create or replace function public.calendar_feed(token uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := (select id from profiles where calendar_token = token);
begin
  if uid is null then return null; end if;
  return build_ics(uid);
end $$;

-- New secret link (the old one stops working)
create or replace function public.reset_calendar_token() returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  update profiles set calendar_token = t where id = auth.uid();
  return t;
end $$;

-- Supabase grants EXECUTE on new functions to anon and authenticated by default; take it all back,
-- then allow only the functions the app calls (internal helpers like build_ics stay private)
revoke execute on all functions in schema public from anon, authenticated, public;
grant execute on function public.is_admin(), public.is_enrolled(text), public.save_courses(jsonb, boolean),
  public.admin_replace_classes(jsonb, boolean), public.class_sections(text[]), public.admin_users(), public.admin_set_role(uuid, text),
  public.admin_reset_password(uuid, text), public.admin_delete_user(uuid),
  public.admin_update_profile(uuid, jsonb), public.my_timetable(uuid), public.my_calendar_ics(),
  public.reset_calendar_token() to authenticated;
grant execute on function public.calendar_feed(uuid) to anon, authenticated;

-- ---------- make yourself admin (run once after you register, with your own student ID) ----------
-- update public.profiles set role = 'admin' where student_id = '231021306';
