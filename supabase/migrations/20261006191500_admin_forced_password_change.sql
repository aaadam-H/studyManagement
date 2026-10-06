alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

create or replace function public.admin_reset_password(target uuid, new_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if length(new_password) < 8 then raise exception 'password must be at least 8 characters'; end if;
  if target = auth.uid() then raise exception 'you cannot reset your own password here'; end if;
  update auth.users set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')) where id = target;
  if not found then raise exception 'user not found'; end if;
  update public.profiles set must_change_password = true where id = target;
  if not found then raise exception 'user profile not found'; end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using target;
  end if;
end $$;

create or replace function public.complete_forced_password_change(new_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare target uuid := auth.uid();
begin
  if target is null then raise exception 'sign in required'; end if;
  if length(new_password) < 8 then raise exception 'password must be at least 8 characters'; end if;
  if not exists (select 1 from public.profiles where id = target and must_change_password) then
    raise exception 'no temporary password change is pending';
  end if;
  update auth.users
    set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf'))
    where id = target;
  if not found then raise exception 'user not found'; end if;
  update public.profiles set must_change_password = false where id = target;
end $$;

revoke all on function public.admin_reset_password(uuid, text) from public, anon;
revoke all on function public.complete_forced_password_change(text) from public, anon;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
grant execute on function public.complete_forced_password_change(text) to authenticated;
