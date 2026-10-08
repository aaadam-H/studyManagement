alter table public.profiles
  add column if not exists last_access_at timestamptz;

grant update (last_access_at) on public.profiles to authenticated;

create or replace function public.record_last_access() returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare
  target_id uuid := auth.uid();
  recorded_at timestamptz := pg_catalog.clock_timestamp();
begin
  if target_id is null then raise exception 'sign in required'; end if;
  update public.profiles set last_access_at = recorded_at where id = target_id;
  if not found then raise exception 'profile not found'; end if;
  return recorded_at;
end $$;

create or replace function public.admin_users_with_access()
returns table (id uuid, student_id text, name text, email text, phone text, program text, role text, created_at timestamptz, courses bigint, last_access_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select u.id, u.student_id, u.name, u.email, u.phone, u.program, u.role, u.created_at, u.courses, p.last_access_at
  from public.admin_users() as u
  join public.profiles as p on p.id = u.id
$$;

revoke all on function public.record_last_access() from public, anon;
revoke all on function public.admin_users_with_access() from public, anon, authenticated;
grant execute on function public.record_last_access() to authenticated;
grant execute on function public.admin_users_with_access() to authenticated;
