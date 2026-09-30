-- Security tests for supabase/schema.sql. Needs a Postgres with a mock `auth` schema (see tests/README).
\set ON_ERROR_STOP 1
insert into auth.users(id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a', 'admin@x', '{"student_id":"ADMIN1","name":"Admin"}'),
 ('00000000-0000-0000-0000-00000000000b', 'adam@x',  '{"student_id":"231021306","name":"Adam","phone":"012"}'),
 ('00000000-0000-0000-0000-00000000000c', 'eve@x',   '{"student_id":"999","name":"Eve"}');
update public.profiles set role = 'admin' where student_id = 'ADMIN1';

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000' || u, false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.expect_fail(q text, what text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'ok - blocked: %', what; return; end;
  raise exception 'FAIL - should have been blocked: %', what;
end $$;
create or replace function pg_temp.expect(cond boolean, what text) returns void language plpgsql as $$
begin if not cond then raise exception 'FAIL - %', what; end if; raise notice 'ok - %', what; end $$;

-- Adam (student)
select pg_temp.as_user('b');
select pg_temp.expect((select count(*) from profiles) = 1, 'student sees only own profile');
select pg_temp.expect_fail($$update profiles set role='admin' where id=auth.uid()$$, 'student making self admin');
select pg_temp.expect_fail($$update profiles set student_id='x' where id=auth.uid()$$, 'student changing student ID');
update profiles set phone = '0199' where id = auth.uid();
select save_courses('[{"code":"IMJ41203","name":"Artificial Intelligence","credit":"3","status":"FT","grp":"UR6523002"},{"code":"bad"}]', true);
select pg_temp.expect((select count(*) from enrollments) = 1, 'save_courses enrolls, skips bad codes');
select pg_temp.expect_fail($$insert into enrollments(user_id, course_code) values (auth.uid(), 'IMJ41203')$$, 'direct enrollment insert');
select pg_temp.expect_fail($$insert into courses values ('ABC12345','x',1)$$, 'student inserting course');
select pg_temp.expect_fail($$select admin_users()$$, 'student calling admin_users');
select pg_temp.expect_fail($$select admin_replace_classes('[]')$$, 'student replacing classes');
update profiles set subgroup = 'UR6523002 - Y3G1' where id = auth.uid();
select pg_temp.expect((select subgroup from profiles) = 'UR6523002 - Y3G1', 'student sets own timetable group');
select pg_temp.expect_fail($$select admin_delete_user('00000000-0000-0000-0000-00000000000c')$$, 'student deleting user');
select pg_temp.expect_fail($$select admin_update_profile('00000000-0000-0000-0000-00000000000c', '{"name":"x"}')$$, 'student editing another profile');
update settings set value = 'hacked' where key = 'timetable_url';
select pg_temp.expect((select value from settings where key='timetable_url') <> 'hacked', 'student cannot edit settings');
insert into posts(course_code, kind, title, due_date) values ('IMJ41203', 'assignment', 'Report 1', '2026-10-20');
select pg_temp.expect((select author_sid from posts limit 1) = '231021306', 'post author stamped by trigger');
select pg_temp.expect_fail($$insert into posts(title) values ('general')$$, 'student general post');
insert into posts(course_code, title, user_id) values ('IMJ41203', 'spoof', '00000000-0000-0000-0000-00000000000c');
select pg_temp.expect((select count(*) from posts where user_id <> auth.uid()) = 0, 'cannot post as someone else');
insert into notes(title, body) values ('private', 'secret');
insert into my_classes(course_code, day, start_time, end_time, venue) values ('IMJ41203', 2, '14:00', '15:50', 'DK 9');
select pg_temp.expect_fail($$insert into my_classes(day, start_time, end_time) values (9, '14:00', '15:00')$$, 'invalid day in own class');
insert into assignments(title) values ('mine');
reset role;

-- Eve (student, not enrolled)
select pg_temp.as_user('c');
select pg_temp.expect((select count(*) from notes) = 0 and (select count(*) from assignments) = 0 and (select count(*) from my_classes) = 0, 'cannot see other users notes/assignments/own classes');
select pg_temp.expect((select count(*) from enrollments) = 0, 'cannot see other users enrollments');
select pg_temp.expect((select count(*) from posts) = 2, 'bulletin readable by everyone');
select pg_temp.expect_fail($$insert into posts(course_code, title) values ('IMJ41203','x')$$, 'posting to a subject you are not in');
delete from posts;
select pg_temp.expect((select count(*) from posts) = 2, 'cannot delete others posts');
update notes set body = 'pwned';
delete from notes;
reset role;
select pg_temp.expect((select body from notes) = 'secret', 'others notes untouched');

-- admin
select pg_temp.as_user('a');
select pg_temp.expect((select count(*) from admin_users()) = 3, 'admin lists users');
select pg_temp.expect((select count(*) from my_classes) = 1, 'admin can see a user''s own classes');
select pg_temp.expect(admin_replace_classes('[{"course_code":"IMJ41203","course_name":"Ignored","section":"UR1 - Y1G1","day":1,"start":"08:00","end":"10:00"},{"course_code":"IMJ99999","course_name":"New Course","section":"UR1 - Y1G1","day":2,"start":"08:00","end":"10:00"}]') = 2, 'admin replaces classes');
select pg_temp.expect(admin_replace_classes('[{"course_code":"IMJ41203","section":"UR1 - Y1G2","day":3,"start":"08:00","end":"10:00"}]', false) = 1, 'admin appends a batch');
select pg_temp.expect((select count(*) from classes) = 3, 'batches accumulate');
select pg_temp.expect((select name from courses where code='IMJ99999') = 'New Course' and (select name from courses where code='IMJ41203') = 'Artificial Intelligence', 'timetable fills missing course names only');
select pg_temp.expect((select count(*) from class_sections(array['IMJ41203'])) = 2, 'class_sections lists groups for a course');
update settings set value = 'https://example.edu/t.html' where key = 'timetable_url';
select pg_temp.expect((select value from settings where key='timetable_url') = 'https://example.edu/t.html', 'admin edits timetable link');
insert into posts(title) values ('Campus notice');
select pg_temp.expect((select count(*) from posts where course_code is null) = 1, 'admin general post');
select admin_reset_password('00000000-0000-0000-0000-00000000000c', 'newpassword1');
select pg_temp.expect_fail($$select admin_set_role(auth.uid(), 'student')$$, 'admin demoting self');
select admin_update_profile('00000000-0000-0000-0000-00000000000b', '{"name":"Adam H","phone":"0194145201","year":""}');
select pg_temp.expect((select name || phone from profiles where student_id='231021306') = 'Adam H0194145201', 'admin edits a user profile');
select pg_temp.expect((select count(*) from enrollments where user_id='00000000-0000-0000-0000-00000000000b') = 1, 'admin can see a user''s subjects');
select pg_temp.expect_fail($$select admin_update_profile('00000000-0000-0000-0000-00000000000b', '{"name":""}')$$, 'admin blanking a name');
select admin_set_role('00000000-0000-0000-0000-00000000000b', 'admin');
select admin_delete_user('00000000-0000-0000-0000-00000000000c');
delete from posts where author_sid = '231021306';
reset role;
select pg_temp.expect((select encrypted_password is null from auth.users where id = '00000000-0000-0000-0000-00000000000c') is null, 'deleted user gone');
select pg_temp.expect((select role from profiles where student_id='231021306') = 'admin', 'admin promoted user');
select pg_temp.expect((select count(*) from posts) = 1, 'admin deleted a student post');

-- anon (not logged in) sees nothing
set role anon;
select pg_temp.expect_fail($$select count(*) from posts$$, 'anon reading posts');
reset role;
\echo ALL RLS TESTS PASSED
