# Tests

Admin browser regression: run `npm run test:browser` with Chromium installed. It uses `/usr/bin/chromium` by default; set `CHROMIUM_EXECUTABLE_PATH` for another location. The test uses fixture accounts and the production DOMPurify, form handlers, planner, and canvas renderer.

`shared-subject-plans.sql` checks live RLS with two existing students and an admin. All writes are rolled back and the result exposes no student data.
