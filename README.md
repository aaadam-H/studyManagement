# StudyHub

Multi-user study planner for UniMAP students.

- **Accounts**: register with student ID (matric), name, programme, etc. Admin panel for user management.
- **Registration slip**: upload the UniMAP course registration slip PDF; courses are read and saved.
- **Timetable**: built from your courses + a university timetable page. The link is editable in Admin and can be re-synced any time (or upload the saved HTML).
- **Bulletin**: shared board grouped by subject for assignments / exams / notices.
- **Personal**: assignments, grades, notes, calendar, dashboard.
- **Database**: SQLite (single file `data/studyhub.db`) - free, no server or signup.

## Run

Requires Node 22.13+.

```sh
npm install
ADMIN_PASSWORD='choose-a-strong-password' npm start   # http://localhost:3000
```

The first start creates the admin account (`admin`; override with `ADMIN_USERNAME`). Without `ADMIN_PASSWORD` a random password is generated and printed once in the console.
Env: `PORT`, `DATA_DIR` (where the DB lives), `NODE_ENV=production` (secure cookies, use behind HTTPS).

`npm test` runs an end-to-end smoke test on a throwaway DB (set `SLIP_PDF=/path/to/slip.pdf` to include a real slip).

## Notes

- Back up by copying `data/studyhub.db`.
- The timetable parser handles "days vertical" tables (rows = days, columns = time slots) and the transposed layout, and only the table named in the link's `#table_xxxx` if present. If the university changes its page format, adjust `server/timetable.js`.
- The IC number on the slip is not stored.
