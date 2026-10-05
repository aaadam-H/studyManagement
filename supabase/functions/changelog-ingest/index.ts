const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const decodePart = (part: string) => {
  const binary = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};
const decodeJson = (part: string) => JSON.parse(new TextDecoder().decode(decodePart(part)));

let cachedKeys: JsonWebKey[] = [];
let keysExpireAt = 0;
async function getGitHubKey(kid: string) {
  if (Date.now() >= keysExpireAt) {
    const response = await fetch('https://token.actions.githubusercontent.com/.well-known/jwks');
    if (!response.ok) throw new Error('Unable to retrieve GitHub signing keys');
    const data = await response.json();
    cachedKeys = data.keys || [];
    keysExpireAt = Date.now() + 10 * 60 * 1000;
  }
  return cachedKeys.find((key) => key.kid === kid && key.kty === 'RSA');
}

async function verifyGitHubToken(req: Request) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = decodeJson(parts[0]);
    const claims = decodeJson(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    if (claims.iss !== 'https://token.actions.githubusercontent.com') return false;
    if (!(claims.aud === 'studyhub-changelog' || Array.isArray(claims.aud) && claims.aud.includes('studyhub-changelog'))) return false;
    if (claims.repository !== 'aaadam-H/studyManagement' || claims.ref !== 'refs/heads/main' || claims.event_name !== 'push') return false;
    if (claims.workflow_ref !== 'aaadam-H/studyManagement/.github/workflows/changelog.yml@refs/heads/main') return false;
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp < now || typeof claims.nbf === 'number' && claims.nbf > now + 30) return false;
    const jwk = await getGitHubKey(header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodePart(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
      ? claims
      : false;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const claims = await verifyGitHubToken(req);
  if (!claims) return json({ error: 'unauthorized workflow' }, 401);
  try {
    const entry = await req.json();
    if (!/^[0-9a-f]{40}$/.test(entry.source_commit || '') || entry.source_commit !== claims.sha) return json({ error: 'invalid source commit' }, 400);
    if (typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 200) return json({ error: 'invalid title' }, 400);
    if (typeof entry.body !== 'string' || !entry.body.trim() || entry.body.length > 8000) return json({ error: 'invalid update details' }, 400);
    const baseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || (() => {
      try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default; } catch { return null; }
    })();
    if (!baseUrl || !serviceKey) return json({ error: 'database service is not configured' }, 500);
    const response = await fetch(`${baseUrl}/rest/v1/changelog?on_conflict=source_commit`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        source_commit: entry.source_commit,
        version: typeof entry.version === 'string' ? entry.version.slice(0, 40) : null,
        title: entry.title.trim(),
        body: entry.body.trim(),
        is_public: false,
      }),
    });
    if (!response.ok) return json({ error: 'could not save the generated update' }, 502);
    return json({ ok: true });
  } catch {
    return json({ error: 'invalid update payload' }, 400);
  }
});
