-- Security tests for supabase/schema.sql. Needs a Postgres with a mock `auth` schema (see tests/README).
\set ON_ERROR_STOP 1
insert into auth.users(id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a', 'admin1@x', '{"student_id":"ADMIN1","name":"Admin"}'),
 ('00000000-0000-0000-0000-00000000000b', '200000001@x',  '{"student_id":"200000001","name":"Adam","phone":"012"}'),
 ('00000000-0000-0000-0000-00000000000c', '999@x',   '{"student_id":"999","name":"Eve"}');
update public.profiles set role = 'admin' where student_id = 'ADMIN1';
insert into auth.sessions(user_id) values ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000c');


create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000' || u, false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.expect_fail(q text, what text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'ok - blocked: %', what; return; end;
  raise exception 'FAIL - should have been blocked: %', what;
end $$;
create or replace function pg_temp.expect(cond boolean, what text) returns void language plpgsql as $$
begin if not cond then raise exception 'FAIL - %', what; end if; raise notice 'ok - %', what; end $$;

-- sign-up hardening: the student ID comes from the login email, not from free-form sign-up data
insert into auth.users(id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e1', 'mallory1@x', '{"student_id":"200000001-x","name":"<b>M</b>","year":"abc"}');
select pg_temp.expect((select student_id || '|' || coalesce(year::text, 'null') from profiles where id = '00000000-0000-0000-0000-0000000000e1') = 'mallory1|null', 'sign-up: student ID taken from login, junk year ignored');
select pg_temp.expect_fail($$insert into auth.users(id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e2', 'a b<i>@x', '{}')$$, 'sign-up with an invalid student ID');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e1';

-- Adam (student)
select pg_temp.as_user('b');
select pg_temp.expect((select count(*) from profiles) = 1, 'student sees only own profile');
select pg_temp.expect_fail($$update profiles set role='admin' where id=auth.uid()$$, 'student making self admin');
select pg_temp.expect_fail($$update profiles set student_id='x' where id=auth.uid()$$, 'student changing student ID');
update profiles set phone = '0199' where id = auth.uid();
select save_courses('[{"code":"IMJ41203","name":"Artificial Intelligence","credit":"3","status":"FT","grp":"UR6523002"},{"code":"bad"}]', true);
select pg_temp.expect((select count(*) from enrollments) = 1, 'save_courses enrolls, skips bad codes');
select pg_temp.expect_fail($$insert into enrollments(user_id, course_code) values (auth.uid(), 'IMJ41203')$$, 'direct enrollment insert');
select pg_temp.expect_fail($$select save_courses((select jsonb_agg(jsonb_build_object('code', 'IMJ' || (40000 + g))) from generate_series(1, 31) g))$$, 'more than 30 courses at once');
select pg_temp.expect_fail($$insert into notes(title, body) values ('big', repeat('x', 20001))$$, 'oversized note');
select pg_temp.expect_fail($$insert into courses values ('ABC12345','x',1)$$, 'student inserting course');
select pg_temp.expect_fail($$select admin_users()$$, 'student calling admin_users');
select pg_temp.expect_fail($$select admin_replace_classes('[]')$$, 'student replacing classes');
update profiles set subgroup = 'UR6523002 - Y3G1' where id = auth.uid();
select pg_temp.expect((select subgroup from profiles) = 'UR6523002 - Y3G1', 'student sets own timetable group');
select pg_temp.expect((select onboarded_at is null from profiles), 'new student starts with the setup guide');
update profiles set onboarded_at = now() where id = auth.uid();
select pg_temp.expect((select onboarded_at is not null from profiles), 'student can mark setup as done');
update profiles set muted_subjects = '{IMJ41203}' where id = auth.uid();
select pg_temp.expect((select muted_subjects from profiles) = '{IMJ41203}', 'student mutes a bulletin subject');
select pg_temp.expect_fail($$update profiles set muted_subjects = (select array_agg('X' || g) from generate_series(1, 101) g) where id = auth.uid()$$, 'muting more than 100 subjects');
select pg_temp.expect_fail($$update profiles set bulletin_seen_at = now() + interval '1 year' where id = auth.uid()$$, 'setting bulletin_seen_at directly');
select pg_temp.expect(mark_bulletin_seen() is not null, 'student marks bulletin as seen');
update profiles set muted_subjects = '{}' where id = auth.uid();
select pg_temp.expect_fail($$select admin_delete_user('00000000-0000-0000-0000-00000000000c')$$, 'student deleting user');
select pg_temp.expect_fail($$select admin_update_profile('00000000-0000-0000-0000-00000000000c', '{"name":"x"}')$$, 'student editing another profile');
update settings set value = 'hacked' where key = 'timetable_url';
select pg_temp.expect((select value from settings where key='timetable_url') <> 'hacked', 'student cannot edit settings');
insert into posts(course_code, kind, title, due_date) values ('IMJ41203', 'assignment', 'Report 1', '2026-10-20');
select pg_temp.expect((select author_sid from posts limit 1) = '200000001', 'post author stamped by trigger');
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
select pg_temp.expect_fail($$select * from my_timetable('00000000-0000-0000-0000-00000000000b')$$, 'student reading another timetable');
select pg_temp.expect_fail($$select build_ics('00000000-0000-0000-0000-00000000000b')$$, 'student calling build_ics directly');
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
select admin_replace_classes('[{"course_code":"IMJ99999","course_name":"Better Timetable Name","section":"UR1 - Y1G1","day":2,"start":"08:00","end":"10:00"}]', false);
select pg_temp.expect((select name from courses where code='IMJ99999') = 'Better Timetable Name', 'a newer timetable name replaces a timetable name');
reset role;
select pg_temp.as_user('b');
select save_courses('[{"code":"IMJ99999","name":"Slip Name","credit":"3"}]', false);
delete from enrollments where course_code = 'IMJ99999';
reset role;
select pg_temp.as_user('a');
select pg_temp.expect((select name from courses where code='IMJ99999') = 'Slip Name', 'slip name replaces a timetable name');
select admin_replace_classes('[{"course_code":"IMJ99999","course_name":"Timetable Again","section":"UR1 - Y1G1","day":2,"start":"08:00","end":"10:00"}]', false);
select pg_temp.expect((select name from courses where code='IMJ99999') = 'Slip Name', 'timetable does not overwrite a slip name');
update settings set value = 'https://example.edu/t.html' where key = 'timetable_url';
select pg_temp.expect((select value from settings where key='timetable_url') = 'https://example.edu/t.html', 'admin edits timetable link');
insert into posts(title) values ('Campus notice');
select pg_temp.expect((select count(*) from posts where course_code is null) = 1, 'admin general post');
insert into posts(course_code, kind, title) values ('IMJ41203', 'update', 'New timetable is out');
select pg_temp.expect((select author_name || '|' || coalesce(author_sid, '-') || '|' || coalesce(course_code, 'everyone') from posts where kind = 'update') = 'ADMIN|-|everyone', 'update hides the admin name and goes to everyone');
reset role;
select pg_temp.as_user('b');
select pg_temp.expect_fail($$insert into posts(course_code, kind, title) values ('IMJ41203', 'update', 'fake')$$, 'student posting an update');
insert into update_dismissals(post_id) select id from posts where kind = 'update';
select pg_temp.expect((select count(*) from update_dismissals) = 1, 'student dismisses an update');
select pg_temp.expect_fail($$insert into update_dismissals(user_id, post_id) select '00000000-0000-0000-0000-00000000000c', id from posts where kind = 'update'$$, 'dismissing for someone else');
reset role;
select pg_temp.as_user('c');
select pg_temp.expect((select count(*) from update_dismissals) = 0, 'cannot see other users dismissals');
reset role;
select pg_temp.as_user('a');
delete from posts where kind = 'update';
select admin_reset_password('00000000-0000-0000-0000-00000000000c', 'newpassword1');
reset role;
select pg_temp.expect((select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-00000000000c') = 0, 'password reset signs the user out');
select pg_temp.as_user('a');
select pg_temp.expect_fail($$select admin_set_role(auth.uid(), 'student')$$, 'admin demoting self');
select admin_update_profile('00000000-0000-0000-0000-00000000000b', '{"name":"Adam H","phone":"0120000000","year":""}');
select pg_temp.expect((select name || phone from profiles where student_id='200000001') = 'Adam H0120000000', 'admin edits a user profile');
select pg_temp.expect((select count(*) from enrollments where user_id='00000000-0000-0000-0000-00000000000b') = 1, 'admin can see a user''s subjects');
select pg_temp.expect_fail($$select admin_update_profile('00000000-0000-0000-0000-00000000000b', '{"name":""}')$$, 'admin blanking a name');
select admin_set_role('00000000-0000-0000-0000-00000000000b', 'admin');
select admin_delete_user('00000000-0000-0000-0000-00000000000c');
delete from posts where author_sid = '200000001';
reset role;
select pg_temp.expect((select encrypted_password is null from auth.users where id = '00000000-0000-0000-0000-00000000000c') is null, 'deleted user gone');
select pg_temp.expect((select role from profiles where student_id='200000001') = 'admin', 'admin promoted user');
select pg_temp.expect((select count(*) from posts) = 1, 'admin deleted a student post');

-- calendar export
insert into settings(key, value) values ('semester_start', '2026-10-05'), ('semester_end', '2026-12-27'), ('break_start', '2026-11-16'), ('break_end', '2026-11-22')
  on conflict (key) do update set value = excluded.value;
select pg_temp.as_user('b');
update enrollments set section = 'UR1 - Y1G2' where course_code = 'IMJ41203';
select pg_temp.expect((select count(*) from my_timetable()) = 2, 'my_timetable: chosen group + own class');
create temp table ics as select my_calendar_ics() as t;
grant select, insert, delete on ics to authenticated;
select pg_temp.expect((select t like '%DTSTART;TZID=Asia/Kuala_Lumpur:20261007T080000%' from ics), 'ics: Wednesday class starts first Wednesday of semester');
select pg_temp.expect((select t like '%DTSTART;TZID=Asia/Kuala_Lumpur:20261006T140000%' from ics), 'ics: own Tuesday class included');
select pg_temp.expect((select t like '%RRULE:FREQ=WEEKLY;UNTIL=20261227T155959Z%' from ics), 'ics: repeats weekly until semester end');
select pg_temp.expect((select t like '%EXDATE;TZID=Asia/Kuala_Lumpur:20261118T080000%' and t like '%EXDATE;TZID=Asia/Kuala_Lumpur:20261117T140000%' from ics), 'ics: skips mid-semester break');
select pg_temp.expect((select t like '%LOCATION:DK 9%' and t like E'%\r\nEND:VCALENDAR\r\n' from ics), 'ics: venue + CRLF line endings');
update enrollments set section = 'none' where course_code = 'IMJ41203';
select pg_temp.expect((select count(*) from my_timetable()) = 1, 'hidden subject left out');
reset role;
\o /var/tmp/shpg/test.ics
\pset format unaligned
\pset tuples_only on
select t from ics;
\pset format aligned
\pset tuples_only off
\o
select pg_temp.as_user('b');
create temp table tok as select calendar_token as t from profiles where id = auth.uid();
reset role;
grant select on tok to anon, authenticated;
set role anon;
select pg_temp.expect((select calendar_feed(t) from tok) like 'BEGIN:VCALENDAR%', 'feed works with the secret token (no login)');
select pg_temp.expect(calendar_feed(gen_random_uuid()) is null, 'feed returns nothing for a wrong token');
select pg_temp.expect_fail($$select my_calendar_ics()$$, 'anon download blocked');
reset role;
select pg_temp.as_user('b');
select pg_temp.expect(reset_calendar_token() <> (select t from tok), 'reset gives a new link');
reset role;
set role anon;
select pg_temp.expect((select calendar_feed(t) from tok) is null, 'old link stops working');
reset role;

-- feedback and reports
reset role;
insert into auth.users(id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000d', '555@x', '{"student_id":"555","name":"Dan"}');
select pg_temp.as_user('d');
insert into feedback(kind, subject, message) values ('bug', 'Calendar broken', 'It shows the wrong week');
select pg_temp.expect((select user_id = auth.uid() and status = 'new' from feedback), 'feedback saved as new, owned by sender');
select pg_temp.expect_fail($$insert into feedback(kind, subject, message, status) values ('bug', 'x', 'y', 'resolved')$$, 'sender setting status');
select pg_temp.expect_fail($$insert into feedback(subject, message, admin_reply) values ('x', 'y', 'fake reply')$$, 'sender writing a reply');
select pg_temp.expect_fail($$update feedback set status = 'resolved'$$, 'sender resolving own feedback');
select pg_temp.expect_fail($$select admin_update_feedback(1, 'resolved', 'x')$$, 'student using admin feedback functions');
insert into feedback(kind, subject, message, post_id, page) values ('report', 'Spam post', 'Please remove', (select min(id) from posts), 'bulletin');
select pg_temp.expect((select post_title is not null from feedback where kind = 'report'), 'reported post title taken from the post');
insert into feedback(kind, subject, message, post_id) values ('report', 'Ghost', 'no such post', 999999);
select pg_temp.expect((select post_id is null and post_title is null from feedback where subject = 'Ghost'), 'report of a missing post keeps no reference');
select pg_temp.expect_fail($$insert into feedback(subject, message) select 's' || g, 'm' from generate_series(1, 8) g$$, 'more than 10 feedback items in an hour');
reset role;
select pg_temp.as_user('b');
select pg_temp.expect((select count(*) from feedback where user_id = '00000000-0000-0000-0000-00000000000d') = 3, 'admin sees everyone''s feedback');
select admin_mark_feedback_read(array(select id from feedback where subject = 'Calendar broken'));
select admin_update_feedback((select id from feedback where subject = 'Calendar broken'), 'resolved', 'Fixed, thanks!');
reset role;
select pg_temp.as_user('d');
select pg_temp.expect((select status || '|' || admin_reply || '|' || (reply_seen_at is null)::text from feedback where subject = 'Calendar broken') = 'resolved|Fixed, thanks!|true', 'sender sees the reply as unread');
update feedback set reply_seen_at = now() where subject = 'Calendar broken';
select pg_temp.expect((select reply_seen_at is not null from feedback where subject = 'Calendar broken'), 'sender marks reply as seen');
delete from feedback;
select pg_temp.expect((select count(*) from feedback) = 3, 'sender cannot delete feedback');
reset role;
insert into auth.users(id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000f', 'fay1@x', '{"name":"Fay"}');
select pg_temp.as_user('f');
select pg_temp.expect((select count(*) from feedback) = 0, 'students cannot see others'' feedback');
reset role;
select pg_temp.as_user('b');
delete from feedback where subject = 'Ghost';
select pg_temp.expect((select count(*) from feedback) = 2, 'admin deletes feedback');
reset role;

-- academic calendar drives the export
select pg_temp.as_user('b');
reset role;
select pg_temp.as_user('a');
select admin_save_academic_calendar(
  '[{"session":"2026/2027","semester":"Semester 1 2026/2027","kind":"lecture","label":"Lectures","start":"2026-10-05","end":"2026-11-29"},
    {"session":"2026/2027","semester":"Semester 1 2026/2027","kind":"mid_break","label":"Mid-semester break","start":"2026-11-30","end":"2026-12-06"},
    {"session":"2026/2027","semester":"Semester 1 2026/2027","kind":"lecture","label":"Lectures","start":"2026-12-07","end":"2027-01-17"},
    {"session":"2026/2027","semester":"Semester 1 2026/2027","kind":"exam","label":"Final examination","start":"2027-01-25","end":"2027-02-07"},
    {"session":"2026/2027","semester":"Semester 2 2026/2027","kind":"lecture","label":"Lectures","start":"2027-03-08","end":"2027-05-16"}]',
  '[{"title":"Test Holiday","start":"2026-10-20","end":"2026-10-20","no_class":true},
    {"title":"Convocation","start":"2026-11-17","end":"2026-11-17","no_class":false},
    {"title":"Hari Krismas / Christmas","start":"2026-12-25","end":"2026-12-25"}]');
insert into settings(key, value) values ('teaching_semester', 'Semester 1 2026/2027') on conflict (key) do update set value = excluded.value;
select pg_temp.expect((select sem_label || first_day || last_day from teaching_window()) = 'Semester 1 2026/20272026-10-052027-01-17', 'teaching window = lecture weeks of the chosen semester');
reset role;
select pg_temp.as_user('b');

delete from ics;
insert into ics select my_calendar_ics();
select pg_temp.expect((select t like '%DTSTART;TZID=Asia/Kuala_Lumpur:20261006T140000%' and t like '%RRULE:FREQ=WEEKLY;UNTIL=20270117T155959Z%' from ics), 'ics: classes run from first to last lecture week');
select pg_temp.expect((select t like '%20261020T140000%' and t like '%20261201T140000%' and t not like '%20261117T140000%' from ics), 'ics: skips holiday + mid-sem break, not info events');
select pg_temp.expect((select t like '%DTSTART;VALUE=DATE:20261225%' and t like '%SUMMARY:Mid-semester break (Semester 1 2026/2027)%' from ics), 'ics: holidays and breaks as all-day events');
reset role;
update courses set name = E'Evil\r\nBEGIN:VEVENT\rX' where code = 'IMJ41203';
insert into my_classes(user_id, course_code, day, start_time, end_time) values ('00000000-0000-0000-0000-00000000000b', 'IMJ41203', 4, '09:00', '10:00');
select pg_temp.as_user('b');
select pg_temp.expect((select position('Evil' || E'\r' in t) = 0 and position('Evil\nBEGIN:VEVENTX' in t) > 0 from (select my_calendar_ics() t) z), 'ics: control characters in names cannot inject lines');
reset role;
select pg_temp.as_user('d');
select pg_temp.expect_fail($$select admin_save_academic_calendar('[]', '[]')$$, 'student replacing academic calendar');
select pg_temp.expect((select count(*) from academic_events) = 3 and (select count(*) from academic_periods) = 5, 'students can read the academic calendar');
select pg_temp.expect_fail($$insert into academic_events(title, start_date, end_date) values ('x', current_date, current_date)$$, 'student adding a holiday directly');
reset role;

-- anon (not logged in) sees nothing
set role anon;
select pg_temp.expect_fail($$select count(*) from posts$$, 'anon reading posts');
reset role;
\echo ALL RLS TESTS PASSED
