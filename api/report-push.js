/* =====================================================================
   Sky Team Ife - heads-up to offices that a weekly report is not filed.

   Called by the database's scheduler (pg_cron, see
   supabase/RUN-THIS-ONCE.sql (PART 10)) at 10:00am Lagos time, Monday to
   Thursday. For every active office it looks at last week's report and
   this week's report. Offices with both in get nothing. Offices missing
   one or both get a push on every device the office login and its
   Senior Managers turned notifications on for.

   A week runs Thursday to Wednesday. On Thursday morning the new week has
   only just opened, so only LAST week's report is asked for then.

   POST /api/report-push    header  x-cron-secret: <CRON_SECRET>

   Uses the same three environment variables as /api/code-push:
   VAPID_PRIVATE_KEY, CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY.
   ===================================================================== */
const webpush = require('web-push');

const SUPABASE_URL = 'https://xuxukwrvyduilmxyswik.supabase.co';
const VAPID_PUBLIC = 'BE9-3jwbOU921KXzV_GpUL9MrlfmpS3LSM1C_tvFqsOEe_j2w9KymfUYJFkOerll1ibphAn9RshSmEnPz4JpIeg';
const APP_URL = 'https://sky-team-ife.vercel.app';

const iso = (d) => d.toISOString().slice(0, 10);

/* The Thursday that opened the week containing this Lagos date. */
function weekStartOf(lagosNow) {
  const midnight = Date.parse(iso(lagosNow) + 'T00:00:00Z');
  const back = (lagosNow.getUTCDay() - 4 + 7) % 7;
  return new Date(midnight - back * 86400000);
}

/* What to say, given what is missing. Pure, so it is easy to check. */
function messageFor(missingLast, missingThis, needNumbers) {
  const tail = needNumbers ? ' Add your distributor numbers too, even without the names.' : '';
  if (missingLast && missingThis) return { title: 'Weekly reports to file', body: 'Last week\'s and this week\'s reports are not filed yet.' + tail };
  if (missingLast) return { title: 'Last week\'s report', body: 'Last week\'s report is not filed yet. It takes two minutes.' + tail };
  if (missingThis) return { title: 'This week\'s report', body: 'This week\'s report is not filed yet. The week closes on Wednesday.' + tail };
  if (needNumbers) return { title: 'Your distributor numbers', body: 'Add your distributor numbers to this week\'s report, even without the names, so the team can track growth.' };
  return null;
}

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

  const lagos = new Date(Date.now() + 3600 * 1000);
  const dow = lagos.getUTCDay();
  if (dow < 1 || dow > 4) return send(200, { skipped: 'Reminders go out Monday to Thursday only.' });

  const thisWk = weekStartOf(lagos);
  const lastWk = new Date(thisWk.getTime() - 7 * 86400000);
  const wThis = iso(thisWk), wLast = iso(lastWk);
  const onThursday = dow === 4;

  const offices = await getJson('/rest/v1/offices?select=id,name&active=eq.true&limit=5000');
  if (!offices.length) return send(200, { sent: 0, note: 'No offices.' });
  const reports = await getJson('/rest/v1/reports?select=office_id,week_start,num_distributors,num_senior_managers,num_newbies,num_prospects'
    + '&week_start=in.(' + wThis + ',' + wLast + ')&limit=10000');
  const people = await getJson('/rest/v1/profiles?select=id,role,office_id,member_office_id&role=in.(office,member)&limit=10000');
  const subs = await getJson('/rest/v1/push_subscriptions?select=id,user_id,endpoint,p256dh,auth&limit=20000');

  const subsOf = {};
  subs.forEach(s => { (subsOf[s.user_id] = subsOf[s.user_id] || []).push(s); });

  const jobs = [];
  let notified = 0, sent = 0, failed = 0, skipped = 0;
  offices.forEach(o => {
    const last = reports.find(r => r.office_id === o.id && r.week_start === wLast);
    const cur = reports.find(r => r.office_id === o.id && r.week_start === wThis);
    const missingLast = !last;
    const missingThis = !cur && !onThursday;
    const latest = cur || last;
    const headcount = latest
      ? (Number(latest.num_distributors) || 0) + (Number(latest.num_senior_managers) || 0)
        + (Number(latest.num_newbies) || 0) + (Number(latest.num_prospects) || 0)
      : 0;
    const needNumbers = !!latest && headcount === 0;
    const msg = messageFor(missingLast, missingThis, needNumbers);
    if (!msg) { skipped++; return; }

    const payload = JSON.stringify({
      title: msg.title, body: o.name + ': ' + msg.body,
      url: APP_URL + '/#/reports', tag: 'sti-report-' + o.id
    });
    people.filter(p => p.office_id === o.id || p.member_office_id === o.id).forEach(p => {
      (subsOf[p.id] || []).forEach(s => {
        notified++;
        jobs.push(webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 43200 })
          .then(() => { sent++; })
          .catch(async (e) => {
            failed++;
            if (e.statusCode === 404 || e.statusCode === 410) await sb('/rest/v1/push_subscriptions?id=eq.' + s.id, { method: 'DELETE' });
          }));
      });
    });
  });
  await Promise.all(jobs);
  return send(200, { offices: offices.length, upToDate: skipped, devices: notified, sent, failed, thisWeek: wThis, lastWeek: wLast });
};

module.exports.messageFor = messageFor;
module.exports.weekStartOf = weekStartOf;
