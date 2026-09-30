// Supabase Edge Function: fetches the timetable page saved in settings.timetable_url and returns its HTML.
// Browsers can't read the university site directly (cross-site), so the admin page calls this instead.
// Admins only, and it only ever fetches the saved link, so it can't be used as an open proxy.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error || !isAdmin) return json({ error: 'admin only' }, 403);

  const { data: row } = await sb.from('settings').select('value').eq('key', 'timetable_url').maybeSingle();
  let url: URL;
  try {
    url = new URL(row?.value ?? '');
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    return json({ error: 'timetable link is not a valid http(s) URL' }, 400);
  }
  try {
    const res = await fetch(url.origin + url.pathname + url.search, {
      signal: AbortSignal.timeout(25000),
      headers: { 'User-Agent': 'Mozilla/5.0 (StudyHub timetable sync)' },
    });
    if (!res.ok) return json({ error: `the page returned HTTP ${res.status}` }, 502);
    const html = await res.text();
    if (html.length > 15_000_000) return json({ error: 'page is too large' }, 502);
    return json({ html, url: url.href });
  } catch (e) {
    return json({ error: `could not reach ${url.host} (${(e as Error).message})` }, 502);
  }
});
