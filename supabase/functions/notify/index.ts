/* =====================================================================
   notify — renewal reminders, the Monday zone digest, and a broadcast
   the Super Admin sends by hand, all by email.

   reminders and digest are not reachable from the browser at all —
   pg_cron calls this on a schedule (see supabase/2026-09-features.sql
   for the exact commands), passing { type: 'reminders' } or
   { type: 'digest' }. Nothing checks who is asking for those two,
   because nothing outside your own database ever does.

   broadcast is different: it IS called from the browser, by a Super
   Admin, on demand — "Send an announcement" in Admin -> Features — so
   it is the one type here that checks a real Supabase session and
   confirms the role before sending a single email. The other two stay
   open because pg_cron carries no Supabase token to check in the
   first place.

   All three check their own feature flag before sending anything, so
   deploying this function does nothing on its own — Admin -> Features
   is still the only thing that turns any of it on.

   Secrets (Supabase dashboard -> Edge Functions -> Manage secrets):
     RESEND_API_KEY   re_...           Resend -> API Keys
     NOTIFY_FROM      "Sky Team Ife <no-reply@yourdomain.com>"
                       must be a domain verified in Resend, or every
                       send in this function fails the same way.
   ===================================================================== */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function sendEmail(apiKey: string, from: string, to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html })
  });
  return { ok: res.ok, status: res.status, body: await res.text().catch(() => '') };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('NOTIFY_FROM');
  if (!apiKey || !from) return json({ error: 'RESEND_API_KEY or NOTIFY_FROM not set.' }, 500);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const setting = async (key: string) =>
    (await db.from('app_settings').select('value').eq('key', key).maybeSingle()).data?.value ?? null;

  const body = await req.json().catch(() => ({}));
  const type = body?.type;

  if (type === 'reminders') {
    if ((await setting('feature_renewal_emails')) !== 'true') return json({ skipped: 'feature off' });

    const days = ((await setting('notify_reminder_days')) ?? '7,3,1')
      .split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => n > 0);

    const { data: subs } = await db.from('subscriptions').select('office_id, status, trial_ends, next_charge');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const daysUntil = (dateStr: string | null) => {
      if (!dateStr) return null;
      const d = new Date(dateStr + 'T00:00:00');
      return Math.round((d.getTime() - today.getTime()) / 86400000);
    };

    let sent = 0, failed = 0;
    for (const s of subs ?? []) {
      const target = s.status === 'trial' ? s.trial_ends : s.status === 'active' ? s.next_charge : null;
      const left = daysUntil(target);
      if (left === null || !days.includes(left)) continue;

      const { data: profile } = await db.from('profiles')
        .select('email, full_name').eq('office_id', s.office_id).eq('role', 'office').maybeSingle();
      if (!profile?.email) continue;

      const { data: office } = await db.from('offices').select('name').eq('id', s.office_id).maybeSingle();
      const noun = s.status === 'trial' ? 'your free trial ends' : 'your next charge is due';
      const html = '<p>Hi' + (profile.full_name ? ' ' + profile.full_name : '') + ',</p>'
        + '<p><b>' + office?.name + '</b> — ' + noun + ' in <b>' + left + ' day' + (left === 1 ? '' : 's') + '</b>'
        + ' (' + target + ').</p>'
        + '<p>Nothing to do if you are already set up to renew. If not, open the app and go to Subscription.</p>';

      const r = await sendEmail(apiKey, from, profile.email,
        left <= 1 ? 'Sky Team Ife — renews tomorrow' : 'Sky Team Ife — ' + left + ' days left', html);
      if (r.ok) sent++; else failed++;
    }
    return json({ sent, failed });
  }

  if (type === 'digest') {
    if ((await setting('feature_monthly_digest')) !== 'true') return json({ skipped: 'feature off' });

    /* Last week, by whatever the app itself would call "last week" —
       computed the same way js/ui.js does, in plain JS rather than SQL,
       since the two never have to actually agree on it as long as this
       matches Thursday-anchored weeks. */
    const EPOCH = new Date('2026-07-30T00:00:00Z');
    const now = new Date();
    const dow = now.getUTCDay();
    const thisWeekStart = new Date(now);
    thisWeekStart.setUTCDate(now.getUTCDate() - ((dow - 4 + 7) % 7));
    thisWeekStart.setUTCHours(0, 0, 0, 0);
    const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setUTCDate(thisWeekStart.getUTCDate() - 7);
    const lastWeekIso = lastWeekStart.toISOString().slice(0, 10);
    const weekNo = Math.round((lastWeekStart.getTime() - EPOCH.getTime()) / 604800000) + 1;

    const { data: directors } = await db.from('profiles')
      .select('email, full_name, center_id').eq('role', 'platform_admin').not('center_id', 'is', null);

    let sent = 0, failed = 0;
    for (const dir of directors ?? []) {
      if (!dir.email) continue;
      const { data: center } = await db.from('centers').select('name').eq('id', dir.center_id).maybeSingle();
      const { data: reps } = await db.from('reports')
        .select('orders, amount, office_id').eq('center_id', dir.center_id).eq('week_start', lastWeekIso);
      const { data: offices } = await db.from('offices').select('id, name').eq('center_id', dir.center_id).eq('active', true);

      const orders = (reps ?? []).reduce((a, r) => a + (Number(r.orders) || 0), 0);
      const amount = (reps ?? []).reduce((a, r) => a + (Number(r.amount) || 0), 0);
      const filed = new Set((reps ?? []).map(r => r.office_id)).size;
      const total = offices?.length ?? 0;
      const top = (reps ?? []).slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0];
      const topName = top ? offices?.find(o => o.id === top.office_id)?.name ?? '—' : '—';

      const html = '<p>Hi' + (dir.full_name ? ' ' + dir.full_name : '') + ',</p>'
        + '<p><b>' + (center?.name ?? 'Your zone') + '</b> — Week ' + weekNo + ':</p>'
        + '<ul>'
        + '<li>' + orders.toLocaleString() + ' orders, ₦' + amount.toLocaleString() + '</li>'
        + '<li>' + filed + ' of ' + total + ' offices filed</li>'
        + '<li>Leading office: ' + topName + '</li>'
        + '</ul>'
        + '<p>Open the app for the full evaluation list.</p>';

      const r = await sendEmail(apiKey, from, dir.email, 'Sky Team Ife — Week ' + weekNo + ' zone summary', html);
      if (r.ok) sent++; else failed++;
    }
    return json({ sent, failed });
  }

  if (type === 'broadcast') {
    if ((await setting('feature_broadcast_email')) !== 'true') return json({ error: 'Announcements are turned off. Admin -> Features.' }, 403);

    /* The one type a real person calls, so the one type that checks who
       they actually are — a valid session belonging to a super_admin,
       not just a body that says so. */
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in.' }, 401);
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await asUser.auth.getUser();
    if (!userRes?.user) return json({ error: 'Not signed in.' }, 401);
    const { data: caller } = await db.from('profiles').select('role').eq('id', userRes.user.id).maybeSingle();
    if (caller?.role !== 'super_admin') return json({ error: 'Only the Super Admin can send an announcement.' }, 403);

    const subject = String(body?.subject ?? '').trim();
    const message = String(body?.message ?? '').trim();
    if (!subject || !message) return json({ error: 'Both a subject and a message are needed.' }, 400);

    /* Who it goes to. 'all' means every approved account with an email
       — office, platform_admin and super_admin alike — not the pending
       ones still waiting on approval, who have not agreed to anything
       yet and would not know what the app even was. */
    const audience = ['office', 'platform_admin', 'super_admin'].includes(body?.audience) ? body.audience : 'all';
    let q = db.from('profiles').select('email, full_name, role').neq('role', 'pending');
    if (audience !== 'all') q = q.eq('role', audience);
    const { data: recipients } = await q;

    const html = '<div>' + message.split(/\n{2,}/).map((p: string) =>
      '<p>' + p.split('\n').map((l: string) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('<br>') + '</p>').join('') + '</div>';

    let sent = 0, failed = 0;
    for (const r of recipients ?? []) {
      if (!r.email) continue;
      const res = await sendEmail(apiKey, from, r.email, subject, html);
      if (res.ok) sent++; else failed++;
    }
    return json({ sent, failed, audience });
  }

  return json({ error: 'Unknown type. Use "reminders", "digest" or "broadcast".' }, 400);
});
