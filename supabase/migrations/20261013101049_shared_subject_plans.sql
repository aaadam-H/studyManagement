-- Manual registration is a plan, separate from university enrolments and calendar feeds.
create or replace function public.valid_subject_plan(subjects jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select case when jsonb_typeof(subjects) <> 'array' then false else
    jsonb_array_length(subjects) <= 100 and
    coalesce((select bool_and(coalesce(
      jsonb_typeof(item) = 'object'
      and jsonb_typeof(item->'code') = 'string'
      and (item->>'code') ~ '^[A-Z]{3}[0-9]{5}$'
      and jsonb_typeof(item->'section') = 'string'
      and length(trim(item->>'section')) between 1 and 200
    , false)) from jsonb_array_elements(subjects) item), true)
    and (select count(distinct item->>'code') from jsonb_array_elements(subjects) item) = jsonb_array_length(subjects)
  end
$$;
revoke all on function public.valid_subject_plan(jsonb) from public, anon;
grant execute on function public.valid_subject_plan(jsonb) to authenticated, service_role;

create table public.subject_plans (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  subjects jsonb not null default '[]'::jsonb,
  constraint subject_plans_valid check (public.valid_subject_plan(subjects))
);
alter table public.subject_plans enable row level security;
revoke all on table public.subject_plans from public, anon, authenticated;
grant select, insert, update on table public.subject_plans to authenticated;
grant all on table public.subject_plans to service_role;
create policy subject_plans_read on public.subject_plans for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy subject_plans_insert on public.subject_plans for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy subject_plans_update on public.subject_plans for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
