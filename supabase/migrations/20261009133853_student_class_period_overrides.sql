create table if not exists public.class_period_overrides (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  course_code text not null,
  section text not null,
  original_day int not null check (original_day between 1 and 7),
  original_start_time text not null check (original_start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  original_end_time text not null check (original_end_time ~ '^[0-2][0-9]:[0-5][0-9]$' and original_end_time > original_start_time),
  override_day int not null check (override_day between 1 and 7),
  override_start_time text not null check (override_start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  override_end_time text not null check (override_end_time ~ '^[0-2][0-9]:[0-5][0-9]$' and override_end_time > override_start_time),
  updated_at timestamptz not null default now(),
  unique (user_id, course_code, section, original_day, original_start_time, original_end_time)
);

alter table public.class_period_overrides enable row level security;
create policy own_class_period_overrides on public.class_period_overrides
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy admin_read_class_period_overrides on public.class_period_overrides
  for select to authenticated using (public.is_admin());
revoke all on public.class_period_overrides from anon, authenticated;
grant select, insert, update, delete on public.class_period_overrides to authenticated;
grant usage, select on sequence public.class_period_overrides_id_seq to authenticated;

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
  select cl.course_code, pick.name, cl.section, coalesce(o.override_day, cl.day),
    coalesce(o.override_start_time, cl.start_time), coalesce(o.override_end_time, cl.end_time),
    cl.kind, cl.venue, cl.lecturer, false
  from pick join classes cl on cl.course_code = pick.course_code and cl.section = pick.chosen
  left join public.class_period_overrides o on o.user_id = uid and o.course_code = cl.course_code and o.section = cl.section
    and o.original_day = cl.day and o.original_start_time = left(cl.start_time, 5) and o.original_end_time = left(cl.end_time, 5)
  union all
  select m.course_code, coalesce(nullif(m.title, ''), c.name), 'added by you', m.day, m.start_time, m.end_time,
    m.kind, m.venue, null, true
  from my_classes m left join courses c on c.code = m.course_code where m.user_id = uid
$$;
