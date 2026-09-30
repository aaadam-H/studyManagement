# StudyHub

Multi-user study planner for UniMAP students. Static site on **GitHub Pages**, data and logins on **Supabase** (free).

- **Accounts**: students register with student ID, name, contact and programme details; log in with student ID + password.
- **Registration slip**: upload the UniMAP course registration slip PDF; it is read in the browser and your courses are saved.
- **Timetable**: built from your courses + the university timetable page. Admins can change the link and re-sync, or upload the saved page.
- **Bulletin**: shared board grouped by subject for assignments, exams and notices. Students post to subjects they're registered for; admins can post general notices.
- **Personal**: dashboard, assignments, calendar, grades, notes (private to each user).
- **Admin**: timetable source, user list, promote/demote, reset passwords, delete users.

**Setup:** follow [SETUP.md](SETUP.md).

## Layout
- `web/`: the site (HTML/CSS/JS, no build step). `config.js` holds the Supabase URL + anon key.
- `supabase/schema.sql`: tables, security rules (RLS) and admin functions. Paste into the Supabase SQL editor.
- `supabase/functions/fetch-timetable/`: Edge Function that fetches the timetable page for admins.
- `tests/`: parser tests (`npm install && npm test`) and database security tests (`tests/rls_test.sql`, run on Postgres after `tests/mock_auth.sql` + `supabase/schema.sql`).

Run locally: `npm run serve`, then open the printed URL (needs `web/config.js` filled in).
