// Fill these in from Supabase > Project Settings > API (or "Connect" button).
// The anon/publishable key is meant to be public; security comes from the database rules in supabase/schema.sql.
// NEVER put the service_role / secret key here.
window.STUDYHUB_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
  // Students log in with their student ID; it is turned into this internal email. Don't change it after people register.
  LOGIN_EMAIL_DOMAIN: 'students.studyhub.app',
};
