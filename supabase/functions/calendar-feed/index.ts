// Supabase Edge Function: a student's timetable as an iCalendar feed, for subscribing in Google / Apple Calendar.
// Calendar apps fetch it without logging in, so deploy it with "Verify JWT" OFF.
// It's still private: the ?token= is each student's secret, and the database only answers for a valid token.
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response('Missing or invalid token', { status: 400 });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await sb.rpc('calendar_feed', { token });
  if (error) return new Response('Calendar unavailable', { status: 500 });
  if (!data) return new Response('Calendar not found (the link may have been reset)', { status: 404 });
  return new Response(data, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="studyhub-timetable.ics"',
      'Cache-Control': 'max-age=900',
    },
  });
});
