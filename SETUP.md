# Setting up StudyHub (free: GitHub Pages + Supabase)

About 20 minutes. No credit card needed.

## 1. Create the Supabase project
1. Go to **supabase.com**, then **Start your project** and sign in with GitHub.
2. **New project**: any name (e.g. `studyhub`), set a database password (save it somewhere), region **Southeast Asia (Singapore)**, Free plan. Wait until it finishes setting up.

## 2. Create the database
1. Left menu, **SQL Editor**, then **New query**.
2. Open `supabase/schema.sql` from this repo, copy **all** of it, paste, then click **Run**. You should see "Success. No rows returned". Re-run the full file when upgrading an existing StudyHub database so the guest read-only policies and safe public feed functions are installed.

## 3. Let students log in with their student ID
Left menu, **Authentication**, then **Sign In / Providers** (or **Providers**), then **Email**:
- keep **Email** enabled
- turn **OFF "Confirm email"**, then **Save**

(Students log in with student ID + password. Internally the ID becomes a made-up email, so there is no real inbox to confirm.)

## 4. Deploy the timetable fetcher (Edge Function)
1. Left menu, **Edge Functions**, then **Deploy a new function**, then **Via Editor**.
2. Name it exactly **`fetch-timetable`**.
3. Replace the sample code with the contents of `supabase/functions/fetch-timetable/index.ts`, then **Deploy**.
4. Leave "Verify JWT" / "Enforce JWT" **on**.

## 4a. Automatic changelog drafts
1. Create an Edge Function named **`changelog-ingest`** from `supabase/functions/changelog-ingest/index.ts`.
2. Turn **Verify JWT / Enforce JWT OFF** for this function. Its code verifies a short-lived GitHub Actions OIDC token itself and only accepts this repository's changelog workflow on `main`.
3. Each push to `main` creates a **private** changelog draft. An admin can review, edit and publish it from **Manage changelog**. The app does not expose the service-role key to GitHub or the browser.

## 5. Connect the website to Supabase
1. Click **Connect** at the top of the dashboard (or Project Settings, then **API**).
2. Copy the **Project URL** and the **anon / publishable** key. **Not** the `service_role` / secret key.
3. Put them in `web/config.js` and commit (or send them to Claude to do it). The anon key is meant to be public.

## 6. Publish on GitHub Pages
1. GitHub Pages is free only for **public** repos: repo **Settings**, **General**, then **Change visibility** to Public.
   Nothing secret is in the repo; the database rules protect the data.
2. Repo **Settings**, **Pages**, then under **Build and deployment** set Source = **GitHub Actions**.
3. Merge this work into `main` (via the pull request). The "Deploy to GitHub Pages" action runs and the site appears at
   **https://aaadam-h.github.io/studyManagement/** (the Actions tab shows progress).

## 7. Make yourself admin
1. Open the site, click **Register**, create your account with your student ID.
2. In Supabase **SQL Editor** run (with your ID):
   ```sql
   update public.profiles set role = 'admin' where student_id = 'YOUR_STUDENT_ID';
   ```
3. Reload the site. An **Admin** tab appears.

## 8. Load the timetable
Admin tab, paste the university timetable link, then **Save & sync now**. Every group on the page is loaded (about 6,000 classes).
If sync fails (university site unreachable from Supabase), open the timetable page in your browser, **Save as** HTML,
then use **Upload & parse** on the Admin tab. Each new semester: paste the new link and sync again.

Students then open **Timetable**, pick their main group, change the group for any subject they take with another group
(mix and match), and can add classes by hand for anything missing. Guests can browse the shared university timetable, bulletin and academic calendar without logging in, but all personal uploads, edits and admin actions remain login-gated.

## 9. Calendar apps (Google / Apple)
1. Supabase, **Edge Functions**, deploy or update **`calendar-feed`** with both
   `supabase/functions/calendar-feed/index.ts` and `supabase/functions/calendar-feed/filter.js`.
   The website offers all-in-one, separate category subscriptions, and a ZIP of separate calendar files. A GitHub Pages push
   does not update this function; redeploy it separately. Include both files (for example, as a function ZIP in the Dashboard
   editor or by deploying the function directory with the Supabase CLI); do not paste only `index.ts`.
2. Open the function's **Details** and turn **Verify JWT / Enforce JWT verification OFF**. Calendar apps can't log in;
   each student's link carries a secret token instead, and the database only answers for a valid token.
3. Site, **Admin**, **Academic calendar**: upload the university's Kalendar Akademik PDF, check the preview (untick "No classes"
   for info-only items), then **Save**. This sets lecture weeks, breaks and public holidays for the Calendar page and for exports.
   Upload the new PDF each academic year. (No PDF? Use **Manual semester dates** instead.)

Students then use the **Add to your calendar app** box on the Timetable page: **Download .ics** (Apple Calendar / Outlook,
one-time copy), **Connect Google Calendar** or **Subscribe in Apple Calendar** (live, updates by itself).

## Good to know
- **Free-tier pause**: Supabase pauses free projects after about a week with no activity. Open the Supabase dashboard and click **Restore**; no data is lost.
- **Forgotten passwords**: the sign-in page's **Forgot password?** option directs students to contact the admin. Admins can reset passwords on the Admin tab.
- **Backups**: Supabase dashboard, **Database**, **Backups**, or export tables from the Table Editor.
- **Updating the app**: change files in `web/`, merge to `main`, and Pages redeploys automatically. Database changes: re-run `supabase/schema.sql` (safe to re-run).
