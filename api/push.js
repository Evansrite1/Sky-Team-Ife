/* =====================================================================
   Sky Team Ife — push notification sender (Vercel serverless function).

   Deployed with the site on every push to GitHub, at /api/push.

   POST /api/push   Authorization: Bearer <the caller's Supabase session>
     { "type": "test" }   sends a test notification to the caller's own
                          devices. Super Admin only.

   Needs one environment variable in Vercel (Settings -> Environment
   Variables): VAPID_PRIVATE_KEY. The public half lives below and in
   config.js — it is meant to be public.

   It talks to Supabase as the caller, with the caller's own session, so
   row level security still decides what it can see: it can only read
   and clean up the caller's own devices.
   ===================================================================== */
const webpush = require('web-push');

const SUPABASE_URL = 'https://xuxukwrvyduilmxyswik.supabase.co';
const ANON_KEY = 'sb_publishable_t4HoL9y_7ZYAo8xzf1TquA_imDgKZGe';
const VAPID_PUBLIC = 'BE9-3jwbOU921KXzV_GpUL9MrlfmpS3LSM1C_tvFqsOEe_j2w9KymfUYJFkOerll1ibphAn9RshSmEnPz4JpIeg';
const APP_URL = 'https://sky-team-ife.vercel.app';

const sb = (path, token, init) => fetch(SUPABASE_URL + path, Object.assign({}, init, {
  headers: Object.assign({ apikey: ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    (init && init.headers) || {})
}));

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).send(JSON.stringify({ error: 'POST only' }));

  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) {
    return res.status(503).send(JSON.stringify({
      error: 'Push is not set up yet: add VAPID_PRIVATE_KEY in Vercel, then redeploy.'
    }));
  }
  webpush.setVapidDetails(APP_URL, VAPID_PUBLIC, priv.trim());

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).send(JSON.stringify({ error: 'Sign in first.' }));

  /* Who is calling — Supabase checks the session, not us. */
  const who = await sb('/auth/v1/user', token);
  if (!who.ok) return res.status(401).send(JSON.stringify({ error: 'Your session has expired. Sign in again.' }));
  const user = await who.json();

  const prof = await (await sb('/rest/v1/profiles?select=role,full_name&id=eq.' + user.id, token)).json();
  const role = (prof[0] || {}).role;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const type = (body || {}).type;

  if (type !== 'test') return res.status(400).send(JSON.stringify({ error: 'Unknown type.' }));
  if (role !== 'super_admin') return res.status(403).send(JSON.stringify({ error: 'Only the Super Admin can send a test.' }));

  const subs = await (await sb('/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth&user_id=eq.' + user.id, token)).json();
  if (!Array.isArray(subs) || !subs.length) {
    return res.status(200).send(JSON.stringify({ sent: 0, failed: 0, note: 'No devices turned on for you yet.' }));
  }

  const payload = JSON.stringify({
    title: 'Sky Team Ife',
    body: 'Test notification — push is working on this device.',
    url: APP_URL + '/#/dashboard',
    tag: 'sti-test'
  });

  let sent = 0, failed = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
      sent++;
    } catch (e) {
      failed++;
      /* Gone for good — the browser unsubscribed or the app was removed. */
      if (e.statusCode === 404 || e.statusCode === 410) {
        await sb('/rest/v1/push_subscriptions?id=eq.' + s.id, token, { method: 'DELETE' });
      }
    }
  }));
  return res.status(200).send(JSON.stringify({ sent, failed }));
};
