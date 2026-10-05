// Supabase Edge Function: a student's timetable as an iCalendar feed, for subscribing in Google / Apple Calendar.
// Calendar apps fetch it without logging in, so deploy it with "Verify JWT" OFF.
// It's still private: the ?token= is each student's secret, and the database only answers for a valid token.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { categories, filterCalendar } from './filter.js';

const allowedOrigins = new Set([
  'https://aaadam-h.github.io',
  'http://studymanagement.test',
  'http://localhost',
  'http://127.0.0.1',
]);
type CalendarCategory = 'all' | 'lecture' | 'lab' | 'tutorial' | 'other' | 'holiday';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const cors: Record<string, string> = { Vary: 'Origin' };
  if (origin && allowedOrigins.has(origin)) {
    cors['Access-Control-Allow-Origin'] = origin;
    cors['Access-Control-Allow-Headers'] = 'apikey, content-type';
    cors['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    cors['Access-Control-Max-Age'] = '86400';
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const respond = (body: string, status: number, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers: { ...cors, ...headers } });
  if (req.method !== 'GET') return respond('Method not allowed', 405, { Allow: 'GET, OPTIONS' });
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(token)) return respond('Missing or invalid token', 400);
  const requestedCategory = (url.searchParams.get('category') ?? 'all').toLowerCase();
  if (!Object.hasOwn(categories, requestedCategory)) return respond('Unknown calendar category', 400);
  const category = requestedCategory as CalendarCategory;
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await sb.rpc('calendar_feed', { token });
  if (error) return respond('Calendar unavailable', 500);
  if (!data) return respond('Calendar not found (the link may have been reset)', 404);
  const calendar = category === 'all' ? data : filterCalendar(data, category);
  return respond(calendar, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `inline; filename="studyhub-${category}.ics"`,
    'Cache-Control': 'max-age=900',
  });
});
