-- Run against a configured project. All test writes are rolled back; no student data is returned.
begin;
do $$ begin
  perform set_config('test.plan_owner', (select id::text from public.profiles where role = 'student' order by id limit 1), true);
  perform set_config('test.plan_other', (select id::text from public.profiles where role = 'student' order by id offset 1 limit 1), true);
  perform set_config('test.plan_admin', (select id::text from public.profiles where role = 'admin' order by id limit 1), true);
  if current_setting('test.plan_owner', true) is null or current_setting('test.plan_other', true) is null or current_setting('test.plan_admin', true) is null then raise exception 'Need two students and one admin'; end if;
end $$;
-- Remove only the fixture owner's saved row within this rollback-only transaction.
delete from public.subject_plans where user_id = current_setting('test.plan_owner')::uuid;
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', current_setting('test.plan_owner'), true);
  insert into public.subject_plans(user_id, subjects) values (auth.uid(), '[{"code":"IMJ47403","section":"Y4G1"},{"code":"IMJ21303","section":"Y2G1"}]');
  if (select jsonb_array_length(subjects) from public.subject_plans where user_id = auth.uid()) <> 2 then raise exception 'Owner save/read failed'; end if;
  begin
    insert into public.subject_plans(user_id, subjects) values(current_setting('test.plan_other')::uuid, '[]');
    raise exception 'Foreign insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.subject_plans set user_id=current_setting('test.plan_other')::uuid where user_id=auth.uid();
    raise exception 'Ownership reassignment allowed';
  exception when insufficient_privilege then null; end;
  if public.valid_subject_plan('[{}]') or public.valid_subject_plan('[{"code":"IMJ47403"}]') or public.valid_subject_plan('[{"code":"bad","section":"G1"}]') or public.valid_subject_plan('[{"code":"IMJ47403","section":" "}]') or public.valid_subject_plan('{}') or public.valid_subject_plan('[{"code":"IMJ47403","section":"G1"},{"code":"IMJ47403","section":"G2"}]') then raise exception 'Invalid plan accepted'; end if;
  if not public.valid_subject_plan('[]') then raise exception 'Empty plan rejected'; end if;
  update public.subject_plans set subjects='[]' where user_id=auth.uid();
  if (select jsonb_array_length(subjects) from public.subject_plans where user_id=auth.uid())<>0 then raise exception 'Clear failed'; end if;
  perform set_config('request.jwt.claim.sub', current_setting('test.plan_other'), true);
  if exists(select 1 from public.subject_plans where user_id=current_setting('test.plan_owner')::uuid) then raise exception 'Another student sees plan'; end if;
  perform set_config('request.jwt.claim.sub', current_setting('test.plan_admin'), true);
  if not exists(select 1 from public.subject_plans where user_id=current_setting('test.plan_owner')::uuid) then raise exception 'Admin cannot view student plan'; end if;
  update public.subject_plans set subjects='[{"code":"IMJ47403","section":"G1"}]' where user_id=current_setting('test.plan_owner')::uuid;
  if found then raise exception 'Admin edited another student plan'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform 1 from public.subject_plans; raise exception 'Anonymous access allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: owner save/clear, student isolation, admin read-only access, anonymous denial, and payload validation' as result;
