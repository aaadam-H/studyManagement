# Password Reset Email WIP Handoff

Updated: 2026-10-07 (Asia/Kuala_Lumpur)

## Resume point

Continue on branch `codex/password-reset-email-wip`. This branch was created from main at merge commit `b80ea3e910d5e249ce448ad831b41b9a8f287ca7` (PR #16). Do not cherry-pick the email-reset implementation onto main unless the user asks to resume this work.

## Feature state on this branch

PR #16, “Add email password recovery,” added student-ID-based email recovery:
- The sign-in page links to a student ID reset-request form.
- The Supabase Edge Function `request-password-reset` finds the contact address saved in the StudyHub profile, creates a single-use Supabase Auth recovery link for the internal auth account, and sends that link through Brevo.
- Supabase rate-limits requests to three per student ID per hour and sixty per IP per hour. The public response is intentionally generic.
- A recovery session lets the student choose a new password.
- Function code is in `supabase/functions/request-password-reset/index.ts`; relevant app, SQL, and setup changes are in PR #16. App version at merge was 1.2.19.

## Setup already completed by the user

The user reported:
- Applied the updated `supabase/schema.sql` in the Supabase SQL Editor.
- Deployed `request-password-reset` from the Dashboard with JWT verification disabled.
- Set Supabase Edge Function secrets `BREVO_API_KEY` and `RESET_EMAIL_FROM`. The Supabase-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must not be manually added as secrets.
- Added `https://aaadam-h.github.io/studyManagement/web/` to Supabase Auth Redirect URLs.
- Created/verified a Brevo sender and generated a standard API key. No key values are recorded here.
- Authorized the detected Brevo IPs. Brevo API-key IP blocking was still activated.

## Failure observed

- Supabase shows the function was invoked; its public POST returned HTTP 200.
- Edge Function logs recorded `Password recovery email delivery failed with status 401` on attempts around 02:48, 02:54, and 02:58 Malaysia time on 2026-10-07.
- Brevo transactional logs showed zero messages.
- Brevo’s API key list showed an active standard key named “StudyHub password reset”; its key value is intentionally not documented.
- Brevo’s authorized IP page showed three authorized IPv6 addresses attributed to Amazon.com and zero unauthorized addresses on a later check. API-key IP blocking was active.
- Attempts after three requests may have been rate-limited by the per-student hourly cap. Wait for the cap to clear before testing again.
- Do not ask the user to reveal API keys, recovery URLs, one-time codes, or student contact details.

## Next investigation when resumed

1. Diagnose why Brevo still returned 401 despite an active standard API key and authorized IPs. The Edge Function currently logs only the HTTP status, not Brevo's response body; consider adding carefully sanitized diagnostic logging or checking Brevo account/IP restrictions.
2. Avoid repeated reset requests: at most three per student ID per hour.
3. Make one controlled test after correcting the cause; verify both the Supabase function log and Brevo transactional log, then verify receipt at the profile contact address.
4. Confirm password reset links return to the deployed GitHub Pages app and that password update completes.

## Temporary main-branch direction

The user requested that main return to admin-assisted recovery for now: students contact the admin, who sets a temporary password, and the student must change it at next sign-in. Keep this in mind when resuming the email workflow: the email implementation is preserved here as work-in-progress, not the current main experience.
