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

revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_admin(), public.is_enrolled(text), public.save_courses(jsonb, boolean),
  public.admin_replace_classes(jsonb, boolean), public.class_sections(text[]), public.admin_users(), public.admin_set_role(uuid, text),
  public.admin_reset_password(uuid, text), public.admin_delete_user(uuid),
  public.admin_update_profile(uuid, jsonb) to authenticated;

-- ---------- make yourself admin (run once after you register, with your own student ID) ----------
-- update public.profiles set role = 'admin' where student_id = '231021306';
