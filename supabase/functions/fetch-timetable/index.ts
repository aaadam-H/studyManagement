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

// Don't let the saved link point at internal / cloud-metadata addresses
function isPrivateHost(h: string) {
  h = h.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

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
    if (isPrivateHost(url.hostname)) return json({ error: 'that address is not allowed' }, 400);
  } catch {
    return json({ error: 'timetable link is not a valid http(s) URL' }, 400);
  }
  try {
    const res = await fetch(url.origin + url.pathname + url.search, {
      signal: AbortSignal.timeout(25000),
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (StudyHub timetable sync)' },
    });
    if (res.status >= 300 && res.status < 400) return json({ error: `the page redirects to ${res.headers.get('location')}; save that address as the link instead` }, 502);
    if (!res.ok) return json({ error: `the page returned HTTP ${res.status}` }, 502);
    const html = await res.text();
    if (html.length > 15_000_000) return json({ error: 'page is too large' }, 502);
    return json({ html, url: url.href });
  } catch (e) {
    return json({ error: `could not reach ${url.host} (${(e as Error).message})` }, 502);
  }
});
