// Public endpoint. Supabase Gateway JWT verification should be disabled; the request is
// intentionally unauthenticated and protected by hashed-ID/IP throttles in Postgres.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const APP_URL = Deno.env.get('RESET_REDIRECT_URL') || 'https://aaadam-h.github.io/studyManagement/web/';
const GENERIC_MESSAGE = 'If a recovery email is on file for that student ID, a reset link is on its way.';
const allowedOrigins = new Set([
  'https://aaadam-h.github.io',
  'http://studymanagement.test',
  'http://localhost',
  'http://127.0.0.1',
]);

function headersFor(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://aaadam-h.github.io',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headersFor(req) });
}
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: headersFor(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);

  let studentId = '';
  try {
    const body = await req.json();
    studentId = typeof body?.student_id === 'string' ? body.student_id.trim() : '';
  } catch {
    return json(req, { error: 'Enter a valid student ID.' }, 400);
  }
  if (!/^\d{9}$/.test(studentId)) return json(req, { error: 'Enter a valid student ID.' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const brevoKey = Deno.env.get('BREVO_API_KEY');
  const sender = Deno.env.get('RESET_EMAIL_FROM');
  if (!supabaseUrl || !serviceKey || !brevoKey || !sender) {
    console.error('Password recovery is missing required server configuration.');
    return json(req, { error: 'Password recovery is not configured yet.' }, 503);
  }

  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const studentHash = await sha256(`student:${studentId}`);
    const ipHash = await sha256(`ip:${forwardedFor}`);
    const { data: allowed, error: limitError } = await admin.rpc('consume_password_reset_limits', {
      p_student_hash: studentHash,
      p_ip_hash: ipHash,
    });
    if (limitError) {
      console.error('Password recovery throttling is unavailable.');
      return json(req, { error: 'Password recovery is temporarily unavailable.' }, 503);
    }
    if (!allowed) return json(req, { message: GENERIC_MESSAGE });

    const { data: profile, error: profileError } = await admin
      .from('profiles').select('id,email').eq('student_id', studentId).maybeSingle();
    if (profileError || !profile?.id || !profile.email) return json(req, { message: GENERIC_MESSAGE });

    const recoveryEmail = String(profile.email).trim();
    if (recoveryEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)) {
      return json(req, { message: GENERIC_MESSAGE });
    }
    const { data: authResult, error: authError } = await admin.auth.admin.getUserById(profile.id);
    const loginEmail = authResult?.user?.email;
    if (authError || !loginEmail) return json(req, { message: GENERIC_MESSAGE });

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: loginEmail,
      options: { redirectTo: APP_URL },
    });
    const actionLink = linkData?.properties?.action_link;
    if (linkError || !actionLink) {
      console.error('Password recovery link generation failed.');
      return json(req, { message: GENERIC_MESSAGE });
    }

    const safeLink = escapeHtml(actionLink);
    const mail = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: sender, name: 'StudyHub' },
        to: [{ email: recoveryEmail }],
        subject: 'Reset your StudyHub password',
        textContent: `We received a request to reset your StudyHub password. Use this secure link to choose a new password: ${actionLink}\n\nIf you did not request this, you can ignore this email.`,
        htmlContent: `<p>We received a request to reset your StudyHub password.</p><p><a href="${safeLink}">Choose a new password</a></p><p>This link is single-use. If you did not request this, you can ignore this email.</p>`,
      }),
    });
    if (!mail.ok) console.error('Password recovery email delivery failed with status', mail.status);
    return json(req, { message: GENERIC_MESSAGE });
  } catch (error) {
    console.error('Password recovery request failed:', error instanceof Error ? error.name : 'unknown');
    return json(req, { message: GENERIC_MESSAGE });
  }
});
