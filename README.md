# StudyHub

A multi-user study planner for UniMAP students. It runs as a static site on **GitHub Pages**, with data and logins on **Supabase** (free tier). There is no build step and no server of your own to run.

## Features

- **Accounts**: students register with their student ID, name, contact and programme details, then log in with student ID + password.
- **Registration slip import**: upload the UniMAP course registration slip PDF. It is parsed in the browser (pdf.js) and your courses are saved.
- **Timetable**: built from your courses and the university timetable page (all groups). Pick a main group, switch groups per subject, or add classes by hand.
- **Calendar export**: download an `.ics` file or subscribe with a live link in Google Calendar or Apple Calendar. Breaks and public holidays are skipped.
- **Academic calendar**: admins upload the university's Kalendar Akademik PDF. Students see the current lecture week, breaks and holidays.
- **Bulletin**: a shared board grouped by subject for assignments, exams and notices. Students post to subjects they're registered for; admins can post general notices.
- **Personal tools**: dashboard, assignments, calendar, grades and notes, each private to its owner.
- **Admin panel**: timetable source and sync, user list, promote/demote, password resets, user deletion, feedback inbox.
- **Onboarding**: a setup guide for new students, a Dashboard checklist and a Help page.
- **Feedback & reports**: students send feedback or bug reports and can report bulletin posts. Admins see a badge with the number of new items, then reply, resolve or remove posts.

## Tech stack

| Part | What it uses |
|------|--------------|
| Frontend | Plain HTML, CSS and JavaScript (ES modules) in `web/` |
| Auth & database | Supabase (Postgres + Row Level Security) |
| Server-side jobs | Supabase Edge Functions (Deno / TypeScript) |
| PDF parsing | pdf.js, vendored in `web/vendor/` |
| Hosting | GitHub Pages, deployed by GitHub Actions |
| Tests | Node test script with `linkedom`, plus SQL tests for the RLS rules |

## Project layout

```
.
├── index.html                  # Redirects to web/
├── web/                        # The site (deployed as-is to GitHub Pages)
│   ├── index.html
│   ├── app.js                  # UI, routing and pages
│   ├── parsers.js              # Slip, timetable and academic-calendar parsers
│   ├── config.js               # Supabase URL + public (anon) key
│   ├── style.css
│   └── vendor/                 # supabase-js and pdf.js builds
├── supabase/
│   ├── schema.sql              # Tables, RLS policies and RPC functions (safe to re-run)
│   └── functions/
│       ├── fetch-timetable/    # Fetches the university timetable page for admins
│       └── calendar-feed/      # Serves each student's timetable as an .ics subscription
├── tests/
│   ├── parsers.test.mjs        # Parser tests
│   ├── rls_test.sql            # Database security tests
│   ├── mock_auth.sql           # Minimal auth schema for running the RLS tests on plain Postgres
│   └── fixtures/               # Sample slip, timetable and academic-calendar inputs
└── .github/workflows/pages.yml # Deploys web/ to GitHub Pages on push to main
```

## Getting started

Full step-by-step instructions (about 20 minutes, no credit card) are in **[SETUP.md](SETUP.md)**. In short:

1. Create a free Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Under Authentication → Email, turn off **Confirm email** (student IDs are mapped to internal addresses with no real inbox).
4. Deploy the `fetch-timetable` and `calendar-feed` Edge Functions.
5. Put your project URL and **anon / publishable** key in `web/config.js`.
6. In the repo settings, set Pages → Source to **GitHub Actions**, then push to `main`.
7. Register on the site and promote your account to admin with SQL (see SETUP.md).

### Configuration

`web/config.js`:

```js
window.STUDYHUB_CONFIG = {
  SUPABASE_URL: 'https://<your-project-ref>.supabase.co',
  SUPABASE_ANON_KEY: '<your-anon-or-publishable-key>',
  LOGIN_EMAIL_DOMAIN: 'students.studyhub.app', // don't change once people have registered
};
```

> **Security note:** the anon/publishable key is designed to be public, and access control is enforced by the Row Level Security policies in `supabase/schema.sql`. **Never** put the `service_role` / secret key in this repo or anywhere in `web/`.

## Development

```bash
npm install
```

```bash
npm test
```

```bash
npm run serve
```

- `npm test` runs the parser tests against the fixtures in `tests/fixtures/`.
- `npm run serve` serves `web/` locally. It needs `web/config.js` filled in.
- `npm run vendor` refreshes the vendored supabase-js and pdf.js builds from `node_modules`.

To run the database security tests, use a scratch Postgres database and load `tests/mock_auth.sql`, then `supabase/schema.sql`, then `tests/rls_test.sql`.

## Deployment

Every push to `main` that touches `web/**` triggers the **Deploy to GitHub Pages** workflow, which publishes the `web/` folder. To change the database, re-run `supabase/schema.sql` in the SQL Editor; it is written to be safe to run again.

## Notes

- Free Supabase projects pause after about a week of inactivity. Click **Restore** in the dashboard; no data is lost.
- Each semester, an admin pastes the new timetable link and syncs. Each academic year, they upload the new academic calendar PDF.

## Third-party licenses

`web/vendor/` includes [supabase-js](https://github.com/supabase/supabase-js) (MIT) and [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0). Their license texts are in the same folder.
