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
-- true when a course name was guessed from the timetable page; a name from a registration slip replaces it.
-- (Rows that already existed when this column was added count as guessed, so the next slip upload corrects them.)
alter table public.courses add column if not exists name_from_timetable boolean not null default true;
alter table public.courses alter column name_from_timetable set default false;
-- repair names damaged by an older timetable reader: '/Imj42004 - Final Year Project 1/2' -> 'Final Year Project 1/2'
-- (still marked as a guess, so the student's registration slip name replaces it on the next save)
update public.courses set name = regexp_replace(name, '^\s*(/\s*[A-Za-z]{3}\d{3,5}\s*)+-?\s*', ''), name_from_timetable = true
where name ~ '^\s*/\s*[A-Za-z]{3}\d{3,5}';
-- secret for the calendar subscription link (Google / Apple Calendar)
alter table public.profiles add column if not exists calendar_token uuid not null default gen_random_uuid();
-- when the student finished (or skipped) the first-time setup guide; people who already had accounts count as done
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarded_at') then
    alter table public.profiles add column onboarded_at timestamptz;
    update public.profiles set onboarded_at = now();
  end if;
end $$;
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
-- academic calendar (uploaded by an admin from the university PDF)
create table if not exists public.academic_periods (
  id bigint generated always as identity primary key,
  session text, semester text not null,
  kind text not null check (kind in ('registration','lecture','mid_break','revision','exam','semester_break','other')),
  label text, start_date date not null, end_date date not null check (end_date >= start_date)
);
create table if not exists public.academic_events (
  id bigint generated always as identity primary key,
  title text not null check (length(title) <= 300),
  start_date date not null, end_date date not null check (end_date >= start_date),
  no_class boolean not null default true          -- public holiday: classes are skipped in calendar exports
);
-- feedback, bug reports and reports of bulletin posts (students send; admins read, reply and resolve)
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null default 'feedback' check (kind in ('feedback','bug','report','other')),
  subject text not null check (length(subject) between 1 and 200),
  message text not null check (length(message) between 1 and 4000),
  post_id bigint,                                  -- reported bulletin post (no FK: the post may be deleted later)
  post_title text check (length(post_title) <= 200),
  page text check (length(page) <= 100),
  status text not null default 'new' check (status in ('new','open','resolved')),
  admin_reply text check (length(admin_reply) <= 4000),
  replied_at timestamptz, reply_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists feedback_status_idx on public.feedback(status);
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

do $$ begin
  alter table public.notes add constraint notes_len check (length(title) <= 200 and length(coalesce(body, '')) <= 20000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.assignments add constraint assignments_len check (length(title) <= 200 and length(coalesce(description, '')) <= 4000 and length(coalesce(course_code, '')) <= 12);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.grades add constraint grades_len check (length(item) <= 200 and length(coalesce(course_code, '')) <= 12);
exception when duplicate_object then null; end $$;

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
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  -- the login is "<student id>@<domain>", so the student ID always comes from the email, never from free-form sign-up data
  -- (keeps the capitalisation the student typed when it matches)
  sid text := case when lower(trim(m->>'student_id')) = lower(split_part(new.email, '@', 1)) then trim(m->>'student_id')
                   else split_part(new.email, '@', 1) end;
begin
  if sid !~ '^[A-Za-z0-9._-]{3,30}$' then raise exception 'invalid student ID'; end if;
  insert into profiles(id, student_id, name, email, phone, program, faculty, year, semester)
  values (new.id, sid,
          left(coalesce(nullif(trim(m->>'name'), ''), 'Student'), 120),
          left(nullif(trim(m->>'contact_email'), ''), 120), left(nullif(trim(m->>'phone'), ''), 30),
          left(nullif(trim(m->>'program'), ''), 120), left(nullif(trim(m->>'faculty'), ''), 120),
          case when m->>'year' ~ '^\d{1,2}$' then (m->>'year')::int end, left(nullif(trim(m->>'semester'), ''), 40));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- new feedback: fixed owner/status, reported post title taken from the post itself, at most 10 per hour per person
create or replace function public.stamp_feedback() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from feedback where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You have sent a lot of feedback in the last hour. Please try again later.';
  end if;
  new.user_id := auth.uid();
  new.status := 'new';
  new.admin_reply := null; new.replied_at := null; new.reply_seen_at := null;
  new.created_at := now();
  new.post_title := case when new.post_id is not null then (select left(title, 200) from posts where id = new.post_id) end;
  if new.post_id is not null and new.post_title is null then new.post_id := null; end if;
  return new;
end $$;
drop trigger if exists stamp_feedback on public.feedback;
create trigger stamp_feedback before insert on public.feedback for each row execute function public.stamp_feedback();

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
alter table public.academic_periods enable row level security;
alter table public.academic_events enable row level security;
alter table public.feedback enable row level security;

-- profiles: see yourself (admins see everyone); edit only your own details, never your role or student ID
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (name, email, phone, program, faculty, year, semester, subgroup, onboarded_at) on public.profiles to authenticated;

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
drop policy if exists periods_read on public.academic_periods;
create policy periods_read on public.academic_periods for select to authenticated using (true);
drop policy if exists events_read on public.academic_events;
create policy events_read on public.academic_events for select to authenticated using (true);
revoke insert, update, delete on public.academic_periods, public.academic_events from anon, authenticated;
-- feedback: students see their own, admins see all; students may only fill in the message fields
-- and mark a reply as seen; status and replies change only through the admin functions below
drop policy if exists feedback_read on public.feedback;
create policy feedback_read on public.feedback for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert to authenticated with check (user_id = auth.uid());
drop policy if exists feedback_seen on public.feedback;
create policy feedback_seen on public.feedback for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists feedback_admin_delete on public.feedback;
create policy feedback_admin_delete on public.feedback for delete to authenticated using (public.is_admin());
revoke insert, update, delete on public.feedback from anon, authenticated;
grant insert (kind, subject, message, post_id, page) on public.feedback to authenticated;
grant update (reply_seen_at) on public.feedback to authenticated;
grant delete on public.feedback to authenticated;

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
  if jsonb_array_length(items) > 30 then raise exception 'too many courses'; end if;
  if replace then delete from enrollments where user_id = auth.uid(); end if;
  for c in select * from jsonb_array_elements(items) loop
    if upper(c->>'code') !~ '^[A-Z]{3}[0-9]{5}$' then continue; end if;
    insert into courses(code, name, credit) values (upper(c->>'code'), left(nullif(c->>'name', ''), 200), nullif(c->>'credit', '')::int)
      on conflict (code) do update set
        name = case when courses.name is null or courses.name_from_timetable then coalesce(excluded.name, courses.name) else courses.name end,
        name_from_timetable = courses.name_from_timetable and excluded.name is null,
        credit = coalesce(courses.credit, excluded.credit);
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
  select left(x->>'course_code', 12), left(x->>'section', 80), (x->>'day')::int, left(x->>'start', 5), left(x->>'end', 5), left(x->>'kind', 40), left(x->>'venue', 200), left(x->>'lecturer', 300), left(x->>'details', 300)
  from jsonb_array_elements(items) x;
  get diagnostics n = row_count;
  insert into courses(code, name, name_from_timetable)
  select distinct on (x->>'course_code') x->>'course_code', left(x->>'course_name', 200), true
  from jsonb_array_elements(items) x
  where x->>'course_code' ~ '^[A-Z]{3}[0-9]{5}$' and coalesce(x->>'course_name', '') <> ''
  on conflict (code) do update set
    name = case when courses.name is null or courses.name_from_timetable then excluded.name else courses.name end,
    name_from_timetable = courses.name is null or courses.name_from_timetable;
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
  -- sign them out everywhere (refresh tokens go with their sessions)
  if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id = $1' using target; end if;
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
  select replace(replace(replace(replace(
    regexp_replace(replace(coalesce(t, ''), E'\r\n', E'\n'), E'[\\x01-\\x09\\x0B-\\x1F\\x7F]', '', 'g'),
    '\', '\\'), ';', '\;'), ',', '\,'), E'\n', '\n')
$$;
create or replace function public.ics_fold(line text) returns text language plpgsql immutable as $$
declare out text := left(line, 74); rest text := substr(line, 75);
begin
  while length(rest) > 0 loop out := out || E'\r\n ' || left(rest, 73); rest := substr(rest, 74); end loop;
  return out;
end $$;

-- The semester used for timetable exports. With an academic calendar: the admin's choice (setting 'teaching_semester'),
-- else the semester whose lectures are running or come next. Without one: the manual dates in settings.
create or replace function public.teaching_window()
returns table (sem_label text, first_day date, last_day date, from_calendar boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  sem text := nullif((select value from settings where key = 'teaching_semester'), '');
  s date; e date;
begin
  if sem is null or not exists (select 1 from academic_periods p where p.semester = sem and p.kind = 'lecture') then
    sem := null;
    select p.semester into sem from academic_periods p where p.kind = 'lecture'
      group by p.semester having max(p.end_date) >= current_date order by min(p.start_date) limit 1;
    if sem is null then
      select p.semester into sem from academic_periods p where p.kind = 'lecture' group by p.semester order by max(p.end_date) desc limit 1;
    end if;
  end if;
  if sem is not null then
    return query select sem, min(p.start_date), max(p.end_date), true from academic_periods p where p.semester = sem and p.kind = 'lecture';
    return;
  end if;
  s := coalesce(nullif((select value from settings where key = 'semester_start'), '')::date, date_trunc('week', current_date)::date);
  e := coalesce(nullif((select value from settings where key = 'semester_end'), '')::date, s + 14 * 7 - 1);
  if e < s then e := s + 14 * 7 - 1; end if;
  return query select null::text, s, e, false;
end $$;

-- No classes on this day: a break/exam/etc. inside the teaching semester, a public holiday,
-- or (without an academic calendar) the manual break dates
create or replace function public.no_class_day(d date, sem text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from academic_periods p where p.semester = sem and p.kind <> 'lecture' and d between p.start_date and p.end_date)
      or exists (select 1 from academic_events e where e.no_class and d between e.start_date and e.end_date)
      or (sem is null and d between nullif((select value from settings where key = 'break_start'), '')::date
                                and nullif((select value from settings where key = 'break_end'), '')::date)
$$;

-- Build the .ics for one student: weekly classes across the teaching semester (skipping breaks and public holidays),
-- plus the academic calendar's holidays and breaks as all-day events. Times are Malaysia time.
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
      -- UNTIL is in UTC: 23:59:59 Malaysia time on the last day
      'RRULE:FREQ=WEEKLY;UNTIL=' || to_char(w.last_day, 'YYYYMMDD') || 'T155959Z',
      ics_fold('SUMMARY:' || ics_text(coalesce(r.course_code || ' ', '') || coalesce(r.course_name, '') || coalesce(' (' || initcap(r.kind) || ')', ''))),
      case when coalesce(r.venue, '') <> '' then ics_fold('LOCATION:' || ics_text(r.venue)) end,
      ics_fold('DESCRIPTION:' || ics_text(concat_ws(E'\n', 'Lecturer: ' || r.lecturer,
        case when r.custom then 'Added by you in StudyHub' else 'Group: ' || r.section end)))], null);
    if ex is not null then lines := lines || ics_fold('EXDATE;TZID=Asia/Kuala_Lumpur:' || ex); end if;
    lines := lines || 'END:VEVENT'::text;
  end loop;
  -- academic calendar as all-day events (holidays, breaks, revision, exams)
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

-- Admin: replace the academic calendar (periods + dated events) in one go
create or replace function public.admin_save_academic_calendar(periods jsonb, events jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  delete from academic_periods where true;
  delete from academic_events where true;
  insert into academic_periods(session, semester, kind, label, start_date, end_date)
  select left(x->>'session', 20), left(x->>'semester', 60), x->>'kind', left(x->>'label', 80), (x->>'start')::date, (x->>'end')::date
  from jsonb_array_elements(periods) x;
  insert into academic_events(title, start_date, end_date, no_class)
  select left(x->>'title', 300), (x->>'start')::date, (x->>'end')::date, coalesce((x->>'no_class')::boolean, true)
  from jsonb_array_elements(events) x;
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
-- Admin: reply to / change the status of a feedback item (a new reply shows as unread to the student)
create or replace function public.admin_update_feedback(fid bigint, new_status text, reply text) returns void
language plpgsql security definer set search_path = public as $$
declare r text := left(nullif(trim(reply), ''), 4000);
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if new_status not in ('new','open','resolved') then raise exception 'bad status'; end if;
  update feedback set status = new_status,
    replied_at = case when r is distinct from admin_reply then case when r is null then null else now() end else replied_at end,
    reply_seen_at = case when r is distinct from admin_reply then null else reply_seen_at end,
    admin_reply = r
  where id = fid;
end $$;

-- Admin: mark new items as read (they stay open until resolved)
create or replace function public.admin_mark_feedback_read(ids bigint[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  update feedback set status = 'open' where id = any(ids) and status = 'new';
end $$;

revoke execute on all functions in schema public from anon, authenticated, public;
grant execute on function public.is_admin(), public.is_enrolled(text), public.save_courses(jsonb, boolean),
  public.admin_replace_classes(jsonb, boolean), public.class_sections(text[]), public.admin_users(), public.admin_set_role(uuid, text),
  public.admin_reset_password(uuid, text), public.admin_delete_user(uuid),
  public.admin_update_profile(uuid, jsonb), public.my_timetable(uuid), public.my_calendar_ics(),
  public.reset_calendar_token(), public.teaching_window(), public.admin_save_academic_calendar(jsonb, jsonb),
  public.admin_update_feedback(bigint, text, text), public.admin_mark_feedback_read(bigint[]) to authenticated;
grant execute on function public.calendar_feed(uuid) to anon, authenticated;

-- ---------- make yourself admin (run once after you register, with your own student ID) ----------
-- update public.profiles set role = 'admin' where student_id = 'YOUR_STUDENT_ID';
