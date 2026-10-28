/* =====================================================================
   Sky Team Ife - Wednesday code, pushed to the Directors.

   Called by the database's scheduler (pg_cron, see
   supabase/2026-11-member-cron.sql) at 14:00 and 15:05
   Lagos time on Wednesdays. It sends each Director the same code
   for their zone, as a push notification on every device they turned
   notifications on for.

   POST /api/code-push    header  x-cron-secret: <CRON_SECRET>

   Needs three environment variables in Vercel:
     VAPID_PRIVATE_KEY           already set for /api/push
     CRON_SECRET                 any long random string you choose; the
                                 same string goes into the cron SQL
     SUPABASE_SERVICE_ROLE_KEY   Supabase -> Project Settings -> API ->
                                 service_role. Server side only. Never
                                 put it in config.js or git.
   ===================================================================== */
const webpush = require('web-push');

const SUPABASE_URL = 'https://xuxukwrvyduilmxyswik.supabase.co';
const VAPID_PUBLIC = 'BE9-3jwbOU921KXzV_GpUL9MrlfmpS3LSM1C_tvFqsOEe_j2w9KymfUYJFkOerll1ibphAn9RshSmEnPz4JpIeg';
const APP_URL = 'https://sky-team-ife.vercel.app';

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const send = (code, body) => res.status(code).send(JSON.stringify(body));
  if (req.method !== 'POST') return send(405, { error: 'POST only' });

  const secret = process.env.CRON_SECRET, key = process.env.SUPABASE_SERVICE_ROLE_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!secret || !key || !priv) return send(503, { error: 'Set CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY and VAPID_PRIVATE_KEY in Vercel, then redeploy.' });
  if (req.headers['x-cron-secret'] !== secret) return send(401, { error: 'No.' });
  webpush.setVapidDetails(APP_URL, VAPID_PUBLIC, priv.trim());

  const sb = (path, init) => fetch(SUPABASE_URL + path, Object.assign({}, init, {
    headers: Object.assign({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      (init && init.headers) || {})
  }));
  const getJson = async (path) => { const r = await sb(path); return r.ok ? r.json() : []; };

  /* Lagos is UTC+1 all year. Only Wednesdays send anything. */
  const lagos = new Date(Date.now() + 3600 * 1000);
  if (lagos.getUTCDay() !== 3) return send(200, { skipped: 'Not Wednesday in Lagos.' });
  const wed = lagos.toISOString().slice(0, 10);
  const thu = new Date(Date.parse(wed + 'T00:00:00Z') - 6 * 86400000).toISOString().slice(0, 10);

  const centers = await getJson('/rest/v1/centers?select=id,name');
  /* Make sure each zone's training for this week exists, which creates its code. */
  await Promise.all(centers.map(c => sb('/rest/v1/rpc/ensure_week_events_for', {
    method: 'POST', body: JSON.stringify({ p_center: c.id, p_week: thu })
  })));

  const codes = await getJson('/rest/v1/event_codes?select=code,events!inner(center_id,week_start,type)'
    + '&events.week_start=eq.' + thu + '&events.type=eq.SM');
  const codeOf = {};
  codes.forEach(c => { codeOf[c.events.center_id] = c.code; });

  const directors = await getJson('/rest/v1/profiles?select=id,full_name,center_id&role=eq.platform_admin');
  if (!directors.length) return send(200, { sent: 0, note: 'No Directors.' });
  const subs = await getJson('/rest/v1/push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.('
    + directors.map(d => d.id).join(',') + ')');

  let sent = 0, failed = 0;
  const jobs = [];
  directors.forEach(d => {
    const zones = d.center_id ? centers.filter(c => c.id === d.center_id) : centers;
    zones.forEach(z => {
      if (!codeOf[z.id]) return;
      const payload = JSON.stringify({
        title: 'Wednesday code: ' + codeOf[z.id],
        body: z.name + ' Senior Manager Training. Give this code to your Senior and Executive Managers to check in.',
        url: APP_URL + '/#/codes',
        tag: 'sti-code-' + z.id
      });
      subs.filter(s => s.user_id === d.id).forEach(s => jobs.push(
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 })
          .then(() => { sent++; })
          .catch(async (e) => {
            failed++;
            if (e.statusCode === 404 || e.statusCode === 410) await sb('/rest/v1/push_subscriptions?id=eq.' + s.id, { method: 'DELETE' });
          })));
    });
  });
  await Promise.all(jobs);
  return send(200, { sent, failed, week: thu });
};
